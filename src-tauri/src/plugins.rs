//! Tauri 插件 / Provider / Extension 只读列表（Stage 4）。
//!
//! 架构决策：Rust 原生 descriptor 读取，不引入 Node sidecar，也不实现 Rust 插件宿主。
//! - `plugins_list`：读取分类插件目录下各 `{id}/{version}/plugin.json` manifest 合成
//!   descriptor；内置 NCM 插件在 Tauri 只读模式下不复制进插件目录，从资源目录读取
//!   manifest 并合成（manifest 为真实文件读取，非硬编码空数组）。
//! - `providers_list`：Tauri 不运行插件，唯一真实 Provider 是内置 NCM 插件激活时静态
//!   注册的 descriptor（`resources/plugins/ncm-provider/index.mjs` `activate()`），
//!   将其作为已知静态注册表，但以真实 `plugin.json` 存在为门控。不返回 health。
//! - `extensions_list`：全部来自插件 manifest 的 `contributes` 声明，当前无任何声明，
//!   返回真实空数组。
//!
//! 写操作（安装/启停/卸载/Provider call/extension command）不在本阶段实现，仍由
//! `tauriHostBridge.ts` 以 `RuntimeCapabilityError` 明确拒绝。
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

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

/// 由合法 manifest 合成 descriptor。`enabled` 表示已启用态（仅内置插件默认启用），
/// `built_in` 标记内置插件；`error` 为 `None` 时状态为 enabled/disabled，为 `Some` 时
/// 状态为 invalid。
fn manifest_descriptor(
    manifest: &Value,
    version_root: &Path,
    source: &str,
    enabled: bool,
    built_in: bool,
    error: Option<String>,
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
    let mut out = serde_json::Map::new();
    // 先整体铺开 manifest（spread 语义），可选字段 main/binary/dependencies/
    // contributes 等仅在存在时出现，与 Electron 侧一致。
    for (key, value) in object {
        out.insert(key, value);
    }
    out.insert(
        "status".to_string(),
        json!(if error.is_some() {
            "invalid"
        } else if enabled {
            "enabled"
        } else {
            "disabled"
        }),
    );
    out.insert("enabled".to_string(), json!(enabled && error.is_none()));
    out.insert("builtIn".to_string(), json!(built_in));
    out.insert("error".to_string(), json!(error));
    out.insert("isDsp".to_string(), json!(is_dsp));
    out.insert("source".to_string(), json!(source));
    out.insert("installedAt".to_string(), Value::Null);
    out.insert("updatedAt".to_string(), Value::Null);
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

/// `plugins.list`：读取分类插件目录下已安装插件 manifest，并合成内置 NCM 插件。
#[tauri::command]
pub fn plugins_list(app: AppHandle) -> Value {
    let policy = path_policy::get_path_policy(&app);
    let plugins_root = plugins_root_path(&policy);
    let data_root = plugin_data_root_path(&policy);
    let logs_root = plugin_logs_root_path(&policy);

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
                match read_manifest(&version_root).and_then(|manifest| {
                    validate_manifest(&manifest, &version_root).map(|()| manifest)
                }) {
                    Ok(manifest) => {
                        // 无 state 文件：非内置插件保持默认禁用态，内置插件默认启用。
                        descriptors.push(manifest_descriptor(
                            &manifest,
                            &version_root,
                            "scan",
                            built_in,
                            built_in,
                            None,
                            &data_root,
                            &logs_root,
                        ));
                    }
                    Err(error) => {
                        descriptors.push(invalid_descriptor(
                            &id,
                            &version,
                            &version_root,
                            error,
                            built_in,
                            &data_root,
                            &logs_root,
                        ));
                    }
                }
            }
        }
    }

    // 内置 NCM 插件：Tauri 只读模式不会把它复制进插件目录，从资源读取合成。
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
                        &data_root,
                        &logs_root,
                    ));
                }
            }
        }
    }

    Value::Array(descriptors)
}

/// `providers.list`：返回内置 NCM Provider 的静态注册（无 health），
/// 以真实 `plugin.json` 存在为门控；资源缺失时返回真实空数组。
#[tauri::command]
pub fn providers_list(app: AppHandle) -> Value {
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
