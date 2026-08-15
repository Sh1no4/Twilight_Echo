//! 插件安装（Stage 5C）：`plugins.installFromPath` / `plugins.chooseAndInstall`。
//!
//! 镜像 Electron `manager.ts installFromPath` 的语义。Tauri 无插件宿主，省略
//! 启动/回滚/事务队列等运行时副作用，保留文件落盘与持久化状态合并：
//! - 来源必须是目录或 `.tep` 包（`插件来源不存在` / `插件来源必须是目录或 .tep 文件`）；
//!   `.tep` 先读字节（50MB 上限）再走 `plugins_zip::validate_and_extract_tep`
//!   校验解压到临时目录，按 `locate_plugin_root` 定位 plugin.json。
//! - manifest 必须通过 `plugins::validate_manifest`；内置插件拒绝覆盖
//!   （`自带插件随 Twilight Echo 分发，不能用本地包覆盖安装`）。
//! - 信任对话框在 `spawn_blocking` 内跑（tauri-plugin-dialog 的 blocking API），
//!   取消报 `已取消插件安装`。
//! - 提交到 `{pluginsRoot}/{id}/{version}/`；状态合并保留 enabled/installedAt/
//!   nativeDspParameters 等既有字段，刷新 updatedAt/source/activeVersion，
//!   清除 lastError。
//! - 返回 `{"plugin": descriptor, "warning": TRUST_WARNING}`（warning 固定为
//!   信任式安装提示，与 Electron 一致）。
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::path_policy;
use crate::plugins;
use crate::plugins_zip;

/// 信任式安装成功后返回的固定 warning（与 Electron `installFromPath` 一致）。
const TRUST_WARNING: &str = "信任式安装：插件拥有与应用相同的权限，请仅安装可信来源。";

/// `plugins.installFromPath`：来源为目录或 `.tep` 包，信任确认后安装。
pub async fn install_from_path(app: AppHandle, source_path: String) -> Result<Value, String> {
    install_impl(app, source_path, None).await
}

/// 索引安装内部入口：来源强制为 `.tep` 临时包，sourceType 固定 `index`。
/// 由 `plugins_index::install_from_index` 调用。
pub(crate) async fn install_index_package(app: AppHandle, package_path: String) -> Result<Value, String> {
    install_impl(app, package_path, Some("index")).await
}

/// `plugins.chooseAndInstall`：文件对话框选 `.tep` 包，取消返回 `None`。
///
/// tauri-plugin-dialog 只有独立 `blocking_pick_file` / `blocking_pick_folder`，
/// 不支持 Electron 的 openFile+openDirectory 同框；Tauri 侧按文件选择实现
/// （`.tep` + All Files 过滤），不支持直接选目录。
pub async fn choose_and_install(app: AppHandle) -> Result<Option<Value>, String> {
    let picked = {
        let app = app.clone();
        tokio::task::spawn_blocking(move || {
            app.dialog()
                .file()
                .add_filter("Twilight Echo Plugin", &["tep"])
                .add_filter("All Files", &["*"])
                .set_title("安装 Twilight Echo 插件")
                .blocking_pick_file()
        })
        .await
        .map_err(|error| format!("选择插件文件对话框失败：{error}"))?
    };
    let Some(file_path) = picked else {
        return Ok(None);
    };
    let path = file_path
        .into_path()
        .map_err(|error| format!("无法解析选择的插件路径：{error}"))?;
    let result = install_impl(app, path.to_string_lossy().into_owned(), None).await?;
    Ok(Some(result))
}

async fn install_impl(
    app: AppHandle,
    source_path: String,
    source_type_override: Option<&str>,
) -> Result<Value, String> {
    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return Err("插件来源不存在".to_string());
    }
    let metadata = fs::metadata(&source).map_err(|error| format!("读取插件来源信息失败：{error}"))?;
    let is_tep = metadata.is_file()
        && source
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("tep"));
    if !metadata.is_dir() && !is_tep {
        return Err("插件来源必须是目录或 .tep 文件".to_string());
    }
    // .tep 先按文件大小拒绝超限包，避免大文件整体进内存（镜像 Electron
    // `assertPluginPackageFileSize`；plugins_zip 解压时还会再校验一次）。
    if is_tep && metadata.len() > plugins_zip::MAX_PLUGIN_PACKAGE_BYTES as u64 {
        return Err("插件包超过 50MB 上限".to_string());
    }

    // `.tep` 包：校验 + 解压到临时目录；成功与失败都清理临时目录。
    let mut temp_cleanup: Option<PathBuf> = None;
    let install_source: PathBuf = if is_tep {
        let bytes = fs::read(&source).map_err(|error| format!("读取插件包失败：{error}"))?;
        let temp_root = plugins_zip::validate_and_extract_tep(&bytes)?;
        temp_cleanup = Some(temp_root.clone());
        plugins_zip::locate_plugin_root(&temp_root)?
    } else {
        source
    };

    let result = install_staged(&app, &install_source, is_tep, source_type_override).await;
    if let Some(temp_root) = temp_cleanup {
        let _ = fs::remove_dir_all(&temp_root);
    }
    result
}

