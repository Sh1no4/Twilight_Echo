use serde_json::{json, Map, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use url::Url;

use crate::path_policy;
use crate::plugin_index_gateway;
use crate::plugins;
use crate::plugins_install;

const MAX_PLUGIN_ID_LENGTH: usize = 128;

static LAST_INDEX_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn set_last_index_error(error: Option<String>) {
    let guard = LAST_INDEX_ERROR.get_or_init(|| Mutex::new(None));
    if let Ok(mut slot) = guard.lock() {
        *slot = error;
    }
}

fn last_index_error() -> Option<String> {
    LAST_INDEX_ERROR
        .get()
        .and_then(|guard| guard.lock().ok())
        .and_then(|slot| slot.clone())
}

pub fn list_index(app: AppHandle) -> Result<Vec<Value>, String> {
    let entries = read_index_entries(&app)?;
    Ok(listing_from_entries(&app, entries))
}

pub async fn refresh_index(app: AppHandle) -> Result<Vec<Value>, String> {
    let fetched = plugin_index_gateway::proxy_index_json(Duration::from_secs(60)).await;
    match fetched {
        Ok(index) if is_valid_index(&index) => {
            set_last_index_error(None);
            let entries = index
                .get("plugins")
                .cloned()
                .unwrap_or(Value::Array(vec![]));
            Ok(listing_from_entries(&app, entries))
        }
        Ok(_index) => {
            let error = "插件索引必须是包含 schemaVersion 和 plugins 的对象".to_string();
            set_last_index_error(Some(error));
            let entries = read_index_entries(&app)?;
            Ok(listing_from_entries(&app, entries))
        }
        Err(error) => {
            set_last_index_error(Some(error));
            let entries = read_index_entries(&app)?;
            Ok(listing_from_entries(&app, entries))
        }
    }
}

pub fn get_index_status(app: AppHandle) -> Result<Value, String> {
    let source_url = index_file_url(&app);
    let error = last_index_error();
    let stale = error.is_some();
    Ok(json!({
        "sourceUrl": source_url,
        "configuredSourceUrl": source_url,
        "sourceKind": "bundled",
        "loadedFrom": "bundled",
        "lastFetchedAt": Value::Null,
        "expiresAt": Value::Null,
        "loadedAt": plugins::now_iso8601(),
        "stale": stale,
        "expired": false,
        "originVerified": true,
        "officialSource": false,
        "cacheFormat": Value::Null,
        "trustStoreError": Value::Null,
        "error": error,
    }))
}

pub async fn install_from_index(app: AppHandle, id: String) -> Result<Value, String> {
    let id = normalize_plugin_id(&id)?;
    let entries = read_index_entries(&app)?;
    let entry = entries
        .as_array()
        .and_then(|list| {
            list.iter()
                .find(|entry| entry.get("id").and_then(Value::as_str) == Some(id.as_str()))
        })
        .ok_or_else(|| "插件索引中未找到该插件".to_string())?;
    if id == plugins::BUNDLED_PLUGIN_ID {
        return Err("索引不能安装或覆盖 Twilight Echo 自带插件".to_string());
    }
    let range = entry
        .pointer("/engines/twilightEcho")
        .and_then(Value::as_str)
        .unwrap_or("*");
    if !plugins::engine_range_compatible(range) {
        let name = entry.get("name").and_then(Value::as_str).unwrap_or(&id);
        return Err(format!(
            "插件 {name} 不兼容当前 Twilight Echo {}",
            plugins::APP_VERSION
        ));
    }
    let source_url = entry
        .get("sourceUrl")
        .and_then(Value::as_str)
        .ok_or_else(|| "插件索引条目缺少 sourceUrl".to_string())?;
    let expected_checksum = entry
        .get("checksumSha256")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_lowercase();
    if expected_checksum.len() != 64 {
        return Err(format!("插件索引 {id} checksumSha256 必须是 64 位 sha256"));
    }

    let bytes =
        plugin_index_gateway::proxy_package_bytes(source_url, Duration::from_secs(120)).await?;
    let actual_checksum = sha256_hex(&bytes);
    if actual_checksum != expected_checksum {
        return Err(format!("插件包 checksum 不匹配：{id}"));
    }

    // 写临时 `.tep` 包，走统一安装逻辑（sourceType='index'，含信任对话框）。
    let temp_dir = temp_package_dir()?;
    let package_path = temp_dir.join("package.tep");
    fs::write(&package_path, &bytes).map_err(|error| format!("写入临时插件包失败：{error}"))?;
    let result =
        plugins_install::install_index_package(app, package_path.to_string_lossy().into_owned())
            .await;
    let _ = fs::remove_dir_all(&temp_dir);
    result
}

pub fn set_native_dsp_parameters(
    app: AppHandle,
    id: String,
    parameters: Value,
) -> Result<Value, String> {
    let id = normalize_plugin_id(&id)?;
    let policy = path_policy::get_path_policy(&app);
    let descriptor =
        plugins::find_descriptor(&app, &policy, &id).ok_or_else(|| format!("插件未找到：{id}"))?;
    if !descriptor
        .get("isDsp")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err("只有 DSP 插件支持原生参数".to_string());
    }

    let mut normalized: Map<String, Value> = Map::new();
    if let Some(object) = parameters.as_object() {
        for (key, value) in object {
            let name = key.trim();
            if name.is_empty() {
                continue;
            }
            let Some(number) = value.as_f64() else {
                return Err(format!("DSP 参数不是有限数字：{name}"));
            };
            if !number.is_finite() {
                return Err(format!("DSP 参数不是有限数字：{name}"));
            }
            normalized.insert(name.to_string(), json!(number));
        }
    }

    let now = plugins::now_iso8601();
    let mut state = plugins::read_plugin_state(&policy);
    let record = state
        .get_mut(&id)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "插件状态不存在".to_string())?;
    record.insert("nativeDspParameters".to_string(), Value::Object(normalized));
    record.insert("updatedAt".to_string(), json!(now));
    plugins::write_plugin_state(&policy, &state);

    plugins::find_descriptor(&app, &policy, &id).ok_or_else(|| format!("插件未找到：{id}"))
}

