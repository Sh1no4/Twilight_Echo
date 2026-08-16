use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

mod audio_runtime;
mod data;
mod fonts;
mod library_scan;
mod local_fs;
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
mod themes;

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
    save_json_file(&app, "settings.json", &settings)?;
    let snapshot = settings_snapshot(&app, &settings);
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

/// 解析配置的缓存根：`musicCachePath` > `cachePath`，缺省为应用数据目录 / cache。
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

/// `settings.getCacheSize`：返回缓存目录总字节数。
#[tauri::command]
fn settings_get_cache_size(app: AppHandle) -> Result<u64, String> {
    let settings = load_json_file(&app, "settings.json", json!({}));
    Ok(directory_size(&cache_root(&app, &settings)))
}

/// `settings.clearCache`：清空缓存目录并返回新的总字节数。
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

/// `settings.getShortcutStatuses`：Tauri 尚未接入全局快捷键后端，诚实报告
/// 全部为未注册（与 Electron `getPlayerShortcutStatuses` 的列表形状一致）。
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

/// 与 Electron `src/main/security/localPaths.ts` 的 `resolveAuthorizedAudioFile`
/// 语义对齐：文件存在、扩展名受支持，且位于已配置的音乐库目录（settings.json
/// 的 libraryFolders / musicCachePath / cachePath）或已保存音乐库的 folders 内。
/// canonical 化后会拒绝 symlink 逃逸到授权 root 之外的路径。
#[tauri::command]
fn fs_is_audio_file_authorized(app: AppHandle, file_path: String) -> Result<bool, String> {
    library_scan::is_authorized_audio_file(&app, &file_path)
}

// ── Stage 1: 动态 capability manifest（与 `src/shared/runtimeManifest.ts` 协议对齐）──────

/// 组件健康状态（`RuntimeComponentHealth`，camelCase 字段与 TS 一致）。
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

/// 运行时探测载荷（`RuntimeManifestProbe`）：OS、架构、版本与组件健康。逐方法状态由
/// 渲染端依据 `windowApiParity.ts` 契约推导，这里只返回运行事实 + 组件探针。
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
        .setup(|app| {
            library_scan::LibraryScanManager::grant_runtime_paths(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            relaunch,
            settings_get,
            settings_update,
            settings_get_cache_size,
            settings_clear_cache,
            settings_get_shortcut_statuses,
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
            runtime_get_manifest
        ])
        .on_page_load(|webview, _| {
            let window = webview.window();
            let _ = window.set_title("Twilight Echo");
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
