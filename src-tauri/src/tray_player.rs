//! `trayPlayer` surface（Stage 7B）——Tauri 独立托盘播放器窗口。
//!
//! 迁移 Electron `src/main/integrations/trayPlayer.ts` 到 Tauri 独立窗口：
//! - `tray_player_toggle`（主窗口→显示/隐藏 `tray-player` 窗口，存在时隐藏）；
//! - `tray_player_hide`（托盘窗口→隐藏自身）；`tray_player_is_visible`（主→查询）；
//! - `tray_player_get_bootstrap`（托盘窗口→返回 `{ state }`）；
//! - `tray_player_command`（托盘窗口→转发播放命令到主窗口 `miniPlayer:command`）；
//! - `tray_player_navigate`（托盘窗口→登记导航目标并转发 `app:navigate` 到主窗口，
//!   主渲染器在启动时经 `consumePendingNavigation` 消费）。
//!
//! 事件（渲染端经 `@tauri-apps/api/event` 订阅）：
//! `trayPlayer:state`（主→托盘）；`miniPlayer:command` 与 `app:navigate`（托盘→主）。
//!
//! 边界：命令按发起窗口 label 校验；输入经 shared 归一化
//! （`normalize_mini_player_command` / `normalize_tray_navigation_target`）。
//! 播放快照复用 settings.json 的 `miniPlayerState` 段（与 miniPlayer 共享同一
//! 播放状态源，等价 Electron `runtime.latestMiniPlayerState`）。窗口位置存
//! `trayPlayerPosition` 段（`windowX`/`windowY`），默认贴工作区右下角。

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::settings;

const TRAY_PLAYER_WINDOW_LABEL: &str = "tray-player";
const TRAY_PLAYER_VIEW_QUERY: &str = "window=tray-player";
const TRAY_PLAYER_WIDTH: f64 = 360.0;
const TRAY_PLAYER_HEIGHT: f64 = 176.0;

/// 运行时 trayPlayer 标记（state/managed 占位，逻辑状态持久化在 settings.json）。
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

/// 主窗口显示/隐藏托盘播放器。返回当前可见状态（与 Electron `toggleTrayPlayerWindow` 对齐）。
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

/// 工作区右下角默认定位（无托盘 anchor 时的退化位置）。
fn default_tray_position() -> (f64, f64) {
    (0.0, 0.0)
}

/// 主窗口调用：显示/隐藏托盘播放器窗口，返回当前可见状态。
#[tauri::command]
pub fn tray_player_toggle(app: AppHandle, window: tauri::WebviewWindow) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("trayPlayer:toggle 仅允许主窗口调用".to_string());
    }
    toggle_tray_player(&app)
}

/// 主窗口调用：查询托盘播放器窗口是否可见。
#[tauri::command]
pub fn tray_player_is_visible(app: AppHandle, window: tauri::WebviewWindow) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("trayPlayer:isVisible 仅允许主窗口调用".to_string());
    }
    Ok(tray_player_window(&app)
        .map(|existing| existing.is_visible().unwrap_or(false))
        .unwrap_or(false))
}

/// 主窗口调用：隐藏托盘播放器窗口。
#[tauri::command]
pub fn tray_player_hide(app: AppHandle) -> Result<(), String> {
    if let Some(window) = tray_player_window(&app) {
        let _ = window.hide();
    }
    Ok(())
}

/// 托盘窗口调用：返回启动快照。
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

/// 托盘窗口调用：把播放命令转发到主窗口。
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

/// 托盘窗口调用：登记导航目标并转发到主窗口。
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

/// 归一化托盘导航目标（镜像 `normalizeTrayNavigationTarget`：仅 local/streaming/settings）。
fn normalize_tray_navigation_target(value: &Value) -> Option<Value> {
    let target = value.as_str()?;
    match target {
        "local" | "streaming" | "settings" => Some(json!(target)),
        _ => None,
    }
}

/// 主窗口调用：消费挂起的托盘导航（`app:consumePendingNavigation`）。
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

/// 保存托盘播放器窗口位置（窗口移动时持久化，重启后恢复）。
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