// ── 索引读取与条目合成 ────────────────────────────────────────────────

fn bundled_index_path(app: &AppHandle) -> PathBuf {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("plugin-index").join("plugins.json");
        if candidate.is_file() {
            return candidate;
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let candidate = cwd
            .join("resources")
            .join("plugin-index")
            .join("plugins.json");
        if candidate.is_file() {
            return candidate;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources/plugin-index/plugins.json")
}

fn index_file_url(app: &AppHandle) -> String {
    Url::from_file_path(bundled_index_path(app))
        .map(|url| url.to_string())
        .unwrap_or_else(|_| "file:///".to_string())
}

fn read_index_entries(app: &AppHandle) -> Result<Value, String> {
    let path = bundled_index_path(app);
    let raw = fs::read_to_string(&path).map_err(|error| format!("读取插件索引失败：{error}"))?;
    let index: Value =
        serde_json::from_str(&raw).map_err(|error| format!("插件索引不是合法 JSON：{error}"))?;
    if !is_valid_index(&index) {
        return Err("插件索引必须是包含 schemaVersion 和 plugins 的对象".to_string());
    }
    Ok(index
        .get("plugins")
        .cloned()
        .unwrap_or(Value::Array(vec![])))
}

fn is_valid_index(index: &Value) -> bool {
    index.get("schemaVersion").and_then(Value::as_u64) == Some(1)
        && index.get("plugins").and_then(Value::as_array).is_some()
}

fn listing_from_entries(app: &AppHandle, entries: Value) -> Vec<Value> {
    let installed = plugins::plugins_list(app.clone());
    let installed_array = installed.as_array().cloned().unwrap_or_default();
    let entries_array = entries.as_array().cloned().unwrap_or_default();
    entries_array
        .into_iter()
        .map(|entry| {
            let id = entry
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let install_state = describe_install_state(&entry, &installed_array);
            let installed_version = installed_array
                .iter()
                .find(|descriptor| {
                    descriptor.get("id").and_then(Value::as_str) == Some(id.as_str())
                })
                .and_then(|descriptor| descriptor.get("version").and_then(Value::as_str))
                .map(String::from);
            let mut listed = entry;
            if let Some(object) = listed.as_object_mut() {
                object.insert("installState".to_string(), json!(install_state));
                object.insert("installedVersion".to_string(), json!(installed_version));
            }
            listed
        })
        .collect()
}

fn describe_install_state(entry: &Value, installed: &[Value]) -> &'static str {
    let id = entry.get("id").and_then(Value::as_str).unwrap_or("");
    if id == plugins::BUNDLED_PLUGIN_ID {
        return "built-in-blocked";
    }
    let range = entry
        .pointer("/engines/twilightEcho")
        .and_then(Value::as_str)
        .unwrap_or("*");
    if !plugins::engine_range_compatible(range) {
        return "incompatible";
    }
    let Some(descriptor) = installed
        .iter()
        .find(|descriptor| descriptor.get("id").and_then(Value::as_str) == Some(id))
    else {
        return "not-installed";
    };
    let entry_version = entry
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or("0.0.0");
    let installed_version = descriptor
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or("0.0.0");
    if compare_semver(entry_version, installed_version) > 0 {
        return "update-available";
    }
    "installed"
}

fn compare_semver(a: &str, b: &str) -> i32 {
    let a = plugins::parse_version(a).unwrap_or((0, 0, 0));
    let b = plugins::parse_version(b).unwrap_or((0, 0, 0));
    if a.0 != b.0 {
        return if a.0 > b.0 { 1 } else { -1 };
    }
    if a.1 != b.1 {
        return if a.1 > b.1 { 1 } else { -1 };
    }
    if a.2 != b.2 {
        return if a.2 > b.2 { 1 } else { -1 };
    }
    0
}

fn normalize_plugin_id(id: &str) -> Result<String, String> {
    let normalized = id.trim().to_lowercase();
    if !is_valid_plugin_id(&normalized) {
        return Err("plugin id is invalid".to_string());
    }
    Ok(normalized)
}

fn is_valid_plugin_id(id: &str) -> bool {
    if id.is_empty() || id.len() > MAX_PLUGIN_ID_LENGTH {
        return false;
    }
    let mut chars = id.chars().peekable();
    let mut first_segment = 0;
    while let Some(&c) = chars.peek() {
        if !(c.is_ascii_lowercase() || c.is_ascii_digit()) {
            break;
        }
        first_segment += 1;
        chars.next();
    }
    if first_segment == 0 {
        return false;
    }
    let mut groups = 0;
    while let Some(&separator) = chars.peek() {
        if separator != '.' && separator != '-' {
            return false;
        }
        chars.next();
        let mut segment = 0;
        while let Some(&c) = chars.peek() {
            if !(c.is_ascii_lowercase() || c.is_ascii_digit()) {
                break;
            }
            segment += 1;
            chars.next();
        }
        if segment == 0 {
            return false;
        }
        groups += 1;
    }
    groups >= 1
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn temp_package_dir() -> Result<PathBuf, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!(
        "twilight-echo-index-pkg-{}-{nanos}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).map_err(|error| format!("创建临时目录失败：{error}"))?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_plugin_id_matches_electron_pattern() {
        assert_eq!(normalize_plugin_id("  NCM.Search  ").unwrap(), "ncm.search");
        assert_eq!(
            normalize_plugin_id("com.twilightecho.provider.bilibili").unwrap(),
            "com.twilightecho.provider.bilibili"
        );
        assert_eq!(normalize_plugin_id("a-b-c").unwrap(), "a-b-c");
        assert!(normalize_plugin_id("").is_err());
        assert!(normalize_plugin_id("single").is_err());
        assert!(normalize_plugin_id("-leading").is_err());
        assert!(normalize_plugin_id("trailing-").is_err());
        assert!(normalize_plugin_id("has space").is_err());
        assert!(normalize_plugin_id("UPPER").is_err());
        let long = format!("a.{}", "b".repeat(MAX_PLUGIN_ID_LENGTH));
        assert!(normalize_plugin_id(&long).is_err());
    }

    #[test]
    fn compare_semver_three_field_numeric() {
        assert_eq!(compare_semver("1.2.3", "1.2.3"), 0);
        assert!(compare_semver("1.2.4", "1.2.3") > 0);
        assert!(compare_semver("1.3.0", "1.2.99") > 0);
        assert!(compare_semver("2.0.0", "1.9.9") > 0);
        assert!(compare_semver("1.2.3", "1.2.4") < 0);
        assert!(compare_semver("0.1.9", "1.0.5") < 0);
        assert_eq!(compare_semver("nope", "1.0.0"), -1);
    }

    #[test]
    fn describe_install_state_order() {
        let installed = json!([{ "id": "com.example.installed", "version": "0.1.0" }]);
        let installed = installed.as_array().unwrap();

        let built_in = json!({ "id": plugins::BUNDLED_PLUGIN_ID, "engines": { "twilightEcho": ">=0.20.0" }, "version": "0.1.0" });
        assert_eq!(
            describe_install_state(&built_in, installed),
            "built-in-blocked"
        );

        let incompatible = json!({ "id": "com.example.x", "engines": { "twilightEcho": ">=99.0.0" }, "version": "0.1.0" });
        assert_eq!(
            describe_install_state(&incompatible, installed),
            "incompatible"
        );

        let fresh = json!({ "id": "com.example.new", "engines": { "twilightEcho": ">=0.20.0" }, "version": "0.1.0" });
        assert_eq!(describe_install_state(&fresh, installed), "not-installed");

        let update = json!({ "id": "com.example.installed", "engines": { "twilightEcho": ">=0.20.0" }, "version": "0.2.0" });
        assert_eq!(
            describe_install_state(&update, installed),
            "update-available"
        );

        let same = json!({ "id": "com.example.installed", "engines": { "twilightEcho": ">=0.20.0" }, "version": "0.1.0" });
        assert_eq!(describe_install_state(&same, installed), "installed");
    }

    #[test]
    fn is_valid_index_accepts_bundled_shape() {
        assert!(is_valid_index(
            &json!({ "schemaVersion": 1, "plugins": [] })
        ));
        assert!(!is_valid_index(
            &json!({ "schemaVersion": 2, "plugins": [] })
        ));
        assert!(!is_valid_index(&json!({ "schemaVersion": 1 })));
        assert!(!is_valid_index(&json!({ "plugins": [] })));
    }

    #[test]
    fn sha256_hex_known_vector() {
        assert_eq!(
            sha256_hex(b"hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }
}

