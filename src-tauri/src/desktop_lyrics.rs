
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::settings;

const DESKTOP_LYRICS_WINDOW_LABEL: &str = "desktop-lyrics";
const DESKTOP_LYRICS_DOCUMENT: &str = "desktop-lyrics.html";
const DEFAULT_WIDTH: f64 = 900.0;
const DEFAULT_HEIGHT: f64 = 160.0;
const MAX_TRACK_PAYLOAD_BYTES: usize = 1 * 1024 * 1024;

pub struct DesktopLyricsState;

fn desktop_lyrics_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(DESKTOP_LYRICS_WINDOW_LABEL)
}

fn is_self(window: &tauri::WebviewWindow) -> bool {
    window.label() == DESKTOP_LYRICS_WINDOW_LABEL
}

fn current_settings(app: &AppHandle) -> Value {
    let stored = settings::load_settings(app);
    stored
        .get("desktopLyrics")
        .cloned()
        .unwrap_or_else(default_desktop_lyrics_settings)
}

fn default_desktop_lyrics_settings() -> Value {
    json!({
        "enabled": false,
        "fontSize": 32,
        "fontFamily": "system",
        "fontWeight": 700,
        "color": "#ffffff",
        "highlightColor": "#3b82f6",
        "bgColor": "#000000",
        "bgOpacity": 30,
        "align": "center",
        "showTranslation": true,
        "layout": "bilingual",
        "lineSpacing": 1.6,
        "shadow": true,
        "shadowBlur": 8,
        "shadowColor": "#000000",
        "windowWidth": 900,
        "windowHeight": 160,
        "windowX": -1,
        "windowY": -1,
        "alwaysOnTop": true,
        "clickThrough": false,
        "maxLines": 2,
        "lineOffset": 0
    })
}

fn number_or(value: Option<&Value>, fallback: f64) -> f64 {
    value
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite())
        .unwrap_or(fallback)
}

fn clamp_number(value: Option<&Value>, min: f64, max: f64, fallback: f64) -> f64 {
    number_or(value, fallback).clamp(min, max)
}

fn integer_or(value: Option<&Value>, fallback: i64) -> i64 {
    value.and_then(Value::as_i64).unwrap_or(fallback)
}

fn bool_or(value: Option<&Value>, fallback: bool) -> bool {
    value.and_then(Value::as_bool).unwrap_or(fallback)
}

pub(crate) fn normalize_desktop_lyrics_settings(value: Value) -> Value {
    let object = value.as_object().cloned().unwrap_or_default();
    let color_or = |key: &str, fallback: &str| -> String {
        object
            .get(key)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or(fallback)
            .to_string()
    };
    let align = match object.get("align").and_then(Value::as_str) {
        Some("left") => "left",
        _ => "center",
    };
    let layout = match object.get("layout").and_then(Value::as_str) {
        Some("multi") => "multi",
        Some("bilingual") => "bilingual",
        _ => "bilingual",
    };
    let font_family = object
        .get("fontFamily")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("system")
        .to_string();
    json!({
        "enabled": bool_or(object.get("enabled"), false),
        "fontSize": clamp_number(object.get("fontSize"), 12.0, 80.0, 32.0),
        "fontFamily": font_family,
        "fontWeight": clamp_number(object.get("fontWeight"), 100.0, 900.0, 700.0),
        "color": color_or("color", "#ffffff"),
        "highlightColor": color_or("highlightColor", "#3b82f6"),
        "bgColor": color_or("bgColor", "#000000"),
        "bgOpacity": clamp_number(object.get("bgOpacity"), 0.0, 100.0, 30.0),
        "align": align,
        "showTranslation": bool_or(object.get("showTranslation"), true),
        "layout": layout,
        "lineSpacing": clamp_number(object.get("lineSpacing"), 1.0, 3.0, 1.6),
        "shadow": bool_or(object.get("shadow"), true),
        "shadowBlur": clamp_number(object.get("shadowBlur"), 0.0, 30.0, 8.0),
        "shadowColor": color_or("shadowColor", "#000000"),
        "windowWidth": clamp_number(object.get("windowWidth"), 200.0, 3000.0, 900.0),
        "windowHeight": clamp_number(object.get("windowHeight"), 60.0, 800.0, 160.0),
        "windowX": integer_or(object.get("windowX"), -1),
        "windowY": integer_or(object.get("windowY"), -1),
        "alwaysOnTop": bool_or(object.get("alwaysOnTop"), true),
        "clickThrough": bool_or(object.get("clickThrough"), false),
        "maxLines": clamp_number(object.get("maxLines"), 1.0, 5.0, 2.0),
        "lineOffset": clamp_number(object.get("lineOffset"), -200.0, 200.0, 0.0)
    })
}

