
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::LogicalSize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

use crate::path_policy;
use crate::settings;

const MINI_PLAYER_WINDOW_LABEL: &str = "mini-player";
const MINI_PLAYER_VIEW_QUERY: &str = "window=mini-player";
const MINI_PLAYER_WIDTH: f64 = 480.0;
const MINI_PLAYER_HEIGHT: f64 = 300.0;
const MINI_PLAYER_MIN_WIDTH: f64 = 420.0;
const MINI_PLAYER_MIN_HEIGHT: f64 = 220.0;
const MINI_PLAYER_MAX_WIDTH: f64 = 900.0;
const MINI_PLAYER_MAX_HEIGHT: f64 = 520.0;
const MAX_BACKGROUND_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

pub struct MiniPlayerState;

fn mini_player_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(MINI_PLAYER_WINDOW_LABEL)
}

fn window_is_self(_app: &AppHandle, window: &tauri::WebviewWindow) -> bool {
    window.label() == MINI_PLAYER_WINDOW_LABEL
}

fn current_mini_player_settings(app: &AppHandle) -> Value {
    let stored = settings::load_settings(app);
    stored
        .get("miniPlayer")
        .cloned()
        .unwrap_or_else(|| settings::default_mini_player_settings())
}

fn latest_mini_player_state(app: &AppHandle) -> Value {
    let stored = settings::load_settings(app);
    stored
        .get("miniPlayerState")
        .cloned()
        .unwrap_or_else(|| settings::empty_mini_player_state())
}

fn current_motion_preference(app: &AppHandle) -> Value {
    let stored = settings::load_settings(app);
    stored
        .get("motionPreference")
        .cloned()
        .unwrap_or_else(|| json!("system"))
}

fn broadcast_settings(app: &AppHandle) {
    let snapshot = settings::settings_snapshot(app);
    let _ = app.emit("settings:changed", snapshot);
}

fn persist_mini_player_settings(app: &AppHandle, settings: &Value) -> Result<Value, String> {
    let mut stored = crate::settings::load_settings(app);
    if let Some(object) = stored.as_object_mut() {
        object.insert("miniPlayer".to_string(), settings.clone());
    }
    crate::settings::save_settings(app, &stored)?;
    broadcast_settings(app);
    Ok(settings.clone())
}

fn send_mini_player_state(app: &AppHandle) {
    if let Some(window) = mini_player_window(app) {
        let _ = window.emit("miniPlayer:state", latest_mini_player_state(app));
    }
}

fn send_mini_player_settings(app: &AppHandle) {
    if let Some(window) = mini_player_window(app) {
        let _ = window.emit("miniPlayer:settings", current_mini_player_settings(app));
    }
}

fn send_mini_player_motion_preference(app: &AppHandle) {
    if let Some(window) = mini_player_window(app) {
        let _ = window.emit("miniPlayer:motionPreference", current_motion_preference(app));
    }
}

fn send_mini_player_command_to_main(app: &AppHandle, command: &Value) {
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.emit("miniPlayer:command", command);
    }
}

fn open_mini_player(app: &AppHandle) -> Result<Value, String> {
    let settings = current_mini_player_settings(app);
    let width = settings
        .get("windowWidth")
        .and_then(Value::as_f64)
        .unwrap_or(MINI_PLAYER_WIDTH);
    let height = settings
        .get("windowHeight")
        .and_then(Value::as_f64)
        .unwrap_or(MINI_PLAYER_HEIGHT);
    let x = settings.get("windowX").and_then(Value::as_f64);
    let y = settings.get("windowY").and_then(Value::as_f64);
    let always_on_top = settings.get("alwaysOnTop").and_then(Value::as_bool).unwrap_or(false);

    if let Some(existing) = mini_player_window(app) {
        if !existing.is_visible().unwrap_or(false) {
            let _ = existing.show();
            let _ = existing.set_focus();
        }
        send_mini_player_settings(app);
        send_mini_player_state(app);
        return Ok(settings);
    }

    let url = app
        .config()
        .build
        .dev_url
        .clone()
        .and_then(|dev_url| {
            let trailing = if dev_url.query().is_some() { "&" } else { "?" };
            dev_url
                .join(&format!("{trailing}{MINI_PLAYER_VIEW_QUERY}"))
                .ok()
                .map(WebviewUrl::External)
        })
        .unwrap_or_else(|| {
            WebviewUrl::App(format!("index.html?{MINI_PLAYER_VIEW_QUERY}").into())
        });

    let mut builder = WebviewWindowBuilder::new(app, MINI_PLAYER_WINDOW_LABEL, url)
        .title("Twilight Echo Mini Player")
        .inner_size(width.max(MINI_PLAYER_MIN_WIDTH), height.max(MINI_PLAYER_MIN_HEIGHT))
        .min_inner_size(MINI_PLAYER_MIN_WIDTH, MINI_PLAYER_MIN_HEIGHT)
        .max_inner_size(MINI_PLAYER_MAX_WIDTH, MINI_PLAYER_MAX_HEIGHT)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .visible(false);
    if let (Some(x), Some(y)) = (x, y) {
        builder = builder.position(x, y);
    }
    if always_on_top {
        builder = builder.always_on_top(true);
    }

    let window = builder
        .build()
        .map_err(|error| format!("创建迷你播放器窗口失败：{error}"))?;

    {
        use tauri::WindowEvent;
        window.on_window_event(|event| {
            if let WindowEvent::CloseRequested { .. } = event {
                let _ = event;
            }
        });
    }

    window
        .show()
        .map_err(|error| format!("显示迷你播放器窗口失败：{error}"))?;
    let _ = window.set_focus();

    send_mini_player_settings(app);
    send_mini_player_state(app);
    send_mini_player_motion_preference(app);

    Ok(current_mini_player_settings(app))
}

