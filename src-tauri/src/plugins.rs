//! Tauri 插件 / Provider / Extension 能力（Stage 4 只读列表 + Stage 5A 生命周期）。
//!
//! 架构决策：Rust 原生 descriptor 读取与插件状态管理，不引入 Node sidecar，也不实现
//! Rust 插件宿主（插件不在 Tauri 侧执行）。
//! - `plugins_list`：读取分类插件目录下各 `{id}/{version}/plugin.json` manifest 合成
//!   descriptor，并叠加 `plugin-state.json` 中持久化的启停/来源/时间信息；内置 NCM
//!   插件在 Tauri 下不复制进插件目录，从资源目录读取 manifest 并合成。
//! - `plugins_enable` / `plugins_disable` / `plugins_uninstall`：写入持久化插件状态，
//!   纯文件操作（manifest/state/目录），不启动任何插件进程。
//! - `plugins_get_log` / `plugins_open_log`：读取/打开插件日志（复用 Electron 尾部
//!   20KB 截断与资源管理器定位语义）。
//! - `providers_list`：Tauri 不运行插件，唯一真实 Provider 是内置 NCM 插件启用时静态
//!   注册的 descriptor（`resources/plugins/ncm-provider/index.mjs` `activate()`），
//!   以真实 `plugin.json` 存在 **且持久化状态为启用** 为门控。不返回 health。
//! - `extensions_list`：全部来自插件 manifest 的 `contributes` 声明，当前无任何声明，
//!   返回真实空数组。
//!
//! 仍未实现的操作（.tep 安装、插件市场索引、Provider RPC / extension command）由
//! `tauriHostBridge.ts` 以 `RuntimeCapabilityError` 明确拒绝。
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::path_policy;

/// 内置 NCM Provider 插件 id（与 Electron 侧 `bundledPluginIds` 一致）。
pub const BUNDLED_PLUGIN_ID: &str = "com.twilightecho.provider.ncm";
/// 内置 NCM Provider 激活时注册的 provider id（`index.mjs` 的 `PROVIDER_ID`）。
const BUNDLED_NCM_PROVIDER_ID: &str = "ncm";
/// 当前应用版本（与 `tauri.conf.json` / Electron `appVersion` 对齐）。
const APP_VERSION: &str = "1.0.5";

fn plugins_root_path(policy: &path_policy::PathPolicy) -> PathBuf {
    path_policy::categorized_app_path(policy, "plugins", &[], "plugins")
}

fn plugin_data_root_path(policy: &path_policy::PathPolicy) -> PathBuf {
    path_policy::categorized_app_path(policy, "plugin-data", &[], "plugin-data")
}

fn plugin_logs_root_path(policy: &path_policy::PathPolicy) -> PathBuf {
    path_policy::categorized_app_path(policy, "logs", &["plugins"], "logs/plugins")
}

/// 插件状态文件：portable 下位于 `data/plugins/plugin-state.json`，
/// standard/fallback 下位于 `{standardRoot}/plugin-state.json`（与 Electron
/// `stateFile` 一致，分类目录 `plugins` 的 legacy 相对路径为 `plugin-state.json`）。
fn plugin_state_path(policy: &path_policy::PathPolicy) -> PathBuf {
    path_policy::categorized_app_path(policy, "plugins", &["plugin-state.json"], "plugin-state.json")
}

fn read_plugin_state(policy: &path_policy::PathPolicy) -> Value {
    fs::read_to_string(plugin_state_path(policy))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| json!({}))
}

/// 写入插件状态；同时写 `.bak` 备份（镜像 Electron `PluginStatePersistence` 的双文件
/// 布局）。与 Electron `queueStateSave` 一致，写失败不使命令失败。
fn write_plugin_state(policy: &path_policy::PathPolicy, state: &Value) {
    let path = plugin_state_path(policy);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let serialized = serde_json::to_vec_pretty(state).expect("serialize plugin state");
    let _ = fs::write(&path, &serialized);
    let backup = path.with_extension("json.bak");
    let _ = fs::write(backup, &serialized);
}

