//! 插件市场网关实验性桥接（prototype，未提交的验证代码）。
//!
//! 与 `ncm_gateway` 同构：Rust 侧用 `std::process::Command` 把 Node 网关
//! （`scripts/plugin-index-gateway.mjs`）作为独立子进程 spawn 到 `127.0.0.1:3101`，
//! 再把远程市场操作（`plugins.refreshIndex` 拉取远端 `plugins.json`、
//! `plugins.installFromIndex` 下载 `.tep` 包）通过本地 HTTP 代理过去，拿到真实数据。
//! 远端 HTTPS 抓取由 Node 侧完成（离线 Rust crate 无 HTTP/TLS 客户端）。
//!
//! 这不是生产实现：
//! - 子进程不做生命周期管理（退出时不 kill，端口被外部占用时复用）。
//! - `.tep` 包以二进制原样回传（`http_get_bytes_blocking`），不经过
//!   `String::from_utf8_lossy`，保证字节级一致。
//! - 大小上限（索引 1MB、包 50MB）在 Node 侧强制；Rust 侧仅代理字节。
use serde_json::Value;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// 网关监听地址（与 `scripts/plugin-index-gateway.mjs` 对齐）。
pub const GATEWAY_HOST: &str = "127.0.0.1";
pub const GATEWAY_PORT: u16 = 3101;

/// 网关子进程句柄；`None` = 尚未由本进程 spawn（端口可能由外部进程如 Electron dev 服务）。
static GATEWAY_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn socket_addr() -> Option<SocketAddr> {
    (GATEWAY_HOST, GATEWAY_PORT).to_socket_addrs().ok()?.next()
}

fn try_connect() -> Option<TcpStream> {
    let addr = socket_addr()?;
    TcpStream::connect_timeout(&addr, Duration::from_millis(500)).ok()
}

/// 端口已可连通（无论网关由谁提供）。
pub fn port_open() -> bool {
    try_connect().is_some()
}

