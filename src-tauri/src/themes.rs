
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

use crate::path_policy;
use crate::persistence;

const MAX_THEME_LIBRARY_BYTES: u64 = 2 * 1024 * 1024;
const MAX_USER_THEME_PROFILES: usize = 32;
const MAX_THEME_PROFILE_HISTORY_ENTRIES: usize = 8;
const MAX_THEME_PROFILE_HISTORY_BYTES: usize = 256 * 1024;

pub const TWILIGHT_DEFAULT_THEME_ID: &str = "builtin:twilight-echo-default";

fn theme_library_path(app: &AppHandle) -> PathBuf {
    let policy = path_policy::get_path_policy(app);
    path_policy::categorized_data_path(&policy, "database", &["themes.json"])
}

fn default_theme_library() -> Value {
    json!({
        "schemaVersion": 1,
        "activeTheme": { "kind": "builtin", "id": TWILIGHT_DEFAULT_THEME_ID },
        "profiles": [],
        "windowInheritance": { "miniPlayer": true, "desktopLyrics": true },
        "profileHistory": {}
    })
}

fn is_theme_library_data(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.get("schemaVersion").and_then(Value::as_u64) == Some(1)
        && object.get("profiles").is_some_and(Value::is_array)
        && object
            .get("windowInheritance")
            .is_some_and(Value::is_object)
        && object.get("activeTheme").is_some()
}

pub(crate) fn is_theme_library_document(value: &Value) -> bool {
    is_theme_library_data(value)
}

pub(crate) fn replace_theme_library(
    app: &AppHandle,
    document: Value,
    expected_revision: u64,
) -> Result<Value, String> {
    if !is_theme_library_data(&document) {
        return Err("主题库文档无效".to_string());
    }
    write_library(app, load_library(app), document, expected_revision)
}

fn is_theme_selection(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    match object.get("kind").and_then(Value::as_str) {
        Some("builtin") => object
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| !id.trim().is_empty()),
        Some("user") => object
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| !id.trim().is_empty()),
        Some("plugin") => {
            object
                .get("pluginId")
                .and_then(Value::as_str)
                .is_some_and(|id| !id.trim().is_empty())
                && object
                    .get("themeId")
                    .and_then(Value::as_str)
                    .is_some_and(|id| !id.trim().is_empty())
        }
        _ => false,
    }
}

fn normalize_theme_profile(value: &Value) -> Option<Value> {
    let object = value.as_object()?;
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let name = object
        .get("name")
        .and_then(Value::as_str)
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    if id.is_empty()
        || name.is_empty()
        || id.len() > 160
        || name.len() > 80
        || id.starts_with("builtin:")
    {
        return None;
    }
    let mut out = serde_json::Map::new();
    for (key, value) in object {
        out.insert(key.clone(), value.clone());
    }
    out.insert("id".to_string(), json!(id));
    out.insert("name".to_string(), json!(name));
    out.insert("schemaVersion".to_string(), json!(2));
    if out.get("createdAt").and_then(Value::as_str).is_none() {
        out.insert("createdAt".to_string(), json!("1970-01-01T00:00:00.000Z"));
    }
    if out.get("updatedAt").and_then(Value::as_str).is_none() {
        out.insert("updatedAt".to_string(), json!(persistence::now_iso8601()));
    }
    let overrides = out
        .get("overrides")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mut normalized_overrides = serde_json::Map::new();
    normalized_overrides.insert(
        "pureWhite".to_string(),
        overrides
            .get("pureWhite")
            .cloned()
            .unwrap_or_else(|| json!({})),
    );
    normalized_overrides.insert(
        "dark".to_string(),
        overrides.get("dark").cloned().unwrap_or_else(|| json!({})),
    );
    out.insert("overrides".to_string(), Value::Object(normalized_overrides));
    Some(Value::Object(out))
}

fn limit_history(entries: Vec<Value>) -> Vec<Value> {
    let mut result = Vec::new();
    let mut byte_length = 2usize;
    for entry in entries.into_iter().take(MAX_THEME_PROFILE_HISTORY_ENTRIES) {
        let serialized = serde_json::to_string(&entry).unwrap_or_default();
        let entry_bytes = serialized.len() + if result.is_empty() { 0 } else { 1 };
        if byte_length + entry_bytes > MAX_THEME_PROFILE_HISTORY_BYTES {
            break;
        }
        result.push(entry);
        byte_length += entry_bytes;
    }
    result
}