/// 当前 UTC 时间，ISO-8601（与 Electron `new Date().toISOString()` 对齐）。
fn now_iso8601() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn read_manifest(root: &Path) -> Result<Value, String> {
    let text = fs::read_to_string(root.join("plugin.json"))
        .map_err(|error| format!("读取 plugin.json 失败：{error}"))?;
    serde_json::from_str(&text).map_err(|error| format!("plugin.json 不是合法 JSON：{error}"))
}

fn parse_version(s: &str) -> Option<(u32, u32, u32)> {
    let mut parts = s.trim().split('.');
    let major: u32 = parts.next()?.trim().parse().ok()?;
    let minor: u32 = parts
        .next()
        .map(|part| part.trim().parse().unwrap_or(0))
        .unwrap_or(0);
    let patch: u32 = parts
        .next()
        .map(|part| part.trim().parse().unwrap_or(0))
        .unwrap_or(0);
    Some((major, minor, patch))
}

/// 极小引擎范围检查：支持 `>=x.y.z` 与裸 `x.y.z`，其余范围一律视为兼容，
/// 避免只读列表误拒绝。与 Electron `isCompatibleTwilightRange` 的常见用例对齐。
fn engine_range_compatible(range: &str) -> bool {
    let spec = range.trim();
    let version = spec.strip_prefix(">=").unwrap_or(spec);
    let Some(required) = parse_version(version) else {
        return true;
    };
    let Some(app) = parse_version(APP_VERSION) else {
        return true;
    };
    app >= required
}

/// 校验 manifest 是否为可展示的插件 descriptor；返回错误文本时表示 `invalid`。
fn validate_manifest(manifest: &Value, version_root: &Path) -> Result<(), String> {
    let object = manifest
        .as_object()
        .ok_or_else(|| "plugin.json 顶层不是对象".to_string())?;
    object
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "插件缺少 id".to_string())?;
    object
        .get("version")
        .and_then(Value::as_str)
        .filter(|version| !version.is_empty())
        .ok_or_else(|| "插件缺少 version".to_string())?;
    object
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "插件缺少 name".to_string())?;
    let type_array = object
        .get("type")
        .and_then(Value::as_array)
        .ok_or_else(|| "插件缺少 type".to_string())?;
    if type_array.is_empty() {
        return Err("插件缺少 type".to_string());
    }
    let engines = object
        .get("engines")
        .and_then(Value::as_object)
        .ok_or_else(|| "插件缺少 engines".to_string())?;
    let range = engines
        .get("twilightEcho")
        .and_then(Value::as_str)
        .ok_or_else(|| "插件缺少 engines.twilightEcho".to_string())?;
    if !engine_range_compatible(range) {
        return Err(format!("插件要求 Twilight Echo {range}"));
    }
    if let Some(main) = object.get("main").and_then(Value::as_str) {
        let main_path = version_root.join(main);
        if !is_file_within(&main_path, version_root) {
            return Err("插件 main 入口不存在或越界".to_string());
        }
    }
    Ok(())
}

fn is_file_within(file_path: &Path, root: &Path) -> bool {
    if !file_path.is_file() {
        return false;
    }
    let Ok(file) = file_path.canonicalize() else {
        return false;
    };
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    file.starts_with(&root)
}

fn paths_json(id: &str, version_root: &Path, data_root: &Path, logs_root: &Path) -> Value {
    let root = version_root
        .parent()
        .map(|parent| parent.to_string_lossy().into_owned())
        .unwrap_or_default();
    json!({
        "root": root,
        "versionRoot": version_root.to_string_lossy(),
        "manifestPath": version_root.join("plugin.json").to_string_lossy(),
        "dataDir": data_root.join(id).to_string_lossy(),
        "logPath": logs_root.join(format!("{id}.log")).to_string_lossy()
    })
}