fn normalize_track_payload(value: Value) -> Option<Value> {
    let object = value.as_object()?;
    let serialized = serde_json::to_vec(&value).unwrap_or_default();
    if serialized.len() > MAX_TRACK_PAYLOAD_BYTES {
        return None;
    }
    let str_field = |key: &str, fallback: &str| -> String {
        object
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or(fallback)
            .chars()
            .take(8192)
            .collect()
    };
    let opt_str_field = |key: &str| -> Option<String> {
        object
            .get(key)
            .and_then(Value::as_str)
            .map(|s| s.chars().take(8192).collect())
    };
    Some(json!({
        "lyrics": opt_str_field("lyrics"),
        "translatedLyrics": opt_str_field("translatedLyrics"),
        "lyricsSource": opt_str_field("lyricsSource"),
        "translatedLyricsSource": opt_str_field("translatedLyricsSource"),
        "title": str_field("title", ""),
        "artist": str_field("artist", "")
    }))
}

fn focused_or_primary_work_area(app: &AppHandle) -> Option<(f64, f64, f64, f64)> {
    let main = app.get_webview_window("main")?;
    let monitor = main.current_monitor().ok()??;
    let work = monitor.work_area();
    Some((
        work.position.x as f64,
        work.position.y as f64,
        work.size.width as f64,
        work.size.height as f64,
    ))
}

fn persist_position(app: &AppHandle, x: f64, y: f64) {
    let mut stored = settings::load_settings(app);
    if let Some(object) = stored.as_object_mut() {
        let current = object
            .get("desktopLyrics")
            .cloned()
            .unwrap_or_else(default_desktop_lyrics_settings);
        if let Some(segment) = current.as_object() {
            let mut merged = segment.clone();
            merged.insert("windowX".to_string(), json!(x as i64));
            merged.insert("windowY".to_string(), json!(y as i64));
            object.insert("desktopLyrics".to_string(), Value::Object(merged));
        }
    }
    let _ = settings::save_settings(app, &stored);
}

fn broadcast_settings(app: &AppHandle) {
    let snapshot = settings::settings_snapshot(app);
    let _ = app.emit("settings:changed", snapshot);
}

fn apply_window_style(app: &AppHandle, normalized: &Value) {
    if let Some(win) = desktop_lyrics_window(app) {
        let width = normalized.get("windowWidth").and_then(Value::as_f64);
        let height = normalized.get("windowHeight").and_then(Value::as_f64);
        if let (Some(width), Some(height)) = (width, height) {
            let _ = win.set_size(tauri::LogicalSize::new(width, height));
        }
        let _ = win.set_always_on_top(bool_or(normalized.get("alwaysOnTop"), true));
        let _ = win.set_ignore_cursor_events(bool_or(normalized.get("clickThrough"), false));
    }
}

fn send_snapshot(app: &AppHandle) {
    if let Some(win) = desktop_lyrics_window(app) {
        let _ = win.emit("desktopLyrics:initSettings", current_settings(app));
        let latest_track = crate::load_json_file(app, "lyrics_track.json", Value::Null);
        if !latest_track.is_null() {
            let _ = win.emit("desktopLyrics:updateTrack", latest_track);
        }
        let latest_time = crate::load_json_file(app, "lyrics_time.json", json!(0));
        let time = number_or(Some(&latest_time), 0.0).max(0.0);
        let _ = win.emit("desktopLyrics:updateTime", time);
    }
}

fn desktop_lyrics_url(app: &AppHandle, document: &str) -> WebviewUrl {
    if let Some(dev_url) = app.config().build.dev_url.clone() {
        if let Ok(joined) = dev_url.join(document) {
            return WebviewUrl::External(joined);
        }
    }
    WebviewUrl::App(document.into())
}