#[tauri::command]
pub fn mini_player_open(window: tauri::WebviewWindow) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("miniPlayer:open 仅允许主窗口调用".to_string());
    }
    open_mini_player(&window.app_handle())
}

#[tauri::command]
pub fn mini_player_get_bootstrap(app: AppHandle, window: tauri::WebviewWindow) -> Result<Value, String> {
    if !window_is_self(&app, &window) {
        return Err("miniPlayer:getBootstrap 仅允许迷你播放器窗口调用".to_string());
    }
    Ok(json!({
        "state": latest_mini_player_state(&app),
        "settings": current_mini_player_settings(&app),
        "motionPreference": current_motion_preference(&app)
    }))
}

#[tauri::command]
pub fn mini_player_update_settings(
    app: AppHandle,
    window: tauri::WebviewWindow,
    patch: Value,
) -> Result<Value, String> {
    if !window_is_self(&app, &window) {
        return Err("miniPlayer:updateSettings 仅允许迷你播放器窗口调用".to_string());
    }
    let current = current_mini_player_settings(&app);
    let merged = settings::merge_mini_player_settings(&current, &patch);
    let merged = settings::normalize_mini_player_settings(merged);
    let saved = persist_mini_player_settings(&app, &merged)?;
    if let Some(win) = mini_player_window(&app) {
        let width = merged.get("windowWidth").and_then(Value::as_f64);
        let height = merged.get("windowHeight").and_then(Value::as_f64);
        if let (Some(width), Some(height)) = (width, height) {
            let _ = win.set_size(LogicalSize::new(width, height));
        }
        let _ = win.set_always_on_top(merged.get("alwaysOnTop").and_then(Value::as_bool).unwrap_or(false));
    }
    send_mini_player_settings(&app);
    Ok(saved)
}

#[tauri::command]
pub fn mini_player_command(app: AppHandle, window: tauri::WebviewWindow, command: Value) -> Result<(), String> {
    if !window_is_self(&app, &window) {
        return Err("miniPlayer:command 仅允许迷你播放器窗口调用".to_string());
    }
    if let Some(command) = settings::normalize_mini_player_command(&command) {
        send_mini_player_command_to_main(&app, &command);
    }
    Ok(())
}

#[tauri::command]
pub fn mini_player_publish_state(app: AppHandle, window: tauri::WebviewWindow, state: Value) -> Result<(), String> {
    if window.label() != "main" {
        return Err("miniPlayer:publishState 仅允许主窗口调用".to_string());
    }
    let normalized = settings::normalize_mini_player_state(state);
    let mut stored = crate::settings::load_settings(&app);
    if let Some(object) = stored.as_object_mut() {
        object.insert("miniPlayerState".to_string(), normalized.clone());
    }
    crate::settings::save_settings(&app, &stored)?;
    send_mini_player_state(&app);
    Ok(())
}

#[tauri::command]
pub fn mini_player_minimize(window: tauri::WebviewWindow) -> Result<(), String> {
    window
        .minimize()
        .map_err(|error| format!("最小化迷你播放器窗口失败：{error}"))
}

#[tauri::command]
pub fn mini_player_return_to_main(app: AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    if !window_is_self(&app, &window) {
        return Err("miniPlayer:returnToMain 仅允许迷你播放器窗口调用".to_string());
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    let _ = window.close();
    Ok(())
}

#[tauri::command]
pub fn mini_player_choose_background_image(app: AppHandle, window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    if !window_is_self(&app, &window) {
        return Err("miniPlayer:chooseBackgroundImage 仅允许迷你播放器窗口调用".to_string());
    }
    let selected = app
        .dialog()
        .file()
        .add_filter("背景图片", &["jpg", "jpeg", "png", "webp"])
        .blocking_pick_file();
    let Some(path) = selected.and_then(|file| file.into_path().ok()) else {
        return Ok(None);
    };
    import_background_image(&app, &path).map(Some)
}

pub(crate) fn import_background_image(app: &AppHandle, source: &Path) -> Result<String, String> {
    if !source.is_file()
        || source.metadata().map(|m| m.len()).unwrap_or(0) > MAX_BACKGROUND_IMAGE_BYTES
    {
        return Err("背景图片无效或过大".to_string());
    }
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .filter(|e| matches!(e.as_str(), "jpg" | "jpeg" | "png" | "webp"))
        .map(|e| if e == "jpeg" { e.replace("jpeg", "jpg") } else { e.to_string() })
        .unwrap_or_else(|| "png".to_string());

    let policy = path_policy::get_path_policy(app);
    let cache_root = policy
        .categories
        .get("cache")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            app.path()
                .app_data_dir()
                .map(|d| d.join("cache"))
                .unwrap_or_else(|_| PathBuf::from("cache"))
        });
    fs::create_dir_all(&cache_root).map_err(|error| format!("创建缓存目录失败：{error}"))?;

    // hash 用前 24 hex（与 Electron `sha256(...).slice(0, 24)` 一致）。
    let bytes = fs::read(source).map_err(|e| format!("读取背景图片失败：{e}"))?;
    let hash = crate::plugins_index::sha256_hex(&bytes);
    let hash = hash.chars().take(24).collect::<String>();
    let target = cache_root.join(format!("background-{hash}.{ext}"));
    if !target.is_file() {
        fs::copy(source, &target).map_err(|error| format!("复制背景图片失败：{error}"))?;
    }
    Ok(format!("background://{hash}.{ext}"))
}
