
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::settings;

const TRAY_PLAYER_WINDOW_LABEL: &str = "tray-player";
const TRAY_PLAYER_VIEW_QUERY: &str = "window=tray-player";
const TRAY_PLAYER_WIDTH: f64 = 360.0;
const TRAY_PLAYER_HEIGHT: f64 = 176.0;

pub struct TrayPlayerState;

fn tray_player_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(TRAY_PLAYER_WINDOW_LABEL)
}

fn window_is_self(_app: &AppHandle, window: &tauri::WebviewWindow) -> bool {
    window.label() == TRAY_PLAYER_WINDOW_LABEL
}

fn latest_mini_player_state(app: &AppHandle) -> Value {
    let stored = settings::load_settings(app);
    stored
        .get("miniPlayerState")
        .cloned()
        .unwrap_or_else(|| settings::empty_mini_player_state())
}

fn load_tray_position(app: &AppHandle) -> Option<(f64, f64)> {
    let stored = settings::load_settings(app);
    let segment = stored.get("trayPlayerPosition")?;
    let x = segment.get("windowX").and_then(Value::as_f64)?;
    let y = segment.get("windowY").and_then(Value::as_f64)?;
    Some((x, y))
}

fn send_tray_player_state(app: &AppHandle) {
    if let Some(window) = tray_player_window(app) {
        let _ = window.emit("trayPlayer:state", latest_mini_player_state(app));
    }
}

fn send_player_command_to_main(app: &AppHandle, command: &Value) {
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.emit("miniPlayer:command", command);
    }
}

fn send_navigation_to_main(app: &AppHandle, target: &Value) {
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.emit("app:navigate", target);
    }
}

fn toggle_tray_player(app: &AppHandle) -> Result<bool, String> {
    if let Some(existing) = tray_player_window(app) {
        let visible = existing.is_visible().unwrap_or(false);
        if visible {
            let _ = existing.hide();
            return Ok(false);
        }
        // 复用已存在窗口（tauri.conf 声明）：恢复保存的位置后再显示。
        if let Some((x, y)) = load_tray_position(app) {
            let _ = existing.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
        }
        let _ = existing.show();
        let _ = existing.set_focus();
        send_tray_player_state(app);
        return Ok(true);
    }

    let url = app
        .config()
        .build
        .dev_url
        .clone()
        .and_then(|dev_url| {
            let trailing = if dev_url.query().is_some() { "&" } else { "?" };
            dev_url
                .join(&format!("{trailing}{TRAY_PLAYER_VIEW_QUERY}"))
                .ok()
                .map(WebviewUrl::External)
        })
        .unwrap_or_else(|| {
            WebviewUrl::App(format!("index.html?{TRAY_PLAYER_VIEW_QUERY}").into())
        });

    // 默认贴到主显示器工作区右下角（Tauri 无全局托盘锚点，退化为屏边角）。
    let (default_x, default_y) = default_tray_position();
    let (saved_x, saved_y) = load_tray_position(app).unwrap_or((default_x, default_y));

    let window = WebviewWindowBuilder::new(app, TRAY_PLAYER_WINDOW_LABEL, url)
        .title("Twilight Echo Tray Player")
        .inner_size(TRAY_PLAYER_WIDTH, TRAY_PLAYER_HEIGHT)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .position(saved_x, saved_y)
        .build()
        .map_err(|error| format!("创建托盘播放器窗口失败：{error}"))?;

    let _ = window.show();
    let _ = window.set_focus();
    send_tray_player_state(app);
    Ok(true)
}

fn default_tray_position() -> (f64, f64) {
    (0.0, 0.0)
}

#[tauri::command]
pub fn tray_player_toggle(app: AppHandle, window: tauri::WebviewWindow) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("trayPlayer:toggle 仅允许主窗口调用".to_string());
    }
    toggle_tray_player(&app)
}

#[tauri::command]
pub fn tray_player_is_visible(app: AppHandle, window: tauri::WebviewWindow) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("trayPlayer:isVisible 仅允许主窗口调用".to_string());
    }
    Ok(tray_player_window(&app)
        .map(|existing| existing.is_visible().unwrap_or(false))
        .unwrap_or(false))
}

#[tauri::command]
pub fn tray_player_hide(app: AppHandle) -> Result<(), String> {
    if let Some(window) = tray_player_window(&app) {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
pub fn tray_player_get_bootstrap(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    if !window_is_self(&app, &window) {
        return Err("trayPlayer:getBootstrap 仅允许托盘播放器窗口调用".to_string());
    }
    Ok(json!({ "state": latest_mini_player_state(&app) }))
}

#[tauri::command]
pub fn tray_player_command(
    app: AppHandle,
    window: tauri::WebviewWindow,
    command: Value,
) -> Result<(), String> {
    if !window_is_self(&app, &window) {
        return Err("trayPlayer:command 仅允许托盘播放器窗口调用".to_string());
    }
    if let Some(command) = settings::normalize_mini_player_command(&command) {
        send_player_command_to_main(&app, &command);
    }
    Ok(())
}

#[tauri::command]
pub fn tray_player_navigate(
    app: AppHandle,
    window: tauri::WebviewWindow,
    target: Value,
) -> Result<(), String> {
    if !window_is_self(&app, &window) {
        return Err("trayPlayer:navigate 仅允许托盘播放器窗口调用".to_string());
    }
    if let Some(target) = normalize_tray_navigation_target(&target) {
        // 持久化为 pending 导航，主窗口启动时可经 `consumePendingNavigation` 消费；
        // 运行期直接广播 `app:navigate`（主渲染器已挂 onNavigate 后立即消费）。
        let mut stored = crate::settings::load_settings(&app);
        if let Some(object) = stored.as_object_mut() {
            object.insert("pendingTrayNavigation".to_string(), target.clone());
        }
        let _ = crate::settings::save_settings(&app, &stored);
        send_navigation_to_main(&app, &target);
    }
    Ok(())
}

fn normalize_tray_navigation_target(value: &Value) -> Option<Value> {
    let target = value.as_str()?;
    match target {
        "local" | "streaming" | "settings" => Some(json!(target)),
        _ => None,
    }
}

#[tauri::command]
pub fn tray_player_consume_pending_navigation(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("trayPlayer:consumePendingNavigation 仅允许主窗口调用".to_string());
    }
    let mut stored = crate::settings::load_settings(&app);
    let pending = stored
        .get("pendingTrayNavigation")
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(object) = stored.as_object_mut() {
        object.remove("pendingTrayNavigation");
    }
    let _ = crate::settings::save_settings(&app, &stored);
    Ok(pending)
}

#[allow(dead_code)]
pub fn record_tray_position(app: &AppHandle, window: &tauri::WebviewWindow) {
    if !window_is_self(app, window) {
        return;
    }
    if let Ok(position) = window.outer_position() {
        let mut stored = crate::settings::load_settings(app);
        if let Some(object) = stored.as_object_mut() {
            object.insert(
                "trayPlayerPosition".to_string(),
                json!({ "windowX": position.x, "windowY": position.y }),
            );
        }
        let _ = crate::settings::save_settings(app, &stored);
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_tray_navigation_target;
    use serde_json::json;

    #[test]
    fn tray_navigation_accepts_only_builtin_targets() {
        for target in ["local", "streaming", "settings"] {
            assert_eq!(
                normalize_tray_navigation_target(&json!(target)),
                Some(json!(target))
            );
        }
        assert_eq!(normalize_tray_navigation_target(&json!("plugins")), None);
        assert_eq!(normalize_tray_navigation_target(&json!({"a": 1})), None);
    }
}
