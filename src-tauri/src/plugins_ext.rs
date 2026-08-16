//! 扩展命令（Stage 5B）。
//!
//! `extensions.executeCommand` / `extensions.readThemeStylesheet` 由激活的插件宿主实现：
//! - `executeCommand`：把命令路由到已注册该 UI command 的宿主（插件激活时经
//!   `extensions/registerUi` 登记），未找到时返回结构化错误（镜像 Electron
//!   `manager.executeUiCommand` 的「UI command 未注册」语义）。
//! - `readThemeStylesheet`：从已启用插件的 manifest `contributes.themes` 声明中取
//!   `stylesheet`，canonical 化后与请求路径比对，拒绝未注册路径与路径穿越/symlink 逃逸
//!   （镜像 Electron `isRegisteredThemeStylesheet`）。
use serde_json::Value;
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager};

use crate::path_policy;
use crate::plugin_host;
use crate::plugins;

/// `extensions.executeCommand`：路由到注册该命令的宿主。
pub async fn execute_command(
    app: &AppHandle,
    command: &str,
    args: Option<Value>,
) -> Result<Value, String> {
    let normalized = command.trim().to_lowercase();
    if normalized.is_empty() {
        return Err("UI command 不能为空".to_string());
    }
    let args = args.unwrap_or_else(|| Value::Array(vec![]));
    let args = match args {
        Value::Array(items) => Value::Array(items.into_iter().take(16).collect()),
        _ => Value::Array(vec![]),
    };

    let registry = app.state::<plugin_host::PluginHostRegistry>();
    let hosts = registry.hosts.lock().await;
    for handle in hosts.values() {
        let registered = handle
            .ui_commands
            .lock()
            .map_err(|_| "插件宿主状态锁失败".to_string())?
            .iter()
            .any(|registered| registered.eq_ignore_ascii_case(&normalized));
        if registered {
            return plugin_host::ui_command(handle, &normalized, args).await;
        }
    }
    Err(format!("UI command 未注册：{normalized}"))
}

/// `extensions.readThemeStylesheet`：仅允许读取已启用插件 `contributes.themes`
/// 声明的 stylesheet；路径必须 canonical 化后与声明完全一致。
pub async fn read_theme_stylesheet(
    app: &AppHandle,
    stylesheet_path: &str,
) -> Result<String, String> {
    if stylesheet_path.trim().is_empty() {
        return Err("主题 stylesheet 路径不能为空".to_string());
    }
    let requested = Path::new(stylesheet_path);
    let requested_canonical = requested
        .canonicalize()
        .map_err(|_| "主题 stylesheet 未注册".to_string())?;

    let policy = path_policy::get_path_policy(app);
    let state = plugins::read_plugin_state(&policy);
    let mut allowed = false;

    if let Ok(entries) = fs::read_dir(plugins::plugins_root_path(&policy)) {
        for entry in entries.flatten() {
            let id_root = entry.path();
            if !id_root.is_dir() {
                continue;
            }
            let Some(id) = id_root
                .file_name()
                .and_then(|name| name.to_str())
                .map(ToOwned::to_owned)
            else {
                continue;
            };
            let enabled = state
                .get(&id)
                .and_then(|record| record.get("enabled"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if !enabled {
                continue;
            }
            let descriptor =
                plugins::find_descriptor(app, &policy, &id).unwrap_or_else(|| Value::Null);
            if descriptor.get("status").and_then(Value::as_str) == Some("invalid") {
                continue;
            }
            let themes = descriptor
                .pointer("/contributes/themes")
                .and_then(Value::as_array);
            if let Some(themes) = themes {
                for theme in themes {
                    let Some(stylesheet) = theme.get("stylesheet").and_then(Value::as_str) else {
                        continue;
                    };
                    let stylesheet_path = Path::new(stylesheet);
                    let stylesheet_canonical = stylesheet_path
                        .canonicalize()
                        .unwrap_or_else(|_| stylesheet_path.to_path_buf());
                    if stylesheet_canonical == requested_canonical {
                        allowed = true;
                    }
                }
            }
        }
    }

    // 内置 NCM 插件（不复制进插件目录）也可能声明主题；与 `plugins_list` 相同回退。
    if !allowed {
        if let Some(bundled_root) = plugins::bundled_plugin_root(app) {
            if let Ok(manifest) = plugins::read_manifest(&bundled_root) {
                let enabled = state
                    .get(plugins::BUNDLED_PLUGIN_ID)
                    .and_then(|record| record.get("enabled"))
                    .and_then(Value::as_bool)
                    .unwrap_or(true);
                if enabled {
                    let themes = manifest
                        .pointer("/contributes/themes")
                        .and_then(Value::as_array);
                    if let Some(themes) = themes {
                        for theme in themes {
                            let Some(stylesheet) = theme.get("stylesheet").and_then(Value::as_str)
                            else {
                                continue;
                            };
                            let stylesheet_path = Path::new(stylesheet);
                            let stylesheet_canonical = stylesheet_path
                                .canonicalize()
                                .unwrap_or_else(|_| stylesheet_path.to_path_buf());
                            if stylesheet_canonical == requested_canonical {
                                allowed = true;
                            }
                        }
                    }
                }
            }
        }
    }

    if !allowed {
        return Err("主题 stylesheet 未注册".to_string());
    }
    fs::read_to_string(&requested_canonical)
        .map_err(|error| format!("读取主题 stylesheet 失败：{error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_command_trims_and_lowercases() {
        let normalized = "  NCM.Search  ".trim().to_lowercase();
        assert_eq!(normalized, "ncm.search");
    }

    #[test]
    fn args_slice_caps_entries() {
        let args = Value::Array((0..30).map(|i| Value::from(i)).collect());
        let sliced = match args {
            Value::Array(items) => Value::Array(items.into_iter().take(16).collect()),
            _ => Value::Array(vec![]),
        };
        assert_eq!(sliced.as_array().map(Vec::len), Some(16));
    }
}