/// 由合法 manifest 合成 descriptor。`enabled` 为无持久化状态时的默认启用态（仅内置
/// 插件默认启用），`built_in` 标记内置插件；`error` 为 `None` 时状态为 enabled/disabled
/// 或（存在持久化 lastError）failed，为 `Some` 时状态为 invalid。`state_record` 为
/// `plugin-state.json` 中该插件 id 的记录，用于叠加 installedAt/updatedAt/source/
/// enabled/activeVersion/lastError（与 Electron `readDescriptor` 的合并语义一致）。
fn manifest_descriptor(
    manifest: &Value,
    version_root: &Path,
    source: &str,
    enabled: bool,
    built_in: bool,
    error: Option<String>,
    state_record: Option<&Value>,
    data_root: &Path,
    logs_root: &Path,
) -> Value {
    let object = manifest.as_object().cloned().unwrap_or_default();
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or(BUNDLED_PLUGIN_ID)
        .to_string();
    let is_dsp = object
        .get("type")
        .and_then(Value::as_array)
        .map(|types| types.iter().any(|kind| kind.as_str() == Some("dsp")))
        .unwrap_or(false);
    let persisted_enabled = state_record
        .and_then(|record| record.get("enabled"))
        .and_then(Value::as_bool);
    let effective_enabled = persisted_enabled.unwrap_or(enabled);
    let last_error = state_record
        .and_then(|record| record.get("lastError"))
        .and_then(Value::as_str)
        .map(String::from);
    let status = if error.is_some() {
        "invalid"
    } else if last_error.as_deref().is_some_and(|text| !text.is_empty()) {
        "failed"
    } else if effective_enabled {
        "enabled"
    } else {
        "disabled"
    };
    let descriptor_source = state_record
        .and_then(|record| record.get("source"))
        .and_then(Value::as_str)
        .unwrap_or(source)
        .to_string();
    let installed_at = state_record
        .and_then(|record| record.get("installedAt"))
        .cloned()
        .unwrap_or(Value::Null);
    let updated_at = state_record
        .and_then(|record| record.get("updatedAt"))
        .cloned()
        .unwrap_or(Value::Null);
    let error_field = if error.is_some() {
        error.clone()
    } else {
        last_error
    };
    let mut out = serde_json::Map::new();
    // 先整体铺开 manifest（spread 语义），可选字段 main/binary/dependencies/
    // contributes 等仅在存在时出现，与 Electron 侧一致。
    for (key, value) in object {
        out.insert(key, value);
    }
    out.insert("status".to_string(), json!(status));
    out.insert("enabled".to_string(), json!(effective_enabled && error.is_none()));
    out.insert("builtIn".to_string(), json!(built_in));
    out.insert("error".to_string(), json!(error_field));
    out.insert("isDsp".to_string(), json!(is_dsp));
    out.insert("source".to_string(), json!(descriptor_source));
    out.insert("installedAt".to_string(), installed_at);
    out.insert("updatedAt".to_string(), updated_at);
    out.insert(
        "paths".to_string(),
        paths_json(&id, version_root, data_root, logs_root),
    );
    Value::Object(out)
}

/// 目录名推断的无效 descriptor（manifest 缺失或校验失败），与 Electron
/// `readDescriptor` 的 catch 分支形状一致。
fn invalid_descriptor(
    id: &str,
    version: &str,
    version_root: &Path,
    error: String,
    built_in: bool,
    data_root: &Path,
    logs_root: &Path,
) -> Value {
    json!({
        "id": id,
        "name": id,
        "version": version,
        "description": "",
        "author": "",
        "license": "",
        "type": [],
        "engines": { "twilightEcho": "*" },
        "apiVersion": 1,
        "permissions": [],
        "status": "invalid",
        "enabled": false,
        "builtIn": built_in,
        "error": error,
        "isDsp": false,
        "source": "scan",
        "installedAt": null,
        "updatedAt": null,
        "paths": paths_json(id, version_root, data_root, logs_root)
    })
}