fn gateway_script_path() -> Option<PathBuf> {
    if let Ok(override_path) = std::env::var("PLUGIN_INDEX_GATEWAY_SCRIPT") {
        let candidate = PathBuf::from(override_path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    // 开发构建默认定位到仓库 `scripts/plugin-index-gateway.mjs`（编译期嵌入 manifest 目录）。
    let candidate =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/plugin-index-gateway.mjs");
    if candidate.is_file() {
        Some(candidate)
    } else {
        None
    }
}

/// 如端口未在服务则 spawn 网关子进程（幂等）。
fn spawn_if_needed() -> Result<(), String> {
    if port_open() {
        return Ok(());
    }
    let script = gateway_script_path()
        .ok_or("找不到插件索引网关启动脚本（scripts/plugin-index-gateway.mjs）")?;
    let child = Command::new("node")
        .arg(&script)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("启动插件索引网关失败（需要 Node.js）：{err}"))?;
    let guard = GATEWAY_CHILD.get_or_init(|| Mutex::new(None));
    *guard.lock().expect("gateway child lock") = Some(child);
    Ok(())
}

/// 确保网关就绪（spawn + 轮询端口），最多等待 `timeout`。
async fn ensure_gateway(timeout: Duration) -> Result<(), String> {
    spawn_if_needed()?;
    let deadline = tokio::time::Instant::now() + timeout;
    while tokio::time::Instant::now() < deadline {
        if port_open() {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err(format!("插件索引网关在 {}ms 内未就绪", timeout.as_millis()))
}

/// 在原始字节中定位 `\r\n\r\n`（响应头与响应体分界）。
fn find_header_body_split(raw: &[u8]) -> Option<usize> {
    raw.windows(4).position(|window| window == b"\r\n\r\n")
}

/// 解析 chunked 响应体（字节安全）。
fn decode_chunked_bytes(mut body: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    loop {
        let line_end = body
            .windows(2)
            .position(|window| window == b"\r\n")
            .ok_or("chunked 编码缺少行结束符")?;
        let size_str =
            std::str::from_utf8(&body[..line_end]).map_err(|_| "chunked 大小不是文本")?;
        let size = usize::from_str_radix(size_str.split(';').next().unwrap_or("").trim(), 16)
            .map_err(|_| format!("chunked 大小非法：{size_str}"))?;
        let chunk_start = line_end + 2;
        if size == 0 {
            break;
        }
        let chunk_end = chunk_start + size;
        if chunk_end > body.len() {
            return Err("chunked 数据不完整".into());
        }
        out.extend_from_slice(&body[chunk_start..chunk_end]);
        body = &body[chunk_end..];
        body = body.strip_prefix(b"\r\n").unwrap_or(body);
    }
    Ok(out)
}

/// 查询串值的最小化 percent-encode（保留 unreserved 字符，其余按字节转义）。
fn url_escape(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// 阻塞式 HTTP/1.1 GET（std `TcpStream`，读超时 = `timeout`）。返回 (status, 原始 body 字节)。
///
/// body 始终按字节保留（含二进制 `.tep` 包），不以 UTF-8 有损解码；长度按
/// `Content-Length` 截取，缺失时退回 chunked 解码 / 剩余全部字节。
fn http_get_bytes_blocking(
    path_and_query: &str,
    timeout: Duration,
) -> Result<(u16, Vec<u8>), String> {
    let mut stream = try_connect().ok_or("无法连接插件索引网关")?;
    stream
        .set_read_timeout(Some(timeout))
        .and_then(|_| stream.set_write_timeout(Some(timeout)))
        .map_err(|err| format!("设置插件索引网关连接超时失败：{err}"))?;

    let request = format!(
        "GET {path_and_query} HTTP/1.1\r\nHost: {GATEWAY_HOST}:{GATEWAY_PORT}\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|err| format!("发送插件索引网关请求失败：{err}"))?;

    let mut raw = Vec::new();
    stream
        .read_to_end(&mut raw)
        .map_err(|err| format!("读取插件索引网关响应失败：{err}"))?;

    let split = find_header_body_split(&raw).ok_or("插件索引网关响应缺少响应头分隔")?;
    let head = std::str::from_utf8(&raw[..split]).map_err(|_| "插件索引网关响应头不是合法文本")?;
    let mut head_lines = head.split("\r\n");
    let status_line = head_lines.next().ok_or("插件索引网关响应缺少状态行")?;
    let status: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let mut content_length: Option<usize> = None;
    let mut chunked = false;
    for line in head_lines {
        let lower = line.to_ascii_lowercase();
        if let Some(value) = lower.strip_prefix("content-length:") {
            content_length = value.trim().parse().ok();
        } else if let Some(value) = lower.strip_prefix("transfer-encoding:") {
            chunked = value.trim().contains("chunked");
        }
    }
    let body = if chunked {
        decode_chunked_bytes(&raw[split + 4..])?
    } else if let Some(length) = content_length {
        let end = (split + 4 + length).min(raw.len());
        raw[split + 4..end].to_vec()
    } else {
        raw[split + 4..].to_vec()
    };
    Ok((status, body))
}

/// 把 Node 侧错误响应体（JSON `{error}`）解析为错误文本。
fn gateway_error(status: u16, body: &[u8]) -> String {
    let text = String::from_utf8_lossy(body).trim().to_string();
    if text.is_empty() {
        format!("插件索引网关返回 HTTP {status}")
    } else {
        // 尽量提取 JSON `error` 字段。
        serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .unwrap_or(text)
    }
}

/// 将一次远端索引抓取代理到本地 Node 网关并返回解析后的 JSON。
pub async fn proxy_index_json(timeout: Duration) -> Result<Value, String> {
    ensure_gateway(Duration::from_secs(15)).await?;
    let blocking = tokio::task::spawn_blocking(move || http_get_bytes_blocking("/index", timeout));
    let result = tokio::time::timeout(timeout, blocking)
        .await
        .map_err(|_| format!("插件索引网关调用超时（>{}ms）", timeout.as_millis()))?
        .map_err(|err| format!("插件索引网关任务失败：{err}"))?;
    let (status, body) = result?;
    if status >= 400 {
        return Err(gateway_error(status, &body));
    }
    serde_json::from_slice(&body).map_err(|err| format!("插件索引网关响应不是合法 JSON：{err}"))
}

/// 将一次 `.tep` 包下载代理到本地 Node 网关并返回原始字节。
pub async fn proxy_package_bytes(source_url: &str, timeout: Duration) -> Result<Vec<u8>, String> {
    ensure_gateway(Duration::from_secs(15)).await?;
    let path = format!("/package?url={}", url_escape(source_url));
    let blocking = tokio::task::spawn_blocking(move || http_get_bytes_blocking(&path, timeout));
    let result = tokio::time::timeout(timeout, blocking)
        .await
        .map_err(|_| format!("插件索引网关调用超时（>{}ms）", timeout.as_millis()))?
        .map_err(|err| format!("插件索引网关任务失败：{err}"))?;
    let (status, body) = result?;
    if status >= 400 {
        return Err(gateway_error(status, &body));
    }
    Ok(body)
}
