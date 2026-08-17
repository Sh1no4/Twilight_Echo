
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, Mutex as AsyncMutex};

use crate::node_sidecar::NodeSidecar;

const AUDIO_CALL_TIMEOUT_MS: u64 = 10_000;
const AUDIO_INIT_TIMEOUT_MS: u64 = 5_000;
const AUDIO_EVENT_POLL_MS: u64 = 50;
const MAX_AUDIO_QUEUE_ITEMS: usize = 5000;
const MAX_AUDIO_SOURCE_LENGTH: usize = 8192;
const MAX_AUDIO_DEVICE_LENGTH: usize = 512;

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

pub(crate) struct AudioRuntimeHandle {
    pub(crate) sidecar: AsyncMutex<NodeSidecar>,
    pub(crate) pending: Mutex<HashMap<String, mpsc::UnboundedSender<Result<Value, String>>>>,
}

#[derive(Default)]
pub(crate) struct AudioRuntimeRegistry {
    pub(crate) runtime: AsyncMutex<Option<Arc<AudioRuntimeHandle>>>,
}

pub(crate) fn resolve_audio_script(app: &AppHandle) -> Result<(PathBuf, Vec<String>), String> {
    if let Ok(override_path) = std::env::var("TWILIGHT_AUDIO_SCRIPT") {
        let candidate = PathBuf::from(override_path);
        if candidate.is_file() {
            return Ok((candidate, Vec::new()));
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("sidecar").join("audioEngineNode.js");
        if candidate.is_file() {
            return Ok((candidate, Vec::new()));
        }
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let audio_out = manifest_dir.join("../out/audio-engine/audioEngineNode.js");
    if audio_out.is_file() {
        return Ok((audio_out, Vec::new()));
    }
    let out_main = manifest_dir.join("../out/main/audioEngineNode.js");
    if out_main.is_file() {
        return Ok((out_main, Vec::new()));
    }
    let source = manifest_dir.join("../src/main/audio/audioEngineNode.ts");
    if source.is_file() {
        return Ok((source, vec!["--experimental-strip-types".to_string()]));
    }
    Err("找不到音频运行时脚本（audioEngineNode.js / audioEngineNode.ts）".to_string())
}

fn audio_env(app: &AppHandle) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = vec![
        (
            "TWILIGHT_ENABLE_HTMLAUDIO_FALLBACK".to_string(),
            "1".to_string(),
        ),
        ("TWILIGHT_AUDIO_SERVICE_NODE".to_string(), "0".to_string()),
    ];
    if let Ok(resource_dir) = app.path().resource_dir() {
        env.push((
            "TWILIGHT_AUDIO_RESOURCE_DIR".to_string(),
            resource_dir.to_string_lossy().into_owned(),
        ));
    }
    env
}

fn audio_config(app: &AppHandle) -> Value {
    let settings = crate::load_json_file(app, "settings.json", json!({}));
    let data_dir = app
        .path()
        .app_data_dir()
        .map(|dir| dir.to_string_lossy().into_owned())
        .unwrap_or_default();
    json!({
        "exclusiveMode": settings.get("audioExclusiveMode").and_then(Value::as_bool).unwrap_or(false),
        "volume": settings.get("softwareVolume").and_then(Value::as_f64).unwrap_or(1.0),
        "audioOutput": settings.get("audioOutput").and_then(Value::as_str).unwrap_or("wasapi"),
        "audioDevice": settings.get("audioDevice").and_then(Value::as_str).unwrap_or("auto"),
        "audioOutputConfig": settings.get("audioOutputConfig").cloned().unwrap_or_else(|| json!({})),
        "audioProcessing": settings.get("audioProcessing").cloned(),
        "dspScenes": settings.get("dspScenes").cloned().unwrap_or_else(|| json!([])),
        "dspPinnedSceneId": settings.get("dspPinnedSceneId").cloned(),
        "dataDir": data_dir,
    })
}

fn classify_audio_source(source: &str) -> Result<&'static str, String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err("音频地址为空".to_string());
    }
    let scheme_end = trimmed.find(':');
    let has_scheme = match scheme_end {
        Some(index) if index > 0 && trimmed.as_bytes()[0].is_ascii_alphabetic() => trimmed[..index]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '-' || c == '.'),
        _ => false,
    };
    let is_posix_abs = trimmed.starts_with('/');
    let is_win_abs = trimmed.len() >= 3
        && trimmed.as_bytes()[1] == b':'
        && (trimmed.as_bytes()[2] == b'\\' || trimmed.as_bytes()[2] == b'/');
    let is_unc = trimmed.starts_with("\\\\");
    if !has_scheme || is_posix_abs || is_win_abs || is_unc {
        return Ok("local");
    }
    let scheme = &trimmed[..scheme_end.unwrap()];
    if scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https") {
        Ok("remote")
    } else {
        Err("音频地址协议不受支持".to_string())
    }
}

fn authorize_playback_source(app: &AppHandle, source: &str) -> Result<String, String> {
    if source.chars().count() > MAX_AUDIO_SOURCE_LENGTH {
        return Err("音频地址过长".to_string());
    }
    match classify_audio_source(source)? {
        "remote" => Ok(source.trim().to_string()),
        _ => {
            let authorized = crate::library_scan::is_authorized_audio_file(app, source.trim())?;
            if !authorized {
                return Err("音频路径不在已授权目录内".to_string());
            }
            let canonical = fs::canonicalize(source.trim())
                .map_err(|error| format!("解析音频文件路径失败：{error}"))?;
            Ok(canonical.to_string_lossy().into_owned())
        }
    }
}

