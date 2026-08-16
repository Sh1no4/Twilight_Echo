//! `data` surface 共享持久化（Stage 3）。
//!
//! 迁移 Electron `data:loadPlaybackSession` / `savePlaybackSession` /
//! `clearPlaybackSession` / `loadPlaylists` / `savePlaylists` /
//! `loadLyricsManagement` / `saveLyricsManagement` /
//! `loadPlaybackBookmarks` / `savePlaybackBookmarks` 到真实 Tauri command，
//! 复用 `persistence` 的 versioned envelope + CAS 语义，与 Electron 的
//! `VersionedDataStore` 行为一致：写冲突返回
//! `{ code: 'ERR_PERSISTENCE_REVISION_CONFLICT', ... }`，读失败返回 `null`。

use serde_json::Value;
use std::path::PathBuf;
use tauri::AppHandle;

use crate::path_policy;
use crate::persistence;

const MAX_PLAYBACK_SESSION_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PLAYLISTS_BYTES: u64 = 20 * 1024 * 1024;
const MAX_LYRICS_MANAGEMENT_BYTES: u64 = 8 * 1024 * 1024;
const MAX_PLAYBACK_BOOKMARKS_BYTES: u64 = 4 * 1024 * 1024;

fn data_file(app: &AppHandle, name: &str) -> PathBuf {
    let policy = path_policy::get_path_policy(app);
    path_policy::categorized_data_path(&policy, "database", &[name])
}

fn is_playback_session(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.get("version").and_then(Value::as_u64) == Some(1)
        && object.get("savedAt").and_then(Value::as_str).is_some()
        && object
            .get("mode")
            .and_then(Value::as_str)
            .is_some_and(|mode| matches!(mode, "off" | "track" | "trackAndPosition"))
        && object
            .get("track")
            .and_then(Value::as_object)
            .is_some_and(|track| track.get("id").and_then(Value::as_str).is_some())
        && object
            .get("position")
            .and_then(Value::as_f64)
            .is_some_and(|position| position >= 0.0)
        && (object.get("queue").is_none() || object.get("queue").is_some_and(Value::is_array))
}

fn is_session_data(value: &Value) -> bool {
    value.is_null() || is_playback_session(value)
}

fn is_playlists_data(value: &Value) -> bool {
    value.is_array()
}

fn is_lyrics_management_data(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.get("schemaVersion").and_then(Value::as_u64) == Some(1)
        && object
            .get("globalOffsetMs")
            .and_then(Value::as_f64)
            .is_some()
        && object
            .get("showOriginal")
            .and_then(Value::as_bool)
            .is_some()
        && object
            .get("showTranslation")
            .and_then(Value::as_bool)
            .is_some()
        && object
            .get("showRomanization")
            .and_then(Value::as_bool)
            .is_some()
        && object.get("tracks").is_some_and(Value::is_object)
}

fn is_playback_bookmarks_data(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.get("schemaVersion").and_then(Value::as_u64) == Some(1)
        && object
            .get("longTrackResumeSeconds")
            .and_then(Value::as_f64)
            .is_some()
        && object.get("bookmarks").is_some_and(Value::is_array)
}

/// 读取版本化信封，缺失 / 损坏时返回 `null`（与 Electron 读失败返回 null 一致）。
fn load_or_null(app: &AppHandle, name: &str, max_bytes: u64, is_data: fn(&Value) -> bool) -> Value {
    persistence::load_versioned(&data_file(app, name), max_bytes, is_data)
        .ok()
        .flatten()
        .unwrap_or(Value::Null)
}

/// `data.loadPlaybackSession`。
#[tauri::command]
pub fn data_load_playback_session(app: AppHandle) -> Value {
    load_or_null(
        &app,
        "playback-session.json",
        MAX_PLAYBACK_SESSION_BYTES,
        is_session_data,
    )
}

/// `data.savePlaybackSession`。
#[tauri::command]
pub fn data_save_playback_session(
    app: AppHandle,
    session: Value,
    expected_revision: u64,
) -> Result<Value, String> {
    persistence::save_versioned(
        &data_file(&app, "playback-session.json"),
        MAX_PLAYBACK_SESSION_BYTES,
        session,
        expected_revision,
        is_session_data,
    )
}

