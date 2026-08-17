use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

mod audio_runtime;
mod data;
mod desktop_lyrics;
mod fonts;
mod library_scan;
mod local_fs;
mod mini_player;
mod ncm_gateway;
mod node_sidecar;
mod path_policy;
mod persistence;
mod plugin_host;
mod plugin_index_gateway;
mod plugins;
mod plugins_ext;
mod plugins_index;
mod plugins_install;
mod plugins_zip;
mod radio_media;
mod settings_backup;
mod sleep_timer;
mod themes;
mod tray_player;

// Tauri 构建与发布仅覆盖 Windows（规划 Stage 8）。macOS/Linux 不纳入 Tauri
// 支持范围，编译期直接拒绝，避免出现半成品的跨平台构建被误认为可用。
#[cfg(not(target_os = "windows"))]
compile_error!(
    "Twilight Echo 的 Tauri 运行时仅支持 Windows；macOS/Linux 不纳入 Tauri 构建或发布验证。"
);

pub(crate) mod settings {

    use serde_json::{json, Value};
    use std::path::Path;

    pub(crate) fn load_settings(app: &tauri::AppHandle) -> Value {
        crate::load_json_file(app, "settings.json", json!({}))
    }

    pub(crate) fn save_settings(app: &tauri::AppHandle, settings: &Value) -> Result<(), String> {
        crate::save_json_file(app, "settings.json", settings)
    }

    pub(crate) fn settings_snapshot(app: &tauri::AppHandle) -> Value {
        let settings = load_settings(app);
        crate::settings_snapshot(app, &settings)
    }

    pub(crate) fn default_mini_player_settings() -> Value {
        json!({
            "windowX": -1,
            "windowY": -1,
            "windowWidth": 480,
            "windowHeight": 300,
            "alwaysOnTop": false,
            "positionLocked": false,
            "activeStyleId": "aurora-glass"
        })
    }

    pub(crate) fn empty_mini_player_state() -> Value {
        json!({
            "track": null,
            "currentLyric": null,
            "lyrics": [],
            "isPlaying": false,
            "isLoading": false,
            "currentTime": 0,
            "duration": 0,
            "volume": 0.7,
            "playMode": "sequential",
            "favoriteAvailable": false,
            "favoriteLiked": false,
            "favoriteLoading": false,
            "dominantColor": "#7c4dff",
            "queueIndex": -1,
            "queueLength": 0
        })
    }

    pub(crate) fn merge_mini_player_settings(
        current: &Value,
        patch: &Value,
    ) -> Value {
        let mut merged = current.clone();
        if let (Some(target), Some(source)) = (merged.as_object_mut(), patch.as_object()) {
            const ALLOWED_KEYS: &[&str] = &[
                "alwaysOnTop",
                "positionLocked",
                "activeStyleId",
                "profiles",
                "windowWidth",
                "windowHeight",
            ];
            for key in ALLOWED_KEYS {
                if let Some(value) = source.get(*key) {
                    target.insert((*key).to_string(), value.clone());
                }
            }
        }
        merged
    }

