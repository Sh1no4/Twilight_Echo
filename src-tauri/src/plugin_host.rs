//! 插件宿主 sidecar 监管（Stage 5B）。
//!
//! Tauri 不重写 JavaScript 插件运行时：`src/main/plugins/hostCore.ts` 是共享宿主核心，
//! Electron 用 utility-process transport，Tauri 用 `src/main/plugins/pluginHostNode.ts`
//! 作为 Node sidecar（stdin/stdout JSON-lines）。本模块负责：
//!
//! - **生命周期**：`ensure_host` 按需 spawn 宿主子进程并完成 `activate` 握手；
//!   `stop_host` 发 `deactivate` 并终止；应用退出由 `NodeSidecar::Drop` 统一回收。
//! - **RPC 转发**：`host_message_loop` 读宿主 stdout，按 `requestId` 匹配终止消息
//!   （`activated` / `provider-result` / `ui-command-result` / `deactivated`），并响应
//!   宿主发出的 `api-call`（内部 NCM 网关代理、Provider/UI 注册登记）。
//! - **崩溃状态**：stdout 通道关闭（进程退出）返回结构化「连接中断」错误，调用方据此
//!   把宿主移出注册表，下一次调用重新 spawn，实现惰性崩溃恢复。
//!
//! 协议与 `src/main/plugins/hostCore.ts` / `hostTransport.ts` 完全一致。
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex as AsyncMutex;

use crate::ncm_gateway;
use crate::node_sidecar::NodeSidecar;
use crate::plugins::{self, ProviderCallRegistry};

/// 宿主激活握手超时（镜像 Electron `PLUGIN_ACTIVATE_TIMEOUT_MS`）。
pub(crate) const HOST_ACTIVATE_TIMEOUT_MS: u64 = 5000;
/// 停用/关闭超时（镜像 Electron `PLUGIN_DEACTIVATE_TIMEOUT_MS`）。
const HOST_DEACTIVATE_TIMEOUT_MS: u64 = 1500;
/// UI command 调用超时（镜像 Electron `PLUGIN_UI_COMMAND_TIMEOUT_MS`）。
const HOST_UI_COMMAND_TIMEOUT_MS: u64 = 5000;

static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(0);