fn open_desktop_lyrics(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = desktop_lyrics_window(app) {
        let _ = win.show();
        send_snapshot(app);
        return Ok(());
    }

    let normalized = normalize_desktop_lyrics_settings(current_settings(app));
    let width = normalized
        .get("windowWidth")
        .and_then(Value::as_f64)
        .unwrap_or(DEFAULT_WIDTH);
    let height = normalized
        .get("windowHeight")
        .and_then(Value::as_f64)
        .unwrap_or(DEFAULT_HEIGHT);
    let always_on_top = bool_or(normalized.get("alwaysOnTop"), true);
    let click_through = bool_or(normalized.get("clickThrough"), false);

    let settings_x = normalized.get("windowX").and_then(Value::as_f64).unwrap_or(-1.0);
    let settings_y = normalized.get("windowY").and_then(Value::as_f64).unwrap_or(-1.0);
    let (x, y) = if settings_x >= 0.0 && settings_y >= 0.0 {
        (settings_x, settings_y)
    } else {
        let (wx, wy, ww, wh) =
            focused_or_primary_work_area(app).unwrap_or((0.0, 0.0, 1920.0, 1040.0));
        let cx = wx + (ww - width) / 2.0;
        let cy = wy + wh - height - 60.0;
        (cx, cy)
    };

    let window = WebviewWindowBuilder::new(
        app,
        DESKTOP_LYRICS_WINDOW_LABEL,
        desktop_lyrics_url(app, DESKTOP_LYRICS_DOCUMENT),
    )
    .title("Twilight Echo 桌面歌词")
    .inner_size(width, height)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(always_on_top)
    .skip_taskbar(true)
    .visible(false)
    .position(x, y)
    .build()
    .map_err(|error| format!("创建桌面歌词窗口失败：{error}"))?;

    let _ = window.set_ignore_cursor_events(click_through);
    let _ = window.show();

    send_snapshot(app);
    Ok(())
}

fn destroy_desktop_lyrics(app: &AppHandle) {
    if let Some(win) = desktop_lyrics_window(app) {
        if let Ok(position) = win.outer_position() {
            persist_position(app, position.x as f64, position.y as f64);
        }
        let _ = win.close();
    }
}

#[tauri::command]
pub fn desktop_lyrics_toggle(app: AppHandle, window: tauri::WebviewWindow) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("desktopLyrics:toggle 仅允许主窗口调用".to_string());
    }
    let current = current_settings(&app);
    let next_enabled = !bool_or(current.get("enabled"), false);
    let mut settings = settings::load_settings(&app);
    if let Some(object) = settings.as_object_mut() {
        let mut merged = current.as_object().cloned().unwrap_or_default();
        merged.insert("enabled".to_string(), json!(next_enabled));
        object.insert("desktopLyrics".to_string(), Value::Object(merged));
    }
    settings::save_settings(&app, &settings)?;
    broadcast_settings(&app);

    if next_enabled {
        open_desktop_lyrics(&app)?;
    } else {
        destroy_desktop_lyrics(&app);
    }
    let _ = app.emit("desktopLyrics:toggleChanged", next_enabled);
    Ok(next_enabled)
}

#[tauri::command]
pub fn desktop_lyrics_show(app: AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("desktopLyrics:show 仅允许主窗口调用".to_string());
    }
    if desktop_lyrics_window(&app).is_none() {
        open_desktop_lyrics(&app)?;
    } else if let Some(win) = desktop_lyrics_window(&app) {
        let _ = win.show();
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_lyrics_hide(app: AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("desktopLyrics:hide 仅允许主窗口调用".to_string());
    }
    destroy_desktop_lyrics(&app);
    Ok(())
}