    pub(crate) fn normalize_mini_player_settings(value: Value) -> Value {
        let object = value.as_object().cloned().unwrap_or_default();
        let width = number_or(object.get("windowWidth"), 480.0).clamp(420.0, 900.0);
        let height = number_or(object.get("windowHeight"), 300.0).clamp(220.0, 520.0);
        let active_style_id = object
            .get("activeStyleId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("aurora-glass");
        json!({
            "windowX": integer_or(object.get("windowX"), -1),
            "windowY": integer_or(object.get("windowY"), -1),
            "windowWidth": width,
            "windowHeight": height,
            "alwaysOnTop": object.get("alwaysOnTop").and_then(Value::as_bool).unwrap_or(false),
            "positionLocked": object.get("positionLocked").and_then(Value::as_bool).unwrap_or(false),
            "activeStyleId": active_style_id,
            "profiles": object.get("profiles").cloned().unwrap_or_else(|| json!({}))
        })
    }

    pub(crate) fn normalize_mini_player_state(value: Value) -> Value {
        let object = value.as_object().cloned().unwrap_or_default();
        json!({
            "track": object.get("track").cloned().unwrap_or(Value::Null),
            "currentLyric": object.get("currentLyric").cloned().unwrap_or(Value::Null),
            "lyrics": object.get("lyrics").cloned().unwrap_or_else(|| json!([])),
            "isPlaying": object.get("isPlaying").and_then(Value::as_bool).unwrap_or(false),
            "isLoading": object.get("isLoading").and_then(Value::as_bool).unwrap_or(false),
            "currentTime": number_or(object.get("currentTime"), 0.0).max(0.0),
            "duration": number_or(object.get("duration"), 0.0).max(0.0),
            "volume": number_or(object.get("volume"), 0.7).clamp(0.0, 1.0),
            "playMode": object.get("playMode").and_then(Value::as_str).unwrap_or("sequential"),
            "favoriteAvailable": object.get("favoriteAvailable").and_then(Value::as_bool).unwrap_or(false),
            "favoriteLiked": object.get("favoriteLiked").and_then(Value::as_bool).unwrap_or(false),
            "favoriteLoading": object.get("favoriteLoading").and_then(Value::as_bool).unwrap_or(false),
            "dominantColor": object.get("dominantColor").and_then(Value::as_str).unwrap_or("#7c4dff"),
            "queueIndex": integer_or(object.get("queueIndex"), -1),
            "queueLength": integer_or(object.get("queueLength"), 0).max(0)
        })
    }

    pub(crate) fn normalize_mini_player_command(command: &Value) -> Option<Value> {
        let object = command.as_object()?;
        let command_type = object.get("type")?.as_str()?;
        let normalized = match command_type {
            "toggle-play" | "previous" | "next" | "cycle-play-mode" | "toggle-favorite" => {
                json!({ "type": command_type })
            }
            "set-play-mode" => {
                let mode = object.get("value").and_then(Value::as_str)?;
                json!({ "type": command_type, "value": mode })
            }
            "seek" => {
                let value = object.get("value").and_then(Value::as_f64)?;
                json!({ "type": command_type, "value": value })
            }
            "set-volume" => {
                let value = object.get("value").and_then(Value::as_f64)?;
                json!({ "type": command_type, "value": value.clamp(0.0, 1.0) })
            }
            _ => return None,
        };
        Some(normalized)
    }

    fn number_or(value: Option<&Value>, fallback: f64) -> f64 {
        value
            .and_then(Value::as_f64)
            .filter(|v| v.is_finite())
            .unwrap_or(fallback)
    }

    fn integer_or(value: Option<&Value>, fallback: i64) -> i64 {
        value
            .and_then(Value::as_i64)
            .unwrap_or(fallback)
    }

    #[allow(dead_code)]
    pub(crate) fn sha256_file(path: &Path) -> Result<String, String> {
        let bytes = std::fs::read(path).map_err(|e| format!("读取文件失败：{e}"))?;
        Ok(crate::plugins_index::sha256_hex(&bytes))
    }
}

#[tauri::command]
fn relaunch(app: AppHandle) {
    app.restart();
}

fn categorized_file(app: &AppHandle, category: &str, name: &str) -> PathBuf {
    let policy = path_policy::get_path_policy(app);
    path_policy::categorized_data_path(&policy, category, &[name])
}

fn user_data_file(app: &AppHandle, name: &str) -> PathBuf {
    if name == "settings.json" {
        categorized_file(app, "config", name)
    } else {
        categorized_file(app, "database", name)
    }
}

pub(crate) fn load_json_file(app: &AppHandle, name: &str, fallback: Value) -> Value {
    fs::read_to_string(user_data_file(app, name))
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or(fallback)
}

fn auth_patch(app: &AppHandle, settings: &Value, patch: &mut Value) {
    let Some(patch_object) = patch.as_object_mut() else {
        return;
    };
    let authorized: Vec<String> = library_scan::authorized_audio_roots(app)
        .into_iter()
        .map(|root| root.to_string_lossy().into_owned())
        .collect();
    fn keep_path(value: &Value, authorized: &[String]) -> bool {
        let Some(raw) = value.as_str() else {
            return false;
        };
        let candidate = raw.trim();
        if candidate.is_empty() {
            return false;
        }
        let Ok(canonical) = std::fs::canonicalize(candidate) else {
            return false;
        };
        let canonical = canonical.to_string_lossy().to_lowercase();
        authorized.iter().any(|root| {
            let Ok(root_canonical) = std::fs::canonicalize(root) else {
                return root.to_lowercase() == candidate.to_lowercase();
            };
            canonical.starts_with(&root_canonical.to_string_lossy().to_lowercase())
        })
    }
    for key in ["libraryFolders", "musicCachePath", "cachePath"] {
        match patch_object.get(key) {
            Some(Value::Array(folders)) if key == "libraryFolders" => {
                if folders.iter().all(|folder| keep_path(folder, &authorized)) {
                    // 整个数组都在授权根内，允许保留。
                } else {
                    patch_object.remove(key);
                }
            }
            Some(single) if key != "libraryFolders" => {
                if !keep_path(single, &authorized) {
                    patch_object.remove(key);
                }
            }
            _ => {}
        }
    }
    let _ = settings;
}

pub(crate) fn save_json_file(app: &AppHandle, name: &str, data: &Value) -> Result<(), String> {
    let path = user_data_file(app, name);
    let serialized =
        serde_json::to_vec_pretty(data).map_err(|error| format!("序列化失败：{error}"))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建目录失败：{error}"))?;
    }
    fs::write(&path, &serialized).map_err(|error| format!("写入失败：{error}"))?;
    Ok(())
}