/// 单个 `{id}/{version}` 目录的 descriptor：合法 manifest 走 `manifest_descriptor`，
/// 校验失败走 `invalid_descriptor`；`state` 为整个插件状态文件（当前仅取 `id` 记录）。
fn descriptor_for_version_root(
    id: &str,
    version: &str,
    version_root: &Path,
    built_in: bool,
    state: &Value,
    data_root: &Path,
    logs_root: &Path,
) -> Value {
    match read_manifest(version_root).and_then(|manifest| {
        validate_manifest(&manifest, version_root).map(|()| manifest)
    }) {
        Ok(manifest) => manifest_descriptor(
            &manifest,
            version_root,
            "scan",
            built_in,
            built_in,
            None,
            state.get(id),
            data_root,
            logs_root,
        ),
        Err(error) => invalid_descriptor(
            id,
            version,
            version_root,
            error,
            built_in,
            data_root,
            logs_root,
        ),
    }
}

/// 指定插件 id 的 descriptor：先扫插件目录，未命中且为内置插件时回退到资源目录合成。
fn find_descriptor(app: &AppHandle, policy: &path_policy::PathPolicy, id: &str) -> Option<Value> {
    let plugins_root = plugins_root_path(policy);
    let data_root = plugin_data_root_path(policy);
    let logs_root = plugin_logs_root_path(policy);
    let state = read_plugin_state(policy);

    let id_root = plugins_root.join(id);
    if let Ok(version_entries) = fs::read_dir(&id_root) {
        for version_entry in version_entries.flatten() {
            let version_root = version_entry.path();
            if !version_root.is_dir() {
                continue;
            }
            let version = version_root
                .file_name()
                .and_then(|name| name.to_str())
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| "unknown".to_string());
            return Some(descriptor_for_version_root(
                id,
                &version,
                &version_root,
                id == BUNDLED_PLUGIN_ID,
                &state,
                &data_root,
                &logs_root,
            ));
        }
    }

    if id == BUNDLED_PLUGIN_ID {
        if let Some(bundled_root) = bundled_plugin_root(app) {
            if let Ok(manifest) = read_manifest(&bundled_root) {
                if manifest.get("id").and_then(Value::as_str) == Some(BUNDLED_PLUGIN_ID) {
                    return Some(manifest_descriptor(
                        &manifest,
                        &bundled_root,
                        "bundled",
                        true,
                        true,
                        None,
                        state.get(id),
                        &data_root,
                        &logs_root,
                    ));
                }
            }
        }
    }
    None
}

/// 内置 NCM 插件根目录：打包后位于 `{resource_dir}/plugins/ncm-provider`，
/// 开发模式回退到仓库根 `{cwd}/resources/plugins/ncm-provider`。
fn bundled_plugin_root(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("plugins").join("ncm-provider");
        if candidate.join("plugin.json").is_file() {
            return Some(candidate);
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let candidate = cwd.join("resources").join("plugins").join("ncm-provider");
        if candidate.join("plugin.json").is_file() {
            return Some(candidate);
        }
    }
    None
}

/// 内置 NCM Provider 的静态注册 descriptor（镜像 `index.mjs` `activate()`
/// 注册的 provider，仅 manifest 可读时返回）。
fn bundled_ncm_provider_registration() -> Value {
    json!({
        "id": BUNDLED_NCM_PROVIDER_ID,
        "name": "NetEase Cloud Music",
        "capabilities": [
            "search", "playbackUrl", "lyrics", "cover", "playlist", "library", "login"
        ],
        "ui": {
            "icon": "pi pi-cloud",
            "color": "#c20c0c",
            "description": "内置基础音源",
            "authType": "qr",
            "loginInstructions": "请使用网易云音乐 App 扫码登录",
            "qrStatusCodes": { "waiting": 801, "scanned": 802, "expired": 800, "success": 803 },
            "loginExtraActions": [
                { "label": "使用官方网页登录", "icon": "pi pi-external-link", "method": "openOfficialLogin" }
            ],
            "streamingSections": [
                { "id": "daily", "title": "每日推荐", "icon": "pi pi-calendar", "method": "fetchRecommendSongs" },
                { "id": "fm", "title": "私人漫游", "icon": "pi pi-compass", "method": "fetchPersonalFm" },
                { "id": "radar", "title": "私人雷达", "icon": "pi pi-send", "method": "fetchPrivateContent" }
            ],
            "streamingLibraryTab": true,
            "streamingSearch": true
        }
    })
}