pub(crate) async fn ensure_audio_runtime(
    app: &AppHandle,
) -> Result<Arc<AudioRuntimeHandle>, String> {
    let registry = app.state::<AudioRuntimeRegistry>();
    let mut guard = registry.runtime.lock().await;
    if let Some(handle) = guard.as_ref() {
        return Ok(handle.clone());
    }

    let (script, node_args) = resolve_audio_script(app)?;
    let node_args: Vec<&str> = node_args.iter().map(|arg| arg.as_str()).collect();
    let env = audio_env(app);
    let env_refs: Vec<(&str, String)> = env.iter().map(|(k, v)| (k.as_str(), v.clone())).collect();
    let sidecar = NodeSidecar::spawn_with_env("audio-engine", &node_args, &script, &env_refs)
        .map_err(|error| format!("启动音频运行时失败：{error}"))?;
    let handle = Arc::new(AudioRuntimeHandle {
        sidecar: AsyncMutex::new(sidecar),
        pending: Mutex::new(HashMap::new()),
    });

    let init = json!({ "kind": "init", "config": audio_config(app) });
    let init_result =
        wait_for_init(&handle, &init, Duration::from_millis(AUDIO_INIT_TIMEOUT_MS)).await;
    let capabilities = match init_result {
        Ok(capabilities) => capabilities,
        Err(error) => {
            // 句柄丢弃触发 NodeSidecar::Drop 终止子进程。
            drop(handle);
            return Err(format!("音频运行时初始化失败：{error}"));
        }
    };
    if capabilities.get("nativeAvailable").and_then(Value::as_bool) != Some(true) {
        eprintln!(
            "[audio-runtime] 原生音频引擎未加载；播放将走 HTMLAudio 兜底：{}",
            resolve_audio_addon_missing_reason(app)
        );
    }

    // init 握手完成后才启动事件转发任务，避免在途 `ready` 被事件循环误吞。
    let forward_handle = handle.clone();
    let forward_app = app.clone();
    tokio::spawn(async move { audio_event_loop(forward_handle, forward_app).await });

    *guard = Some(handle.clone());
    Ok(handle)
}

fn resolve_audio_addon_missing_reason(app: &AppHandle) -> String {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir
            .join("audio-engine")
            .join("twilight_audio_node.node");
        if candidate.is_file() {
            return "原生 addon 存在但加载失败".to_string();
        }
    }
    "twilight_audio_node.node 未随包提供".to_string()
}

async fn wait_for_init(
    handle: &Arc<AudioRuntimeHandle>,
    initial: &Value,
    timeout: Duration,
) -> Result<Value, String> {
    let deadline = tokio::time::Instant::now() + timeout;
    {
        let guard = handle.sidecar.lock().await;
        guard
            .send_json(initial)
            .map_err(|error| format!("发送音频运行时 init 失败：{error}"))?;
    }
    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err(format!(
                "等待音频运行时 ready 超时（>{}ms）",
                timeout.as_millis()
            ));
        }
        let msg = {
            let mut guard = handle.sidecar.lock().await;
            loop {
                match guard.try_recv_json() {
                    Ok(Some(value)) => break value,
                    Ok(None) => break Value::Null,
                    Err(error) => return Err(format!("音频运行时连接中断：{error}")),
                }
            }
        };
        if msg.is_null() {
            tokio::time::sleep(Duration::from_millis(20)).await;
            continue;
        }
        match msg.get("kind").and_then(Value::as_str).unwrap_or("") {
            "ready" => return Ok(msg.get("capabilities").cloned().unwrap_or(Value::Null)),
            "fatal" => {
                return Err(msg
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("音频运行时启动失败")
                    .to_string())
            }
            _ => continue,
        }
    }
}

pub(crate) async fn audio_call(
    app: &AppHandle,
    method: &str,
    args: Value,
) -> Result<Value, String> {
    let handle = ensure_audio_runtime(app).await?;
    let request_id = next_request_id();
    let (tx, mut rx) = mpsc::unbounded_channel();
    {
        let mut pending = handle.pending.lock().map_err(|_| "音频调用注册表锁失败")?;
        pending.insert(request_id.clone(), tx);
    }
    let call = json!({ "kind": "call", "requestId": request_id, "method": method, "args": args });
    let send_result = {
        let guard = handle.sidecar.lock().await;
        guard.send_json(&call)
    };
    if let Err(error) = send_result {
        handle.pending.lock().unwrap().remove(&request_id);
        drop_audio_runtime_on_disconnect(app, &handle);
        return Err(format!("写入音频运行时失败：{error}"));
    }
    let result =
        tokio::time::timeout(Duration::from_millis(AUDIO_CALL_TIMEOUT_MS), rx.recv()).await;
    handle.pending.lock().unwrap().remove(&request_id);
    match result {
        Ok(Some(Ok(value))) => Ok(value),
        Ok(Some(Err(error))) => Err(error),
        Ok(None) => {
            drop_audio_runtime_on_disconnect(app, &handle);
            Err("音频运行时连接中断".to_string())
        }
        Err(_) => Err(format!("音频引擎调用超时：{method}")),
    }
}

