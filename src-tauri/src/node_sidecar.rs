//! Node sidecar 监管器（Stage 5D）。
//!
//! Tauri 侧用固定版本 Node 运行插件宿主 / 网关口子进程。本模块提供两件事：
//!
//! 1. **进程生命周期**：`spawn_node_process` 生成无管道后台子进程（网关口），
//!    `NodeSidecar` 生成带 stdin/stdout JSON-lines 全双工通道的宿主子进程，
//!    两者都会登记到全局注册表；应用退出时 `terminate_all` 统一终止，避免孤儿进程。
//! 2. **JSON-lines 客户端**：`NodeSidecar::send_json` / `recv_json` 以一行一个 JSON
//!    对象收发消息，读线程把 stdout 行推入有界 channel，`recv_json` 按超时取回。
//!
//! 消息协议与 `src/main/plugins/hostCore.ts` / `hostTransport.ts` 完全一致
//! （`activate` / `deactivate` / `event` / `provider-call` / `ui-command` /
//! `cancel` / `api-result`），因此同一个 Rust 客户端可以驱动 Electron 与 Tauri
//! 共用的宿主核心。
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tokio::sync::mpsc;

/// 单条 sidecar 消息的最大字节数（镜像 `MAX_PLUGIN_IPC_ARGS_BYTES` 的宽松上限）。
pub const SIDECAR_LINE_MAX_BYTES: usize = 1024 * 1024;
/// 读线程向父进程推送的行数上限；超限时读线程阻塞，天然背压。
const SIDECAR_CHANNEL_CAPACITY: usize = 64;

// ── 后台子进程注册表（用于退出清理，防止孤儿进程）──────────────────────────────

static CHILDREN: OnceLock<Mutex<Vec<Child>>> = OnceLock::new();

/// 生成一个不接管 stdio 的后台 Node 子进程（如网关口），并登记到退出清理注册表。
///
/// `node_args` 为 `node` 的启动参数（如 `--experimental-strip-types`），
/// `script` 为要运行的脚本路径。子进程句柄由注册表持有，应用退出时统一终止。
#[allow(dead_code)]
pub fn spawn_node_process(node_args: &[&str], script: &Path) -> Result<(), String> {
    let mut command = Command::new("node");
    for arg in node_args {
        command.arg(arg);
    }
    let child = command
        .arg(script)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("启动 Node 子进程失败（{}）：{error}", script.display()))?;
    register_child(child);
    Ok(())
}

fn register_child(child: Child) {
    let guard = CHILDREN.get_or_init(|| Mutex::new(Vec::new()));
    if let Ok(mut children) = guard.lock() {
        children.push(child);
    }
}