async fn install_staged(
    app: &AppHandle,
    install_source: &Path,
    is_tep: bool,
    source_type_override: Option<&str>,
) -> Result<Value, String> {
    let policy = path_policy::get_path_policy(app);
    let manifest = plugins::read_manifest(install_source)?;
    plugins::validate_manifest(&manifest, install_source)?;

    let id = manifest
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if id == plugins::BUNDLED_PLUGIN_ID {
        return Err("自带插件随 Twilight Echo 分发，不能用本地包覆盖安装".to_string());
    }

    let name = manifest
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if !confirm_trust(app, &name).await? {
        return Err("已取消插件安装".to_string());
    }

    let version = manifest
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or("0.0.0")
        .to_string();
    let source_type = source_type_override.unwrap_or(if is_tep { "tep" } else { "directory" });

    let plugins_root = plugins::plugins_root_path(&policy);
    let target = plugins_root.join(&id).join(&version);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|error| format!("删除旧插件版本失败：{error}"))?;
    }
    copy_tree(install_source, &target, &plugins_root)?;

    // 状态合并：保留既有字段（含 nativeDspParameters），覆盖安装字段。
    let now = plugins::now_iso8601();
    let mut state = plugins::read_plugin_state(&policy);
    let previous = state.get(&id).cloned().unwrap_or_else(|| json!({}));
    let next_state_record = merged_install_state(&previous, &now, source_type, &version);
    if let Some(object) = state.as_object_mut() {
        object.insert(id.clone(), next_state_record.clone());
    }
    plugins::write_plugin_state(&policy, &state);

    let descriptor = plugins::manifest_descriptor(
        &manifest,
        &target,
        source_type,
        previous
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        false,
        None,
        Some(&next_state_record),
        &plugins::plugin_data_root_path(&policy),
        &plugins::plugin_logs_root_path(&policy),
    );
    Ok(json!({
        "plugin": descriptor,
        "warning": TRUST_WARNING,
    }))
}

/// 状态合并（镜像 manager.ts `installFromPath` 的 nextState 形状）：
/// `{...previousState, enabled: wasEnabled, installedAt: previous?.installedAt ?? now,
/// updatedAt: now, source, activeVersion, lastError: undefined}`。
fn merged_install_state(previous: &Value, now: &str, source_type: &str, version: &str) -> Value {
    let mut record = previous.clone();
    if let Some(object) = record.as_object_mut() {
        let was_enabled = previous.get("enabled").and_then(Value::as_bool).unwrap_or(false);
        object.insert("enabled".to_string(), json!(was_enabled));
        object.insert(
            "installedAt".to_string(),
            previous
                .get("installedAt")
                .cloned()
                .unwrap_or_else(|| json!(now)),
        );
        object.insert("updatedAt".to_string(), json!(now));
        object.insert("source".to_string(), json!(source_type));
        object.insert("activeVersion".to_string(), json!(version));
        object.insert("lastError".to_string(), Value::Null);
    }
    record
}

/// 信任对话框（spawn_blocking 内）：`OkCancelCustom("安装", "取消")`、kind Warning、
/// 标题 `安装 Twilight Echo 插件`、消息 `安装 {name}？`；true = 确认。
async fn confirm_trust(app: &AppHandle, name: &str) -> Result<bool, String> {
    let app = app.clone();
    let message = format!("安装 {name}？");
    let confirmed = tokio::task::spawn_blocking(move || {
        app.dialog()
            .message(message)
            .title("安装 Twilight Echo 插件")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "安装".to_string(),
                "取消".to_string(),
            ))
            .blocking_show()
    })
    .await
    .map_err(|error| format!("信任确认对话框失败：{error}"))?;
    Ok(confirmed)
}

/// 递归复制目录树；跳过位于插件根目录内的源路径（防止把插件目录拷进自身，
/// 镜像 Electron `cp` 的 `!isInsidePath(path, roots.plugins)` 过滤）。
fn copy_tree(source: &Path, target: &Path, plugins_root: &Path) -> Result<(), String> {
    let plugins_root_canonical = plugins_root.canonicalize().ok();
    copy_tree_inner(source, target, plugins_root_canonical.as_deref())
}