/// `plugins.list`：读取分类插件目录下已安装插件 manifest，叠加持久化启停状态，
/// 并合成内置 NCM 插件。
#[tauri::command]
pub fn plugins_list(app: AppHandle) -> Value {
    let policy = path_policy::get_path_policy(&app);
    let plugins_root = plugins_root_path(&policy);
    let data_root = plugin_data_root_path(&policy);
    let logs_root = plugin_logs_root_path(&policy);
    let state = read_plugin_state(&policy);

    let mut descriptors: Vec<Value> = vec![];

    if let Ok(entries) = fs::read_dir(&plugins_root) {
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
            let Ok(version_entries) = fs::read_dir(&id_root) else {
                continue;
            };
            for version_entry in version_entries.flatten() {
                let version_root = version_entry.path();
                if !version_root.is_dir() {
                    continue;
                }
                let version = version_root
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| "unknown".to_string());
                let built_in = id == BUNDLED_PLUGIN_ID;
                descriptors.push(descriptor_for_version_root(
                    &id,
                    &version,
                    &version_root,
                    built_in,
                    &state,
                    &data_root,
                    &logs_root,
                ));
            }
        }
    }

    // 内置 NCM 插件：Tauri 不会把它复制进插件目录，从资源读取合成。
    let bundled_seen = descriptors
        .iter()
        .any(|descriptor| descriptor.get("id").and_then(Value::as_str) == Some(BUNDLED_PLUGIN_ID));
    if !bundled_seen {
        if let Some(bundled_root) = bundled_plugin_root(&app) {
            if let Ok(manifest) = read_manifest(&bundled_root) {
                if manifest.get("id").and_then(Value::as_str) == Some(BUNDLED_PLUGIN_ID) {
                    descriptors.push(manifest_descriptor(
                        &manifest,
                        &bundled_root,
                        "bundled",
                        true,
                        true,
                        None,
                        state.get(BUNDLED_PLUGIN_ID),
                        &data_root,
                        &logs_root,
                    ));
                }
            }
        }
    }

    Value::Array(descriptors)
}

/// 将插件持久化状态切换为 `enabled` 并返回更新后的 descriptor；插件不存在或无效时
/// 返回 Err（与 Electron `enable`/`disable` 抛错语义一致）。状态记录形状与 Electron
/// `setEnabled` 对齐：保留原 installedAt/source，刷新 updatedAt，清除 lastError。
fn set_plugin_enabled(app: &AppHandle, id: &str, enabled: bool) -> Result<Value, String> {
    let policy = path_policy::get_path_policy(app);
    let descriptor = find_descriptor(app, &policy, id)
        .ok_or_else(|| format!("插件未找到：{id}"))?;
    if descriptor.get("status").and_then(Value::as_str) == Some("invalid") {
        return Err(
            descriptor
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("插件无效")
                .to_string(),
        );
    }

    let now = now_iso8601();
    let mut state = read_plugin_state(&policy);
    let previous = state.get(id).cloned().unwrap_or_else(|| json!({}));
    let default_source = if id == BUNDLED_PLUGIN_ID {
        "bundled"
    } else {
        "directory"
    };
    let version = descriptor
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if let Some(object) = state.as_object_mut() {
        object.insert(
            id.to_string(),
            json!({
                "enabled": enabled,
                "installedAt": previous.get("installedAt").cloned().unwrap_or_else(|| json!(now)),
                "updatedAt": json!(now),
                "source": previous.get("source").and_then(Value::as_str).unwrap_or(default_source),
                "activeVersion": previous.get("activeVersion").cloned().unwrap_or_else(|| json!(version)),
                "lastError": Value::Null
            }),
        );
    }
    write_plugin_state(&policy, &state);
    Ok(find_descriptor(app, &policy, id).unwrap_or(descriptor))
}

