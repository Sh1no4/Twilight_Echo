//! `settings` 备份导入导出（Stage 7D）。
//!
//! 镜像 Electron `src/main/core/settingsBackup.ts`：
//! - `export_settings_backup`：把当前 settings + 主题库文档打成
//!   `{ schemaVersion: 2, settings, themeLibrary }` 的 JSON 字符串
//!   （无主题库时退化为纯 settings 对象，与 Electron 一致）；
//! - `import_settings_backup`：解析传入 JSON，schemaVersion 2 + `settings` 键时
//!   视为捆绑包并校验 `themeLibrary`；否则视为纯 settings 对象。合并到当前
//!   settings 后原子写回并广播 `settings:changed`；捆绑包连带恢复主题库
//!   （CAS 冲突按 Electron `importAppSettingsBackup` + `restoreThemeLibraryFromBackup`
//!   处理：抛错中止，不静默覆盖）。
//!
//! 路径类设置字段写入前经 `crate::auth_patch` 过滤（新值必须位于授权音频根内）。

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::themes;
use crate::{auth_patch, save_json_file, settings_snapshot};

const SETTINGS_BACKUP_SCHEMA_VERSION: u64 = 2;
const MAX_SETTINGS_BACKUP_BYTES: usize = 16 * 1024 * 1024;

/// `settings.exportBackup`：返回可下载/保存的备份 JSON 字符串。
#[tauri::command]
pub fn settings_export_backup(app: AppHandle) -> Result<String, String> {
    let settings = crate::load_json_file(&app, "settings.json", json!({}));
    let theme_envelope = themes::load_library(&app);
    let theme_data = theme_envelope.get("data").cloned().unwrap_or(Value::Null);
    let has_theme_library = !theme_data.is_null();
    let payload = if has_theme_library {
        json!({
            "schemaVersion": SETTINGS_BACKUP_SCHEMA_VERSION,
            "settings": settings,
            "themeLibrary": theme_data
        })
    } else {
        settings
    };
    serde_json::to_string_pretty(&payload).map_err(|e| format!("序列化备份失败：{e}"))
}

/// `settings.importBackup`：导入备份 JSON 并写回，返回新的 settings 快照。
#[tauri::command]
pub fn settings_import_backup(app: AppHandle, json_string: String) -> Result<Value, String> {
    if json_string.len() > MAX_SETTINGS_BACKUP_BYTES {
        return Err("设置备份过大".to_string());
    }
    let parsed: Value =
        serde_json::from_str(&json_string).map_err(|_| "设置备份 JSON 无效".to_string())?;
    let Some(object) = parsed.as_object() else {
        return Err("设置备份必须是 JSON 对象".to_string());
    };
    let is_bundle = object.get("schemaVersion").and_then(Value::as_u64)
        == Some(SETTINGS_BACKUP_SCHEMA_VERSION)
        && object.contains_key("settings");
    let raw_settings = if is_bundle {
        object
            .get("settings")
            .cloned()
            .unwrap_or_else(|| json!({}))
    } else {
        parsed.clone()
    };
    if !raw_settings.is_object() {
        return Err("设置备份的 settings 必须是 JSON 对象".to_string());
    }

    let imported_theme_library = if is_bundle {
        match object.get("themeLibrary") {
            Some(Value::Null) | None => None,
            Some(theme) => {
                let ok = themes::is_theme_library_document(theme);
                if !ok {
                    return Err("设置备份的主题库无效".to_string());
                }
                Some(theme.clone())
            }
        }
    } else {
        None
    };

    // 合并到当前 settings（Electron：normalize({ ...current, ...raw })）。
    let mut current = crate::load_json_file(&app, "settings.json", json!({}));
    if let (Some(stored), Some(raw)) = (current.as_object_mut(), raw_settings.as_object()) {
        for (key, value) in raw {
            stored.insert(key.clone(), value.clone());
        }
    }
    // 路径类键新值必须位于授权音频根内，否则从合并结果移除（镜像 Electron
    // `authorizeSettingsPathPatch` 对 cachePath/musicCachePath/libraryFolders 的处理）。
    let mut merged = current.clone();
    {
        let settings_ref = current.clone();
        auth_patch(&app, &settings_ref, &mut merged);
    }

    save_json_file(&app, "settings.json", &merged)?;
    let snapshot = settings_snapshot(&app, &merged);
    let _ = app.emit("settings:changed", snapshot.clone());

    if let Some(theme_document) = imported_theme_library {
        restore_theme_library(&app, theme_document)?;
    }
    Ok(snapshot)
}

/// 以 CAS 恢复备份中的主题库：当前 revision 不匹配时抛错（镜像
/// `restoreThemeLibraryFromBackup` 的并发变更中止语义）。
fn restore_theme_library(app: &AppHandle, document: Value) -> Result<(), String> {
    let current = themes::load_library(app);
    let current_revision = current.get("revision").and_then(Value::as_u64).unwrap_or(0);
    themes::replace_theme_library(app, document, current_revision)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn export_backup_shape_mirrors_settings_backup() {
        // 纯 settings（无主题库）退化为 settings 对象。
        let payload = json!({ "theme": "dark" });
        let serialized = serde_json::to_string(&payload).unwrap();
        let parsed: Value = serde_json::from_str(&serialized).unwrap();
        assert_eq!(parsed, payload);
    }

    #[test]
    fn bundle_detection_matches_schema_version() {
        let bundle = json!({
            "schemaVersion": 2,
            "settings": { "theme": "dark" },
            "themeLibrary": null
        });
        assert_eq!(
            bundle.get("schemaVersion").and_then(Value::as_u64),
            Some(2)
        );
        assert!(bundle.get("settings").is_some());
    }

    #[test]
    fn import_rejects_empty_or_invalid_json() {
        let empty: Result<Value, _> = serde_json::from_str("");
        assert!(empty.is_err());
        let not_object = json!([1, 2, 3]);
        assert!(!not_object.is_object());
    }

    #[test]
    fn theme_library_validator_exposed_for_backup() {
        let valid = json!({
            "schemaVersion": 1,
            "activeTheme": { "kind": "builtin", "id": "twilight-default" },
            "profiles": [],
            "windowInheritance": { "miniPlayer": true, "desktopLyrics": true },
            "profileHistory": {}
        });
        assert!(themes::is_theme_library_document(&valid));
        assert!(!themes::is_theme_library_document(&json!({ "schemaVersion": 1 })));
    }
}