pub(crate) fn settings_snapshot(app: &AppHandle, settings: &Value) -> Value {
    let settings_file = user_data_file(app, "settings.json")
        .to_string_lossy()
        .into_owned();
    let user_data_path = app
        .path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let path_policy = path_policy::get_path_policy(app);
    let active_cache_path = settings
        .get("musicCachePath")
        .and_then(Value::as_str)
        .or_else(|| settings.get("cachePath").and_then(Value::as_str))
        .unwrap_or("")
        .to_string();
    json!({
        "settings": settings,
        "defaults": { "cachePath": "" },
        "paths": {
            "settingsFile": settings_file,
            "userDataPath": user_data_path,
            "activeCachePath": active_cache_path,
            "dataRoot": path_policy,
            "migration": null
        },
        "appVersion": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "windowTransparencySupported": false,
        "restartRequired": false,
        "restartReasons": []
    })
}

#[tauri::command]
fn settings_get(app: AppHandle) -> Value {
    let settings = load_json_file(&app, "settings.json", json!({}));
    settings_snapshot(&app, &settings)
}

#[tauri::command]
fn settings_update(app: AppHandle, patch: Value) -> Result<Value, String> {
    let mut settings = load_json_file(&app, "settings.json", json!({}));
    if let (Value::Object(stored), Value::Object(patch)) = (&mut settings, &patch) {
        for (key, value) in patch {
            stored.insert(key.clone(), value.clone());
        }
    }
    // 路径类键（libraryFolders / musicCachePath / cachePath）新值必须位于授权
    // 音频根内，否则移除，防止渲染层把任意目录提升为授权根。
    let mut filtered = settings.clone();
    auth_patch(&app, &settings, &mut filtered);
    save_json_file(&app, "settings.json", &filtered)?;
    let snapshot = settings_snapshot(&app, &filtered);
    let _ = app.emit("settings:changed", snapshot.clone());
    Ok(snapshot)
}

#[tauri::command]
fn data_load_music_library(app: AppHandle) -> Value {
    library_scan::load_music_library(&app)
}

#[tauri::command]
fn data_save_music_library(app: AppHandle, data: Value) -> Result<Value, String> {
    library_scan::save_music_library(&app, &data)?;
    Ok(data)
}

// ── Stage 3: settings 缓存统计 / 清理 / 快捷键状态 ──────────────────────────────────────

