use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

mod local_fs;
mod ncm_gateway;
mod path_policy;
mod plugin_index_gateway;
mod plugins;
mod plugins_ext;
mod plugins_index;
mod plugins_install;
mod plugins_zip;

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

fn load_json_file(app: &AppHandle, name: &str, fallback: Value) -> Value {
    fs::read_to_string(user_data_file(app, name))
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or(fallback)
}

fn save_json_file(app: &AppHandle, name: &str, data: &Value) {
    let path = user_data_file(app, name);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(
        path,
        serde_json::to_vec_pretty(data).expect("serialize data"),
    );
}

fn settings_snapshot(app: &AppHandle, settings: &Value) -> Value {
    let settings_file = user_data_file(app, "settings.json")
        .to_string_lossy()
        .into_owned();
    let user_data_path = app
        .path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let path_policy = path_policy::get_path_policy(app);
    json!({
        "settings": settings,
        "defaults": { "cachePath": "" },
        "paths": {
            "settingsFile": settings_file,
            "userDataPath": user_data_path,
            "activeCachePath": "",
            "dataRoot": path_policy,
            "migration": null
        },
        "appVersion": "1.0.5",
        "platform": "windows",
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
fn settings_update(app: AppHandle, patch: Value) -> Value {
    let mut settings = load_json_file(&app, "settings.json", json!({}));
    if let (Value::Object(stored), Value::Object(patch)) = (&mut settings, &patch) {
        for (key, value) in patch {
            stored.insert(key.clone(), value.clone());
        }
    }
    save_json_file(&app, "settings.json", &settings);
    settings_snapshot(&app, &settings)
}

#[tauri::command]
fn data_load_music_library(app: AppHandle) -> Value {
    load_json_file(
        &app,
        "music-library.json",
        json!({ "version": 2, "revision": 0, "tracks": [], "folders": [], "exclusions": [] }),
    )
}

#[tauri::command]
fn data_save_music_library(app: AppHandle, data: Value) -> Value {
    save_json_file(&app, "music-library.json", &data);
    data
}

/// 与 Electron `src/main/security/localPaths.ts` 的 `resolveAuthorizedAudioFile`
/// 语义对齐：文件存在、扩展名受支持，且位于已配置的音乐库目录（settings.json
/// 的 libraryFolders / musicCachePath / cachePath）或已保存音乐库的 folders 内。
/// Tauri 原型阶段没有独立的授权授权集，配置与已扫描目录即为授权范围。
#[tauri::command]
fn fs_is_audio_file_authorized(app: AppHandle, file_path: String) -> Result<bool, String> {
    let path = PathBuf::from(&file_path);
    if !path.is_file() || !local_fs::is_audio_path(&path) {
        return Ok(false);
    }
    let canonical = fs::canonicalize(&path).map_err(|err| format!("解析文件路径失败：{err}"))?;

    let settings = load_json_file(&app, "settings.json", json!({}));
    let library = load_json_file(
        &app,
        "music-library.json",
        json!({ "version": 2, "revision": 0, "tracks": [], "folders": [], "exclusions": [] }),
    );

    let mut roots: Vec<PathBuf> = Vec::new();
    for array in [
        settings.get("libraryFolders").and_then(Value::as_array),
        library.get("folders").and_then(Value::as_array),
    ]
    .into_iter()
    .flatten()
    {
        for folder in array.iter().filter_map(Value::as_str) {
            if !folder.trim().is_empty() {
                roots.push(PathBuf::from(folder));
            }
        }
    }
    for key in ["musicCachePath", "cachePath"] {
        if let Some(folder) = settings.get(key).and_then(Value::as_str) {
            if !folder.trim().is_empty() {
                roots.push(PathBuf::from(folder));
            }
        }
    }

    for root in roots {
        if let Ok(canonical_root) = fs::canonicalize(&root) {
            if canonical.starts_with(&canonical_root) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(path_policy::PathPolicyState(Mutex::new(None)))
        .manage(plugins::ProviderCallRegistry::default())
        .invoke_handler(tauri::generate_handler![
            relaunch,
            settings_get,
            settings_update,
            data_load_music_library,
            data_save_music_library,
            local_fs::fs_scan_music_files,
            fs_is_audio_file_authorized,
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
            plugins::extensions_read_theme_stylesheet
        ])
        .on_page_load(|webview, _| {
            let window = webview.window();
            let _ = window.set_title("Twilight Echo");
        })
        .build(tauri::generate_context!())
        .expect("failed to build Twilight Echo")
        .run(|_app, _event| {});
}