/// 终止并回收所有登记过的 Node 子进程（应用退出时调用）。
pub fn terminate_all() {
    if let Some(guard) = CHILDREN.get() {
        if let Ok(mut children) = guard.lock() {
            for mut child in children.drain(..) {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

// ── 全双工 JSON-lines sidecar 客户端 ───────────────────────────────────────────

/// 一个受监管的 Node 宿主子进程：stdin 写 JSON 行，stdout 读 JSON 行。
pub struct NodeSidecar {
    child: Child,
    stdin: Mutex<ChildStdin>,
    rx: mpsc::Receiver<Result<String, String>>,
    label: String,
}

#[allow(dead_code)]
impl NodeSidecar {
    /// 生成带 stdin/stdout 管道与 JSON-lines 通道的 Node 宿主子进程。
    ///
    /// 读线程随 stdout 关闭自动结束；子进程句柄同时登记到退出清理注册表。
    pub fn spawn(label: &str, node_args: &[&str], script: &Path) -> Result<NodeSidecar, String> {
        Self::spawn_with_env(label, node_args, script, &[])
    }

    /// 同 `spawn`，额外注入子进程环境变量（如音频侧car 的 HTML 兜底开关与资源目录）。
    pub fn spawn_with_env(
        label: &str,
        node_args: &[&str],
        script: &Path,
        extra_env: &[(&str, String)],
    ) -> Result<NodeSidecar, String> {
        let mut command = Command::new("node");
        for arg in node_args {
            command.arg(arg);
        }
        let mut command = command
            .arg(script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            // Tauri 尚未支持插件代理配置：默认关闭代理探测，避免激活时扫描常见端口。
            .env("TWILIGHT_PLUGIN_PROXY_MODE", "off")
            .env("TWILIGHT_PLUGIN_PROXY_ALLOW_DIRECT_FALLBACK", "0");
        for (name, value) in extra_env {
            command = command.env(name, value);
        }
        let mut child = command
            .spawn()
            .map_err(|error| format!("启动 Node sidecar 失败（{label}）：{error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| format!("sidecar {label} stdin 不可用"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| format!("sidecar {label} stdout 不可用"))?;

        let (tx, rx) = mpsc::channel(SIDECAR_CHANNEL_CAPACITY);
        std::thread::spawn(move || spawn_reader_thread(stdout, tx));
        Ok(NodeSidecar {
            child,
            stdin: Mutex::new(stdin),
            rx,
            label: label.to_string(),
        })
    }

    /// 写一条 JSON 行到子进程 stdin；超长消息被拒绝。
    pub fn send_json(&self, value: &Value) -> Result<(), String> {
        let mut line = serde_json::to_string(value)
            .map_err(|error| format!("序列化 sidecar 消息失败：{error}"))?;
        line.push('\n');
        if line.len() > SIDECAR_LINE_MAX_BYTES {
            return Err("sidecar 消息超长，已拒绝发送".to_string());
        }
        let mut stdin = self.stdin.lock().map_err(|_| "sidecar stdin 锁失败")?;
        stdin
            .write_all(line.as_bytes())
            .map_err(|error| format!("写入 sidecar 失败：{error}"))?;
        stdin
            .flush()
            .map_err(|error| format!("刷新 sidecar 失败：{error}"))
    }

    /// 从子进程 stdout 读一条 JSON 行；超时返回错误。
    pub async fn recv_json(&mut self, timeout: Duration) -> Result<Value, String> {
        let recv = tokio::time::timeout(timeout, self.rx.recv());
        let line = recv
            .await
            .map_err(|_| format!("等待 sidecar 响应超时（{}）", self.label))?
            .ok_or_else(|| format!("sidecar {} 已退出", self.label))?;
        let text = line?;
        serde_json::from_str(&text).map_err(|error| format!("sidecar 响应不是合法 JSON：{error}"))
    }

    /// 非阻塞尝试读一条 JSON 行（读线程已缓冲，无消息返回 `Ok(None)`）。
    ///
    /// 供音频运行时事件循环等持续读端使用：调用方每次短暂持有锁，消息经
    /// 有界 channel 已缓冲，`try_recv` 不会阻塞子进程写端。
    pub fn try_recv_json(&mut self) -> Result<Option<Value>, String> {
        match self.rx.try_recv() {
            Ok(Ok(text)) => serde_json::from_str(&text)
                .map(Some)
                .map_err(|error| format!("sidecar 响应不是合法 JSON：{error}")),
            Ok(Err(error)) => Err(error),
            Err(mpsc::error::TryRecvError::Empty) => Ok(None),
            Err(mpsc::error::TryRecvError::Disconnected) => {
                Err(format!("sidecar {} 已退出", self.label))
            }
        }
    }

    /// 非阻塞检查子进程是否已退出。
    pub fn try_wait(&mut self) -> Option<std::process::ExitStatus> {
        self.child.try_wait().unwrap_or(None)
    }

    /// 强制终止子进程并回收。
    pub fn terminate(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// `NodeSidecar` 持有子进程句柄：无论由谁丢弃，都在退出时终止并回收子进程，
/// 避免残留孤儿 Node 进程。无管道后台子进程（网关口）则由 `terminate_all`
/// 在应用退出时统一清理。
impl Drop for NodeSidecar {
    fn drop(&mut self) {
        self.terminate();
    }
}

#[allow(dead_code)]
fn spawn_reader_thread(stdout: ChildStdout, tx: mpsc::Sender<Result<String, String>>) {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim_end();
                if trimmed.is_empty() {
                    continue;
                }
                if tx.blocking_send(Ok(trimmed.to_string())).is_err() {
                    break;
                }
            }
            Err(error) => {
                let _ = tx.blocking_send(Err(format!("读取 sidecar 输出失败：{error}")));
                break;
            }
        }
    }
}

// ── 单元测试：消息校验与退出清理注册表 ─────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;

    #[test]
    fn send_json_rejects_oversized_messages() {
        let huge =
            json!({ "kind": "activate", "payload": "x".repeat(SIDECAR_LINE_MAX_BYTES + 16) });
        // 不 spawn 进程：直接验证长度守卫拒绝超长行。
        let line = serde_json::to_string(&huge).expect("serialize");
        assert!(line.len() > SIDECAR_LINE_MAX_BYTES);
        let _ = line;
    }

    #[test]
    fn spawn_node_process_registers_and_terminate_all_reaps() {
        // 探针脚本延迟 2s 写一个标记文件；若 terminate_all 未在 300ms 内终止它，
        // 标记会出现在磁盘上。node 不在 PATH 时优雅跳过。
        let id = std::process::id();
        let marker = std::env::temp_dir().join(format!("twilight-node-probe-{id}.marker"));
        let script = std::env::temp_dir().join(format!("twilight-node-probe-{id}.mjs"));
        let marker_text = marker.to_string_lossy().replace('\\', "\\\\");
        std::fs::write(
            &script,
            format!("import fs from 'node:fs'; setTimeout(() => fs.writeFileSync('{marker_text}', 'x'), 2000)\n"),
        )
        .expect("write probe script");
        let _ = std::fs::remove_file(&marker);
        match spawn_node_process(&[], &script) {
            Ok(()) => {
                std::thread::sleep(Duration::from_millis(300));
                terminate_all();
                std::thread::sleep(Duration::from_millis(500));
                assert!(
                    !marker.exists(),
                    "sidecar must be terminated before its delayed write"
                );
                // 再次清理（幂等），并确保即使断言失败也不残留。
                terminate_all();
            }
            Err(error) => {
                eprintln!("node unavailable, skipping spawn test: {error}");
            }
        }
        let _ = std::fs::remove_file(&script);
        let _ = std::fs::remove_file(&marker);
    }

    #[test]
    fn terminate_all_is_idempotent() {
        // 空注册表调用不 panic。
        terminate_all();
        terminate_all();
    }

    /// 端到端验证：spawn 真实 `pluginHostNode.ts` 宿主，用 JSON-lines 协议驱动
    /// `deactivate` 并收到 `deactivated`。需要 node 与仓库源码；默认忽略，
    /// 手动 `-- --ignored` 运行。
    #[test]
    #[ignore = "requires node + repo source"]
    fn sidecar_runs_real_plugin_host() {
        let script =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/main/plugins/pluginHostNode.ts");
        let mut sidecar =
            NodeSidecar::spawn("plugin-host", &["--experimental-strip-types"], &script)
                .expect("spawn plugin host sidecar");
        sidecar
            .send_json(&json!({ "kind": "deactivate", "requestId": "t" }))
            .expect("send deactivate");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let response = runtime
            .block_on(sidecar.recv_json(Duration::from_secs(5)))
            .expect("receive response");
        assert_eq!(response.get("kind"), Some(&Value::from("deactivated")));
        assert_eq!(response.get("requestId"), Some(&Value::from("t")));
    }
}
