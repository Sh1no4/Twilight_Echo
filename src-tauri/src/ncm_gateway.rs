
use serde_json::Value;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::time::Duration;

pub const GATEWAY_HOST: &str = "127.0.0.1";
pub const GATEWAY_PORT: u16 = 3100;

fn socket_addr() -> Option<SocketAddr> {
    (GATEWAY_HOST, GATEWAY_PORT).to_socket_addrs().ok()?.next()
}

fn try_connect() -> Option<TcpStream> {
    let addr = socket_addr()?;
    TcpStream::connect_timeout(&addr, Duration::from_millis(500)).ok()
}

pub fn port_open() -> bool {
    try_connect().is_some()
}

fn gateway_script_path() -> Option<PathBuf> {
    if let Ok(override_path) = std::env::var("NCM_GATEWAY_SCRIPT") {
        let candidate = PathBuf::from(override_path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    // 打包发布：随包分发的固定版本网关单文件（`sidecar/ncmGateway.js`，内含
    // 全部路由与依赖，用随包 Node 运行时自举）。数据文件随包在 `data/`。
    if let Some(resource_dir) = crate::node_sidecar::resource_dir() {
        let candidate = resource_dir.join("sidecar").join("ncmGateway.js");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    // 开发构建默认定位到仓库 `scripts/ncm-gateway.mjs`（编译期嵌入 manifest 目录）。
    let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/ncm-gateway.mjs");
    if candidate.is_file() {
        Some(candidate)
    } else {
        None
    }
}

fn spawn_if_needed() -> Result<(), String> {
    if port_open() {
        return Ok(());
    }
    let script =
        gateway_script_path().ok_or("找不到 NCM 网关启动脚本（scripts/ncm-gateway.mjs）")?;
    crate::node_sidecar::spawn_node_process(&[], &script)
        .map_err(|error| format!("启动 NCM 网关失败（需要 Node.js）：{error}"))
}

async fn ensure_gateway(timeout: Duration) -> Result<(), String> {
    spawn_if_needed()?;
    let deadline = tokio::time::Instant::now() + timeout;
    while tokio::time::Instant::now() < deadline {
        if port_open() {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err(format!("NCM 网关在 {}ms 内未就绪", timeout.as_millis()))
}

fn decode_chunked(mut body: &str) -> Result<String, String> {
    let mut out = String::new();
    loop {
        let line_end = body.find("\r\n").ok_or("chunked 编码缺少行结束符")?;
        let size_str = &body[..line_end];
        let size = usize::from_str_radix(size_str.split(';').next().unwrap_or("").trim(), 16)
            .map_err(|_| format!("chunked 大小非法：{size_str}"))?;
        if size == 0 {
            break;
        }
        let chunk_start = line_end + 2;
        let chunk_end = chunk_start + size;
        if chunk_end > body.len() {
            return Err("chunked 数据不完整".into());
        }
        out.push_str(&body[chunk_start..chunk_end]);
        body = &body[chunk_end..];
        body = body.strip_prefix("\r\n").unwrap_or(body);
    }
    Ok(out)
}

fn http_get_blocking(
    path_and_query: &str,
    headers: &[(String, String)],
    timeout: Duration,
) -> Result<(u16, String), String> {
    let mut stream = try_connect().ok_or("无法连接 NCM 网关")?;
    stream
        .set_read_timeout(Some(timeout))
        .and_then(|_| stream.set_write_timeout(Some(timeout)))
        .map_err(|err| format!("设置网关连接超时失败：{err}"))?;

    let mut request = format!(
        "GET {path_and_query} HTTP/1.1\r\nHost: {GATEWAY_HOST}:{GATEWAY_PORT}\r\nConnection: close\r\n"
    );
    for (name, value) in headers {
        request.push_str(&format!("{name}: {value}\r\n"));
    }
    request.push_str("\r\n");
    stream
        .write_all(request.as_bytes())
        .map_err(|err| format!("发送网关请求失败：{err}"))?;

    let mut raw = Vec::new();
    stream
        .read_to_end(&mut raw)
        .map_err(|err| format!("读取网关响应失败：{err}"))?;

    let text = String::from_utf8_lossy(&raw);
    let (head, body_raw) = text
        .split_once("\r\n\r\n")
        .ok_or("网关响应缺少响应头分隔")?;
    let mut head_lines = head.lines();
    let status_line = head_lines.next().ok_or("网关响应缺少状态行")?;
    let status: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let mut chunked = false;
    for line in head_lines {
        let lower = line.to_ascii_lowercase();
        if let Some(value) = lower.strip_prefix("transfer-encoding:") {
            chunked = value.trim().contains("chunked");
        }
    }
    let body = if chunked {
        decode_chunked(body_raw)?
    } else {
        body_raw.to_string()
    };
    Ok((status, body))
}

pub async fn proxy_json_call(
    path: &str,
    headers: Vec<(String, String)>,
    timeout: Duration,
) -> Result<Value, String> {
    ensure_gateway(Duration::from_secs(15)).await?;
    let path_owned = path.to_string();
    let blocking =
        tokio::task::spawn_blocking(move || http_get_blocking(&path_owned, &headers, timeout));
    let result = tokio::time::timeout(timeout, blocking)
        .await
        .map_err(|_| format!("NCM 网关调用超时（>{}ms）", timeout.as_millis()))?
        .map_err(|err| format!("NCM 网关任务失败：{err}"))?;
    let (status, body) = result?;
    if status >= 400 {
        return Err(format!("NCM 网关返回 HTTP {status}"));
    }
    serde_json::from_str(&body).map_err(|err| format!("NCM 网关响应不是合法 JSON：{err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires node + network"]
    fn proxy_reaches_real_ncm_endpoint() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let path = format!("/login/qr/key?timestamp={now}");
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(proxy_json_call(&path, Vec::new(), Duration::from_secs(20)));
        let value = result.expect("proxy call should reach the real NetEase gateway");
        assert_eq!(value.get("code"), Some(&Value::from(200)));
        assert!(
            value
                .get("data")
                .and_then(|d| d.get("unikey"))
                .and_then(Value::as_str)
                .is_some(),
            "response should carry a unikey: {value}"
        );
    }
}