fn cache_root(app: &AppHandle, settings: &Value) -> PathBuf {
    let explicit = settings
        .get("musicCachePath")
        .and_then(Value::as_str)
        .or_else(|| settings.get("cachePath").and_then(Value::as_str))
        .map(str::trim)
        .filter(|path| !path.is_empty());
    if let Some(path) = explicit {
        return PathBuf::from(path);
    }
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("cache"))
        .unwrap_or_else(|_| PathBuf::from("cache"))
}

fn directory_size(dir: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Ok(metadata) = fs::metadata(&path) {
                if metadata.is_dir() {
                    total += directory_size(&path);
                } else {
                    total += metadata.len();
                }
            }
        }
    }
    total
}

#[tauri::command]
fn settings_get_cache_size(app: AppHandle) -> Result<u64, String> {
    let settings = load_json_file(&app, "settings.json", json!({}));
    Ok(directory_size(&cache_root(&app, &settings)))
}

#[tauri::command]
fn settings_clear_cache(app: AppHandle) -> Result<u64, String> {
    let settings = load_json_file(&app, "settings.json", json!({}));
    let root = cache_root(&app, &settings);
    if root.is_dir() {
        fs::remove_dir_all(&root).map_err(|error| format!("清理缓存失败：{error}"))?;
    }
    fs::create_dir_all(&root).map_err(|error| format!("重建缓存目录失败：{error}"))?;
    Ok(directory_size(&root))
}

#[tauri::command]
fn settings_get_shortcut_statuses() -> Value {
    let shortcuts: [(&str, &str, &str); 8] = [
        ("CommandOrControl+Alt+Left", "previous", "上一首"),
        ("CommandOrControl+Alt+Right", "next", "下一首"),
        ("CommandOrControl+Alt+Space", "playPause", "播放 / 暂停"),
        ("CommandOrControl+Alt+D", "toggleDesktopLyrics", "桌面歌词"),
        ("MediaPreviousTrack", "previous", "上一首（媒体键）"),
        ("MediaNextTrack", "next", "下一首（媒体键）"),
        ("MediaPlayPause", "playPause", "播放 / 暂停（媒体键）"),
        ("MediaStop", "pause", "停止（媒体键）"),
    ];
    Value::Array(
        shortcuts
            .into_iter()
            .map(|(accelerator, action, label)| {
                json!({
                    "accelerator": accelerator,
                    "action": action,
                    "label": label,
                    "registered": false,
                    "error": null
                })
            })
            .collect(),
    )
}

#[tauri::command]
fn debug_append_native_trace(message: String) {
    if message.is_empty() || message.len() > 500 {
        return;
    }
    let line = format!("{} {message}\n", crate::persistence::now_iso8601());
    let path = std::env::temp_dir().join("twilight-native.log");
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = file.write_all(line.as_bytes());
    }
}

#[tauri::command]
fn fs_is_audio_file_authorized(app: AppHandle, file_path: String) -> Result<bool, String> {
    library_scan::is_authorized_audio_file(&app, &file_path)
}

// ── Stage 1: 动态 capability manifest（与 `src/shared/runtimeManifest.ts` 协议对齐）──────

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ComponentHealth {
    component: &'static str,
    state: &'static str,
    reason_code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'static str>,
    checked_at: String,
}

fn component_health(
    component: &'static str,
    state: &'static str,
    reason_code: &'static str,
    message: Option<&'static str>,
) -> ComponentHealth {
    ComponentHealth {
        component,
        state,
        reason_code,
        message,
        checked_at: plugins::now_iso8601(),
    }
}