fn drop_audio_runtime_on_disconnect(app: &AppHandle, handle: &Arc<AudioRuntimeHandle>) {
    let registry = app.state::<AudioRuntimeRegistry>();
    let guard = registry.runtime.try_lock();
    if let Ok(mut guard) = guard {
        if let Some(current) = guard.as_ref() {
            if Arc::ptr_eq(current, handle) {
                *guard = None;
            }
        }
    }
}

async fn audio_event_loop(handle: Arc<AudioRuntimeHandle>, app: AppHandle) {
    let mut disconnected = false;
    loop {
        let mut messages: Vec<Value> = Vec::new();
        {
            let mut guard = handle.sidecar.lock().await;
            loop {
                match guard.try_recv_json() {
                    Ok(Some(value)) => messages.push(value),
                    Ok(None) => break,
                    Err(_) => {
                        disconnected = true;
                        break;
                    }
                }
            }
        }
        for message in messages {
            if !handle_runtime_message(&app, &handle, &message).await {
                disconnected = true;
            }
        }
        if disconnected {
            break;
        }
        tokio::time::sleep(Duration::from_millis(AUDIO_EVENT_POLL_MS)).await;
    }
    fail_all_pending(&handle, "音频运行时连接中断");
    drop_audio_runtime_on_disconnect(&app, &handle);
    let _ = app.emit(
        "audioEngine:disconnected",
        json!({ "reason": "runtime-disconnected" }),
    );
}

async fn handle_runtime_message(
    app: &AppHandle,
    handle: &Arc<AudioRuntimeHandle>,
    message: &Value,
) -> bool {
    match message.get("kind").and_then(Value::as_str).unwrap_or("") {
        "analysis-event" => {
            if let (Some(surface), Some(name), Some(payload)) = (
                message.get("surface").and_then(Value::as_str),
                message.get("name").and_then(Value::as_str),
                message.get("payload"),
            ) {
                let channel = match surface {
                    "bpmAnalysis" => "bpmAnalysis:completed".to_string(),
                    "loudnessAnalysis" => "loudnessAnalysis:completed".to_string(),
                    _ => format!("{surface}:{name}"),
                };
                let _ = app.emit(&channel, payload.clone());
            }
            true
        }
        "event" => {
            if let (Some(name), Some(payload)) = (
                message.get("name").and_then(Value::as_str),
                message.get("payload"),
            ) {
                let _ = app.emit(&format!("audioEngine:{name}"), payload.clone());
            }
            true
        }
        "result" => {
            if let Some(request_id) = message.get("requestId").and_then(Value::as_str) {
                let result = if message.get("ok").and_then(Value::as_bool) == Some(true) {
                    Ok(message.get("value").cloned().unwrap_or(Value::Null))
                } else {
                    Err(message
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("音频引擎调用失败")
                        .to_string())
                };
                if let Some(tx) = handle.pending.lock().unwrap().remove(request_id) {
                    let _ = tx.send(result);
                }
            }
            true
        }
        "fatal" => {
            fail_all_pending(
                handle,
                message
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("音频运行时致命错误"),
            );
            false
        }
        _ => true,
    }
}

fn fail_all_pending(handle: &Arc<AudioRuntimeHandle>, reason: &str) {
    if let Ok(mut pending) = handle.pending.lock() {
        for (_, tx) in pending.drain() {
            let _ = tx.send(Err(reason.to_string()));
        }
    }
}

fn persist_audio_settings(app: &AppHandle, patch: &Value) -> Result<(), String> {
    let mut settings = crate::load_json_file(app, "settings.json", json!({}));
    if let Value::Object(stored) = &mut settings {
        if let Some(patch) = patch.as_object() {
            for (key, value) in patch {
                stored.insert(key.clone(), value.clone());
            }
        }
    }
    crate::save_json_file(app, "settings.json", &settings)?;
    let snapshot = crate::settings_snapshot(app, &settings);
    let _ = app.emit("settings:changed", snapshot);
    Ok(())
}

pub(crate) fn shutdown(app: &AppHandle) {
    let registry = app.state::<AudioRuntimeRegistry>();
    let guard = registry.runtime.try_lock();
    if let Ok(mut guard) = guard {
        if let Some(handle) = guard.take() {
            let request_id = next_request_id();
            let deinit = json!({ "kind": "deinit", "requestId": request_id });
            let _ = {
                let sidecar = handle.sidecar.try_lock();
                if let Ok(sidecar) = sidecar {
                    sidecar.send_json(&deinit)
                } else {
                    Ok(())
                }
            };
        }
    }
}

// ── Tauri 命令：基础播放 / 输出路由 / DSP 场景 / 元数据 ─────────────────────────

fn finite_number(value: Option<f64>, min: f64, max: f64, default: f64) -> f64 {
    match value {
        Some(v) if v.is_finite() => v.clamp(min, max),
        _ => default,
    }
}