fn profile_editable_state(profile: &Value) -> Value {
    json!({
        "overrides": profile.get("overrides").cloned().unwrap_or(Value::Null),
        "modes": profile.get("modes").cloned().unwrap_or(Value::Null),
        "windowDefaults": profile.get("windowDefaults").cloned().unwrap_or(Value::Null),
        "assets": profile.get("assets").cloned().unwrap_or(Value::Null),
        "assetBindings": profile.get("assetBindings").cloned().unwrap_or(Value::Null)
    })
}

fn same_editable_state(first: &Value, second: &Value) -> bool {
    profile_editable_state(first) == profile_editable_state(second)
}

fn normalize_theme_library(value: &Value) -> Value {
    let mut out = default_theme_library();
    let Some(object) = value.as_object() else {
        return out;
    };
    if let Some(profiles) = object.get("profiles").and_then(Value::as_array) {
        let mut normalized: Vec<Value> = profiles
            .iter()
            .filter_map(normalize_theme_profile)
            .collect();
        normalized.truncate(MAX_USER_THEME_PROFILES);
        out["profiles"] = Value::Array(normalized);
    }
    if let Some(active) = object.get("activeTheme") {
        if is_theme_selection(active) {
            out["activeTheme"] = active.clone();
        }
    }
    if let Some(inheritance) = object.get("windowInheritance").and_then(Value::as_object) {
        out["windowInheritance"]["miniPlayer"] = json!(inheritance
            .get("miniPlayer")
            .and_then(Value::as_bool)
            .unwrap_or(true));
        out["windowInheritance"]["desktopLyrics"] = json!(inheritance
            .get("desktopLyrics")
            .and_then(Value::as_bool)
            .unwrap_or(true));
    }
    let profile_ids: Vec<String> = out["profiles"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|profile| profile.get("id").and_then(Value::as_str).map(String::from))
        .collect();
    if let Some(history) = object.get("profileHistory").and_then(Value::as_object) {
        let mut filtered = serde_json::Map::new();
        for (profile_id, entries) in history {
            if profile_ids.iter().any(|id| id == profile_id) {
                if let Some(array) = entries.as_array() {
                    filtered.insert(
                        profile_id.clone(),
                        Value::Array(limit_history(array.clone())),
                    );
                }
            }
        }
        out["profileHistory"] = Value::Object(filtered);
    }
    if out["activeTheme"].get("kind").and_then(Value::as_str) == Some("user") {
        let active_id = out["activeTheme"]
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("");
        let exists = out["profiles"]
            .as_array()
            .unwrap()
            .iter()
            .any(|profile| profile.get("id").and_then(Value::as_str) == Some(active_id));
        if !exists {
            out["activeTheme"] = json!({ "kind": "builtin", "id": TWILIGHT_DEFAULT_THEME_ID });
        }
    }
    out
}

pub fn load_library(app: &AppHandle) -> Value {
    let path = theme_library_path(app);
    match persistence::load_versioned(&path, MAX_THEME_LIBRARY_BYTES, is_theme_library_data) {
        Ok(Some(envelope)) => {
            let data = normalize_theme_library(envelope.get("data").unwrap_or(&Value::Null));
            json!({
                "version": 2,
                "revision": envelope.get("revision").cloned().unwrap_or(json!(0)),
                "savedAt": envelope.get("savedAt").cloned().unwrap_or_else(|| json!("1970-01-01T00:00:00.000Z")),
                "data": data
            })
        }
        _ => json!({
            "version": 2,
            "revision": 0,
            "savedAt": "1970-01-01T00:00:00.000Z",
            "data": default_theme_library()
        }),
    }
}

fn write_library(
    app: &AppHandle,
    current: Value,
    next_data: Value,
    expected_revision: u64,
) -> Result<Value, String> {
    let path = theme_library_path(app);
    let current_revision = current.get("revision").and_then(Value::as_u64).unwrap_or(0);
    if expected_revision != current_revision {
        return Ok(persistence::conflict_response(
            expected_revision,
            Some(current),
        ));
    }
    let next = json!({
        "version": 2,
        "revision": current_revision + 1,
        "savedAt": persistence::now_iso8601(),
        "data": next_data
    });
    persistence::write_json_atomic(&path, &next, MAX_THEME_LIBRARY_BYTES)?;
    let _ = app.emit("themes:changed", next.clone());
    Ok(next)
}

#[tauri::command]
pub fn themes_get_bootstrap(app: AppHandle) -> Value {
    json!({ "library": load_library(&app), "defaultTheme": Value::Null })
}

#[tauri::command]
pub fn themes_list(app: AppHandle) -> Value {
    load_library(&app)
}

