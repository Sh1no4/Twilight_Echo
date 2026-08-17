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

pub(crate) const HOST_ACTIVATE_TIMEOUT_MS: u64 = 5000;
const HOST_DEACTIVATE_TIMEOUT_MS: u64 = 1500;
const HOST_UI_COMMAND_TIMEOUT_MS: u64 = 5000;

static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(0);

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

pub(crate) struct HostHandle {
    pub(crate) sidecar: AsyncMutex<NodeSidecar>,
    pub(crate) providers: Mutex<HashMap<String, Value>>,
    pub(crate) ui_commands: Mutex<Vec<String>>,
    pub(crate) subscriptions: Mutex<Vec<String>>,
    pub(crate) log_path: PathBuf,
}

#[derive(Default)]
pub(crate) struct PluginHostRegistry {
    pub(crate) hosts: AsyncMutex<HashMap<String, Arc<HostHandle>>>,
}

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

pub(crate) async fn drop_host(app: &AppHandle, plugin_id: &str) {
    let registry = app.state::<PluginHostRegistry>();
    let handle = registry.hosts.lock().await.remove(plugin_id);
    if let Some(handle) = handle {
        // 句柄丢弃即终止子进程；不再等待 deactivate（进程可能已退出）。
        drop(handle);
    }
}

pub(crate) fn shutdown(app: &AppHandle) {
    let registry = app.state::<PluginHostRegistry>();
    let hosts = registry.hosts.try_lock();
    if let Ok(mut hosts) = hosts {
        hosts.clear();
    }
}

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

