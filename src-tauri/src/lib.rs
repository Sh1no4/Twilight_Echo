use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[tauri::command]
fn relaunch(app: AppHandle) {
    app.restart();
}

fn user_data_file(app: &AppHandle, name: &str) -> PathBuf {
    app.path().app_data_dir().expect("app data directory").join(name)
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
    let _ = fs::write(path, serde_json::to_vec_pretty(data).expect("serialize data"));
}

fn settings_snapshot(app: &AppHandle, settings: &Value) -> Value {
    let settings_file = user_data_file(app, "settings.json").to_string_lossy().into_owned();
    let user_data_path = app
        .path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    json!({
        "settings": settings,
        "defaults": { "cachePath": "" },
        "paths": {
            "settingsFile": settings_file,
            "userDataPath": user_data_path,
            "activeCachePath": ""
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            relaunch,
            settings_get,
            settings_update,
            data_load_music_library,
            data_save_music_library
        ])
        .on_page_load(|webview, _| {
            let window = webview.window();
            let _ = window.set_title("Twilight Echo");
        })
        .build(tauri::generate_context!())
        .expect("failed to build Twilight Echo")
        .run(|_app, _event| {});
}
