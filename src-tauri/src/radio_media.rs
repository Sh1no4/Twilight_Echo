
use serde_json::Value;
use std::path::PathBuf;
use tauri::AppHandle;

use crate::path_policy;
use crate::persistence;

const MAX_RADIO_STATIONS_BYTES: u64 = 4 * 1024 * 1024;
const MAX_PODCAST_SUBSCRIPTIONS_BYTES: u64 = 16 * 1024 * 1024;
const MAX_RADIO_STATIONS: usize = 500;
const MAX_PODCAST_SUBSCRIPTIONS: usize = 200;
const MAX_PODCAST_EPISODES_PER_FEED: usize = 200;
const MAX_RADIO_NAME_LENGTH: usize = 120;
const MAX_RADIO_URL_LENGTH: usize = 2048;
const MAX_PODCAST_TITLE_LENGTH: usize = 240;
const MAX_PODCAST_URL_LENGTH: usize = 2048;
const MAX_PODCAST_GUID_LENGTH: usize = 512;

fn data_file(app: &AppHandle, name: &str) -> PathBuf {
    let policy = path_policy::get_path_policy(app);
    path_policy::categorized_data_path(&policy, "database", &[name])
}

fn is_http_or_https_url(value: &Value, max_length: usize) -> bool {
    let Some(raw) = value.as_str() else {
        return false;
    };
    let url = raw.trim();
    if url.is_empty() || url.len() > max_length || url.contains(['\0', '\r', '\n']) {
        return false;
    }
    let Some(rest) = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")) else {
        return false;
    };
    // 拒绝 `http://user:pass@host` 内嵌凭据（镜像 URL.username/password 检查）。
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    !authority.contains('@')
}

fn is_radio_station(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    let id = object.get("id").and_then(Value::as_str);
    if !id.is_some_and(|s| !s.trim().is_empty()) {
        return false;
    }
    let name = object.get("name").and_then(Value::as_str);
    if !name.is_some_and(|s| !s.trim().is_empty() && s.len() <= MAX_RADIO_NAME_LENGTH) {
        return false;
    }
    if !is_http_or_https_url(object.get("streamUrl").unwrap_or(&Value::Null), MAX_RADIO_URL_LENGTH) {
        return false;
    }
    let Some(allow_insecure) = object.get("allowInsecureHttp").and_then(Value::as_bool) else {
        return false;
    };
    let stream_url = object.get("streamUrl").and_then(Value::as_str).unwrap_or("");
    if stream_url.starts_with("http://") && !allow_insecure {
        return false;
    }
    if !object.get("createdAt").and_then(Value::as_str).is_some()
        || !object.get("updatedAt").and_then(Value::as_str).is_some()
    {
        return false;
    }
    for optional in ["homepage", "favicon"] {
        if let Some(value) = object.get(optional) {
            if !value.is_null() && !is_http_or_https_url(value, MAX_RADIO_URL_LENGTH) {
                return false;
            }
        }
    }
    if let Some(tags) = object.get("tags") {
        if !tags.is_null() {
            let Some(tags_array) = tags.as_array() else {
                return false;
            };
            if tags_array.len() > 16 {
                return false;
            }
            for tag in tags_array {
                let Some(text) = tag.as_str() else {
                    return false;
                };
                if text.trim().is_empty() || text.len() > 40 {
                    return false;
                }
            }
        }
    }
    true
}

fn is_radio_stations_document(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if object.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return false;
    }
    let Some(stations) = object.get("stations").and_then(Value::as_array) else {
        return false;
    };
    stations.len() <= MAX_RADIO_STATIONS && stations.iter().all(is_radio_station)
}