#[tauri::command]
pub async fn audio_engine_load_queue(
    app: AppHandle,
    items: Value,
    start_index: Option<u32>,
) -> Result<(), String> {
    let array = items
        .as_array()
        .ok_or_else(|| "音频队列必须为数组".to_string())?;
    if array.len() > MAX_AUDIO_QUEUE_ITEMS {
        return Err("音频队列过大".to_string());
    }
    let mut normalized: Vec<Value> = Vec::with_capacity(array.len());
    for item in array {
        let mut entry = item.clone();
        let source = entry
            .get("source")
            .or_else(|| entry.get("audioSource"))
            .or_else(|| entry.get("playUrl"))
            .or_else(|| entry.get("filePath"))
            .or_else(|| entry.get("streamUrl"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if source.is_empty() {
            return Err("音频队列条目缺少 source".to_string());
        }
        entry["source"] = json!(authorize_playback_source(&app, source)?);
        normalized.push(entry);
    }
    let start_index = start_index.unwrap_or(0) as usize;
    audio_call(&app, "loadQueue", json!([normalized, start_index])).await?;
    Ok(())
}

#[tauri::command]
pub async fn audio_engine_play(
    app: AppHandle,
    source: String,
    start_time: Option<f64>,
) -> Result<Value, String> {
    let authorized = authorize_playback_source(&app, &source)?;
    let start_time = finite_number(start_time, 0.0, i64::MAX as f64, 0.0);
    audio_call(&app, "play", json!([authorized, start_time])).await
}

#[tauri::command]
pub async fn audio_engine_is_html_audio_fallback_allowed() -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
pub async fn audio_engine_toggle_pause(app: AppHandle) -> Result<(), String> {
    audio_call(&app, "togglePause", json!([])).await?;
    Ok(())
}

#[tauri::command]
pub async fn audio_engine_seek(app: AppHandle, time: f64) -> Result<(), String> {
    let time = finite_number(Some(time), 0.0, i64::MAX as f64, 0.0);
    audio_call(&app, "seek", json!([time])).await?;
    Ok(())
}

#[tauri::command]
pub async fn audio_engine_set_volume(app: AppHandle, volume: f64) -> Result<(), String> {
    let volume = finite_number(Some(volume), 0.0, 1.0, 1.0);
    audio_call(&app, "setVolume", json!([volume])).await?;
    Ok(())
}

#[tauri::command]
pub async fn audio_engine_set_playback_rate(app: AppHandle, rate: f64) -> Result<(), String> {
    let rate = finite_number(Some(rate), 0.5, 2.0, 1.0);
    audio_call(&app, "setPlaybackRate", json!([rate])).await?;
    Ok(())
}

#[tauri::command]
pub async fn audio_engine_set_loop_range(
    app: AppHandle,
    start_seconds: f64,
    end_seconds: f64,
) -> Result<bool, String> {
    let start = if start_seconds.is_finite() {
        start_seconds
    } else {
        -1.0
    };
    let end = if end_seconds.is_finite() {
        end_seconds
    } else {
        -1.0
    };
    let value = audio_call(&app, "setLoopRange", json!([start, end])).await?;
    value
        .as_bool()
        .ok_or_else(|| "setLoopRange 返回类型错误".to_string())
}

#[tauri::command]
pub async fn audio_engine_stop(app: AppHandle) -> Result<(), String> {
    audio_call(&app, "stop", json!([])).await?;
    Ok(())
}

#[tauri::command]
pub async fn audio_engine_next(app: AppHandle) -> Result<(), String> {
    audio_call(&app, "next", json!([])).await?;
    Ok(())
}

#[tauri::command]
pub async fn audio_engine_previous(app: AppHandle) -> Result<(), String> {
    audio_call(&app, "previous", json!([])).await?;
    Ok(())
}

#[tauri::command]
pub async fn audio_engine_set_play_mode(app: AppHandle, mode: String) -> Result<(), String> {
    let mode = match mode.as_str() {
        "repeat" | "shuffle" => mode,
        _ => "sequential".to_string(),
    };
    audio_call(&app, "setPlayMode", json!([mode])).await?;
    Ok(())
}

#[tauri::command]
pub async fn audio_engine_get_upcoming_track(app: AppHandle) -> Result<Value, String> {
    audio_call(&app, "getUpcomingTrack", json!([])).await
}

#[tauri::command]
pub async fn audio_engine_get_playback_info(app: AppHandle) -> Result<Value, String> {
    audio_call(&app, "getPlaybackInfo", json!([])).await
}

#[tauri::command]
pub async fn audio_engine_set_exclusive_mode(
    app: AppHandle,
    enabled: bool,
) -> Result<Value, String> {
    let state = audio_call(&app, "setExclusiveMode", json!([enabled])).await?;
    persist_audio_settings(&app, &json!({ "audioExclusiveMode": enabled }))?;
    Ok(state)
}

#[tauri::command]
pub async fn audio_engine_get_exclusive_mode(app: AppHandle) -> Result<bool, String> {
    let value = audio_call(&app, "getExclusiveMode", json!([])).await?;
    value
        .as_bool()
        .ok_or_else(|| "getExclusiveMode 返回类型错误".to_string())
}

#[tauri::command]
pub async fn audio_engine_set_audio_output(
    app: AppHandle,
    output: String,
    device: Option<String>,
) -> Result<Value, String> {
    let output = truncate(&output, 64);
    let device = device
        .as_deref()
        .map(|d| truncate(d, MAX_AUDIO_DEVICE_LENGTH))
        .unwrap_or_else(|| "auto".to_string());
    let state = audio_call(&app, "setAudioOutput", json!([output, device])).await?;
    persist_audio_settings(
        &app,
        &json!({
            "audioOutput": output,
            "audioDevice": device,
            "audioExclusiveMode": state.get("exclusiveMode").and_then(Value::as_bool).unwrap_or(false),
        }),
    )?;
    Ok(state)
}

#[tauri::command]
pub async fn audio_engine_set_audio_device(
    app: AppHandle,
    device: String,
) -> Result<Value, String> {
    let device = truncate(&device, MAX_AUDIO_DEVICE_LENGTH);
    let state = audio_call(&app, "setAudioDevice", json!([device])).await?;
    persist_audio_settings(
        &app,
        &json!({
            "audioDevice": device,
            "audioExclusiveMode": state.get("exclusiveMode").and_then(Value::as_bool).unwrap_or(false),
        }),
    )?;
    Ok(state)
}

#[tauri::command]
pub async fn audio_engine_set_output_config(
    app: AppHandle,
    config: Value,
) -> Result<Value, String> {
    if !config.is_object() {
        return Err("输出配置必须为对象".to_string());
    }
    let applied = audio_call(&app, "setOutputConfig", json!([config])).await?;
    persist_audio_settings(&app, &json!({ "audioOutputConfig": applied }))?;
    Ok(applied)
}

#[tauri::command]
pub async fn audio_engine_get_output_config_apply_status(app: AppHandle) -> Result<Value, String> {
    audio_call(&app, "getOutputConfigApplyStatus", json!([])).await
}

#[tauri::command]
pub async fn audio_engine_get_audio_output(app: AppHandle) -> Result<Value, String> {
    audio_call(&app, "getAudioOutput", json!([])).await
}

#[tauri::command]
pub async fn audio_engine_get_audio_output_options(app: AppHandle) -> Result<Value, String> {
    audio_call(&app, "getAudioOutputOptions", json!([])).await
}

#[tauri::command]
pub async fn audio_engine_get_audio_output_state(app: AppHandle) -> Result<Value, String> {
    audio_call(&app, "getAudioOutputState", json!([])).await
}

#[tauri::command]
pub async fn audio_engine_set_audio_processing(
    app: AppHandle,
    settings: Value,
) -> Result<Value, String> {
    if !settings.is_object() {
        return Err("音频处理设置必须为对象".to_string());
    }
    let applied = audio_call(&app, "setAudioProcessing", json!([settings])).await?;
    persist_audio_settings(&app, &json!({ "audioProcessing": applied }))?;
    Ok(applied)
}

#[tauri::command]
pub async fn audio_engine_get_audio_processing(app: AppHandle) -> Result<Value, String> {
    audio_call(&app, "getAudioProcessing", json!([])).await
}

#[tauri::command]
pub async fn audio_engine_get_dsp_scene_state(app: AppHandle) -> Result<Value, String> {
    audio_call(&app, "getDspSceneState", json!([])).await
}

#[tauri::command]
pub async fn audio_engine_set_dsp_scenes(
    app: AppHandle,
    scenes: Value,
    pinned_scene_id: Option<String>,
) -> Result<Value, String> {
    if !scenes.is_array() {
        return Err("DSP 场景必须为数组".to_string());
    }
    let state = audio_call(&app, "setDspScenes", json!([scenes, pinned_scene_id])).await?;
    persist_audio_settings(
        &app,
        &json!({
            "dspScenes": state.get("scenes").cloned().unwrap_or_else(|| json!([])),
            "dspPinnedSceneId": state.get("pinnedSceneId").cloned(),
        }),
    )?;
    Ok(state)
}

#[tauri::command]
pub async fn audio_engine_set_output_stage(
    app: AppHandle,
    partial: Value,
) -> Result<Value, String> {
    let partial = if partial.is_object() {
        partial
    } else {
        json!({})
    };
    let state = audio_call(&app, "setOutputStage", json!([partial])).await?;
    persist_audio_settings(
        &app,
        &json!({
            "dspScenes": state.get("scenes").cloned().unwrap_or_else(|| json!([])),
            "dspPinnedSceneId": state.get("pinnedSceneId").cloned(),
        }),
    )?;
    Ok(state)
}

#[tauri::command]
pub async fn audio_engine_set_stereo_image(
    app: AppHandle,
    partial: Value,
) -> Result<Value, String> {
    let partial = if partial.is_object() {
        partial
    } else {
        json!({})
    };
    let state = audio_call(&app, "setStereoImage", json!([partial])).await?;
    persist_audio_settings(
        &app,
        &json!({
            "dspScenes": state.get("scenes").cloned().unwrap_or_else(|| json!([])),
            "dspPinnedSceneId": state.get("pinnedSceneId").cloned(),
        }),
    )?;
    Ok(state)
}

#[tauri::command]
pub async fn audio_engine_apply_dsp_scene(
    app: AppHandle,
    scene_id: Option<String>,
    confirm_dsd_pcm_fallback: Option<bool>,
) -> Result<Value, String> {
    let scene_id = scene_id.unwrap_or_default();
    let scene_id = if scene_id.is_empty() {
        Value::Null
    } else {
        json!(scene_id)
    };
    let confirm = confirm_dsd_pcm_fallback.unwrap_or(false);
    let state = audio_call(&app, "applyDspScene", json!([scene_id, confirm])).await?;
    persist_audio_settings(
        &app,
        &json!({
            "dspScenes": state.get("scenes").cloned().unwrap_or_else(|| json!([])),
            "dspPinnedSceneId": state.get("pinnedSceneId").cloned(),
        }),
    )?;
    Ok(state)
}

#[tauri::command]
pub async fn audio_engine_get_dsp_graph_status(app: AppHandle) -> Result<Value, String> {
    audio_call(&app, "getDspGraphStatus", json!([])).await
}

#[tauri::command]
pub async fn audio_engine_set_eq_bands(app: AppHandle, settings: Value) -> Result<Value, String> {
    if !settings.is_object() {
        return Err("EQ 设置必须为对象".to_string());
    }
    let applied = audio_call(&app, "setEqBands", json!([settings])).await?;
    persist_audio_settings(&app, &json!({ "audioProcessing": applied }))?;
    Ok(applied)
}

#[tauri::command]
pub async fn audio_engine_set_eq_preset(app: AppHandle, preset: Value) -> Result<Value, String> {
    let applied = audio_call(&app, "setEqPreset", json!([preset])).await?;
    persist_audio_settings(&app, &json!({ "audioProcessing": applied }))?;
    Ok(applied)
}

#[tauri::command]
pub async fn audio_engine_set_crossfeed_strength(
    app: AppHandle,
    strength: f64,
) -> Result<Value, String> {
    let strength = finite_number(Some(strength), -1.0, 1.0, 0.0);
    let applied = audio_call(&app, "setCrossfeedStrength", json!([strength])).await?;
    persist_audio_settings(&app, &json!({ "audioProcessing": applied }))?;
    Ok(applied)
}

#[tauri::command]
pub async fn audio_engine_set_replay_gain_mode(
    app: AppHandle,
    mode: String,
    preamp: Option<f64>,
    fallback: Option<f64>,
    clip: Option<bool>,
) -> Result<Value, String> {
    let mode = if mode.is_empty() {
        "off".to_string()
    } else {
        mode
    };
    let preamp = finite_number(preamp, -24.0, 24.0, 0.0);
    let fallback = finite_number(fallback, -24.0, 24.0, 0.0);
    let clip = clip.unwrap_or(true);
    let applied = audio_call(
        &app,
        "setReplayGainMode",
        json!([mode, preamp, fallback, clip]),
    )
    .await?;
    persist_audio_settings(&app, &json!({ "audioProcessing": applied }))?;
    Ok(applied)
}

#[tauri::command]
pub async fn audio_engine_load_impulse_response(
    app: AppHandle,
    path: String,
) -> Result<Value, String> {
    if path.trim().is_empty() {
        return Err("卷积脉冲响应路径为空".to_string());
    }
    let applied = audio_call(&app, "loadImpulseResponse", json!([path])).await?;
    persist_audio_settings(
        &app,
        &json!({
            "audioProcessing": json!({
                "convolverEnabled": true,
                "convolverIrPath": path,
            }),
        }),
    )?;
    Ok(applied)
}

#[tauri::command]
pub async fn audio_engine_unload_impulse_response(app: AppHandle) -> Result<Value, String> {
    let applied = audio_call(&app, "unloadImpulseResponse", json!([])).await?;
    persist_audio_settings(
        &app,
        &json!({
            "audioProcessing": json!({
                "convolverEnabled": false,
                "convolverIrPath": "",
            }),
        }),
    )?;
    Ok(applied)
}

#[tauri::command]
pub async fn audio_engine_get_convolver_info(app: AppHandle) -> Result<Value, String> {
    audio_call(&app, "getConvolverInfo", json!([])).await
}

#[tauri::command]
pub async fn audio_engine_get_metadata(app: AppHandle, source: String) -> Result<Value, String> {
    let authorized = authorize_playback_source(&app, &source)?;
    audio_call(&app, "getMetadata", json!([authorized])).await
}

#[tauri::command]
pub async fn audio_engine_get_spectrum_data(
    app: AppHandle,
    points: Option<u32>,
) -> Result<Value, String> {
    let points = points.unwrap_or(128).clamp(8, 4096);
    audio_call(&app, "getSpectrumData", json!([points])).await
}

#[tauri::command]
pub async fn audio_engine_get_visualization_data(
    app: AppHandle,
    options: Option<Value>,
) -> Result<Value, String> {
    let options = options.unwrap_or_else(|| json!({}));
    if !options.is_object() {
        return Err("可视化选项必须为对象".to_string());
    }
    audio_call(&app, "getVisualizationData", json!([options])).await
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

// ── Stage 6B: VST3 catalog / DSP assets / analysis / diagnostics slice ──────

#[tauri::command]
pub async fn audio_engine_get_vst3_catalog(app: AppHandle) -> Result<Value, String> {
    audio_call(&app, "vst3GetState", json!([])).await
}

#[tauri::command]
pub async fn audio_engine_set_vst3_enabled(app: AppHandle, enabled: bool) -> Result<Value, String> {
    audio_call(&app, "vst3SetEnabled", json!([enabled])).await
}

#[tauri::command]
pub async fn audio_engine_set_vst3_search_paths(
    app: AppHandle,
    paths: Value,
) -> Result<Value, String> {
    if !paths.is_array() {
        return Err("VST3 搜索目录必须为数组".to_string());
    }
    audio_call(&app, "vst3SetSearchPaths", json!([paths])).await
}

#[tauri::command]
pub async fn audio_engine_scan_vst3_plugins(app: AppHandle) -> Result<Value, String> {
    audio_call(&app, "vst3Scan", json!([])).await
}

#[tauri::command]
pub async fn audio_engine_clear_vst3_quarantine(
    app: AppHandle,
    id: String,
) -> Result<Value, String> {
    let id = truncate(&id, 160);
    audio_call(&app, "vst3ClearQuarantine", json!([id])).await
}

#[tauri::command]
pub async fn audio_engine_get_dsp_assets(app: AppHandle) -> Result<Value, String> {
    audio_call(&app, "dspList", json!([])).await
}

#[tauri::command]
pub async fn audio_engine_import_dsp_asset(
    app: AppHandle,
    kind: String,
    source_path: String,
) -> Result<Value, String> {
    if source_path.trim().is_empty() {
        return Ok(Value::Null);
    }
    audio_call(&app, "dspImportAsset", json!([kind, source_path])).await
}

#[tauri::command]
pub async fn audio_engine_import_dsp_correction_profile(
    app: AppHandle,
    source_path: String,
) -> Result<Value, String> {
    if source_path.trim().is_empty() {
        return Ok(Value::Null);
    }
    audio_call(&app, "dspImportCorrectionProfile", json!([source_path])).await
}

#[tauri::command]
pub async fn audio_engine_import_frequency_response(
    app: AppHandle,
    source_path: String,
) -> Result<Value, String> {
    if source_path.trim().is_empty() {
        return Ok(Value::Null);
    }
    audio_call(&app, "dspImportFrequencyResponse", json!([source_path])).await
}

#[tauri::command]
pub async fn audio_engine_get_dsp_correction_profile(
    app: AppHandle,
    asset_id: String,
) -> Result<Value, String> {
    audio_call(&app, "dspGetCorrectionProfile", json!([asset_id])).await
}

#[tauri::command]
pub async fn audio_engine_delete_dsp_asset(
    app: AppHandle,
    asset_id: String,
) -> Result<Value, String> {
    audio_call(&app, "dspDeleteAsset", json!([asset_id])).await
}

#[tauri::command]
pub async fn audio_engine_export_dsp_profile(
    app: AppHandle,
    name: Option<String>,
    output_path: String,
) -> Result<Value, String> {
    if output_path.trim().is_empty() {
        return Ok(Value::Null);
    }
    audio_call(&app, "dspExportProfile", json!([name, output_path])).await
}

#[tauri::command]
pub async fn audio_engine_import_dsp_profile(
    app: AppHandle,
    file_path: String,
) -> Result<Value, String> {
    if file_path.trim().is_empty() {
        return Ok(Value::Null);
    }
    let profile = audio_call(&app, "dspImportProfile", json!([file_path])).await?;
    let scene_state = audio_call(&app, "getDspSceneState", json!([])).await?;
    persist_audio_settings(
        &app,
        &json!({
            "dspScenes": scene_state.get("scenes").cloned().unwrap_or_else(|| json!([])),
            "dspPinnedSceneId": scene_state.get("pinnedSceneId").cloned(),
        }),
    )?;
    Ok(profile)
}

#[tauri::command]
pub async fn audio_engine_bpm_request(app: AppHandle, mut request: Value) -> Result<Value, String> {
    let file_path = request
        .get("filePath")
        .and_then(Value::as_str)
        .ok_or_else(|| "BPM 分析请求缺少 filePath".to_string())?;
    request["filePath"] = json!(authorize_playback_source(&app, file_path)?);
    audio_call(&app, "bpmRequest", json!([request])).await
}

#[tauri::command]
pub async fn audio_engine_bpm_get_cache_size(app: AppHandle) -> Result<Value, String> {
    audio_call(&app, "bpmGetCacheSize", json!([])).await
}

#[tauri::command]
pub async fn audio_engine_bpm_clear_cache(app: AppHandle) -> Result<Value, String> {
    audio_call(&app, "bpmClearCache", json!([])).await
}

#[tauri::command]
pub async fn audio_engine_bpm_cancel(
    app: AppHandle,
    file_path: Option<String>,
) -> Result<(), String> {
    audio_call(&app, "bpmCancel", json!([file_path])).await?;
    Ok(())
}

#[tauri::command]
pub async fn audio_engine_loudness_request(
    app: AppHandle,
    mut request: Value,
) -> Result<Value, String> {
    let file_path = request
        .get("filePath")
        .and_then(Value::as_str)
        .ok_or_else(|| "响度分析请求缺少 filePath".to_string())?;
    request["filePath"] = json!(authorize_playback_source(&app, file_path)?);
    audio_call(&app, "loudnessRequest", json!([request])).await
}

#[tauri::command]
pub async fn audio_engine_loudness_get_cache_size(app: AppHandle) -> Result<Value, String> {
    audio_call(&app, "loudnessGetCacheSize", json!([])).await
}

#[tauri::command]
pub async fn audio_engine_loudness_clear_cache(app: AppHandle) -> Result<Value, String> {
    audio_call(&app, "loudnessClearCache", json!([])).await
}

#[tauri::command]
pub async fn audio_engine_loudness_get_status(app: AppHandle) -> Result<Value, String> {
    audio_call(&app, "loudnessGetStatus", json!([])).await
}

#[tauri::command]
pub async fn audio_engine_loudness_cancel(
    app: AppHandle,
    file_path: Option<String>,
) -> Result<(), String> {
    audio_call(&app, "loudnessCancel", json!([file_path])).await?;
    Ok(())
}

#[tauri::command]
pub async fn audio_engine_export_diagnostics(
    app: AppHandle,
    file_path: String,
) -> Result<Value, String> {
    audio_call(&app, "diagExport", json!([file_path])).await
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
    fn classify_audio_source_distinguishes_local_and_remote() {
        assert_eq!(
            classify_audio_source("D:\\music\\track.flac").unwrap(),
            "local"
        );
        assert_eq!(
            classify_audio_source("D:/music/track.flac").unwrap(),
            "local"
        );
        assert_eq!(
            classify_audio_source("/home/u/music/track.flac").unwrap(),
            "local"
        );
        assert_eq!(
            classify_audio_source("C:\\Users\\x\\a.mp3").unwrap(),
            "local"
        );
        assert_eq!(
            classify_audio_source("https://example.test/a.flac").unwrap(),
            "remote"
        );
        assert_eq!(
            classify_audio_source("http://127.0.0.1:39127/a.flac").unwrap(),
            "remote"
        );
        assert!(classify_audio_source("twilight-media://audio/token").is_err());
        assert!(classify_audio_source("").is_err());
        assert!(classify_audio_source("   ").is_err());
    }

    #[test]
    fn finite_number_clamps_and_defaults() {
        assert_eq!(finite_number(Some(0.7), 0.0, 1.0, 1.0), 0.7);
        assert_eq!(finite_number(Some(2.0), 0.0, 1.0, 1.0), 1.0);
        assert_eq!(finite_number(Some(-1.0), 0.0, 1.0, 1.0), 0.0);
        assert_eq!(finite_number(None, 0.0, 1.0, 1.0), 1.0);
        assert_eq!(finite_number(Some(f64::NAN), 0.0, 1.0, 1.0), 1.0);
    }

    #[test]
    fn truncate_respects_max_chars() {
        assert_eq!(truncate("wasapi", 64), "wasapi");
        assert_eq!(truncate("123456", 3), "123");
    }

    #[test]
    #[ignore = "requires node + repo source"]
    fn audio_runtime_runs_real_sidecar() {
        let script =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/main/audio/audioEngineNode.ts");
        let mut sidecar = NodeSidecar::spawn_with_env(
            "audio-engine-e2e",
            &["--experimental-strip-types"],
            &script,
            &[
                ("TWILIGHT_ENABLE_HTMLAUDIO_FALLBACK", "1".to_string()),
                ("TWILIGHT_AUDIO_SERVICE_NODE", "0".to_string()),
            ],
        )
        .expect("spawn audio sidecar");

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let result = runtime.block_on(async {
            sidecar
                .send_json(&json!({ "kind": "init", "config": { "exclusiveMode": false } }))
                .expect("send init");
            let ready = loop {
                let msg = sidecar.recv_json(Duration::from_secs(5)).await?;
                if msg.get("kind").and_then(Value::as_str) == Some("ready") {
                    break msg;
                }
            };
            let native_available = ready
                .get("capabilities")
                .and_then(|c| c.get("nativeAvailable"))
                .and_then(Value::as_bool);
            // 原生 addon 是否可加载取决于本机构建状态：仓库已构建并暂存
            // `twilight_audio_node.node` 时应当为 true，否则为 false。协议验证不
            // 依赖具体值，但状态必须真实反映运行时探测结果。
            assert!(
                native_available == Some(true) || native_available == Some(false),
                "nativeAvailable must be a boolean from the sidecar probe"
            );

            sidecar
                .send_json(&json!({ "kind": "call", "requestId": "p", "method": "getPlaybackInfo", "args": [] }))
                .expect("send call");
            loop {
                let msg = sidecar.recv_json(Duration::from_secs(5)).await?;
                if msg.get("kind").and_then(Value::as_str) == Some("result")
                    && msg.get("requestId").and_then(Value::as_str) == Some("p")
                {
                    assert_eq!(msg.get("ok").and_then(Value::as_bool), Some(true));
                    assert_eq!(
                        msg.get("value").and_then(|v| v.get("state")).and_then(Value::as_str),
                        Some("stopped")
                    );
                    break;
                }
            }

            sidecar
                .send_json(&json!({ "kind": "call", "requestId": "s", "method": "setVolume", "args": [0.7] }))
                .expect("send volume");
            loop {
                let msg = sidecar.recv_json(Duration::from_secs(5)).await?;
                if msg.get("kind").and_then(Value::as_str) == Some("result")
                    && msg.get("requestId").and_then(Value::as_str) == Some("s")
                {
                    assert_eq!(msg.get("ok").and_then(Value::as_bool), Some(true));
                    break;
                }
            }

            sidecar
                .send_json(&json!({ "kind": "deinit", "requestId": "d" }))
                .expect("send deinit");
            loop {
                let msg = sidecar.recv_json(Duration::from_secs(5)).await?;
                if msg.get("kind").and_then(Value::as_str) == Some("deinitialized") {
                    assert_eq!(msg.get("requestId").and_then(Value::as_str), Some("d"));
                    break;
                }
            }
            Ok::<_, String>(())
        });
        match result {
            Ok(()) => {}
            Err(error) => panic!("audio sidecar e2e failed: {error}"),
        }
        sidecar.terminate();
    }
}

