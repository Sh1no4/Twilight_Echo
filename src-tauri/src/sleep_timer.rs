//! `sleepTimer` surface（Stage 7D）。
//!
//! 镜像 Electron `SleepTimerService`（`src/main/sleepTimerCore.ts` + 共享
//! `src/shared/sleepTimer.ts`）：
//! - 主进程持有权威状态；`configure` / `cancel` / `boundary` 更新状态并向渲染层广播
//!   `sleepTimer:status` / `sleepTimer:trigger` 事件；
//! - `minutes` 模式使用后台 tokio 任务在 `endsAt` 到达时触发；`trackEnd` /
//!   `queueEnd` 由播放结束边界经 `sleep_timer_boundary` 上报时判定。
//!
//! 与 Electron 一致：状态是进程内（不落盘），渲染层把活动计时器随播放会话持久化。

use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

/// 与 `SleepTimerState`（`src/shared/sleepTimer.ts`）字段一致。
#[derive(Clone, Debug, PartialEq)]
struct SleepTimerState {
    mode: String,
    /// 毫秒时间戳；非 `minutes` 模式为 `None`。
    ends_at: Option<i64>,
    fade_seconds: i64,
    active: bool,
    triggered: bool,
}

impl SleepTimerState {
    fn as_value(&self) -> Value {
        json!({
            "mode": self.mode,
            "endsAt": self.ends_at,
            "fadeSeconds": self.fade_seconds,
            "active": self.active,
            "triggered": self.triggered
        })
    }
}

#[derive(Default)]
pub struct SleepTimerRuntime {
    state: Option<SleepTimerState>,
}

/// Tauri managed state：权威睡眠定时器状态。
pub struct SleepTimerStateInner(pub Mutex<SleepTimerRuntime>);

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 镜像 `isSleepTimerState`：字段类型 / 取值域 / `active !== triggered` 不变量。
fn parse_state(value: &Value) -> Option<SleepTimerState> {
    let object = value.as_object()?;
    let mode = object.get("mode").and_then(Value::as_str)?.to_string();
    if !matches!(mode.as_str(), "minutes" | "trackEnd" | "queueEnd") {
        return None;
    }
    let active = object.get("active").and_then(Value::as_bool)?;
    let triggered = object.get("triggered").and_then(Value::as_bool)?;
    let fade_seconds = object.get("fadeSeconds").and_then(Value::as_i64)?;
    if fade_seconds < 0 || fade_seconds > 120 {
        return None;
    }
    let ends_at = if mode == "minutes" {
        let ends = object.get("endsAt").and_then(Value::as_i64)?;
        if ends <= 0 {
            return None;
        }
        Some(ends)
    } else {
        // 非 minutes 模式必须显式为 null（镜像 `state.endsAt !== null`）。
        match object.get("endsAt") {
            Some(Value::Null) => None,
            _ => return None,
        }
    };
    if active == triggered {
        return None;
    }
    Some(SleepTimerState {
        mode,
        ends_at,
        fade_seconds,
        active,
        triggered,
    })
}

/// 镜像 `isActiveSleepTimerState`：已武装（active 且未触发，minutes 未过期）。
fn is_active_state(state: &SleepTimerState, now: i64) -> bool {
    if !state.active || state.triggered {
        return false;
    }
    if state.mode == "minutes" {
        return state.ends_at.is_some_and(|ends| ends > now);
    }
    true
}

/// 镜像 `shouldTriggerSleepTimer`。
fn should_trigger(state: &SleepTimerState, now: i64, event: &str) -> bool {
    if !state.active || state.triggered {
        return false;
    }
    if state.mode == "minutes" {
        return event == "tick" && state.ends_at.is_some_and(|ends| ends <= now);
    }
    if state.mode == "trackEnd" {
        return event == "trackEnd";
    }
    if state.mode == "queueEnd" {
        return event == "queueEnd";
    }
    false
}

fn state_or_null(runtime: &SleepTimerRuntime) -> Value {
    runtime.state.as_ref().map(SleepTimerState::as_value).unwrap_or(Value::Null)
}

fn emit_status(app: &AppHandle) {
    let runtime = app.state::<SleepTimerStateInner>();
    let guard = runtime
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _ = app.emit("sleepTimer:status", state_or_null(&guard));
}

/// 触发判定：仅当当前状态仍对应当前事件时置为已触发并广播。
fn trigger_if_due(app: &AppHandle, event: &str) {
    let runtime = app.state::<SleepTimerStateInner>();
    let mut guard = runtime.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(state) = guard.state.as_ref() else {
        return;
    };
    if !should_trigger(state, now_ms(), event) {
        return;
    }
    let triggered = SleepTimerState {
        active: false,
        triggered: true,
        ..state.clone()
    };
    guard.state = Some(triggered.clone());
    drop(guard);
    let _ = app.emit("sleepTimer:trigger", triggered.as_value());
    emit_status(app);
}

