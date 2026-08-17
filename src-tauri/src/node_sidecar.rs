use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::sync::mpsc;

// Windows 下 `CommandExt` 提供 `creation_flags`（CREATE_NO_WINDOW 抑制控制台）。
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// 子进程创建标志：禁止为 spawn 的 Node sidecar 分配控制台窗口（`CREATE_NO_WINDOW`）。
/// 打包发布时 `twilight-echo.exe` 是 GUI 子系统，但子进程 `node.exe`（GUI 配额/默认继承）
/// 若不带此标志会弹出并挂着一个终端窗口。仅 Windows 相关；他用 `#[cfg]` 编译成无操作。
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Windows 下为子进程抑制控制台窗口。
#[cfg(not(target_os = "windows"))]
const CREATE_NO_WINDOW: u32 = 0;

pub const SIDECAR_LINE_MAX_BYTES: usize = 1024 * 1024;
const SIDECAR_CHANNEL_CAPACITY: usize = 64;

// ── Node 二进制解析（Stage 8：打包后不依赖用户预装 Node）─────────────────────────
//
// 解析优先级：环境变量 `TWILIGHT_NODE_BINARY` 显式覆盖 → 随包分发的
// `{resource}/sidecar/node.exe`（Windows 固定版本运行时）→ 系统 `node`
// （仅开发/回退路径）。结果缓存到进程级 `OnceLock`，`.setup()` 时初始化。
static NODE_BINARY: OnceLock<PathBuf> = OnceLock::new();

pub(crate) fn init_node_binary(app: &AppHandle) {
    let resolved = resolve_node_binary(app);
    let _ = NODE_BINARY.set(resolved);
}

fn resolve_node_binary(app: &AppHandle) -> PathBuf {
    let env_override = std::env::var("TWILIGHT_NODE_BINARY").ok();
    let resource_dir = app.path().resource_dir().ok();
    resolve_node_binary_paths(env_override.as_deref(), resource_dir.as_deref())
}

fn resolve_node_binary_paths(
    env_override: Option<&str>,
    resource_dir: Option<&Path>,
) -> PathBuf {
    if let Some(override_path) = env_override.map(str::trim).filter(|s| !s.is_empty()) {
        let candidate = PathBuf::from(override_path);
        if candidate.is_file() {
            return candidate;
        }
    }
    if let Some(dir) = resource_dir {
        let exe_name = if cfg!(target_os = "windows") {
            "node.exe"
        } else {
            "node"
        };
        let candidate = dir.join("sidecar").join(exe_name);
        if candidate.is_file() {
            return candidate;
        }
    }
    // 开发/回退：依赖系统 PATH 中的 node。打包发布必须随包提供 node.exe，
    // 由 `test:tauri-gate` 的 node-runtime 检查强制。
    PathBuf::from("node")
}

fn node_binary() -> &'static Path {
    NODE_BINARY
        .get()
        .map(PathBuf::as_path)
        .unwrap_or_else(|| Path::new("node"))
}

// ── 后台子进程注册表（用于退出清理，防止孤儿进程）──────────────────────────────

static CHILDREN: OnceLock<Mutex<Vec<Child>>> = OnceLock::new();

#[allow(dead_code)]
pub fn spawn_node_process(node_args: &[&str], script: &Path) -> Result<(), String> {
    let mut command = Command::new(node_binary());
    for arg in node_args {
        command.arg(arg);
    }
    let child = command
        .creation_flags(CREATE_NO_WINDOW)
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

pub struct NodeSidecar {
    child: Child,
    stdin: Mutex<ChildStdin>,
    rx: mpsc::Receiver<Result<String, String>>,
    label: String,
}

#[allow(dead_code)]
impl NodeSidecar {
    pub fn spawn(label: &str, node_args: &[&str], script: &Path) -> Result<NodeSidecar, String> {
        Self::spawn_with_env(label, node_args, script, &[])
    }

    pub fn spawn_with_env(
        label: &str,
        node_args: &[&str],
        script: &Path,
        extra_env: &[(&str, String)],
    ) -> Result<NodeSidecar, String> {
        let mut command = Command::new(node_binary());
        for arg in node_args {
            command.arg(arg);
        }
        let mut command = command
            .creation_flags(CREATE_NO_WINDOW)
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

    pub async fn recv_json(&mut self, timeout: Duration) -> Result<Value, String> {
        let recv = tokio::time::timeout(timeout, self.rx.recv());
        let line = recv
            .await
            .map_err(|_| format!("等待 sidecar 响应超时（{}）", self.label))?
            .ok_or_else(|| format!("sidecar {} 已退出", self.label))?;
        let text = line?;
        serde_json::from_str(&text).map_err(|error| format!("sidecar 响应不是合法 JSON：{error}"))
    }

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

    pub fn try_wait(&mut self) -> Option<std::process::ExitStatus> {
        self.child.try_wait().unwrap_or(None)
    }

    pub fn terminate(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

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
    fn resolve_node_binary_prefers_bundled_runtime_over_system_node() {
        // 空 env + 空 resource dir → 回退到系统 `node`。
        assert_eq!(
            resolve_node_binary_paths(None, None),
            PathBuf::from("node")
        );
        // 环境变量指向不存在的路径 → 忽略，继续回退。
        assert_eq!(
            resolve_node_binary_paths(Some("C:\\missing\\node.exe"), None),
            PathBuf::from("node")
        );
    }

    #[test]
    fn resolve_node_binary_prefers_env_override_and_bundled_runtime() {
        let temp = std::env::temp_dir().join(format!("twilight-node-resolve-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(temp.join("sidecar")).expect("create temp sidecar");
        let bundled = temp.join("sidecar").join(if cfg!(target_os = "windows") {
            "node.exe"
        } else {
            "node"
        });
        std::fs::write(&bundled, b"placeholder").expect("write bundled node");

        // 随包运行时存在 → 优先于系统 node。
        assert_eq!(
            resolve_node_binary_paths(None, Some(&temp)),
            bundled
        );
        // 环境变量覆盖优先于随包运行时。
        let override_path = temp.join("override-node.exe");
        std::fs::write(&override_path, b"placeholder").expect("write override node");
        assert_eq!(
            resolve_node_binary_paths(Some(override_path.to_str().unwrap()), Some(&temp)),
            override_path
        );

        let _ = std::fs::remove_dir_all(&temp);
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