fn copy_tree_inner(
    source: &Path,
    target: &Path,
    plugins_root_canonical: Option<&Path>,
) -> Result<(), String> {
    if !source.is_dir() {
        return Err("插件来源不是目录".to_string());
    }
    fs::create_dir_all(target).map_err(|error| format!("创建插件目录失败：{error}"))?;
    let entries = fs::read_dir(source).map_err(|error| format!("读取插件目录失败：{error}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if let Some(plugins_root) = plugins_root_canonical {
            if path
                .canonicalize()
                .ok()
                .is_some_and(|resolved| resolved.starts_with(plugins_root))
            {
                continue;
            }
        }
        let dest = target.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| format!("读取文件类型失败：{error}"))?;
        if file_type.is_dir() {
            copy_tree_inner(&path, &dest, plugins_root_canonical)?;
        } else if file_type.is_file() {
            fs::copy(&path, &dest).map_err(|error| format!("复制文件失败：{error}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merged_install_state_preserves_existing_fields() {
        let previous = json!({
            "enabled": true,
            "installedAt": "2026-01-01T00:00:00Z",
            "source": "tep",
            "activeVersion": "0.1.0",
            "nativeDspParameters": { "gain": 0.5 }
        });
        let merged = merged_install_state(&previous, "2026-08-15T00:00:00Z", "directory", "1.0.0");
        assert_eq!(merged.get("enabled"), Some(&json!(true)));
        assert_eq!(merged.get("installedAt"), Some(&json!("2026-01-01T00:00:00Z")));
        assert_eq!(merged.get("updatedAt"), Some(&json!("2026-08-15T00:00:00Z")));
        assert_eq!(merged.get("source"), Some(&json!("directory")));
        assert_eq!(merged.get("activeVersion"), Some(&json!("1.0.0")));
        assert_eq!(merged.get("lastError"), Some(&Value::Null));
        // 非安装字段保留。
        assert_eq!(merged.get("nativeDspParameters"), Some(&json!({ "gain": 0.5 })));
    }

    #[test]
    fn merged_install_state_defaults_for_fresh_install() {
        let merged = merged_install_state(&json!({}), "2026-08-15T00:00:00Z", "tep", "0.2.0");
        assert_eq!(merged.get("enabled"), Some(&json!(false)));
        assert_eq!(merged.get("installedAt"), Some(&json!("2026-08-15T00:00:00Z")));
        assert_eq!(merged.get("source"), Some(&json!("tep")));
        assert_eq!(merged.get("activeVersion"), Some(&json!("0.2.0")));
        assert_eq!(merged.get("lastError"), Some(&Value::Null));
    }

    #[test]
    fn copy_tree_copies_nested_files() {
        let root = std::env::temp_dir().join("twilight-install-copy-test");
        let _ = fs::remove_dir_all(&root);
        let source = root.join("source");
        let target = root.join("target");
        fs::create_dir_all(source.join("sub")).unwrap();
        fs::write(source.join("plugin.json"), "{}").unwrap();
        fs::write(source.join("sub").join("index.js"), "x").unwrap();

        copy_tree(&source, &target, &root.join("unused-root")).unwrap();
        assert!(target.join("plugin.json").is_file());
        assert!(target.join("sub").join("index.js").is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_tree_skips_plugins_root_nested_in_source() {
        let root = std::env::temp_dir().join("twilight-install-skip-test");
        let _ = fs::remove_dir_all(&root);
        let source = root.join("source");
        let target = root.join("target");
        // 插件根目录嵌套在来源里（模拟把整个应用目录当来源安装）。
        let plugins_root = source.join("plugins");
        fs::create_dir_all(plugins_root.join("x")).unwrap();
        fs::write(plugins_root.join("x").join("y"), "y").unwrap();
        fs::write(source.join("plugin.json"), "{}").unwrap();

        copy_tree(&source, &target, &plugins_root).unwrap();
        assert!(target.join("plugin.json").is_file());
        assert!(
            !target.join("plugins").exists(),
            "插件根目录不应被拷进目标"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_tree_rejects_non_directory_source() {
        let root = std::env::temp_dir().join("twilight-install-notdir-test");
        let _ = fs::remove_dir_all(&root);
        let file = root.join("not-a-dir");
        fs::create_dir_all(&root).unwrap();
        fs::write(&file, "x").unwrap();
        let error = copy_tree(&file, &root.join("target"), &root).unwrap_err();
        assert_eq!(error, "插件来源不是目录");
        let _ = fs::remove_dir_all(&root);
    }
}