#[tauri::command]
pub fn themes_save(
    app: AppHandle,
    profile: Value,
    expected_revision: u64,
) -> Result<Value, String> {
    let normalized = normalize_theme_profile(&profile).ok_or_else(|| "主题档案无效".to_string())?;
    let current = load_library(&app);
    let mut library = current
        .get("data")
        .cloned()
        .unwrap_or_else(default_theme_library);

    let profiles = library
        .get_mut("profiles")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "主题库结构无效".to_string())?;
    let candidate_id = normalized.get("id").and_then(Value::as_str).unwrap_or("");
    let existing = profiles
        .iter()
        .find(|profile| profile.get("id").and_then(Value::as_str) == Some(candidate_id))
        .cloned();
    if existing.is_none() && profiles.len() >= MAX_USER_THEME_PROFILES {
        return Err(format!("最多只能保存 {MAX_USER_THEME_PROFILES} 个用户主题"));
    }

    let now = persistence::now_iso8601();
    let mut candidate = normalized.clone();
    if let Some(existing_profile) = existing {
        let created_at = existing_profile
            .get("createdAt")
            .and_then(Value::as_str)
            .map(String::from)
            .unwrap_or_else(|| now.clone());
        candidate
            .as_object_mut()
            .unwrap()
            .insert("createdAt".to_string(), json!(created_at));
        if !same_editable_state(&existing_profile, &candidate) {
            let mut entries = library
                .get("profileHistory")
                .and_then(|history| history.get(candidate_id))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            entries.insert(0, json!({ "savedAt": now, "profile": existing_profile }));
            library["profileHistory"][candidate_id] = Value::Array(limit_history(entries));
        }
    } else {
        let created_at = if candidate.get("createdAt").and_then(Value::as_str)
            == Some("1970-01-01T00:00:00.000Z")
        {
            now.clone()
        } else {
            candidate
                .get("createdAt")
                .and_then(Value::as_str)
                .unwrap_or(&now)
                .to_string()
        };
        candidate
            .as_object_mut()
            .unwrap()
            .insert("createdAt".to_string(), json!(created_at));
    }
    candidate
        .as_object_mut()
        .unwrap()
        .insert("updatedAt".to_string(), json!(now));

    let profiles = library
        .get_mut("profiles")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "主题库结构无效".to_string())?;
    if let Some(index) = profiles
        .iter()
        .position(|profile| profile.get("id").and_then(Value::as_str) == Some(candidate_id))
    {
        profiles[index] = candidate;
    } else {
        profiles.push(candidate);
    }

    write_library(&app, current, library, expected_revision)
}

#[tauri::command]
pub fn themes_delete(
    app: AppHandle,
    profile_id: String,
    expected_revision: u64,
) -> Result<Value, String> {
    let profile_id = profile_id.trim().to_string();
    if profile_id == TWILIGHT_DEFAULT_THEME_ID || profile_id.starts_with("builtin:") {
        return Err("内置主题不能删除".to_string());
    }
    let current = load_library(&app);
    let mut library = current
        .get("data")
        .cloned()
        .unwrap_or_else(default_theme_library);

    let profiles = library
        .get_mut("profiles")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "主题库结构无效".to_string())?;
    let before = profiles.len();
    profiles
        .retain(|profile| profile.get("id").and_then(Value::as_str) != Some(profile_id.as_str()));
    if profiles.len() == before {
        return Err("主题档案不存在".to_string());
    }
    if let Some(history) = library
        .get_mut("profileHistory")
        .and_then(Value::as_object_mut)
    {
        history.remove(&profile_id);
    }
    let active_is_deleted = library
        .get("activeTheme")
        .and_then(Value::as_object)
        .and_then(|selection| selection.get("kind").and_then(Value::as_str))
        == Some("user")
        && library
            .get("activeTheme")
            .and_then(|s| s.get("id"))
            .and_then(Value::as_str)
            == Some(profile_id.as_str());
    if active_is_deleted {
        library["activeTheme"] = json!({ "kind": "builtin", "id": TWILIGHT_DEFAULT_THEME_ID });
    }

    write_library(&app, current, library, expected_revision)
}

#[tauri::command]
pub fn themes_set_active(
    app: AppHandle,
    selection: Value,
    expected_revision: u64,
) -> Result<Value, String> {
    if !is_theme_selection(&selection) {
        return Err("主题选择无效".to_string());
    }
    let current = load_library(&app);
    let mut library = current
        .get("data")
        .cloned()
        .unwrap_or_else(default_theme_library);
    if selection.get("kind").and_then(Value::as_str) == Some("user") {
        let profile_id = selection.get("id").and_then(Value::as_str).unwrap_or("");
        let exists = library
            .get("profiles")
            .and_then(Value::as_array)
            .is_some_and(|profiles| {
                profiles
                    .iter()
                    .any(|p| p.get("id").and_then(Value::as_str) == Some(profile_id))
            });
        if !exists {
            return Err("主题档案不存在".to_string());
        }
    }
    library["activeTheme"] = selection;
    write_library(&app, current, library, expected_revision)
}

