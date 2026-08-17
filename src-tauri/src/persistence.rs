
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

const ENVELOPE_VERSION: u64 = 2;

pub fn now_iso8601() -> String {
    use time::format_description::well_known::Rfc3339;
    time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

fn corrupt_path(path: &Path) -> PathBuf {
    path.with_extension("json.corrupt")
}

fn temporary_path(path: &Path) -> PathBuf {
    path.with_extension("json.tmp")
}

fn read_json(path: &Path, max_bytes: u64) -> Option<Value> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > max_bytes {
        return None;
    }
    let raw = fs::read_to_string(path).ok()?;
    if raw.len() as u64 > max_bytes {
        return None;
    }
    serde_json::from_str(&raw).ok()
}

fn preserve_corrupt_copy(path: &Path) {
    if path.is_file() {
        let _ = fs::copy(path, corrupt_path(path));
    }
}

pub fn write_json_atomic(path: &Path, value: &Value, max_bytes: u64) -> Result<(), String> {
    let serialized =
        serde_json::to_vec_pretty(value).map_err(|error| format!("序列化失败：{error}"))?;
    if serialized.len() as u64 > max_bytes {
        return Err("数据超过大小上限".to_string());
    }
    let parent = path.parent().ok_or_else(|| "路径无父目录".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("创建目录失败：{error}"))?;
    let tmp = temporary_path(path);
    fs::write(&tmp, &serialized).map_err(|error| format!("写入临时文件失败：{error}"))?;
    if path.exists() {
        let _ = fs::copy(path, backup_path(path));
    }
    fs::rename(&tmp, path).map_err(|error| format!("替换文件失败：{error}"))?;
    Ok(())
}

pub fn load_versioned(
    path: &Path,
    max_bytes: u64,
    is_data: fn(&Value) -> bool,
) -> Result<Option<Value>, String> {
    let primary = read_json(path, max_bytes);
    if let Some(value) = &primary {
        if is_versioned_envelope(value, is_data) {
            return Ok(Some(value.clone()));
        }
        if is_data(value) {
            let envelope = json!({
                "version": ENVELOPE_VERSION,
                "revision": 0,
                "savedAt": now_iso8601(),
                "data": value
            });
            write_json_atomic(path, &envelope, max_bytes)?;
            return Ok(Some(envelope));
        }
        preserve_corrupt_copy(path);
    }

    let backup = read_json(&backup_path(path), max_bytes);
    if let Some(value) = &backup {
        if is_versioned_envelope(value, is_data) {
            // 从备份恢复主文件（对应 Electron `loadJsonFileWithBackup` 的 recovered 分支）。
            write_json_atomic(path, value, max_bytes)?;
            return Ok(Some(value.clone()));
        }
        if is_data(value) {
            let envelope = json!({
                "version": ENVELOPE_VERSION,
                "revision": 0,
                "savedAt": now_iso8601(),
                "data": value
            });
            write_json_atomic(path, &envelope, max_bytes)?;
            return Ok(Some(envelope));
        }
    }
    Ok(None)
}