/// 生成宿主 RPC request id（无 uuid crate 依赖：时间戳 + 单调计数器）。
pub(crate) fn next_request_id() -> String {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!(
        "{now_ms}-{}",
        REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

/// 一个运行中的插件宿主。
pub(crate) struct HostHandle {
    /// 全双工 sidecar；RPC 期间持有该锁（tokio Mutex 允许跨 await 持有）。
    pub(crate) sidecar: AsyncMutex<NodeSidecar>,
    /// 插件注册的 Provider（provider id → registration descriptor）。
    pub(crate) providers: Mutex<HashMap<String, Value>>,
    /// 插件注册的 UI command（小写），供 `extensions.executeCommand` 路由。
    pub(crate) ui_commands: Mutex<Vec<String>>,
    /// 插件订阅的应用事件名。
    pub(crate) subscriptions: Mutex<Vec<String>>,
    pub(crate) log_path: PathBuf,
}

/// 插件宿主注册表（Tauri managed state）。
#[derive(Default)]
pub(crate) struct PluginHostRegistry {
    pub(crate) hosts: AsyncMutex<HashMap<String, Arc<HostHandle>>>,
}

/// 解析插件宿主脚本路径，返回 `(script, node_args)`。
///
/// 优先级：环境变量覆盖 → 打包资源 `{resource}/sidecar/pluginHostNode.js` →
/// 插件宿主专用构建产物 `out/plugin-host/pluginHostNode.js` →
/// Electron main 构建产物 `out/main/pluginHostNode.js` → 仓库源码 `pluginHostNode.ts`
/// （`--experimental-strip-types`，与 sidecar 端到端测试同路径）。
pub(crate) fn resolve_host_script(app: &AppHandle) -> Result<(PathBuf, Vec<String>), String> {
    if let Ok(override_path) = std::env::var("TWILIGHT_PLUGIN_HOST_SCRIPT") {
        let candidate = PathBuf::from(override_path);
        if candidate.is_file() {
            return Ok((candidate, Vec::new()));
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("sidecar").join("pluginHostNode.js");
        if candidate.is_file() {
            return Ok((candidate, Vec::new()));
        }
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let plugin_host_out = manifest_dir.join("../out/plugin-host/pluginHostNode.js");
    if plugin_host_out.is_file() {
        return Ok((plugin_host_out, Vec::new()));
    }
    let out_main = manifest_dir.join("../out/main/pluginHostNode.js");
    if out_main.is_file() {
        return Ok((out_main, Vec::new()));
    }
    let source = manifest_dir.join("../src/main/plugins/pluginHostNode.ts");
    if source.is_file() {
        return Ok((source, vec!["--experimental-strip-types".to_string()]));
    }
    Err("找不到插件宿主脚本（pluginHostNode.js / pluginHostNode.ts）".to_string())
}

/// 校验插件 `main` 入口：存在、canonical 化后在版本根目录内，拒绝路径穿越与 symlink 逃逸。
fn resolve_plugin_file(version_root: &Path, main: &str) -> Result<PathBuf, String> {
    let candidate = version_root.join(main);
    if !candidate.is_file() {
        return Err("插件 main 入口不存在".to_string());
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|_| "插件 main 入口无法解析".to_string())?;
    let root = version_root
        .canonicalize()
        .unwrap_or_else(|_| version_root.to_path_buf());
    if !canonical.starts_with(&root) {
        return Err("插件 main 入口越界".to_string());
    }
    Ok(canonical)
}

/// 确保指定插件宿主已启动并激活；返回共享句柄。
///
/// 持有注册表锁跨整个 spawn+activate（避免并发重复 spawn）；激活失败时句柄丢弃，
/// `NodeSidecar::Drop` 终止子进程，错误向上传播。
pub(crate) async fn ensure_host(
    app: &AppHandle,
    plugin_id: &str,
) -> Result<Arc<HostHandle>, String> {
    let registry = app.state::<PluginHostRegistry>();
    let mut hosts = registry.hosts.lock().await;
    if let Some(handle) = hosts.get(plugin_id) {
        return Ok(handle.clone());
    }

    let policy = crate::path_policy::get_path_policy(app);
    let descriptor = plugins::find_descriptor(app, &policy, plugin_id)
        .ok_or_else(|| format!("插件未找到：{plugin_id}"))?;
    if descriptor.get("status").and_then(Value::as_str) == Some("invalid") {
        return Err(descriptor
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("插件无效")
            .to_string());
    }
    let main = descriptor
        .get("main")
        .and_then(Value::as_str)
        .ok_or_else(|| "插件缺少 main 入口".to_string())?;
    let paths = descriptor
        .get("paths")
        .and_then(Value::as_object)
        .ok_or_else(|| "插件路径缺失".to_string())?;
    let version_root = paths
        .get("versionRoot")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .ok_or_else(|| "插件路径缺失".to_string())?;
    let data_dir = paths
        .get("dataDir")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .ok_or_else(|| "插件路径缺失".to_string())?;
    let log_path = paths
        .get("logPath")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .ok_or_else(|| "插件路径缺失".to_string())?;

    let main_path = resolve_plugin_file(&version_root, main)?;
    let manifest = plugins::read_manifest(&version_root)?;
    let api_version = descriptor
        .get("apiVersion")
        .and_then(Value::as_u64)
        .unwrap_or(1);

    let (script, node_args) = resolve_host_script(app)?;
    let node_args: Vec<&str> = node_args.iter().map(|arg| arg.as_str()).collect();
    let sidecar = NodeSidecar::spawn(plugin_id, &node_args, &script)
        .map_err(|error| format!("启动插件宿主失败：{error}"))?;
    let handle = Arc::new(HostHandle {
        sidecar: AsyncMutex::new(sidecar),
        providers: Mutex::new(HashMap::new()),
        ui_commands: Mutex::new(Vec::new()),
        subscriptions: Mutex::new(Vec::new()),
        log_path,
    });

    let activate = json!({
        "kind": "activate",
        "pluginId": plugin_id,
        "manifest": manifest,
        "mainPath": main_path,
        "dataDir": data_dir,
        "apiVersion": api_version,
    });
    let activation = host_message_loop(
        &handle,
        Duration::from_millis(HOST_ACTIVATE_TIMEOUT_MS),
        Some(&activate),
        None,
        None,
        |msg| {
            let kind = msg.get("kind").and_then(Value::as_str).unwrap_or("");
            if kind == "activated" {
                Some(Ok(Value::Null))
            } else if kind == "host-error" {
                Some(Err(msg
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("插件激活失败")
                    .to_string()))
            } else {
                None
            }
        },
    )
    .await;

    match activation {
        Ok(_) => {
            hosts.insert(plugin_id.to_string(), handle.clone());
            Ok(handle)
        }
        Err(error) => Err(error),
    }
}

/// 停用并终止指定插件宿主（disable / uninstall 时调用）。尽力发 `deactivate`，
/// 无论成败都移除注册表，句柄丢弃触发 `NodeSidecar::Drop` 终止子进程。
pub(crate) async fn stop_host(app: &AppHandle, plugin_id: &str) {
    let registry = app.state::<PluginHostRegistry>();
    let handle = registry.hosts.lock().await.remove(plugin_id);
    if let Some(handle) = handle {
        let request_id = next_request_id();
        let deactivate = json!({ "kind": "deactivate", "requestId": request_id });
        let _ = host_message_loop(
            &handle,
            Duration::from_millis(HOST_DEACTIVATE_TIMEOUT_MS),
            Some(&deactivate),
            None,
            None,
            |msg| {
                if msg.get("kind").and_then(Value::as_str) == Some("deactivated") {
                    Some(Ok(Value::Null))
                } else {
                    None
                }
            },
        )
        .await;
    }
}

/// 把宿主移出注册表并终止（宿主崩溃/连接中断后调用，下一次调用惰性重新 spawn）。
pub(crate) async fn drop_host(app: &AppHandle, plugin_id: &str) {
    let registry = app.state::<PluginHostRegistry>();
    let handle = registry.hosts.lock().await.remove(plugin_id);
    if let Some(handle) = handle {
        // 句柄丢弃即终止子进程；不再等待 deactivate（进程可能已退出）。
        drop(handle);
    }
}

/// 应用退出时统一回收宿主（由 `lib.rs` 的 `RunEvent::Exit | ExitRequested` 调用）。
pub(crate) fn shutdown(app: &AppHandle) {
    let registry = app.state::<PluginHostRegistry>();
    let hosts = registry.hosts.try_lock();
    if let Ok(mut hosts) = hosts {
        hosts.clear();
    }
}

/// 向宿主发起一次 Provider 调用并等待 `provider-result`。
///
/// `cancel_registry` / `cancel_key` 用于取消检测：`providers_cancel` 从
/// `ProviderCallRegistry` 移除 request id 后，本循环在下一次读前发现缺失即返回
/// 「已取消」，无需打断宿主持有的 sidecar 锁。
pub(crate) async fn provider_call(
    handle: &Arc<HostHandle>,
    request: &Value,
    request_id: &str,
    cancel_registry: Option<&ProviderCallRegistry>,
    cancel_key: Option<&str>,
    timeout: Duration,
) -> Result<Value, String> {
    let request_id_owned = request_id.to_string();
    host_message_loop(
        handle,
        timeout,
        Some(request),
        cancel_registry,
        cancel_key,
        |msg| {
            let kind = msg.get("kind").and_then(Value::as_str).unwrap_or("");
            if kind == "provider-result"
                && msg.get("requestId").and_then(Value::as_str) == Some(&request_id_owned)
            {
                if msg.get("ok").and_then(Value::as_bool) == Some(true) {
                    Some(Ok(msg.get("value").cloned().unwrap_or(Value::Null)))
                } else {
                    Some(Err(msg
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("Provider 调用失败")
                        .to_string()))
                }
            } else if kind == "host-error" {
                Some(Err(msg
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("插件宿主错误")
                    .to_string()))
            } else {
                None
            }
        },
    )
    .await
}

/// 向宿主发起一次 UI command 调用并等待 `ui-command-result`。
pub(crate) async fn ui_command(
    handle: &Arc<HostHandle>,
    command: &str,
    args: Value,
) -> Result<Value, String> {
    let request_id = next_request_id();
    let request = json!({
        "kind": "ui-command",
        "requestId": request_id,
        "command": command,
        "args": args,
    });
    let request_id_owned = request_id;
    host_message_loop(
        handle,
        Duration::from_millis(HOST_UI_COMMAND_TIMEOUT_MS),
        Some(&request),
        None,
        None,
        |msg| {
            let kind = msg.get("kind").and_then(Value::as_str).unwrap_or("");
            if kind == "ui-command-result"
                && msg.get("requestId").and_then(Value::as_str) == Some(&request_id_owned)
            {
                if msg.get("ok").and_then(Value::as_bool) == Some(true) {
                    Some(Ok(msg.get("value").cloned().unwrap_or(Value::Null)))
                } else {
                    Some(Err(msg
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("UI command 失败")
                        .to_string()))
                }
            } else if kind == "host-error" {
                Some(Err(msg
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("插件宿主错误")
                    .to_string()))
            } else {
                None
            }
        },
    )
    .await
}

/// 宿主消息循环：可选先发一条 `initial`，然后读消息直到 `terminal` 匹配或超时。
/// 非终止消息交给 `on_host_message`（log / api-call 等），需要回写时发送应答。
async fn host_message_loop(
    handle: &Arc<HostHandle>,
    timeout: Duration,
    initial: Option<&Value>,
    cancel_registry: Option<&ProviderCallRegistry>,
    cancel_key: Option<&str>,
    terminal: impl Fn(&Value) -> Option<Result<Value, String>>,
) -> Result<Value, String> {
    let mut guard = handle.sidecar.lock().await;
    if let Some(initial) = initial {
        guard
            .send_json(initial)
            .map_err(|error| format!("发送到插件宿主失败：{error}"))?;
    }
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if let (Some(registry), Some(key)) = (cancel_registry, cancel_key) {
            let cancelled = registry
                .0
                .lock()
                .map_err(|_| "provider call registry lock")?
                .contains_key(key);
            if !cancelled {
                return Err("Provider 调用被取消".to_string());
            }
        }
        let now = tokio::time::Instant::now();
        if now >= deadline {
            return Err(format!("插件宿主调用超时（>{}ms）", timeout.as_millis()));
        }
        let remaining = deadline - now;
        let msg = match guard.recv_json(remaining).await {
            Ok(value) => value,
            Err(error) => return Err(format!("插件宿主连接中断：{error}")),
        };
        if let Some(result) = terminal(&msg) {
            return result;
        }
        if let Some(reply) = on_host_message(handle, &msg).await? {
            guard
                .send_json(&reply)
                .map_err(|error| format!("回写插件宿主失败：{error}"))?;
        }
    }
}

/// 处理宿主发出的非终止消息。返回 `Some(reply)` 表示需要向宿主回写一条消息。
async fn on_host_message(handle: &Arc<HostHandle>, msg: &Value) -> Result<Option<Value>, String> {
    let kind = msg.get("kind").and_then(Value::as_str).unwrap_or("");
    match kind {
        "log" => {
            let level = msg.get("level").and_then(Value::as_str).unwrap_or("info");
            let message = msg.get("message").and_then(Value::as_str).unwrap_or("");
            append_host_log(&handle.log_path, level, message);
            Ok(None)
        }
        "api-event-subscribe" => {
            if let Some(event_name) = msg.get("eventName").and_then(Value::as_str) {
                if let Ok(mut subscriptions) = handle.subscriptions.lock() {
                    subscriptions.push(event_name.to_string());
                }
            }
            Ok(None)
        }
        "api-call" => {
            let request_id = msg
                .get("requestId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let namespace = msg.get("namespace").and_then(Value::as_str).unwrap_or("");
            let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
            let args = msg
                .get("args")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let reply =
                dispatch_host_api_call(handle, &request_id, namespace, method, &args).await?;
            Ok(Some(reply))
        }
        _ => Ok(None),
    }
}

/// 分派宿主 `api-call`（镜像 Electron `manager.handleApiCall` 的能力边界）：
/// - `providers/register`：登记 Provider 注册并回写成功；
/// - `extensions/registerUi`：登记 UI command；
/// - `internal/ncmRequest`：把请求代理到本地 NCM 网关（cookie 与幂等键随消息传入）；
/// - 其余内部 API / 播放器 API 在 Tauri 尚未提供，回写结构化错误（不伪装成功）。
async fn dispatch_host_api_call(
    handle: &Arc<HostHandle>,
    request_id: &str,
    namespace: &str,
    method: &str,
    args: &[Value],
) -> Result<Value, String> {
    let api_result = match (namespace, method) {
        ("providers", "register") => {
            if let Some(provider) = args.first() {
                if let Some(id) = provider.get("id").and_then(Value::as_str) {
                    if let Ok(mut providers) = handle.providers.lock() {
                        providers.insert(id.to_string(), provider.clone());
                    }
                }
            }
            json!({
                "kind": "api-result",
                "requestId": request_id,
                "ok": true,
                "value": args.first().cloned().unwrap_or(Value::Null)
            })
        }
        ("extensions", "registerUi") => {
            if let Some(contrib) = args.first() {
                if let Some(command) = contrib.get("command").and_then(Value::as_str) {
                    if let Ok(mut ui_commands) = handle.ui_commands.lock() {
                        ui_commands.push(command.to_string());
                    }
                }
            }
            json!({
                "kind": "api-result",
                "requestId": request_id,
                "ok": true,
                "value": args.first().cloned().unwrap_or(Value::Null)
            })
        }
        ("extensions", "registerTheme") => json!({
            "kind": "api-result",
            "requestId": request_id,
            "ok": false,
            "error": "主题必须通过 plugin.json contributes.themes 声明"
        }),
        ("internal", "ncmRequest") => {
            let path = args
                .first()
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let cookie = args.get(1).and_then(Value::as_str).unwrap_or("");
            let options = args
                .get(2)
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let idempotency_key = options.get("idempotencyKey").and_then(Value::as_str);
            let mut headers: Vec<(String, String)> = Vec::new();
            if !cookie.is_empty() {
                headers.push(("Cookie".to_string(), cookie.to_string()));
            }
            if let Some(key) = idempotency_key {
                headers.push(("X-Twilight-Idempotency-Key".to_string(), key.to_string()));
            }
            match ncm_gateway::proxy_json_call(&path, headers, Duration::from_millis(30_000)).await
            {
                Ok(value) => json!({
                    "kind": "api-result",
                    "requestId": request_id,
                    "ok": true,
                    "value": value
                }),
                Err(error) => json!({
                    "kind": "api-result",
                    "requestId": request_id,
                    "ok": false,
                    "error": error
                }),
            }
        }
        ("internal", "ncmOfficialLogin") => json!({
            "kind": "api-result",
            "requestId": request_id,
            "ok": false,
            "error": "官方登录尚未在 Tauri 提供"
        }),
        ("internal", "ncmGetCachedSong") | ("internal", "ncmCacheSong") => json!({
            "kind": "api-result",
            "requestId": request_id,
            "ok": false,
            "error": "歌曲缓存尚未在 Tauri 提供"
        }),
        ("player", _) => json!({
            "kind": "api-result",
            "requestId": request_id,
            "ok": false,
            "error": "播放器 API 尚未在 Tauri 提供"
        }),
        _ => json!({
            "kind": "api-result",
            "requestId": request_id,
            "ok": false,
            "error": format!("未知宿主 API：{namespace}.{method}")
        }),
    };
    Ok(api_result)
}

/// 把宿主日志行追加到插件日志文件（与 Electron `appendLog` 语义一致）。
fn append_host_log(log_path: &Path, level: &str, message: &str) {
    if let Some(parent) = log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let line = format!("[{level}] {message}\n");
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    {
        let _ = file.write_all(line.as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_ids_are_unique() {
        let a = next_request_id();
        let b = next_request_id();
        assert_ne!(a, b);
    }

    #[test]
    fn resolve_plugin_file_rejects_escaping_main() {
        let root = std::env::temp_dir().join("twilight-host-resolve-test");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("nested")).expect("create nested");
        fs::write(root.join("main.js"), "x").expect("write main");
        fs::write(root.join("nested").join("esc.js"), "x").expect("write nested file");
        assert!(resolve_plugin_file(&root, "main.js").is_ok());
        // 目录内的嵌套入口合法；路径穿越（..）到根目录之外才会失败。
        assert!(resolve_plugin_file(&root, "nested/esc.js").is_ok());
        assert!(resolve_plugin_file(&root, "../main.js").is_err());
        assert!(resolve_plugin_file(&root, "missing.js").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn append_host_log_writes_file() {
        let root = std::env::temp_dir().join("twilight-host-log-test");
        let _ = fs::remove_dir_all(&root);
        let log = root.join("logs").join("plugin.log");
        append_host_log(&log, "info", "hello");
        append_host_log(&log, "error", "boom");
        let text = fs::read_to_string(&log).expect("read log");
        assert!(text.contains("[info] hello"));
        assert!(text.contains("[error] boom"));
        let _ = fs::remove_dir_all(&root);
    }

    /// 端到端验证：spawn 真实 `pluginHostNode.ts`，激活一个临时测试插件
    /// （register provider → provider-call → provider-result）。需要 node 与仓库源码；
    /// 默认忽略，手动 `-- --ignored` 运行。
    #[test]
    #[ignore = "requires node + repo source"]
    fn host_runs_provider_call_end_to_end() {
        let temp = std::env::temp_dir().join(format!("twilight-host-e2e-{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp);
        fs::create_dir_all(&temp).expect("create temp");
        let plugin_root = temp.join("plugin");
        let data_root = temp.join("data");
        fs::create_dir_all(&plugin_root).expect("create plugin dir");
        fs::create_dir_all(&data_root).expect("create data dir");
        let main_path = plugin_root.join("index.mjs");
        fs::write(
            &main_path,
            r#"
export async function activate(context) {
  await context.twilight.providers.register({
    id: 'probe',
    name: 'Probe Provider',
    capabilities: ['search'],
    searchSongs: async () => ({ ok: true, keyword: 'probe' })
  })
  context.logger.info('probe activated')
}
export function deactivate() {}
"#,
        )
        .expect("write plugin");

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let result = runtime.block_on(async {
            let (script, node_args) = match std::env::var("TWILIGHT_PLUGIN_HOST_SCRIPT") {
                Ok(path) => (PathBuf::from(path), Vec::new()),
                Err(_) => (
                    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .join("../src/main/plugins/pluginHostNode.ts"),
                    vec!["--experimental-strip-types".to_string()],
                ),
            };
            let node_args: Vec<&str> = node_args.iter().map(|arg| arg.as_str()).collect();
            let sidecar =
                NodeSidecar::spawn("probe-host", &node_args, &script).map_err(|e| e.to_string())?;
            let handle = Arc::new(HostHandle {
                sidecar: AsyncMutex::new(sidecar),
                providers: Mutex::new(HashMap::new()),
                ui_commands: Mutex::new(Vec::new()),
                subscriptions: Mutex::new(Vec::new()),
                log_path: temp.join("plugin.log"),
            });

            let activate = json!({
                "kind": "activate",
                "pluginId": "probe-plugin",
                "manifest": { "id": "probe-plugin", "permissions": ["network"] },
                "mainPath": main_path.to_string_lossy(),
                "dataDir": data_root.to_string_lossy(),
                "apiVersion": 1,
            });
            host_message_loop(
                &handle,
                Duration::from_secs(10),
                Some(&activate),
                None,
                None,
                |msg| {
                    let kind = msg.get("kind").and_then(Value::as_str).unwrap_or("");
                    if kind == "activated" {
                        Some(Ok(Value::Null))
                    } else if kind == "host-error" {
                        Some(Err(msg
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("激活失败")
                            .to_string()))
                    } else {
                        None
                    }
                },
            )
            .await?;

            let call = json!({
                "kind": "provider-call",
                "requestId": "probe-call-1",
                "providerId": "probe",
                "method": "searchSongs",
                "args": [],
            });
            let result = provider_call(
                &handle,
                &call,
                "probe-call-1",
                None,
                None,
                Duration::from_secs(10),
            )
            .await?;
            assert_eq!(result.get("ok"), Some(&Value::from(true)));
            assert_eq!(result.get("keyword"), Some(&Value::from("probe")));
            assert!(handle.providers.lock().unwrap().contains_key("probe"));

            // deactivate + terminate
            let deactivate = json!({ "kind": "deactivate", "requestId": "probe-stop" });
            let _ = host_message_loop(
                &handle,
                Duration::from_secs(5),
                Some(&deactivate),
                None,
                None,
                |msg| {
                    if msg.get("kind").and_then(Value::as_str) == Some("deactivated") {
                        Some(Ok(Value::Null))
                    } else {
                        None
                    }
                },
            )
            .await;
            Ok::<_, String>(())
        });
        match result {
            Ok(()) => {}
            Err(error) => panic!("host e2e failed: {error}"),
        }
        let _ = fs::remove_dir_all(&temp);
    }
}