#[tauri::command]
fn runtime_get_manifest(app: AppHandle) -> Value {
    let checked_at = plugins::now_iso8601();
    let policy = path_policy::get_path_policy(&app);

    // 组件探针：真实探测可用资源/网关，缺失的能力诚实地报 unavailable。
    let provider_gateway = if ncm_gateway::port_open() {
        component_health(
            "providerGateway",
            "healthy",
            "component-healthy",
            Some("网易云网关端口可连通"),
        )
    } else {
        component_health(
            "providerGateway",
            "unavailable",
            "component-unavailable",
            Some("网易云网关未在 127.0.0.1:3100 探测到"),
        )
    };

    let plugin_sidecar = {
        let plugin_data_writable = policy
            .writable_categories
            .get("plugin-data")
            .copied()
            .unwrap_or(false);
        let plugin_writable = policy
            .writable_categories
            .get("plugins")
            .copied()
            .unwrap_or(false);
        if plugin_writable && plugin_data_writable {
            component_health(
                "pluginSidecar",
                "healthy",
                "component-healthy",
                Some("插件/插件数据目录可写"),
            )
        } else {
            component_health(
                "pluginSidecar",
                "unavailable",
                "component-unavailable",
                Some("插件目录不可写"),
            )
        }
    };

    // 音频 sidecar：随包提供 `sidecar/audioEngineNode.js`（Stage 6 起）。原生 addon
    // （`twilight_audio_node.node`）存在时为 healthy；脚本缺失为 unavailable；
    // 脚本存在但 addon 未随包时为 degraded（播放会诚实走 HTMLAudio 兜底）。
    let audio_sidecar = {
        let script_present = audio_runtime::resolve_audio_script(&app).is_ok();
        let addon_present = {
            let mut found = false;
            if let Ok(resource_dir) = app.path().resource_dir() {
                found = resource_dir
                    .join("audio-engine")
                    .join("twilight_audio_node.node")
                    .is_file();
            }
            found
        };
        if !script_present {
            component_health(
                "audioSidecar",
                "unavailable",
                "component-unavailable",
                Some("音频运行时脚本未随包提供"),
            )
        } else if addon_present {
            component_health(
                "audioSidecar",
                "healthy",
                "component-healthy",
                Some("音频运行时与原生引擎已提供"),
            )
        } else {
            component_health(
                "audioSidecar",
                "degraded",
                "component-degraded",
                Some("音频运行时已提供；原生引擎未随包，播放走 HTMLAudio 兜底"),
            )
        }
    };
    let font_backend = component_health(
        "fontBackend",
        "healthy",
        "component-healthy",
        Some("系统字体枚举已提供"),
    );

    let authorized_resources = if policy.writable {
        component_health(
            "authorizedResources",
            "healthy",
            "component-healthy",
            Some("数据目录可写，授权资源路径可用"),
        )
    } else {
        component_health(
            "authorizedResources",
            "unavailable",
            "component-unavailable",
            Some("数据目录不可写"),
        )
    };

    let arch = std::env::consts::ARCH;
    json!({
        "os": std::env::consts::OS,
        "arch": arch,
        "version": env!("CARGO_PKG_VERSION"),
        "checkedAt": checked_at,
        "components": [
            audio_sidecar,
            plugin_sidecar,
            provider_gateway,
            font_backend,
            authorized_resources
        ]
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(path_policy::PathPolicyState(Mutex::new(None)))
        .manage(plugins::ProviderCallRegistry::default())
        .manage(plugin_host::PluginHostRegistry::default())
        .manage(audio_runtime::AudioRuntimeRegistry::default())
        .manage(library_scan::LibraryScanManager::default())
        .manage(mini_player::MiniPlayerState)
        .manage(tray_player::TrayPlayerState)
        .manage(desktop_lyrics::DesktopLyricsState)
        .manage(sleep_timer::SleepTimerStateInner(std::sync::Mutex::new(
            sleep_timer::SleepTimerRuntime::default(),
        )))
        .setup(|app| {
            library_scan::LibraryScanManager::grant_runtime_paths(app.handle());
            // Stage 8：解析随包 Node 运行时（无用户预装 Node 依赖），缓存供 sidecar spawn。
            node_sidecar::init_node_binary(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            relaunch,
            settings_get,
            settings_update,
            settings_get_cache_size,
            settings_clear_cache,
            settings_get_shortcut_statuses,
            debug_append_native_trace,
            settings_backup::settings_export_backup,
            settings_backup::settings_import_backup,
            data_load_music_library,
            data_save_music_library,
            data::data_load_playback_session,
            data::data_save_playback_session,
            data::data_clear_playback_session,
            data::data_load_playlists,
            data::data_save_playlists,
            data::data_load_lyrics_management,
            data::data_save_lyrics_management,
            data::data_load_playback_bookmarks,
            data::data_save_playback_bookmarks,
            themes::themes_get_bootstrap,
            themes::themes_list,
            themes::themes_save,
            themes::themes_delete,
            themes::themes_set_active,
            themes::themes_set_window_inheritance,
            fonts::fonts_list_installed,
            local_fs::fs_scan_music_files,
            fs_is_audio_file_authorized,
            library_scan::library_scan_startup,
            library_scan::library_scan_full,
            library_scan::library_get_scan_status,
            library_scan::library_pause_scan,
            library_scan::library_resume_scan,
            library_scan::library_cancel_scan,
            library_scan::library_remove_tracks,
            library_scan::library_restore_exclusions,
            library_scan::library_reset,
            library_scan::fs_read_audio_file,
            library_scan::data_get_cover,
            radio_media::radio_load_stations,
            radio_media::radio_save_stations,
            radio_media::podcast_load_subscriptions,
            radio_media::podcast_save_subscriptions,
            plugins::plugins_list,
            plugins::plugins_enable,
            plugins::plugins_disable,
            plugins::plugins_uninstall,
            plugins::plugins_get_log,
            plugins::plugins_open_log,
            plugins::plugins_install_from_path,
            plugins::plugins_choose_and_install,
            plugins::plugins_list_index,
            plugins::plugins_refresh_index,
            plugins::plugins_get_index_status,
            plugins::plugins_install_from_index,
            plugins::plugins_set_native_dsp_parameters,
            plugins::providers_list,
            plugins::providers_call,
            plugins::providers_cancel,
            plugins::extensions_list,
            plugins::extensions_execute_command,
            plugins::extensions_read_theme_stylesheet,
            audio_runtime::audio_engine_load_queue,
            audio_runtime::audio_engine_play,
            audio_runtime::audio_engine_is_html_audio_fallback_allowed,
            audio_runtime::audio_engine_toggle_pause,
            audio_runtime::audio_engine_seek,
            audio_runtime::audio_engine_set_volume,
            audio_runtime::audio_engine_set_playback_rate,
            audio_runtime::audio_engine_set_loop_range,
            audio_runtime::audio_engine_stop,
            audio_runtime::audio_engine_next,
            audio_runtime::audio_engine_previous,
            audio_runtime::audio_engine_set_play_mode,
            audio_runtime::audio_engine_get_upcoming_track,
            audio_runtime::audio_engine_get_playback_info,
            audio_runtime::audio_engine_set_exclusive_mode,
            audio_runtime::audio_engine_get_exclusive_mode,
            audio_runtime::audio_engine_set_audio_output,
            audio_runtime::audio_engine_set_audio_device,
            audio_runtime::audio_engine_set_output_config,
            audio_runtime::audio_engine_get_output_config_apply_status,
            audio_runtime::audio_engine_get_audio_output,
            audio_runtime::audio_engine_get_audio_output_options,
            audio_runtime::audio_engine_get_audio_output_state,
            audio_runtime::audio_engine_set_audio_processing,
            audio_runtime::audio_engine_get_audio_processing,
            audio_runtime::audio_engine_get_dsp_scene_state,
            audio_runtime::audio_engine_set_dsp_scenes,
            audio_runtime::audio_engine_set_output_stage,
            audio_runtime::audio_engine_set_stereo_image,
            audio_runtime::audio_engine_apply_dsp_scene,
            audio_runtime::audio_engine_get_dsp_graph_status,
            audio_runtime::audio_engine_set_eq_bands,
            audio_runtime::audio_engine_set_eq_preset,
            audio_runtime::audio_engine_set_crossfeed_strength,
            audio_runtime::audio_engine_set_replay_gain_mode,
            audio_runtime::audio_engine_load_impulse_response,
            audio_runtime::audio_engine_unload_impulse_response,
            audio_runtime::audio_engine_get_convolver_info,
            audio_runtime::audio_engine_get_metadata,
            audio_runtime::audio_engine_get_spectrum_data,
            audio_runtime::audio_engine_get_visualization_data,
            audio_runtime::audio_engine_get_vst3_catalog,
            audio_runtime::audio_engine_set_vst3_enabled,
            audio_runtime::audio_engine_set_vst3_search_paths,
            audio_runtime::audio_engine_scan_vst3_plugins,
            audio_runtime::audio_engine_clear_vst3_quarantine,
            audio_runtime::audio_engine_get_dsp_assets,
            audio_runtime::audio_engine_import_dsp_asset,
            audio_runtime::audio_engine_import_dsp_correction_profile,
            audio_runtime::audio_engine_import_frequency_response,
            audio_runtime::audio_engine_get_dsp_correction_profile,
            audio_runtime::audio_engine_delete_dsp_asset,
            audio_runtime::audio_engine_export_dsp_profile,
            audio_runtime::audio_engine_import_dsp_profile,
            audio_runtime::audio_engine_bpm_request,
            audio_runtime::audio_engine_bpm_get_cache_size,
            audio_runtime::audio_engine_bpm_clear_cache,
            audio_runtime::audio_engine_bpm_cancel,
            audio_runtime::audio_engine_loudness_request,
            audio_runtime::audio_engine_loudness_get_cache_size,
            audio_runtime::audio_engine_loudness_clear_cache,
            audio_runtime::audio_engine_loudness_get_status,
            audio_runtime::audio_engine_loudness_cancel,
            audio_runtime::audio_engine_export_diagnostics,
            mini_player::mini_player_open,
            mini_player::mini_player_get_bootstrap,
            mini_player::mini_player_update_settings,
            mini_player::mini_player_command,
            mini_player::mini_player_publish_state,
            mini_player::mini_player_minimize,
            mini_player::mini_player_return_to_main,
            mini_player::mini_player_choose_background_image,
            tray_player::tray_player_toggle,
            tray_player::tray_player_is_visible,
            tray_player::tray_player_hide,
            tray_player::tray_player_get_bootstrap,
            tray_player::tray_player_command,
            tray_player::tray_player_navigate,
            tray_player::tray_player_consume_pending_navigation,
            desktop_lyrics::desktop_lyrics_toggle,
            desktop_lyrics::desktop_lyrics_show,
            desktop_lyrics::desktop_lyrics_hide,
            desktop_lyrics::desktop_lyrics_publish_track,
            desktop_lyrics::desktop_lyrics_publish_time,
            desktop_lyrics::desktop_lyrics_update_settings,
            desktop_lyrics::desktop_lyrics_get_position,
            desktop_lyrics::desktop_lyrics_move,
            desktop_lyrics::desktop_lyrics_request_close,
            sleep_timer::sleep_timer_configure,
            sleep_timer::sleep_timer_cancel,
            sleep_timer::sleep_timer_get_state,
            sleep_timer::sleep_timer_boundary,
            runtime_get_manifest
        ])
        .on_page_load(|webview, _| {
            let window = webview.window();
            let _ = window.set_title("Twilight Echo");
        })
        .on_window_event(|window, event| {
            // 关闭主窗口即退出整个应用（走 `RunEvent::Exit` 统一清理 sidecar），
            // 否则隐藏的辅助窗口（mini/tray/desktop-lyrics 均 `visible:false`）仍存活，
            // Tauri「所有窗口关闭才退出」不会触发，WebView 进程随之残留。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let handle = window.app_handle().clone();
                    std::thread::spawn(move || handle.exit(0));
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Twilight Echo")
        .run(|app, event| {
            // 退出时统一终止已登记的 Node 子进程（插件宿主 / 网关口），
            // 避免应用退出后残留孤儿进程。
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                plugin_host::shutdown(app);
                audio_runtime::shutdown(app);
                node_sidecar::terminate_all();
            }
        });
}