/// `plugins.enable`：启用插件（写入持久化状态，无进程副作用）。
#[tauri::command]
pub fn plugins_enable(app: AppHandle, id: String) -> Result<Value, String> {
    set_plugin_enabled(&app, &id, true)
}

/// `plugins.disable`：停用插件（写入持久化状态，无进程副作用）。
#[tauri::command]
pub fn plugins_disable(app: AppHandle, id: String) -> Result<Value, String> {
    set_plugin_enabled(&app, &id, false)
}

/// `plugins.uninstall`：删除插件目录（可选删除数据目录）并清除状态。
/// 内置插件拒绝卸载（与 Electron `uninstallUnchecked` 一致）。
#[tauri::command]
pub fn plugins_uninstall(app: AppHandle, id: String, remove_data: Option<bool>) -> Result<Value, String> {
    if id == BUNDLED_PLUGIN_ID {
        return Err("自带插件不能卸载；如需关闭，请在插件页停用".to_string());
    }
    let policy = path_policy::get_path_policy(&app);
    // 先停用（吞掉错误，与 Electron `disableUnchecked(id).catch(() => undefined)` 一致）。
    let _ = set_plugin_enabled(&app, &id, false);

    let plugins_root = plugins_root_path(&policy);
    let id_root = plugins_root.join(&id);
    if id_root.is_dir() {
        let _ = fs::remove_dir_all(&id_root);
    }
    if remove_data.unwrap_or(false) {
        let data_root = plugin_data_root_path(&policy);
        let data_dir = data_root.join(&id);
        if data_dir.is_dir() {
            let _ = fs::remove_dir_all(&data_dir);
        }
    }

    let mut state = read_plugin_state(&policy);
    if let Some(object) = state.as_object_mut() {
        object.remove(&id);
    }
    write_plugin_state(&policy, &state);
    Ok(json!({ "removed": true }))
}

/// `plugins.getLog`：返回插件日志尾部 20KB（与 Electron `raw.slice(-20000)` 对齐）；
/// 日志不存在时返回空串。
#[tauri::command]
pub fn plugins_get_log(app: AppHandle, id: String) -> Result<String, String> {
    let policy = path_policy::get_path_policy(&app);
    let descriptor = find_descriptor(&app, &policy, &id)
        .ok_or_else(|| format!("插件未找到：{id}"))?;
    let log_path = descriptor
        .get("paths")
        .and_then(|paths| paths.get("logPath"))
        .and_then(Value::as_str)
        .ok_or_else(|| "插件路径缺失".to_string())?;
    match fs::read_to_string(log_path) {
        Ok(raw) => {
            let start = raw.char_indices().nth_back(19999).map(|(i, _)| i).unwrap_or(0);
            Ok(raw[start..].to_string())
        }
        Err(_) => Ok(String::new()),
    }
}

/// `plugins.openLog`：确保日志文件存在后在文件管理器中定位（与 Electron
/// `shell.showItemInFolder` 对齐）。
#[tauri::command]
pub fn plugins_open_log(app: AppHandle, id: String) -> Result<(), String> {
    let policy = path_policy::get_path_policy(&app);
    let descriptor = find_descriptor(&app, &policy, &id)
        .ok_or_else(|| format!("插件未找到：{id}"))?;
    let log_path = descriptor
        .get("paths")
        .and_then(|paths| paths.get("logPath"))
        .and_then(Value::as_str)
        .ok_or_else(|| "插件路径缺失".to_string())?;
    let log_path = PathBuf::from(log_path);
    if let Some(parent) = log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if !log_path.is_file() {
        let _ = fs::write(&log_path, "");
    }
    app.opener()
        .reveal_item_in_dir(&log_path)
        .map_err(|error| format!("打开插件日志目录失败：{error}"))
}