#[tauri::command]
pub fn themes_set_window_inheritance(
    app: AppHandle,
    inheritance: Value,
    expected_revision: u64,
) -> Result<Value, String> {
    let Some(object) = inheritance.as_object() else {
        return Err("主题窗口继承设置无效".to_string());
    };
    let current = load_library(&app);
    let mut library = current
        .get("data")
        .cloned()
        .unwrap_or_else(default_theme_library);
    library["windowInheritance"]["miniPlayer"] = json!(object
        .get("miniPlayer")
        .and_then(Value::as_bool)
        .unwrap_or(true));
    library["windowInheritance"]["desktopLyrics"] = json!(object
        .get("desktopLyrics")
        .and_then(Value::as_bool)
        .unwrap_or(true));
    write_library(&app, current, library, expected_revision)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(id: &str, name: &str) -> Value {
        json!({
            "schemaVersion": 2,
            "id": id,
            "name": name,
            "description": "",
            "baseThemeId": TWILIGHT_DEFAULT_THEME_ID,
            "createdAt": "2026-08-16T00:00:00.000Z",
            "updatedAt": "2026-08-16T00:00:00.000Z",
            "overrides": { "pureWhite": { "a": "b" }, "dark": {} },
            "modes": {},
            "windowDefaults": {}
        })
    }

    #[test]
    fn normalize_theme_profile_trims_and_rejects_builtin() {
        let valid = normalize_theme_profile(&profile("  user-1 ", " My Theme ")).unwrap();
        assert_eq!(valid.get("id").and_then(Value::as_str), Some("user-1"));
        assert_eq!(valid.get("name").and_then(Value::as_str), Some("My Theme"));
        assert!(normalize_theme_profile(&profile("builtin:twilight-echo-default", "x")).is_none());
        assert!(normalize_theme_profile(&json!({ "id": "", "name": "x" })).is_none());
        assert!(normalize_theme_profile(&json!({ "id": "a", "name": "" })).is_none());
    }

    #[test]
    fn normalize_theme_library_repairs_invalid_documents() {
        let doc = json!({
            "schemaVersion": 1,
            "activeTheme": { "kind": "user", "id": "missing" },
            "profiles": [profile("keep", "K"), json!({ "id": "builtin:x", "name": "N" })],
            "windowInheritance": { "miniPlayer": false },
            "profileHistory": {
                "keep": [json!({ "savedAt": "2026-08-16T00:00:00.000Z", "profile": profile("keep", "K") })],
                "ghost": [json!({})]
            }
        });
        let normalized = normalize_theme_library(&doc);
        assert_eq!(
            normalized
                .pointer("/activeTheme/kind")
                .and_then(Value::as_str),
            Some("builtin")
        );
        assert_eq!(
            normalized
                .pointer("/profiles")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );
        assert_eq!(
            normalized.pointer("/profiles/0/id").and_then(Value::as_str),
            Some("keep")
        );
        assert_eq!(
            normalized
                .pointer("/windowInheritance/desktopLyrics")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert!(normalized.pointer("/profileHistory/keep").is_some());
        assert!(normalized.pointer("/profileHistory/ghost").is_none());
    }

    #[test]
    fn limit_history_caps_entries_and_bytes() {
        let entries: Vec<Value> = (0..10)
            .map(|i| json!({ "savedAt": format!("2026-08-16T00:00:0{i}Z"), "profile": profile(&format!("p{i}"), "P") }))
            .collect();
        let limited = limit_history(entries);
        assert!(limited.len() <= MAX_THEME_PROFILE_HISTORY_ENTRIES);
        assert!(limited.len() >= 1);
    }

    #[test]
    fn same_editable_state_detects_override_change() {
        let a = profile("p", "P");
        let mut b = a.clone();
        b["overrides"]["pureWhite"]["x"] = json!("y");
        assert!(!same_editable_state(&a, &b));
        assert!(same_editable_state(&a, &a));
    }

    #[test]
    fn theme_selection_validator() {
        assert!(is_theme_selection(
            &json!({ "kind": "builtin", "id": "builtin:twilight-echo-default" })
        ));
        assert!(is_theme_selection(&json!({ "kind": "user", "id": "u1" })));
        assert!(is_theme_selection(
            &json!({ "kind": "plugin", "pluginId": "p", "themeId": "t" })
        ));
        assert!(!is_theme_selection(&json!({ "kind": "user", "id": "" })));
        assert!(!is_theme_selection(&json!({ "kind": "builtin", "id": "" })));
    }
}