/// minutes 模式后台任务：等 `ends_at` 到达后触发。
fn spawn_minutes_tick(app: AppHandle, ends_at: i64, _fade_seconds: i64) {
    tokio::spawn(async move {
        let now = now_ms();
        let wait = (ends_at - now).max(0) as u64;
        if wait > 0 {
            tokio::time::sleep(Duration::from_millis(wait)).await;
        }
        trigger_if_due(&app, "tick");
    });
}

/// `sleepTimer.configure`。
#[tauri::command]
pub fn sleep_timer_configure(app: AppHandle, state: Value) -> Result<Value, String> {
    let parsed = parse_state(&state).ok_or_else(|| "Invalid sleep timer state".to_string())?;
    if !is_active_state(&parsed, now_ms()) {
        return Err("Invalid sleep timer state".to_string());
    }
    let runtime = app.state::<SleepTimerStateInner>();
    let mut guard = runtime
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    guard.state = Some(parsed.clone());
    drop(guard);
    if parsed.mode == "minutes" {
        if let Some(ends_at) = parsed.ends_at {
            spawn_minutes_tick(app.clone(), ends_at, parsed.fade_seconds);
        }
    }
    emit_status(&app);
    Ok(parsed.as_value())
}

/// `sleepTimer.cancel`。
#[tauri::command]
pub fn sleep_timer_cancel(app: AppHandle) -> Value {
    let runtime = app.state::<SleepTimerStateInner>();
    let mut guard = runtime
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    guard.state = None;
    drop(guard);
    emit_status(&app);
    Value::Null
}

/// `sleepTimer.getState`。
#[tauri::command]
pub fn sleep_timer_get_state(app: AppHandle) -> Value {
    let runtime = app.state::<SleepTimerStateInner>();
    let guard = runtime
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    state_or_null(&guard)
}

/// `sleepTimer.boundary`（trackEnd / queueEnd）。
#[tauri::command]
pub fn sleep_timer_boundary(app: AppHandle, boundary: String) -> Result<Value, String> {
    if boundary != "trackEnd" && boundary != "queueEnd" {
        return Err("Invalid sleep timer boundary".to_string());
    }
    trigger_if_due(&app, &boundary);
    let runtime = app.state::<SleepTimerStateInner>();
    let guard = runtime
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Ok(state_or_null(&guard))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn armed_minutes() -> Value {
        json!({
            "mode": "minutes",
            "endsAt": now_ms() + 60_000,
            "fadeSeconds": 10,
            "active": true,
            "triggered": false
        })
    }

    #[test]
    fn parses_valid_armed_minutes_state() {
        let state = parse_state(&armed_minutes()).unwrap();
        assert_eq!(state.mode, "minutes");
        assert!(state.active && !state.triggered);
        assert!(is_active_state(&state, now_ms()));
    }

    #[test]
    fn rejects_inert_or_invalid_states() {
        // active == triggered 不变量被违反。
        let mut inert = armed_minutes();
        inert["triggered"] = json!(true);
        assert!(parse_state(&inert).is_none());
        // 非 minutes 模式要求 endsAt 显式 null。
        let mut track = armed_minutes();
        track["mode"] = json!("trackEnd");
        track["endsAt"] = json!(null);
        let parsed = parse_state(&track).unwrap();
        assert_eq!(parsed.ends_at, None);
        // 已过期 minutes 不可配置。
        let mut expired = armed_minutes();
        expired["endsAt"] = json!(now_ms() - 1_000);
        assert!(parse_state(&expired).is_some());
        assert!(!is_active_state(&parse_state(&expired).unwrap(), now_ms()));
    }

    #[test]
    fn trigger_rules_mirror_shared_semantics() {
        let minutes = parse_state(&armed_minutes()).unwrap();
        let mut track = minutes.clone();
        track.mode = "trackEnd".to_string();
        track.ends_at = None;
        assert!(should_trigger(&track, now_ms(), "trackEnd"));
        assert!(!should_trigger(&track, now_ms(), "queueEnd"));
        let mut queue = track.clone();
        queue.mode = "queueEnd".to_string();
        assert!(should_trigger(&queue, now_ms(), "queueEnd"));
        assert!(!should_trigger(&queue, now_ms(), "trackEnd"));
        // 已触发的状态不再触发。
        let mut fired = track.clone();
        fired.triggered = true;
        assert!(!should_trigger(&fired, now_ms(), "trackEnd"));
    }
}