/// `providers.list`：返回内置 NCM Provider 的静态注册（无 health），以真实
/// `plugin.json` 存在 **且持久化状态为启用** 为门控；资源缺失或已停用时返回真实空数组。
#[tauri::command]
pub fn providers_list(app: AppHandle) -> Value {
    let policy = path_policy::get_path_policy(&app);
    let state = read_plugin_state(&policy);
    let enabled = state
        .get(BUNDLED_PLUGIN_ID)
        .and_then(|record| record.get("enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    if !enabled {
        return Value::Array(vec![]);
    }
    let Some(bundled_root) = bundled_plugin_root(&app) else {
        return Value::Array(vec![]);
    };
    match read_manifest(&bundled_root) {
        Ok(manifest) if manifest.get("id").and_then(Value::as_str) == Some(BUNDLED_PLUGIN_ID) => {
            Value::Array(vec![bundled_ncm_provider_registration()])
        }
        _ => Value::Array(vec![]),
    }
}

/// `extensions.list`：扩展全部来自插件 manifest 的 `contributes` 声明，
/// 当前没有插件声明任何 contributes，返回真实空数组。
#[tauri::command]
pub fn extensions_list() -> Value {
    Value::Array(vec![])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::path_policy::PathPolicy;
    use std::collections::HashMap;

    /// 构造一个指向 `root` 的 standard 模式路径策略（跳过 AppHandle 依赖）。
    fn standard_policy(root: &Path) -> PathPolicy {
        let mut categories = HashMap::new();
        for category in crate::path_policy::DATA_ROOT_CATEGORIES {
            categories.insert(category, root.join(category).to_string_lossy().into_owned());
        }
        PathPolicy {
            mode: "standard",
            portable_requested: false,
            detection_source: "none",
            data_root: root.to_string_lossy().into_owned(),
            standard_root: root.to_string_lossy().into_owned(),
            categories,
            writable: true,
            writable_categories: HashMap::new(),
            fallback_reason: None,
        }
    }

    #[test]
    fn now_iso8601_is_rfc3339_utc() {
        let stamp = now_iso8601();
        assert!(stamp.starts_with('2'), "年份应为 20xx：{stamp}");
        assert!(stamp.ends_with('Z'), "UTC 应为 Z 结尾：{stamp}");
        assert!(stamp.len() >= 20, "最短 ISO-8601 为 20 字符：{stamp}");
    }

    #[test]
    fn plugin_state_path_follows_standard_layout() {
        let root = std::env::temp_dir().join("twilight-plugin-state-test-standard");
        let policy = standard_policy(&root);
        assert_eq!(plugin_state_path(&policy), root.join("plugin-state.json"));
    }

    #[test]
    fn plugin_state_roundtrips_with_backup() {
        let root = std::env::temp_dir().join("twilight-plugin-state-test-roundtrip");
        let _ = fs::remove_dir_all(&root);
        let policy = standard_policy(&root);
        let state = json!({
            "com.twilightecho.provider.ncm": {
                "enabled": true,
                "installedAt": "2026-08-15T00:00:00Z",
                "updatedAt": "2026-08-15T00:00:00Z",
                "source": "bundled"
            }
        });
        write_plugin_state(&policy, &state);
        assert_eq!(read_plugin_state(&policy), state);
        assert!(
            root.join("plugin-state.json.bak").is_file(),
            "应写入 .bak 备份"
        );
        let _ = fs::remove_dir_all(&root);
    }
}