pub fn save_versioned(
    path: &Path,
    max_bytes: u64,
    data: Value,
    expected_revision: u64,
    is_data: fn(&Value) -> bool,
) -> Result<Value, String> {
    if !is_data(&data) {
        return Err("数据结构无效".to_string());
    }
    let current = load_versioned(path, max_bytes, is_data)?;
    let current_revision = current
        .as_ref()
        .and_then(|envelope| envelope.get("revision"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    if expected_revision != current_revision {
        return Ok(conflict_response(expected_revision, current));
    }
    let next = json!({
        "version": ENVELOPE_VERSION,
        "revision": current_revision + 1,
        "savedAt": now_iso8601(),
        "data": data
    });
    write_json_atomic(path, &next, max_bytes)?;
    Ok(next)
}

pub(crate) fn conflict_response(expected_revision: u64, current: Option<Value>) -> Value {
    json!({
        "code": "ERR_PERSISTENCE_REVISION_CONFLICT",
        "expectedRevision": expected_revision,
        "current": current.unwrap_or(Value::Null)
    })
}

fn is_versioned_envelope(value: &Value, is_data: fn(&Value) -> bool) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.get("version").and_then(Value::as_u64) == Some(ENVELOPE_VERSION)
        && object.get("revision").and_then(Value::as_u64).is_some()
        && object.get("savedAt").and_then(Value::as_str).is_some()
        && object.get("data").is_some_and(is_data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn is_array(value: &Value) -> bool {
        value.is_array()
    }

    fn tmp_file(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "twilight-persistence-{}-{}",
            name,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join("data.json")
    }

    #[test]
    fn save_and_load_roundtrips_versioned_envelope() {
        let path = tmp_file("roundtrip");
        let saved = save_versioned(&path, 1024 * 1024, json!([1, 2, 3]), 0, is_array).unwrap();
        assert_eq!(saved.get("revision").and_then(Value::as_u64), Some(1));
        let loaded = load_versioned(&path, 1024 * 1024, is_array)
            .unwrap()
            .unwrap();
        assert_eq!(loaded.get("revision").and_then(Value::as_u64), Some(1));
        assert_eq!(loaded.pointer("/data").unwrap(), &json!([1, 2, 3]));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn save_rejects_stale_revision_with_conflict_response() {
        let path = tmp_file("conflict");
        save_versioned(&path, 1024 * 1024, json!(["a"]), 0, is_array).unwrap();
        let conflict = save_versioned(&path, 1024 * 1024, json!(["b"]), 0, is_array).unwrap();
        assert_eq!(
            conflict.get("code").and_then(Value::as_str),
            Some("ERR_PERSISTENCE_REVISION_CONFLICT")
        );
        assert_eq!(
            conflict.get("expectedRevision").and_then(Value::as_u64),
            Some(0)
        );
        assert_eq!(
            conflict
                .pointer("/current/revision")
                .and_then(Value::as_u64),
            Some(1)
        );
        // 权威数据未被冲突写覆盖。
        let loaded = load_versioned(&path, 1024 * 1024, is_array)
            .unwrap()
            .unwrap();
        assert_eq!(loaded.pointer("/data").unwrap(), &json!(["a"]));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn legacy_data_is_migrated_to_revision_zero_envelope() {
        let path = tmp_file("legacy");
        fs::write(&path, "[9, 8]").unwrap();
        let loaded = load_versioned(&path, 1024 * 1024, is_array)
            .unwrap()
            .unwrap();
        assert_eq!(loaded.get("version").and_then(Value::as_u64), Some(2));
        assert_eq!(loaded.get("revision").and_then(Value::as_u64), Some(0));
        assert_eq!(loaded.pointer("/data").unwrap(), &json!([9, 8]));
        // 迁移已写回磁盘。
        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.contains("\"version\": 2"));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn corrupt_primary_recovers_from_backup() {
        let path = tmp_file("recover");
        save_versioned(&path, 1024 * 1024, json!(["first"]), 0, is_array).unwrap();
        // 第二次原子写把 rev-1 信封轮换为 `.bak`。
        save_versioned(&path, 1024 * 1024, json!(["ok"]), 1, is_array).unwrap();
        fs::write(&path, "{corrupt").unwrap();
        let loaded = load_versioned(&path, 1024 * 1024, is_array)
            .unwrap()
            .unwrap();
        assert_eq!(loaded.pointer("/data").unwrap(), &json!(["first"]));
        // 主文件已由备份恢复。
        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.contains("\"version\": 2"));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn atomic_write_creates_backup() {
        let path = tmp_file("backup");
        save_versioned(&path, 1024 * 1024, json!(["first"]), 0, is_array).unwrap();
        save_versioned(&path, 1024 * 1024, json!(["second"]), 1, is_array).unwrap();
        let backup = read_json(&backup_path(&path), 1024 * 1024).unwrap();
        assert_eq!(backup.pointer("/data").unwrap(), &json!(["first"]));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}