fn is_podcast_episode(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    let guid = object.get("guid").and_then(Value::as_str);
    if !guid.is_some_and(|s| !s.trim().is_empty() && s.len() <= MAX_PODCAST_GUID_LENGTH) {
        return false;
    }
    let title = object.get("title").and_then(Value::as_str);
    if !title.is_some_and(|s| !s.trim().is_empty() && s.len() <= MAX_PODCAST_TITLE_LENGTH) {
        return false;
    }
    if !is_http_or_https_url(object.get("mediaUrl").unwrap_or(&Value::Null), MAX_PODCAST_URL_LENGTH) {
        return false;
    }
    let duration = object.get("durationSeconds").and_then(Value::as_f64);
    if !duration.is_some_and(|d| d.is_finite() && d >= 0.0) {
        return false;
    }
    if let Some(description) = object.get("description") {
        if !description.is_null() && !description.as_str().is_some_and(|s| s.len() <= 4_000) {
            return false;
        }
    }
    if let Some(published_at) = object.get("publishedAt") {
        if !published_at.is_null() && !published_at.is_string() {
            return false;
        }
    }
    if let Some(progress) = object.get("progressSeconds") {
        if !progress.is_null() && !progress.as_f64().is_some_and(|v| v.is_finite() && v >= 0.0) {
            return false;
        }
    }
    if let Some(cover) = object.get("coverUrl") {
        if !cover.is_null() && !is_http_or_https_url(cover, MAX_PODCAST_URL_LENGTH) {
            return false;
        }
    }
    true
}

fn is_podcast_subscription(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    let id = object.get("id").and_then(Value::as_str);
    if !id.is_some_and(|s| !s.trim().is_empty()) {
        return false;
    }
    if !is_http_or_https_url(object.get("feedUrl").unwrap_or(&Value::Null), MAX_PODCAST_URL_LENGTH) {
        return false;
    }
    let title = object.get("title").and_then(Value::as_str);
    if !title.is_some_and(|s| !s.trim().is_empty() && s.len() <= MAX_PODCAST_TITLE_LENGTH) {
        return false;
    }
    if !object.get("createdAt").and_then(Value::as_str).is_some()
        || !object.get("updatedAt").and_then(Value::as_str).is_some()
    {
        return false;
    }
    let Some(episodes) = object.get("episodes").and_then(Value::as_array) else {
        return false;
    };
    if episodes.len() > MAX_PODCAST_EPISODES_PER_FEED {
        return false;
    }
    if !episodes.iter().all(is_podcast_episode) {
        return false;
    }
    if let Some(description) = object.get("description") {
        if !description.is_null() && !description.as_str().is_some_and(|s| s.len() <= 4_000) {
            return false;
        }
    }
    for optional in ["author", "lastRefreshedAt", "lastError"] {
        if let Some(value) = object.get(optional) {
            if !value.is_null() && !value.is_string() {
                return false;
            }
        }
    }
    for optional in ["coverUrl", "homepage"] {
        if let Some(value) = object.get(optional) {
            if !value.is_null() && !is_http_or_https_url(value, MAX_PODCAST_URL_LENGTH) {
                return false;
            }
        }
    }
    true
}

fn is_podcast_subscriptions_document(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if object.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return false;
    }
    let Some(subscriptions) = object.get("subscriptions").and_then(Value::as_array) else {
        return false;
    };
    subscriptions.len() <= MAX_PODCAST_SUBSCRIPTIONS && subscriptions.iter().all(is_podcast_subscription)
}

fn load_or_default(app: &AppHandle, name: &str, max_bytes: u64, is_data: fn(&Value) -> bool, default: Value) -> Value {
    persistence::load_versioned(&data_file(app, name), max_bytes, is_data)
        .ok()
        .flatten()
        .unwrap_or_else(|| {
            serde_json::json!({
                "version": 2,
                "revision": 0,
                "savedAt": persistence::now_iso8601(),
                "data": default
            })
        })
}

#[tauri::command]
pub fn radio_load_stations(app: AppHandle) -> Value {
    load_or_default(
        &app,
        "radio-stations.json",
        MAX_RADIO_STATIONS_BYTES,
        is_radio_stations_document,
        serde_json::json!({ "schemaVersion": 1, "stations": [] }),
    )
}