#[tauri::command]
pub fn desktop_lyrics_publish_track(
    app: AppHandle,
    window: tauri::WebviewWindow,
    data: Value,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("desktopLyrics:updateTrack 仅允许主窗口调用".to_string());
    }
    let normalized = normalize_track_payload(data)
        .ok_or_else(|| "desktopLyrics:updateTrack 载荷无效".to_string())?;
    crate::save_json_file(&app, "lyrics_track.json", &normalized)?;
    if let Some(win) = desktop_lyrics_window(&app) {
        let _ = win.emit("desktopLyrics:updateTrack", normalized);
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_lyrics_publish_time(
    app: AppHandle,
    window: tauri::WebviewWindow,
    time: f64,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("desktopLyrics:updateTime 仅允许主窗口调用".to_string());
    }
    if !time.is_finite() {
        return Err("desktopLyrics:updateTime 时间参数无效".to_string());
    }
    let time = time.max(0.0);
    crate::save_json_file(&app, "lyrics_time.json", &json!(time))?;
    if let Some(win) = desktop_lyrics_window(&app) {
        let _ = win.emit("desktopLyrics:updateTime", time);
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_lyrics_update_settings(
    app: AppHandle,
    window: tauri::WebviewWindow,
    settings_input: Value,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("desktopLyrics:updateSettings 仅允许主窗口调用".to_string());
    }
    let normalized = normalize_desktop_lyrics_settings(settings_input);
    let mut stored = settings::load_settings(&app);
    if let Some(object) = stored.as_object_mut() {
        object.insert("desktopLyrics".to_string(), normalized.clone());
    }
    settings::save_settings(&app, &stored)?;
    apply_window_style(&app, &normalized);
    if let Some(win) = desktop_lyrics_window(&app) {
        let _ = win.emit("desktopLyrics:updateSettings", normalized);
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_lyrics_get_position(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    if !is_self(&window) {
        return Err("desktopLyrics:getPosition 仅允许桌面歌词窗口调用".to_string());
    }
    if let Some(win) = desktop_lyrics_window(&app) {
        if let Ok(position) = win.outer_position() {
            let _ = window.emit("desktopLyrics:position", json!({ "x": position.x, "y": position.y }));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_lyrics_move(
    app: AppHandle,
    window: tauri::WebviewWindow,
    data: Value,
) -> Result<(), String> {
    if !is_self(&window) {
        return Err("desktopLyrics:move 仅允许桌面歌词窗口调用".to_string());
    }
    let x = data.get("x").and_then(Value::as_f64);
    let y = data.get("y").and_then(Value::as_f64);
    let Some((x, y)) = x.zip(y) else {
        return Err("desktopLyrics:move 坐标无效".to_string());
    };
    if !x.is_finite() || !y.is_finite() {
        return Err("desktopLyrics:move 坐标无效".to_string());
    }
    if let Some(win) = desktop_lyrics_window(&app) {
        let (width, height) = win
            .inner_size()
            .map(|size| (size.width as f64, size.height as f64))
            .unwrap_or((DEFAULT_WIDTH, DEFAULT_HEIGHT));
        let (wx, wy, ww, wh) =
            focused_or_primary_work_area(&app).unwrap_or((0.0, 0.0, 1920.0, 1040.0));
        let max_x = wx + ww - width;
        let max_y = wy + wh - height;
        let clamped_x = x.round().clamp(wx, max_x.max(wx));
        let clamped_y = y.round().clamp(wy, max_y.max(wy));
        let _ = win.set_position(tauri::PhysicalPosition::new(clamped_x as i32, clamped_y as i32));
        persist_position(&app, clamped_x, clamped_y);
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_lyrics_request_close(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    if !is_self(&window) {
        return Err("desktopLyrics:requestClose 仅允许桌面歌词窗口调用".to_string());
    }
    let mut stored = settings::load_settings(&app);
    if let Some(object) = stored.as_object_mut() {
        let current = object
            .get("desktopLyrics")
            .cloned()
            .unwrap_or_else(default_desktop_lyrics_settings);
        let mut merged = current.as_object().cloned().unwrap_or_default();
        merged.insert("enabled".to_string(), json!(false));
        object.insert("desktopLyrics".to_string(), Value::Object(merged));
    }
    let _ = settings::save_settings(&app, &stored);
    broadcast_settings(&app);
    destroy_desktop_lyrics(&app);
    let _ = app.emit("desktopLyrics:toggleChanged", false);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::normalize_desktop_lyrics_settings;
    use serde_json::json;

    #[test]
    fn desktop_lyrics_normalization_clamps_ranges_and_converges_fields() {
        let normalized = normalize_desktop_lyrics_settings(json!({
            "fontSize": 200,
            "fontWeight": 50,
            "bgOpacity": 150,
            "lineSpacing": 9,
            "shadowBlur": 99,
            "windowWidth": 100,
            "windowHeight": 20,
            "maxLines": 99,
            "lineOffset": 9999,
            "align": "right",
            "layout": "single",
            "enabled": true,
        }));
        assert_eq!(normalized["fontSize"], 80.0);
        assert_eq!(normalized["fontWeight"], 100.0);
        assert_eq!(normalized["bgOpacity"], 100.0);
        assert_eq!(normalized["lineSpacing"], 3.0);
        assert_eq!(normalized["shadowBlur"], 30.0);
        assert_eq!(normalized["windowWidth"], 200.0);
        assert_eq!(normalized["windowHeight"], 60.0);
        assert_eq!(normalized["maxLines"], 5.0);
        assert_eq!(normalized["lineOffset"], 200.0);
        assert_eq!(normalized["align"], "center");
        assert_eq!(normalized["layout"], "bilingual");
        assert_eq!(normalized["enabled"], true);
    }

    #[test]
    fn desktop_lyrics_normalization_fills_defaults_when_missing() {
        let normalized = normalize_desktop_lyrics_settings(json!({}));
        assert_eq!(normalized["enabled"], false);
        assert_eq!(normalized["fontSize"], 32.0);
        assert_eq!(normalized["color"], "#ffffff");
        assert_eq!(normalized["alwaysOnTop"], true);
        assert_eq!(normalized["showTranslation"], true);
        assert_eq!(normalized["windowX"], -1);
        assert_eq!(normalized["lineOffset"], 0.0);
    }
}