/// `data.clearPlaybackSession`。
#[tauri::command]
pub fn data_clear_playback_session(
    app: AppHandle,
    expected_revision: u64,
) -> Result<Value, String> {
    persistence::save_versioned(
        &data_file(&app, "playback-session.json"),
        MAX_PLAYBACK_SESSION_BYTES,
        Value::Null,
        expected_revision,
        is_session_data,
    )
}

/// `data.loadPlaylists`。
#[tauri::command]
pub fn data_load_playlists(app: AppHandle) -> Value {
    load_or_null(
        &app,
        "playlists.json",
        MAX_PLAYLISTS_BYTES,
        is_playlists_data,
    )
}

/// `data.savePlaylists`。
#[tauri::command]
pub fn data_save_playlists(
    app: AppHandle,
    playlists: Value,
    expected_revision: u64,
) -> Result<Value, String> {
    persistence::save_versioned(
        &data_file(&app, "playlists.json"),
        MAX_PLAYLISTS_BYTES,
        playlists,
        expected_revision,
        is_playlists_data,
    )
}

/// `data.loadLyricsManagement`。
#[tauri::command]
pub fn data_load_lyrics_management(app: AppHandle) -> Value {
    load_or_null(
        &app,
        "lyrics-management.json",
        MAX_LYRICS_MANAGEMENT_BYTES,
        is_lyrics_management_data,
    )
}

/// `data.saveLyricsManagement`。
#[tauri::command]
pub fn data_save_lyrics_management(
    app: AppHandle,
    document: Value,
    expected_revision: u64,
) -> Result<Value, String> {
    persistence::save_versioned(
        &data_file(&app, "lyrics-management.json"),
        MAX_LYRICS_MANAGEMENT_BYTES,
        document,
        expected_revision,
        is_lyrics_management_data,
    )
}

/// `data.loadPlaybackBookmarks`。
#[tauri::command]
pub fn data_load_playback_bookmarks(app: AppHandle) -> Value {
    load_or_null(
        &app,
        "playback-bookmarks.json",
        MAX_PLAYBACK_BOOKMARKS_BYTES,
        is_playback_bookmarks_data,
    )
}

/// `data.savePlaybackBookmarks`。
#[tauri::command]
pub fn data_save_playback_bookmarks(
    app: AppHandle,
    document: Value,
    expected_revision: u64,
) -> Result<Value, String> {
    persistence::save_versioned(
        &data_file(&app, "playback-bookmarks.json"),
        MAX_PLAYBACK_BOOKMARKS_BYTES,
        document,
        expected_revision,
        is_playback_bookmarks_data,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn playback_session_validator_mirrors_preload() {
        let valid = json!({
            "version": 1,
            "savedAt": "2026-08-16T00:00:00Z",
            "mode": "trackAndPosition",
            "track": { "id": "local:abc" },
            "position": 12.5,
            "queue": [{ "id": "local:abc" }]
        });
        assert!(is_playback_session(&valid));
        assert!(is_session_data(&Value::Null));
        assert!(is_session_data(&valid));
        assert!(!is_playback_session(
            &json!({ "version": 1, "mode": "track" })
        ));
        assert!(!is_playback_session(&json!({
            "version": 1, "savedAt": "x", "mode": "bogus", "track": { "id": "a" }, "position": -1
        })));
    }

    #[test]
    fn playlists_validator_accepts_arrays_only() {
        assert!(is_playlists_data(&json!([{ "id": "p1" }])));
        assert!(!is_playlists_data(&json!({ "playlists": [] })));
        assert!(!is_playlists_data(&json!(null)));
    }

    #[test]
    fn lyrics_management_validator_mirrors_shared_schema() {
        let valid = json!({
            "schemaVersion": 1,
            "globalOffsetMs": 0,
            "showOriginal": true,
            "showTranslation": true,
            "showRomanization": false,
            "tracks": {}
        });
        assert!(is_lyrics_management_data(&valid));
        assert!(!is_lyrics_management_data(&json!({ "schemaVersion": 1 })));
    }

    #[test]
    fn playback_bookmarks_validator_mirrors_shared_schema() {
        let valid = json!({
            "schemaVersion": 1,
            "longTrackResumeSeconds": 1200,
            "bookmarks": []
        });
        assert!(is_playback_bookmarks_data(&valid));
        assert!(!is_playback_bookmarks_data(&json!({ "schemaVersion": 1 })));
        assert!(!is_playback_bookmarks_data(&json!({ "bookmarks": [] })));
    }
}