#[tauri::command]
pub fn radio_save_stations(
    app: AppHandle,
    document: Value,
    expected_revision: u64,
) -> Result<Value, String> {
    persistence::save_versioned(
        &data_file(&app, "radio-stations.json"),
        MAX_RADIO_STATIONS_BYTES,
        document,
        expected_revision,
        is_radio_stations_document,
    )
}

#[tauri::command]
pub fn podcast_load_subscriptions(app: AppHandle) -> Value {
    load_or_default(
        &app,
        "podcast-subscriptions.json",
        MAX_PODCAST_SUBSCRIPTIONS_BYTES,
        is_podcast_subscriptions_document,
        serde_json::json!({ "schemaVersion": 1, "subscriptions": [] }),
    )
}

#[tauri::command]
pub fn podcast_save_subscriptions(
    app: AppHandle,
    document: Value,
    expected_revision: u64,
) -> Result<Value, String> {
    persistence::save_versioned(
        &data_file(&app, "podcast-subscriptions.json"),
        MAX_PODCAST_SUBSCRIPTIONS_BYTES,
        document,
        expected_revision,
        is_podcast_subscriptions_document,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid_radio_station() -> Value {
        json!({
            "id": "radio_abc",
            "name": "My Station",
            "streamUrl": "https://example.com/stream",
            "allowInsecureHttp": false,
            "createdAt": "2026-08-17T00:00:00Z",
            "updatedAt": "2026-08-17T00:00:00Z"
        })
    }

    #[test]
    fn radio_validator_mirrors_shared_schema() {
        assert!(is_radio_station(&valid_radio_station()));
        let mut bad = valid_radio_station();
        bad["streamUrl"] = json!("http://example.com/stream");
        // 明文 http 未显式允许 → 拒绝。
        assert!(!is_radio_station(&bad));
        bad["allowInsecureHttp"] = json!(true);
        assert!(is_radio_station(&bad));
        bad["streamUrl"] = json!("ftp://example.com/stream");
        assert!(!is_radio_station(&bad));
        assert!(is_radio_stations_document(&json!({
            "schemaVersion": 1,
            "stations": [valid_radio_station()]
        })));
        assert!(!is_radio_stations_document(&json!({
            "schemaVersion": 2,
            "stations": []
        })));
        assert!(!is_radio_stations_document(&json!({ "stations": [] })));
    }

    #[test]
    fn radio_rejects_inline_credentials() {
        let mut station = valid_radio_station();
        station["streamUrl"] = json!("https://user:pass@example.com/stream");
        assert!(!is_radio_station(&station));
    }

    fn valid_podcast_subscription() -> Value {
        json!({
            "id": "pod_1",
            "feedUrl": "https://example.com/feed.xml",
            "title": "My Podcast",
            "episodes": [{
                "guid": "ep1",
                "title": "Episode 1",
                "mediaUrl": "https://example.com/ep1.mp3",
                "durationSeconds": 300
            }],
            "createdAt": "2026-08-17T00:00:00Z",
            "updatedAt": "2026-08-17T00:00:00Z"
        })
    }

    #[test]
    fn podcast_validator_mirrors_shared_schema() {
        assert!(is_podcast_subscription(&valid_podcast_subscription()));
        assert!(is_podcast_subscriptions_document(&json!({
            "schemaVersion": 1,
            "subscriptions": [valid_podcast_subscription()]
        })));
        assert!(is_podcast_subscriptions_document(&json!({
            "schemaVersion": 1,
            "subscriptions": []
        })));
        assert!(!is_podcast_subscriptions_document(&json!({
            "schemaVersion": 2,
            "subscriptions": []
        })));
        let mut bad_episode = valid_podcast_subscription();
        bad_episode["episodes"][0]["mediaUrl"] = json!("file:///tmp/ep.mp3");
        assert!(!is_podcast_subscription(&bad_episode));
        let mut bad_duration = valid_podcast_subscription();
        bad_duration["episodes"][0]["durationSeconds"] = json!(-5);
        assert!(!is_podcast_subscription(&bad_duration));
    }
}

