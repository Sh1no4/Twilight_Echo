//! Tauri 插件 / Provider / Extension 能力（Stage 4 只读列表 + Stage 5A 生命周期 + Stage 5B Provider RPC）。
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
//!   以真实 `plugin.json` 存在 **且持久化状态为启用** 为门控；叠加 `provider-health.json`
//!   持久化记录合成 `health`（镜像 Electron `getProviderHealth`）。
//! - `providers_call` / `providers_cancel`：镜像 Electron `providers:call` /
//!   `providers:cancel` 的参数校验（provider id / method 白名单 / args 上限 / options
//!   白名单 / requestId），并保留超时分层与按 requestId 的中止注册表契约面。实际 NCM
//!   调用经 `crate::ncm_gateway`（prototype）：把 Node 网关作为子进程 spawn 后通过本地
//!   HTTP 代理到真实网易云接口；网关不可用 / 调用失败时记录一次健康失败（与 Electron
//!   调用失败即记录一致）。
//! - `extensions_list`：全部来自插件 manifest 的 `contributes` 声明，当前无任何声明，
//!   返回真实空数组。
//!
//! - `plugins_install_from_path` / `plugins_choose_and_install`（Stage 5C）：`.tep`
//!   包或目录来源安装，校验解压、信任确认、落盘到 `{pluginsRoot}/{id}/{version}/`。
//! - `plugins_list_index` / `plugins_refresh_index` / `plugins_get_index_status` /
//!   `plugins_install_from_index`（Stage 5C）：插件市场索引 + 校验下载安装。
//! - `plugins_set_native_dsp_parameters`（Stage 5C）：DSP 插件原生参数持久化。
//! - `extensions_execute_command` / `extensions_read_theme_stylesheet`（Stage 5C）：
//!   Tauri 无扩展宿主，恒定报错以明确能力差异。
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::path_policy;
use crate::plugins_ext;
use crate::plugins_index;
use crate::plugins_install;

/// 内置 NCM Provider 插件 id（与 Electron 侧 `bundledPluginIds` 一致）。
pub const BUNDLED_PLUGIN_ID: &str = "com.twilightecho.provider.ncm";
/// 内置 NCM Provider 激活时注册的 provider id（`index.mjs` 的 `PROVIDER_ID`）。
const BUNDLED_NCM_PROVIDER_ID: &str = "ncm";
/// 当前应用版本（与 `tauri.conf.json` / Electron `appVersion` 对齐）。
pub(crate) const APP_VERSION: &str = "1.0.5";

// ── Provider RPC 契约常量（镜像 `src/main/ipc/plugins.ts`）──────────────────────────

/// Provider id 上限（Electron `MAX_PROVIDER_ID_LENGTH`）。
const MAX_PROVIDER_ID_LENGTH: usize = 128;
/// Provider method 上限（Electron `normalizeProviderMethod` 使用 80）。
const MAX_PROVIDER_METHOD_LENGTH: usize = 80;
/// Provider 调用参数数量上限（Electron `MAX_PROVIDER_ARGS`）。
const MAX_PROVIDER_ARGS: usize = 16;
/// Provider 调用参数序列化后的字节上限（Electron `MAX_PLUGIN_IPC_ARGS_BYTES`）。
const MAX_PROVIDER_ARGS_BYTES: usize = 512 * 1024;
/// Provider idempotency key 上限（Electron `MAX_PROVIDER_IDEMPOTENCY_KEY_LENGTH`）。
const MAX_PROVIDER_IDEMPOTENCY_KEY_LENGTH: usize = 128;
/// Provider request id 上限（Electron `normalizeProviderRequestId` 使用 128）。
const MAX_PROVIDER_REQUEST_ID_LENGTH: usize = 128;

/// Provider 调用超时分层（镜像 `manager.ts` 的 `getProviderCallTimeoutMs`）。
const PLUGIN_PROVIDER_DEFAULT_TIMEOUT_MS: u32 = 15000;
const PLUGIN_PROVIDER_MEDIUM_TIMEOUT_MS: u32 = 30000;
const PLUGIN_PROVIDER_SLOW_TIMEOUT_MS: u32 = 120000;

/// 慢超时层的方法（120s，镜像 Electron SLOW 列表，18 个）。
const PROVIDER_SLOW_TIMEOUT_METHODS: [&str; 18] = [
    "fetchPlaylistTracks",
    "fetchLikedTracks",
    "fetchLikedTracksPage",
    "fetchCloudSongsPage",
    "fetchUserLibrary",
    "fetchRecommendSongs",
    "fetchRecommendPlaylists",
    "fetchPersonalFm",
    "fetchPrivateContent",
    "fetchArtistTopSongs",
    "fetchArtistAlbums",
    "fetchAlbumTracks",
    "fetchArtistPlaylists",
    "fetchUserPlaylistsByUid",
    "fetchUserFollows",
    "fetchUserFolloweds",
    "fetchPlayRecords",
    "fetchRecentSongs",
];

/// 中速超时层的方法（30s，镜像 Electron MEDIUM 列表，8 个）。
const PROVIDER_MEDIUM_TIMEOUT_METHODS: [&str; 8] = [
    "getPlaybackUrl",
    "getLyrics",
    "searchSongs",
    "searchPlaylists",
    "searchArtists",
    "fetchPlaylistCategories",
    "fetchDiscoveryPlaylists",
    "fetchHighQualityPlaylists",
];

/// 全部 Twilight Media Provider 方法（镜像 `providerRouting.ts`
/// `TWILIGHT_MEDIA_PROVIDER_METHODS`，56 个）。
const TWILIGHT_MEDIA_PROVIDER_METHODS: [&str; 56] = [
    "getPlaybackUrl",
    "getLyrics",
    "searchSongs",
    "searchPlaylists",
    "searchArtists",
    "fetchPlaylistTracks",
    "createDownload",
    "getDownloadStatus",
    "getDownloadFile",
    "cancelDownload",
    "checkLogin",
    "getProfile",
    "logout",
    "openOfficialLogin",
    "sendCaptcha",
    "loginByPhonePassword",
    "loginByPhoneCaptcha",
    "loginByEmailPassword",
    "getQrLogin",
    "getQrKey",
    "getQrImage",
    "checkQrLogin",
    "fetchUserLibrary",
    "fetchLikedTracks",
    "fetchLikedTracksPage",
    "fetchCloudSongsPage",
    "prepareCloudUpload",
    "completeCloudUpload",
    "getCloudDownloadUrl",
    "fetchRecommendSongs",
    "fetchRecommendPlaylists",
    "fetchPlaylistCategories",
    "fetchDiscoveryPlaylists",
    "fetchHighQualityPlaylists",
    "fetchPersonalFm",
    "fetchPrivateContent",
    "fetchArtistTopSongs",
    "fetchArtistAlbums",
    "fetchArtistIntro",
    "fetchArtistFollowState",
    "fetchAlbumTracks",
    "fetchArtistPlaylists",
    "fetchUserPlaylistsByUid",
    "fetchUserFollows",
    "fetchUserFolloweds",
    "fetchPlayRecords",
    "fetchRecentSongs",
    "fetchIntelligenceList",
    "followArtist",
    "followUser",
    "likeTrack",
    "isTrackLiked",
    "createPlaylist",
    "deletePlaylist",
    "addTracksToPlaylist",
    "removeTracksFromPlaylist",
];

/// 仅宿主可调用的方法（镜像 Electron `HOST_ONLY_PROVIDER_METHODS`）。
const HOST_ONLY_PROVIDER_METHODS: [&str; 4] = [
    "createDownload",
    "getDownloadStatus",
    "getDownloadFile",
    "cancelDownload",
];

pub(crate) fn plugins_root_path(policy: &path_policy::PathPolicy) -> PathBuf {
    path_policy::categorized_app_path(policy, "plugins", &[], "plugins")
}

pub(crate) fn plugin_data_root_path(policy: &path_policy::PathPolicy) -> PathBuf {
    path_policy::categorized_app_path(policy, "plugin-data", &[], "plugin-data")
}

pub(crate) fn plugin_logs_root_path(policy: &path_policy::PathPolicy) -> PathBuf {
    path_policy::categorized_app_path(policy, "logs", &["plugins"], "logs/plugins")
}

/// 插件状态文件：portable 下位于 `data/plugins/plugin-state.json`，
/// standard/fallback 下位于 `{standardRoot}/plugin-state.json`（与 Electron
/// `stateFile` 一致，分类目录 `plugins` 的 legacy 相对路径为 `plugin-state.json`）。
fn plugin_state_path(policy: &path_policy::PathPolicy) -> PathBuf {
    path_policy::categorized_app_path(
        policy,
        "plugins",
        &["plugin-state.json"],
        "plugin-state.json",
    )
}

pub(crate) fn read_plugin_state(policy: &path_policy::PathPolicy) -> Value {
    fs::read_to_string(plugin_state_path(policy))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| json!({}))
}

/// 写入插件状态；同时写 `.bak` 备份（镜像 Electron `PluginStatePersistence` 的双文件
/// 布局）。与 Electron `queueStateSave` 一致，写失败不使命令失败。
pub(crate) fn write_plugin_state(policy: &path_policy::PathPolicy, state: &Value) {
    let path = plugin_state_path(policy);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let serialized = serde_json::to_vec_pretty(state).expect("serialize plugin state");
    let _ = fs::write(&path, &serialized);
    let backup = path.with_extension("json.bak");
    let _ = fs::write(backup, &serialized);
}

/// Provider 健康记录文件：与 `plugin-state.json` 同目录，portable 下位于
/// `data/plugins/provider-health.json`，standard/fallback 下位于 `{standardRoot}/provider-health.json`。
fn provider_health_path(policy: &path_policy::PathPolicy) -> PathBuf {
    path_policy::categorized_app_path(
        policy,
        "plugins",
        &["provider-health.json"],
        "provider-health.json",
    )
}

fn read_provider_health(policy: &path_policy::PathPolicy) -> Value {
    fs::read_to_string(provider_health_path(policy))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| json!({}))
}

/// 写入 Provider 健康记录；同时写 `.bak` 备份（与 `write_plugin_state` 双文件布局一致）。
fn write_provider_health(policy: &path_policy::PathPolicy, health: &Value) {
    let path = provider_health_path(policy);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let serialized = serde_json::to_vec_pretty(health).expect("serialize provider health");
    let _ = fs::write(&path, &serialized);
    let backup = path.with_extension("json.bak");
    let _ = fs::write(backup, &serialized);
}

/// Provider cookie 记录文件（登录态）：与 `provider-health.json` 同目录双文件布局，
/// portable 下位于 `data/plugins/provider-cookie.json`。
fn provider_cookie_path(policy: &path_policy::PathPolicy) -> PathBuf {
    path_policy::categorized_app_path(
        policy,
        "plugins",
        &["provider-cookie.json"],
        "provider-cookie.json",
    )
}

fn read_provider_cookie(policy: &path_policy::PathPolicy) -> Option<String> {
    fs::read_to_string(provider_cookie_path(policy))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| {
            value
                .get("cookie")
                .and_then(Value::as_str)
                .map(|cookie| cookie.to_string())
        })
}

/// 写入 Provider cookie；同时写 `.bak` 备份（与 `write_provider_health` 双文件布局一致）。
fn write_provider_cookie(policy: &path_policy::PathPolicy, cookie: &str) {
    let value = json!({ "cookie": cookie, "updatedAt": now_iso8601() });
    let path = provider_cookie_path(policy);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let serialized = serde_json::to_vec_pretty(&value).expect("serialize provider cookie");
    let _ = fs::write(&path, &serialized);
    let backup = path.with_extension("json.bak");
    let _ = fs::write(backup, &serialized);
}

/// 当前 UTC 时间，ISO-8601（与 Electron `new Date().toISOString()` 对齐）。
pub(crate) fn now_iso8601() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

// ── Provider RPC 参数归一化（镜像 `src/main/ipc/plugins.ts`）────────────────────────

/// Provider id 首字符与整体长度检查：`[a-z0-9]` 开头，后续 `[a-z0-9._:-]`，
/// 总长 1..=128（镜像 `PROVIDER_ID_PATTERN`）。
fn is_valid_provider_id(id: &str) -> bool {
    let mut chars = id.chars();
    let valid_first = chars
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    valid_first
        && id.len() <= MAX_PROVIDER_ID_LENGTH
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "._:-".contains(c))
}

/// request id / idempotency key 检查：`[A-Za-z0-9]` 开头，后续 `[A-Za-z0-9._:-]`，
/// 总长 1..=128（镜像 `PROVIDER_REQUEST_ID_PATTERN` / `PROVIDER_IDEMPOTENCY_KEY_PATTERN`）。
fn is_valid_provider_request_id(id: &str) -> bool {
    let mut chars = id.chars();
    let valid_first = chars.next().is_some_and(|c| c.is_ascii_alphanumeric());
    valid_first
        && id.len() <= MAX_PROVIDER_REQUEST_ID_LENGTH
        && chars.all(|c| c.is_ascii_alphanumeric() || "._:-".contains(c))
}

/// 归一化 provider id：trim + 小写 + 模式校验（镜像 `normalizeProviderId`）。
fn normalize_provider_id(value: &str) -> Result<String, String> {
    let id = value.trim().to_lowercase();
    if !is_valid_provider_id(&id) {
        return Err("provider id is invalid".to_string());
    }
    Ok(id)
}

/// 归一化 provider method：白名单 + host-only 门控（镜像 `normalizeProviderMethod`）。
fn normalize_provider_method(value: &str) -> Result<String, String> {
    let method = value.trim();
    if method.len() > MAX_PROVIDER_METHOD_LENGTH
        || !TWILIGHT_MEDIA_PROVIDER_METHODS.contains(&method)
    {
        return Err("provider method is invalid".to_string());
    }
    if HOST_ONLY_PROVIDER_METHODS.contains(&method) {
        return Err("provider download methods are host-only".to_string());
    }
    Ok(method.to_string())
}

/// 归一化 request id（镜像 `normalizeProviderRequestId`）。
fn normalize_provider_request_id(value: &str) -> Result<String, String> {
    let request_id = value.trim();
    if !is_valid_provider_request_id(request_id) {
        return Err("provider request id is invalid".to_string());
    }
    Ok(request_id.to_string())
}

/// 归一化 idempotency key（镜像 `normalizeProviderCallOptions` 的 key 分支）。
fn normalize_provider_idempotency_key(value: &str) -> Result<String, String> {
    let key = value.trim();
    if key.len() > MAX_PROVIDER_IDEMPOTENCY_KEY_LENGTH || !is_valid_provider_request_id(key) {
        return Err("provider idempotency key is invalid".to_string());
    }
    Ok(key.to_string())
}

/// 归一化 Provider 调用参数：非数组视为空数组，切片到 `MAX_PROVIDER_ARGS` 项，
/// 并校验序列化字节数（镜像 `normalizePluginIpcArgs` + `stringifyJsonForIpcStorage`）。
fn normalize_provider_args(value: Option<Value>) -> Result<Value, String> {
    let args = match value {
        Some(Value::Array(items)) => {
            Value::Array(items.into_iter().take(MAX_PROVIDER_ARGS).collect())
        }
        _ => Value::Array(vec![]),
    };
    let serialized = serde_json::to_string(&args).expect("serialize provider call args");
    if serialized.len() > MAX_PROVIDER_ARGS_BYTES {
        return Err("provider call args is too large".to_string());
    }
    Ok(args)
}

/// 归一化 Provider 调用 options：仅允许 `idempotencyKey` / `requestId` 两个键
/// （镜像 `normalizeProviderCallOptions`）。返回 `(request_id, idempotency_key)`。
fn normalize_provider_call_options(
    value: Option<Value>,
) -> Result<(Option<String>, Option<String>), String> {
    let Some(value) = value else {
        return Ok((None, None));
    };
    let object = value
        .as_object()
        .ok_or_else(|| "provider call options must be an object".to_string())?;
    for key in object.keys() {
        if key != "idempotencyKey" && key != "requestId" {
            return Err("provider call options contain unsupported fields".to_string());
        }
    }
    let request_id = match object.get("requestId") {
        Some(Value::Null) | None => None,
        Some(value) => {
            Some(normalize_provider_request_id(value.as_str().ok_or_else(
                || "provider request id is invalid".to_string(),
            )?)?)
        }
    };
    let idempotency_key = match object.get("idempotencyKey") {
        None => None,
        Some(value) => Some(normalize_provider_idempotency_key(
            value
                .as_str()
                .ok_or_else(|| "provider idempotency key is invalid".to_string())?,
        )?),
    };
    Ok((request_id, idempotency_key))
}

/// Provider 调用超时分层（镜像 `manager.ts` `getProviderCallTimeoutMs`）。
fn get_provider_call_timeout_ms(method: &str) -> u32 {
    if PROVIDER_SLOW_TIMEOUT_METHODS.contains(&method) {
        return PLUGIN_PROVIDER_SLOW_TIMEOUT_MS;
    }
    if PROVIDER_MEDIUM_TIMEOUT_METHODS.contains(&method) {
        return PLUGIN_PROVIDER_MEDIUM_TIMEOUT_MS;
    }
    PLUGIN_PROVIDER_DEFAULT_TIMEOUT_MS
}

// ── Provider 健康记录（镜像 `manager.ts` 的 health 机械）────────────────────────────

/// 进行中的 Provider 调用注册表（requestId → providerId）。Tauri 下 dispatch 同步
/// 完成，请求注册后随即注销，因此 `providers_cancel` 通常命中不到活动条目；该注册表
/// 保留 cancel 契约面，网关迁移为异步后即可真正中断活动请求。
#[derive(Default)]
pub struct ProviderCallRegistry(pub Mutex<HashMap<String, String>>);

/// 取某个 Provider 的持久化健康记录；无记录时返回默认形状。
fn provider_health_record(health: &Value, provider_id: &str) -> Value {
    health.get(provider_id).cloned().unwrap_or_else(|| {
        json!({
            "providerId": provider_id,
            "pluginId": BUNDLED_PLUGIN_ID,
            "totalCalls": 0,
            "successfulCalls": 0,
            "failedCalls": 0,
            "methodStats": {},
            "lastError": null,
            "lastCheckedAt": null
        })
    })
}

/// 记录一次 Provider 调用结果（镜像 Electron `recordProviderCallSuccess` /
/// `recordProviderCallFailure`）：success 时 `successfulCalls+1`、`lastError=null`，
/// failure 时 `failedCalls+1`、`lastError=message`；两者都刷新 `lastCheckedAt` 并
/// 同步更新 `methodStats` 子记录。
fn record_provider_call(
    policy: &path_policy::PathPolicy,
    provider_id: &str,
    method: &str,
    success: bool,
    error_message: Option<&str>,
) {
    let now = now_iso8601();
    let mut health = read_provider_health(policy);
    let mut record = provider_health_record(&health, provider_id);
    let object = record.as_object_mut().expect("health record is object");
    let total_calls = object
        .get("totalCalls")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let successful_calls = object
        .get("successfulCalls")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let failed_calls = object
        .get("failedCalls")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    object.insert("totalCalls".to_string(), json!(total_calls + 1));
    object.insert(
        "successfulCalls".to_string(),
        json!(if success {
            successful_calls + 1
        } else {
            successful_calls
        }),
    );
    object.insert(
        "failedCalls".to_string(),
        json!(if success {
            failed_calls
        } else {
            failed_calls + 1
        }),
    );
    object.insert(
        "lastError".to_string(),
        if success {
            Value::Null
        } else {
            json!(error_message)
        },
    );
    object.insert("lastCheckedAt".to_string(), json!(now.clone()));

    let mut method_stats = object
        .get("methodStats")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mut method_record = method_stats.get(method).cloned().unwrap_or_else(|| {
        json!({
            "totalCalls": 0,
            "successfulCalls": 0,
            "failedCalls": 0,
            "lastError": null,
            "lastCheckedAt": null
        })
    });
    let method_object = method_record
        .as_object_mut()
        .expect("method stats is object");
    let method_total = method_object
        .get("totalCalls")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let method_successful = method_object
        .get("successfulCalls")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let method_failed = method_object
        .get("failedCalls")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    method_object.insert("totalCalls".to_string(), json!(method_total + 1));
    method_object.insert(
        "successfulCalls".to_string(),
        json!(if success {
            method_successful + 1
        } else {
            method_successful
        }),
    );
    method_object.insert(
        "failedCalls".to_string(),
        json!(if success {
            method_failed
        } else {
            method_failed + 1
        }),
    );
    method_object.insert(
        "lastError".to_string(),
        if success {
            Value::Null
        } else {
            json!(error_message)
        },
    );
    method_object.insert("lastCheckedAt".to_string(), json!(now));
    method_stats.insert(method.to_string(), method_record);
    object.insert("methodStats".to_string(), Value::Object(method_stats));

    if let Some(health_object) = health.as_object_mut() {
        health_object.insert(provider_id.to_string(), record);
    }
    write_provider_health(policy, &health);
}

/// 由持久化健康记录合成 provider 的 `health` descriptor（镜像 Electron
/// `getProviderHealth` + `getProviderMethodStats`）。
fn provider_health_descriptor(record: Option<&Value>, plugin_status: &str) -> Value {
    let record = record.cloned().unwrap_or_else(|| json!({}));
    let total_calls = record
        .get("totalCalls")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let successful_calls = record
        .get("successfulCalls")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let failed_calls = record
        .get("failedCalls")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let last_error = record
        .get("lastError")
        .and_then(Value::as_str)
        .map(String::from);
    let last_checked_at = record
        .get("lastCheckedAt")
        .and_then(Value::as_str)
        .map(String::from);
    let available = plugin_status == "enabled"
        && (last_error.is_none() || failed_calls == 0 || successful_calls > 0);
    let success_rate = if total_calls > 0 {
        successful_calls as f64 / total_calls as f64
    } else {
        1.0
    };

    let mut method_stats = serde_json::Map::new();
    if let Some(stats) = record.get("methodStats").and_then(Value::as_object) {
        for (method, stat) in stats {
            let method_total = stat.get("totalCalls").and_then(Value::as_u64).unwrap_or(0);
            let method_successful = stat
                .get("successfulCalls")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let method_failed = stat.get("failedCalls").and_then(Value::as_u64).unwrap_or(0);
            method_stats.insert(
                method.clone(),
                json!({
                    "totalCalls": method_total,
                    "successfulCalls": method_successful,
                    "failedCalls": method_failed,
                    "successRate": if method_total > 0 {
                        method_successful as f64 / method_total as f64
                    } else {
                        1.0
                    },
                    "lastError": stat.get("lastError").cloned().unwrap_or(Value::Null),
                    "lastCheckedAt": stat.get("lastCheckedAt").cloned().unwrap_or(Value::Null)
                }),
            );
        }
    }

    json!({
        "providerId": record.get("providerId").and_then(Value::as_str).unwrap_or(BUNDLED_NCM_PROVIDER_ID),
        "pluginId": record.get("pluginId").and_then(Value::as_str).unwrap_or(BUNDLED_PLUGIN_ID),
        "pluginStatus": plugin_status,
        "available": available,
        "totalCalls": total_calls,
        "successfulCalls": successful_calls,
        "failedCalls": failed_calls,
        "successRate": success_rate,
        "methodStats": Value::Object(method_stats),
        "lastError": last_error.map(|message| json!(message)).unwrap_or(Value::Null),
        "lastCheckedAt": last_checked_at.map(|stamp| json!(stamp)).unwrap_or(Value::Null)
    })
}

/// 分派 NCM Provider 调用（prototype：Node 网关子进程 + 本地 HTTP 代理）。
///
/// Electron 侧的网易云网关是 Node HTTP 服务（`serveNcmApi`），只能在 Node 环境运行；
/// Tauri 侧离线 crate 不携带 TLS 与 WEAPI 加密能力，无法直连 `music.163.com`。因此这里
/// 经 `crate::ncm_gateway::proxy_json_call` 把请求代理到由本进程 spawn 的本地网关，
/// 拿到真实网易云 JSON。方法→网关路径映射与 `resources/plugins/ncm-provider/index.mjs`
/// 保持一致：`getQrKey` → `/login/qr/key`（零鉴权）；`getQrImage`/`getQrLogin`/`checkQrLogin`
/// 覆盖扫码登录闭环；`checkLogin`/`getProfile`/`logout` 维护登录态；`searchSongs` 在线搜索；
/// `getPlaybackUrl` 按 quality 降级取播放地址。登录后方法把 `provider-cookie.json` 中的
/// cookie 作为 `Cookie` 头传给网关（镜像 provider 的 `requestOptionalAuth`/`requestAuthed`）。
/// 未映射方法返回结构化的"原型未映射"错误，由 `providers_call` 记录一次健康失败。
///
/// Stage 5B 起 `providers_call` 改为经插件宿主 sidecar（`plugin_host`）路由，真实插件
/// 代码（`resources/plugins/ncm-provider/index.mjs`）通过 `internal/ncmRequest` 走同一
/// `ncm_gateway` 代理；本 Rust 写死映射保留为离线/无宿主时的降级路径。
#[allow(dead_code)]
async fn dispatch_ncm_provider_call(
    provider_id: &str,
    method: &str,
    args: &Value,
    idempotency_key: Option<&str>,
    timeout_ms: u32,
    policy: &path_policy::PathPolicy,
) -> Result<Value, String> {
    match method {
        // `"getQrKey" => "/login/qr/key"`：零鉴权，取 `data.unikey` 字符串（镜像
        // index.mjs getQrKey：`data.code === 200 && data.data?.unikey ? ... : null`）。
        "getQrKey" => {
            let path = ncm_path("/login/qr/key", &[]);
            let resp = proxy_ncm(policy, &path, idempotency_key, timeout_ms, false).await?;
            let unikey = resp
                .pointer("/data/unikey")
                .and_then(Value::as_str)
                .map(|key| json!(key));
            Ok(unikey.unwrap_or(Value::Null))
        }
        // 两步扫码：先拿 unikey，再创建二维码（镜像 index.mjs getQrLogin）。
        "getQrLogin" => {
            let key_path = ncm_path("/login/qr/key", &[]);
            let key_resp = proxy_ncm(policy, &key_path, idempotency_key, timeout_ms, false).await?;
            let key = key_resp
                .pointer("/data/unikey")
                .and_then(Value::as_str)
                .ok_or_else(|| "NCM getQrLogin 未取得 unikey".to_string())?;
            let qr_path = ncm_path(
                "/login/qr/create",
                &[
                    ("key", key),
                    ("platform", "web"),
                    ("qrimg", "true"),
                    ("ua", "pc"),
                ],
            );
            let qr_resp = proxy_ncm(policy, &qr_path, idempotency_key, timeout_ms, false).await?;
            Ok(json!({ "key": key, "imageDataUrl": extract_qr_image_data_url(&qr_resp) }))
        }
        // 取二维码图片（镜像 index.mjs getQrImage）。
        "getQrImage" => {
            let key =
                arg_string(args, 0).ok_or_else(|| "NCM getQrImage 缺少参数 key".to_string())?;
            let path = ncm_path(
                "/login/qr/create",
                &[
                    ("key", &key),
                    ("platform", "web"),
                    ("qrimg", "true"),
                    ("ua", "pc"),
                ],
            );
            let resp = proxy_ncm(policy, &path, idempotency_key, timeout_ms, false).await?;
            Ok(extract_qr_image_data_url(&resp))
        }
        // 轮询扫码状态：502 重试一次并追加 noCookie=true；803 确认成功并保存 cookie
        // （镜像 index.mjs checkQrLogin / saveCookie）。
        "checkQrLogin" => {
            let key =
                arg_string(args, 0).ok_or_else(|| "NCM checkQrLogin 缺少参数 key".to_string())?;
            let mut path = ncm_path("/login/qr/check", &[("key", &key), ("ua", "pc")]);
            let mut resp = proxy_ncm(policy, &path, idempotency_key, timeout_ms, false).await?;
            if resp.get("code").and_then(Value::as_i64) == Some(502) {
                path = format!("{path}&noCookie=true");
                resp = proxy_ncm(policy, &path, idempotency_key, timeout_ms, false).await?;
            }
            if resp.get("code").and_then(Value::as_i64) == Some(803) {
                if let Some(cookie) = resp.get("cookie").and_then(Value::as_str) {
                    // 仅当新 cookie 带 `MUSIC_U=`（会话令牌）时才落盘；803 响应若只返回
                    // 局部 set-cookie（如仅 NMTID），不能覆盖已有有效登录态。
                    if cookie.contains("MUSIC_U=") {
                        write_provider_cookie(policy, cookie);
                    }
                }
            }
            Ok(json!({
                "code": resp.get("code").cloned().unwrap_or(Value::Null),
                "message": resp.get("message").cloned().unwrap_or(Value::Null)
            }))
        }
        // 登录态检查（镜像 index.mjs checkLogin）：无 cookie → 未登录；网关失败 → 未登录。
        "checkLogin" => ncm_login_status(policy, idempotency_key, timeout_ms).await,
        // 当前用户资料（镜像 index.mjs getProfile：= checkLogin().profile）。
        "getProfile" => {
            let status = ncm_login_status(policy, idempotency_key, timeout_ms).await?;
            Ok(status.get("profile").cloned().unwrap_or(Value::Null))
        }
        // 退出登录：清除本地 cookie（镜像 index.mjs logout：saveCookie('')）。
        "logout" => {
            write_provider_cookie(policy, "");
            Ok(Value::Null)
        }
        // 在线搜索（镜像 index.mjs searchSongs）：`/cloudsearch`，type=1。
        "searchSongs" => {
            let keywords = arg_string(args, 0)
                .ok_or_else(|| "NCM searchSongs 缺少参数 keywords".to_string())?;
            let limit = arg_u64(args, 1).unwrap_or(30);
            let offset = arg_u64(args, 2).unwrap_or(0);
            let path = ncm_path(
                "/cloudsearch",
                &[
                    ("keywords", &keywords),
                    ("type", "1"),
                    ("limit", &limit.to_string()),
                    ("offset", &offset.to_string()),
                ],
            );
            let resp = proxy_ncm(policy, &path, idempotency_key, timeout_ms, true).await?;
            Ok(ncm_search_result(&resp))
        }
        // 播放地址（镜像 index.mjs getPlaybackUrl）：登录态必需，按 quality 降级取流。
        "getPlaybackUrl" => {
            let song_id = args
                .get(0)
                .and_then(ncm_track_song_id)
                .ok_or_else(|| "NCM getPlaybackUrl 无法解析 track 的 ncmSongId".to_string())?;
            if read_provider_cookie(policy)
                .as_deref()
                .unwrap_or("")
                .is_empty()
            {
                return Err("请先登录网易云音乐".to_string());
            }
            let quality = args
                .get(1)
                .and_then(|options| options.get("quality"))
                .and_then(Value::as_str)
                .unwrap_or("auto");
            match ncm_playback_url(song_id, quality, idempotency_key, timeout_ms, policy).await? {
                Some(url) => Ok(json!(url)),
                None => Ok(Value::Null),
            }
        }
        // 短信验证码（镜像 index.mjs sendCaptcha）：`/captcha/sent`，返回 `{code, message}`。
        // 失败也以 Ok 返回（渲染层按 `code === 200` 判断），与 provider 一致不记健康失败。
        "sendCaptcha" => {
            let phone =
                arg_string(args, 0).ok_or_else(|| "NCM sendCaptcha 缺少参数 phone".to_string())?;
            let countrycode = ncm_country_code(arg_string(args, 1));
            let path = ncm_path(
                "/captcha/sent",
                &[("phone", &phone), ("ctcode", &countrycode)],
            );
            let resp = proxy_ncm(policy, &path, idempotency_key, timeout_ms, false).await?;
            let code = resp.get("code").and_then(Value::as_i64).unwrap_or(-1);
            let message = if code == 200 {
                ncm_fallback_message(&resp, "验证码已发送")
            } else {
                ncm_login_error_message(code, &resp)
            };
            Ok(json!({ "code": code, "message": message }))
        }
        // 手机号 + 验证码登录（镜像 index.mjs loginByPhoneCaptcha + finishAccountLogin）。
        "loginByPhoneCaptcha" => {
            let phone = arg_string(args, 0)
                .ok_or_else(|| "NCM loginByPhoneCaptcha 缺少参数 phone".to_string())?;
            let captcha = arg_string(args, 1)
                .ok_or_else(|| "NCM loginByPhoneCaptcha 缺少参数 captcha".to_string())?;
            let countrycode = ncm_country_code(arg_string(args, 2));
            let path = ncm_path(
                "/login/cellphone",
                &[
                    ("phone", &phone),
                    ("captcha", &captcha),
                    ("countrycode", &countrycode),
                ],
            );
            let resp = proxy_ncm(policy, &path, idempotency_key, timeout_ms, false).await?;
            ncm_account_login_response(policy, resp, idempotency_key, timeout_ms).await
        }
        // 手机号 + 密码登录（镜像 index.mjs loginByPhonePassword + finishAccountLogin）。
        "loginByPhonePassword" => {
            let phone = arg_string(args, 0)
                .ok_or_else(|| "NCM loginByPhonePassword 缺少参数 phone".to_string())?;
            let password = arg_string(args, 1)
                .ok_or_else(|| "NCM loginByPhonePassword 缺少参数 password".to_string())?;
            let countrycode = ncm_country_code(arg_string(args, 2));
            let path = ncm_path(
                "/login/cellphone",
                &[
                    ("phone", &phone),
                    ("password", &password),
                    ("countrycode", &countrycode),
                ],
            );
            let resp = proxy_ncm(policy, &path, idempotency_key, timeout_ms, false).await?;
            ncm_account_login_response(policy, resp, idempotency_key, timeout_ms).await
        }
        // 邮箱 + 密码登录（镜像 index.mjs loginByEmailPassword + finishAccountLogin）。
        "loginByEmailPassword" => {
            let email = arg_string(args, 0)
                .ok_or_else(|| "NCM loginByEmailPassword 缺少参数 email".to_string())?;
            let password = arg_string(args, 1)
                .ok_or_else(|| "NCM loginByEmailPassword 缺少参数 password".to_string())?;
            let path = ncm_path("/login", &[("email", &email), ("password", &password)]);
            let resp = proxy_ncm(policy, &path, idempotency_key, timeout_ms, false).await?;
            ncm_account_login_response(policy, resp, idempotency_key, timeout_ms).await
        }
        // 我的音乐库（镜像 index.mjs fetchUserLibrary）：`/user/playlist?uid=&limit=1000`
        // 取全部歌单，分离"我喜欢的音乐"（specialType=5）与其余歌单，返回
        // `{likedPlaylist, playlists}`；封面统一放大到 `param=600y600`。
        "fetchUserLibrary" => {
            let uid = ncm_current_uid(policy, idempotency_key, timeout_ms).await?;
            let path = ncm_path(
                "/user/playlist",
                &[("uid", &uid.to_string()), ("limit", "1000")],
            );
            let resp = proxy_ncm(policy, &path, idempotency_key, timeout_ms, true).await?;
            let items = ncm_playlist_items(&resp);
            let liked_id = items
                .iter()
                .find(|item| ncm_is_liked_playlist(item))
                .and_then(ncm_value_u64_id);
            let liked_playlist = items
                .iter()
                .find(|item| ncm_is_liked_playlist(item))
                .map(|item| ncm_normalize_playlist(item, uid))
                .unwrap_or(Value::Null);
            let playlists = Value::Array(
                items
                    .iter()
                    .filter(|item| ncm_value_u64_id(item) != liked_id)
                    .map(|item| ncm_normalize_playlist(item, uid))
                    .collect(),
            );
            Ok(json!({ "likedPlaylist": liked_playlist, "playlists": playlists }))
        }
        // 分页取"我喜欢的音乐"（镜像 index.mjs fetchLikedTracksPage）：`/likelist?uid=`
        // 取喜欢歌曲 ID 全量，按 offset/limit 切片后再 `/song/detail` 批量取元数据，
        // 保序返回分页信封（tracks/total/offset/limit/nextOffset/hasMore）。
        "fetchLikedTracksPage" => {
            let offset = arg_u64(args, 0).unwrap_or(0);
            let limit = arg_u64(args, 1).unwrap_or(100).clamp(1, 200);
            let uid = ncm_current_uid(policy, idempotency_key, timeout_ms).await?;
            let path = ncm_path("/likelist", &[("uid", &uid.to_string())]);
            let resp = proxy_ncm(policy, &path, idempotency_key, timeout_ms, true).await?;
            let ids = ncm_likelist_ids(&resp);
            let total = ids.len();
            let page_ids: Vec<u64> = ids
                .iter()
                .skip(offset as usize)
                .take(limit as usize)
                .copied()
                .collect();
            let songs =
                ncm_fetch_song_details(&page_ids, policy, idempotency_key, timeout_ms).await?;
            let track_by_song_id: HashMap<u64, Value> = songs
                .iter()
                .filter_map(|song| ncm_value_u64_id(song).map(|id| (id, ncm_normalize_track(song))))
                .collect();
            let tracks = Value::Array(
                page_ids
                    .iter()
                    .filter_map(|id| track_by_song_id.get(id).cloned())
                    .collect(),
            );
            let next_offset = offset.saturating_add(limit).min(total as u64);
            Ok(json!({
                "tracks": tracks,
                "total": total,
                "offset": offset,
                "limit": limit,
                "nextOffset": next_offset,
                "hasMore": next_offset < total as u64
            }))
        }
        // 歌单全部歌曲（镜像 index.mjs fetchPlaylistTracks）：`/playlist/track/all` 分页
        // 去重取到 MAX_PLAYLIST_TRACKS，空则回退 `/playlist/detail` + `/song/detail`。
        "fetchPlaylistTracks" => {
            let playlist_id = arg_string(args, 0)
                .ok_or_else(|| "NCM fetchPlaylistTracks 缺少参数 playlistId".to_string())?;
            let songs =
                ncm_playlist_tracks(&playlist_id, policy, idempotency_key, timeout_ms).await;
            Ok(Value::Array(
                songs
                    .iter()
                    .take(NCM_MAX_PLAYLIST_TRACKS)
                    .map(ncm_normalize_track)
                    .collect(),
            ))
        }
        // 全部"我喜欢的音乐"（镜像 index.mjs fetchLikedTracks）：优先喜欢歌单 track/all，
        // 否则 `/likelist` ID + `/song/detail` 兜底。
        "fetchLikedTracks" => {
            let uid = ncm_current_uid(policy, idempotency_key, timeout_ms).await?;
            let library_path = ncm_path(
                "/user/playlist",
                &[("uid", &uid.to_string()), ("limit", "1000")],
            );
            let library_resp =
                proxy_ncm(policy, &library_path, idempotency_key, timeout_ms, true).await?;
            if let Some(liked) = ncm_playlist_items(&library_resp)
                .into_iter()
                .find(|item| ncm_is_liked_playlist(item))
            {
                if let Some(liked_id) = ncm_value_u64_id(&liked) {
                    let songs = ncm_playlist_tracks(
                        &liked_id.to_string(),
                        policy,
                        idempotency_key,
                        timeout_ms,
                    )
                    .await;
                    if !songs.is_empty() {
                        return Ok(Value::Array(
                            songs
                                .iter()
                                .take(NCM_MAX_PLAYLIST_TRACKS)
                                .map(ncm_normalize_track)
                                .collect(),
                        ));
                    }
                }
            }
            let likelist_path = ncm_path("/likelist", &[("uid", &uid.to_string())]);
            let likelist_resp =
                proxy_ncm(policy, &likelist_path, idempotency_key, timeout_ms, true).await?;
            let ids = ncm_likelist_ids(&likelist_resp);
            let songs = ncm_fetch_song_details(&ids, policy, idempotency_key, timeout_ms).await?;
            let track_by_song_id: HashMap<u64, Value> = songs
                .iter()
                .filter_map(|song| ncm_value_u64_id(song).map(|id| (id, ncm_normalize_track(song))))
                .collect();
            Ok(Value::Array(
                ids.iter()
                    .filter_map(|id| track_by_song_id.get(id).cloned())
                    .collect(),
            ))
        }
        _ => Err(format!(
            "原型尚未映射 NCM 方法 {method} 到网关路径（{provider_id}）"
        )),
    }
}

/// 百分号编码查询参数值（镜像 `encodeURIComponent`；`url` crate 已在 Cargo.toml）。
fn url_encode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

/// 构造网关路径：追加查询参数（值百分号编码）与 `timestamp`（镜像 Electron
/// `requestNcmApi` 的统一时间戳，与原始原型行为一致）。
fn ncm_path(base_path: &str, params: &[(&str, &str)]) -> String {
    let mut query: Vec<String> = params
        .iter()
        .map(|(key, value)| format!("{key}={}", url_encode(value)))
        .collect();
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    query.push(format!("timestamp={now_ms}"));
    let sep = if base_path.contains('?') { '&' } else { '?' };
    format!("{base_path}{sep}{}", query.join("&"))
}

/// 代理单个网关请求。`authed` 为真时把 `provider-cookie.json` 的 cookie 作为
/// `Cookie` 头传给网关（镜像 provider 的 `requestOptionalAuth`：有登录态才带）。
async fn proxy_ncm(
    policy: &path_policy::PathPolicy,
    path: &str,
    idempotency_key: Option<&str>,
    timeout_ms: u32,
    authed: bool,
) -> Result<Value, String> {
    let mut headers: Vec<(String, String)> = Vec::new();
    if let Some(key) = idempotency_key {
        headers.push(("X-Twilight-Idempotency-Key".to_string(), key.to_string()));
    }
    if authed {
        if let Some(cookie) = read_provider_cookie(policy) {
            if !cookie.is_empty() {
                headers.push(("Cookie".to_string(), cookie));
            }
        }
    }
    crate::ncm_gateway::proxy_json_call(path, headers, Duration::from_millis(timeout_ms as u64))
        .await
}

/// 取参数数组第 `index` 项：字符串原样、数字转字符串，否则 None。
fn arg_string(args: &Value, index: usize) -> Option<String> {
    match args.get(index) {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

/// 取参数数组第 `index` 项为 u64（数字或可解析字符串），否则 None。
fn arg_u64(args: &Value, index: usize) -> Option<u64> {
    match args.get(index) {
        Some(Value::Number(n)) => n.as_u64(),
        Some(Value::String(s)) => s.parse().ok(),
        _ => None,
    }
}

/// 提取二维码图片 data URL（镜像 index.mjs getQrImage：`data.data.qrimg`，
/// 缺 `data:` 前缀时补 `data:image/png;base64,`）。
fn extract_qr_image_data_url(resp: &Value) -> Value {
    let qrimg = resp
        .pointer("/data/qrimg")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if qrimg.is_empty() {
        Value::Null
    } else if qrimg.starts_with("data:") {
        json!(qrimg)
    } else {
        json!(format!("data:image/png;base64,{qrimg}"))
    }
}

/// 登录态检查（镜像 index.mjs checkLogin）：无 cookie 或网关失败 → `{loggedIn:false,
/// profile:null}`；`/login/status` code 200 且有 profile → 归一化后的资料。
async fn ncm_login_status(
    policy: &path_policy::PathPolicy,
    idempotency_key: Option<&str>,
    timeout_ms: u32,
) -> Result<Value, String> {
    if read_provider_cookie(policy)
        .as_deref()
        .unwrap_or("")
        .is_empty()
    {
        return Ok(json!({ "loggedIn": false, "profile": Value::Null }));
    }
    let path = ncm_path("/login/status", &[]);
    match proxy_ncm(policy, &path, idempotency_key, timeout_ms, true).await {
        Ok(resp) => {
            let top_code = resp.get("code").and_then(Value::as_i64).unwrap_or(0);
            let data_code = resp
                .pointer("/data/code")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            match resp.pointer("/data/profile") {
                Some(profile) if profile.is_object() && (top_code == 200 || data_code == 200) => {
                    Ok(json!({
                        "loggedIn": true,
                        "profile": ncm_profile_value(profile)
                    }))
                }
                _ => {
                    // 仅显式无效会话（301）时清空登录态；瞬时未同步 / 风控等失败保留
                    // cookie，避免扫码 803 落盘后立即被 checkLogin 的竞态清空（对应
                    // provider checkLogin 的 catch 分支：网络失败不清 cookie）。
                    if top_code == 301 || data_code == 301 {
                        write_provider_cookie(policy, "");
                    }
                    Ok(json!({ "loggedIn": false, "profile": Value::Null }))
                }
            }
        }
        Err(_) => Ok(json!({ "loggedIn": false, "profile": Value::Null })),
    }
}

/// 归一化网易云用户资料（镜像 index.mjs buildProfile / normalizeRemoteAssetUrl）。
fn ncm_profile_value(profile: &Value) -> Value {
    let avatar_url = profile
        .get("avatarUrl")
        .and_then(Value::as_str)
        .map(|value| {
            if value.starts_with("//") {
                format!("https:{value}")
            } else {
                value.to_string()
            }
        })
        .unwrap_or_default();
    json!({
        "userId": profile.get("userId").cloned().unwrap_or(Value::Null),
        "nickname": profile.get("nickname").cloned().unwrap_or(Value::Null),
        "avatarUrl": if avatar_url.is_empty() { Value::Null } else { json!(avatar_url) },
        "signature": profile.get("signature").cloned().unwrap_or(Value::Null),
        "follows": profile.get("follows").cloned().unwrap_or(Value::Null),
        "followeds": profile.get("followeds").cloned().unwrap_or(Value::Null)
    })
}

/// 归一化国家区号（镜像 index.mjs normalizeCountryCode：仅 `[0-9]{1,6}` 合法，否则 86）。
fn ncm_country_code(value: Option<String>) -> String {
    let value = value.unwrap_or_default().trim().to_string();
    if value.is_empty() || value.len() > 6 || !value.chars().all(|c| c.is_ascii_digit()) {
        "86".to_string()
    } else {
        value
    }
}

/// 从响应提取服务端消息（镜像 index.mjs normalizeApiMessage）。
fn ncm_api_message(resp: &Value) -> String {
    resp.get("message")
        .and_then(Value::as_str)
        .or_else(|| resp.get("msg").and_then(Value::as_str))
        .or_else(|| resp.pointer("/data/message").and_then(Value::as_str))
        .map(|message| message.trim())
        .filter(|message| !message.is_empty())
        .unwrap_or_default()
        .to_string()
}

/// 取服务端消息，空时用 fallback（镜像 normalizeApiMessage 的 fallback 参数）。
fn ncm_fallback_message(resp: &Value, fallback: &str) -> String {
    let message = ncm_api_message(resp);
    if message.is_empty() {
        fallback.to_string()
    } else {
        message
    }
}

/// 登录错误消息（镜像 index.mjs describeApiError 的常用分支）。
fn ncm_login_error_message(code: i64, resp: &Value) -> String {
    match code {
        301 => {
            "网易云登录态无效或接口缓存了未登录结果，请重新登录或等待 2 分钟后重试。".to_string()
        }
        400 => ncm_fallback_message(resp, "网易云登录参数无效，请检查账号、密码或验证码。"),
        502 => "网易云二维码状态检查失败，已尝试无 Cookie 模式，请刷新二维码后重试。".to_string(),
        503 => "网易云登录接口触发高频/风控限制，请等待几分钟后再试。".to_string(),
        460 => "网易云限制了当前网络环境，请切换到国内网络或稍后重试。".to_string(),
        _ => ncm_fallback_message(resp, "NetEase API request failed"),
    }
}

/// 账号登录收尾（镜像 index.mjs finishAccountLogin）：成功响应带 `MUSIC_U=` cookie 时
/// 保存登录态并返回 `checkLogin()` 结果；否则报登录错误。
async fn ncm_account_login_response(
    policy: &path_policy::PathPolicy,
    resp: Value,
    idempotency_key: Option<&str>,
    timeout_ms: u32,
) -> Result<Value, String> {
    let code = resp.get("code").and_then(Value::as_i64).unwrap_or(-1);
    let cookie = resp.get("cookie").and_then(Value::as_str).map(String::from);
    if code == 200
        && cookie
            .as_deref()
            .is_some_and(|cookie| cookie.contains("MUSIC_U="))
    {
        if let Some(cookie) = cookie {
            write_provider_cookie(policy, &cookie);
        }
        ncm_login_status(policy, idempotency_key, timeout_ms).await
    } else {
        Err(ncm_login_error_message(code, &resp))
    }
}

/// 在线搜索结果（镜像 index.mjs searchSongs）：`{ items, total }`。
fn ncm_search_result(resp: &Value) -> Value {
    let result = resp
        .pointer("/result")
        .or_else(|| resp.pointer("/data/result"))
        .cloned()
        .unwrap_or_else(|| json!({}));
    let songs = result
        .get("songs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let total = result
        .get("songCount")
        .and_then(Value::as_u64)
        .map(|count| json!(count))
        .unwrap_or_else(|| json!(songs.len()));
    let items = Value::Array(songs.iter().map(ncm_normalize_track).collect());
    json!({ "items": items, "total": total })
}

/// 归一化单曲（镜像 index.mjs normalizeTrack / formatDuration / getSongAudioMeta /
/// normalizeRemoteAssetUrl）。
fn ncm_normalize_track(song: &Value) -> Value {
    let song_id = song.get("id").and_then(Value::as_u64).unwrap_or(0);
    let title = song.get("name").and_then(Value::as_str).unwrap_or("");
    let artist = song
        .get("ar")
        .and_then(Value::as_array)
        .map(|artists| {
            artists
                .iter()
                .filter_map(|artist| artist.get("name").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join(" / ")
        })
        .unwrap_or_default();
    let album = song
        .pointer("/al/name")
        .and_then(Value::as_str)
        .unwrap_or("");
    let duration =
        song.get("dt")
            .and_then(Value::as_u64)
            .map(|dt| if dt > 1000 { dt / 1000 } else { dt });
    let meta = ncm_song_audio_meta(song);
    json!({
        "id": format!("ncm:{song_id}"),
        "title": title,
        "artist": artist,
        "album": album,
        "filePath": format!("ncm:{song_id}"),
        "fileName": format!("{artist} - {title}"),
        "duration": duration.map(|sec| json!(sec)).unwrap_or(Value::Null),
        "size": meta.get("size").cloned().unwrap_or(Value::Null),
        "cover": song
            .pointer("/al/picUrl")
            .and_then(Value::as_str)
            .map(normalize_remote_asset_url)
            .unwrap_or(Value::Null),
        "lyrics": Value::Null,
        "translatedLyrics": Value::Null,
        "source": "ncm",
        "ncmSongId": song_id,
        "streamUrl": Value::Null,
        "format": meta.get("format").cloned().unwrap_or(Value::Null),
        "sampleRate": meta.get("sampleRate").cloned().unwrap_or(Value::Null),
        "bitrate": meta.get("bitrate").cloned().unwrap_or(Value::Null)
    })
}

/// 镜像 index.mjs normalizeRemoteAssetUrl：`//` 补 `https:`，空串 → null。
fn normalize_remote_asset_url(value: &str) -> Value {
    if value.is_empty() {
        Value::Null
    } else if value.starts_with("//") {
        json!(format!("https:{value}"))
    } else {
        json!(value)
    }
}

/// 镜像 index.mjs getSongAudioMeta：按清晰度候选取第一份含 br/bitrate 的音频元信息。
fn ncm_song_audio_meta(song: &Value) -> Value {
    for key in ["sq", "hr", "h", "m", "l"] {
        if let Some(item) = song.get(key) {
            let has_bitrate = item.get("br").is_some() || item.get("bitrate").is_some();
            if !item.is_null() && has_bitrate {
                return json!({
                    "bitrate": item.get("br").or_else(|| item.get("bitrate"))
                        .and_then(Value::as_u64).unwrap_or(0),
                    "sampleRate": item.get("sr").and_then(Value::as_u64).unwrap_or(0),
                    "size": item.get("size").and_then(Value::as_u64).unwrap_or(0),
                    "format": item.get("type").or_else(|| item.get("encodeType"))
                        .and_then(Value::as_str).unwrap_or("")
                });
            }
        }
    }
    json!({})
}

/// 解析 track 的网易云歌曲 id（镜像 index.mjs getSongIdFromTrack）：
/// 优先 `ncmSongId`，否则取 `id`（去掉 `ncm:` 前缀），需 > 0。
fn ncm_track_song_id(track: &Value) -> Option<u64> {
    if let Some(id) = track.get("ncmSongId").and_then(Value::as_u64) {
        if id > 0 {
            return Some(id);
        }
    }
    match track.get("id") {
        Some(Value::Number(n)) => n.as_u64().filter(|&id| id > 0),
        Some(Value::String(raw)) => {
            let cleaned = raw.strip_prefix("ncm:").unwrap_or(raw);
            cleaned.parse::<u64>().ok().filter(|&id| id > 0)
        }
        _ => None,
    }
}

/// 歌单取歌上限 / track/all 分页大小 / song/detail 分片大小（镜像 index.mjs）。
const NCM_MAX_PLAYLIST_TRACKS: usize = 5000;
const NCM_PLAYLIST_TRACK_PAGE_SIZE: usize = 1000;
const NCM_SONG_DETAIL_CHUNK_SIZE: usize = 100;

/// 取当前登录用户 id（镜像 provider ensureProfile）：未登录 → Err。
async fn ncm_current_uid(
    policy: &path_policy::PathPolicy,
    idempotency_key: Option<&str>,
    timeout_ms: u32,
) -> Result<u64, String> {
    let status = ncm_login_status(policy, idempotency_key, timeout_ms).await?;
    if status.get("loggedIn") != Some(&Value::Bool(true)) {
        return Err("请先登录网易云音乐".to_string());
    }
    status
        .pointer("/profile/userId")
        .and_then(Value::as_u64)
        .filter(|id| *id > 0)
        .ok_or_else(|| "请先登录网易云音乐".to_string())
}

/// 提取歌单数组（镜像 index.mjs getPlaylistItems）。
fn ncm_playlist_items(data: &Value) -> Vec<Value> {
    for path in [
        "/playlist",
        "/playlists",
        "/data/playlist",
        "/data/playlists",
    ] {
        if let Some(Value::Array(items)) = data.pointer(path) {
            return items.clone();
        }
    }
    Vec::new()
}

/// 提取歌曲数组（镜像 index.mjs getSongItems，最后 `/data` 兜底）。
fn ncm_song_items(data: &Value) -> Vec<Value> {
    for path in [
        "/songs",
        "/data/songs",
        "/result/songs",
        "/data/result/songs",
        "/playlist/tracks",
        "/playlist/songs",
        "/data/playlist/tracks",
        "/data/artist/hotSongs",
        "/artist/hotSongs",
        "/hotSongs",
        "/data",
    ] {
        if let Some(Value::Array(items)) = data.pointer(path) {
            return items.clone();
        }
    }
    Vec::new()
}

/// 判断"我喜欢的音乐"歌单（镜像 index.mjs isLikedPlaylistItem）。
fn ncm_is_liked_playlist(item: &Value) -> bool {
    let is_special = item
        .get("specialType")
        .and_then(|value| match value {
            Value::Number(n) => n.as_i64().map(|n| n == 5),
            Value::String(s) => Some(s == "5"),
            _ => None,
        })
        .unwrap_or(false);
    is_special || item.get("name").and_then(Value::as_str) == Some("喜欢的音乐")
}

/// 从对象取正整数 id（镜像 Number(id) 且 >0 的过滤）。
fn ncm_value_u64_id(value: &Value) -> Option<u64> {
    let id = value.get("id")?;
    match id {
        Value::Number(n) => n.as_u64().filter(|&id| id > 0),
        Value::String(s) => s.parse::<u64>().ok().filter(|&id| id > 0),
        _ => None,
    }
}

/// 归一化歌单封面并放大到 `param=600y600`（镜像 normalizePlaylistCoverUrl）。
fn ncm_playlist_cover_value(playlist: &Value) -> Value {
    let raw = playlist
        .get("coverImgUrl")
        .and_then(Value::as_str)
        .or_else(|| playlist.get("picUrl").and_then(Value::as_str))
        .unwrap_or("");
    let normalized = normalize_remote_asset_url(raw);
    let Some(url) = normalized.as_str() else {
        return Value::Null;
    };
    let is_http = url.starts_with("http://") || url.starts_with("https://");
    if !is_http || !url.contains("music.126.net") {
        return json!(url);
    }
    if let Some(start) = url.find("param=") {
        let preceded =
            start > 0 && (url.as_bytes()[start - 1] == b'?' || url.as_bytes()[start - 1] == b'&');
        if preceded {
            let value_start = start + "param=".len();
            let end = url[value_start..]
                .find(|c| c == '&' || c == '#')
                .map(|offset| value_start + offset)
                .unwrap_or(url.len());
            return json!(format!("{}param=600y600{}", &url[..start], &url[end..]));
        }
    }
    let sep = if url.contains('?') { "&" } else { "?" };
    json!(format!("{url}{sep}param=600y600"))
}

/// 归一化歌单摘要（镜像 index.mjs normalizePlaylist；`owned` 仅在能确定
/// 创建者时输出，`creatorName` 仅在存在时输出，与 JS 的 undefined 省略一致）。
fn ncm_normalize_playlist(playlist: &Value, owner_uid: u64) -> Value {
    let mut map = serde_json::Map::new();
    map.insert(
        "id".to_string(),
        playlist.get("id").cloned().unwrap_or(Value::Null),
    );
    map.insert(
        "name".to_string(),
        json!(playlist
            .get("name")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or("未命名歌单")),
    );
    map.insert("cover".to_string(), ncm_playlist_cover_value(playlist));
    map.insert(
        "trackCount".to_string(),
        json!(playlist
            .get("trackCount")
            .and_then(Value::as_u64)
            .unwrap_or(0)),
    );
    let creator_name = playlist
        .pointer("/creator/nickname")
        .and_then(Value::as_str)
        .map(String::from)
        .or_else(|| {
            playlist
                .get("creatorName")
                .and_then(Value::as_str)
                .map(String::from)
        });
    if let Some(name) = creator_name {
        map.insert("creatorName".to_string(), json!(name));
    }
    let creator_id = playlist
        .get("userId")
        .and_then(Value::as_u64)
        .or_else(|| playlist.pointer("/creator/userId").and_then(Value::as_u64));
    if let Some(creator_id) = creator_id {
        map.insert("owned".to_string(), json!(creator_id == owner_uid));
    }
    Value::Object(map)
}

/// 提取喜欢歌曲 ID 列表（镜像 index.mjs getLikelistIds）。
fn ncm_likelist_ids(data: &Value) -> Vec<u64> {
    let raw = if let Some(Value::Array(ids)) = data.get("ids") {
        ids
    } else if let Some(Value::Array(ids)) = data.pointer("/data/ids") {
        ids
    } else {
        return Vec::new();
    };
    raw.iter()
        .filter_map(|item| match item {
            Value::Number(n) => n.as_u64().filter(|&id| id > 0),
            Value::String(s) => s.parse::<u64>().ok().filter(|&id| id > 0),
            _ => None,
        })
        .collect()
}

/// 提取歌单 trackIds（镜像 index.mjs getPlaylistTrackIds）。
fn ncm_playlist_track_ids(data: &Value) -> Vec<u64> {
    let raw = if let Some(Value::Array(items)) = data.pointer("/playlist/trackIds") {
        items
    } else if let Some(Value::Array(items)) = data.pointer("/data/playlist/trackIds") {
        items
    } else {
        return Vec::new();
    };
    raw.iter()
        .filter_map(|item| {
            let id = match item {
                Value::Number(n) => n.as_u64(),
                Value::String(s) => s.parse::<u64>().ok(),
                Value::Object(map) => map.get("id").and_then(|value| match value {
                    Value::Number(n) => n.as_u64(),
                    Value::String(s) => s.parse::<u64>().ok(),
                    _ => None,
                }),
                _ => None,
            };
            id.filter(|&id| id > 0)
        })
        .collect()
}

/// 分片批量取歌曲详情（镜像 index.mjs fetchSongDetailsByIds / fetchSongDetailChunk）；
/// `authed=true` 在有登录 cookie 时附加（对应 requestOptionalAuthRead）。
async fn ncm_fetch_song_details(
    ids: &[u64],
    policy: &path_policy::PathPolicy,
    idempotency_key: Option<&str>,
    timeout_ms: u32,
) -> Result<Vec<Value>, String> {
    let mut songs = Vec::new();
    for chunk in ids.chunks(NCM_SONG_DETAIL_CHUNK_SIZE) {
        if chunk.is_empty() {
            continue;
        }
        let ids_joined = chunk
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let path = ncm_path("/song/detail", &[("ids", &ids_joined)]);
        let resp = proxy_ncm(policy, &path, idempotency_key, timeout_ms, true).await?;
        songs.extend(ncm_song_items(&resp));
    }
    Ok(songs)
}

/// 歌单 detail 兜底（镜像 index.mjs fetchPlaylistTracksViaDetail）：优先 trackIds →
/// song/detail 保序取详情，否则用内联 tracks。失败返回 None。
async fn ncm_playlist_tracks_via_detail(
    playlist_id: &str,
    policy: &path_policy::PathPolicy,
    idempotency_key: Option<&str>,
    timeout_ms: u32,
) -> Option<Vec<Value>> {
    let path = ncm_path("/playlist/detail", &[("id", playlist_id)]);
    let resp = proxy_ncm(policy, &path, idempotency_key, timeout_ms, true)
        .await
        .ok()?;
    let track_ids = ncm_playlist_track_ids(&resp);
    if !track_ids.is_empty() {
        let sliced: Vec<u64> = track_ids
            .into_iter()
            .take(NCM_MAX_PLAYLIST_TRACKS)
            .collect();
        if let Ok(songs) =
            ncm_fetch_song_details(&sliced, policy, idempotency_key, timeout_ms).await
        {
            let by_id: HashMap<u64, Value> = songs
                .iter()
                .filter_map(|song| ncm_value_u64_id(song).map(|id| (id, song.clone())))
                .collect();
            let ordered: Vec<Value> = sliced
                .iter()
                .filter_map(|id| by_id.get(id).cloned())
                .collect();
            if !ordered.is_empty() {
                return Some(ordered);
            }
        }
    }
    let inline = ncm_song_items(&resp);
    if inline.is_empty() {
        None
    } else {
        Some(inline.into_iter().take(NCM_MAX_PLAYLIST_TRACKS).collect())
    }
}

/// 歌单全部歌曲（镜像 index.mjs fetchPlaylistTracks）：track/all 分页去重，
/// 空则回退 playlist/detail。
async fn ncm_playlist_tracks(
    playlist_id: &str,
    policy: &path_policy::PathPolicy,
    idempotency_key: Option<&str>,
    timeout_ms: u32,
) -> Vec<Value> {
    let mut songs = Vec::new();
    let mut seen: HashSet<u64> = HashSet::new();
    let mut offset: usize = 0;
    while songs.len() < NCM_MAX_PLAYLIST_TRACKS {
        let remaining = NCM_MAX_PLAYLIST_TRACKS - songs.len();
        let limit = remaining.min(NCM_PLAYLIST_TRACK_PAGE_SIZE);
        let path = ncm_path(
            "/playlist/track/all",
            &[
                ("id", playlist_id),
                ("limit", &limit.to_string()),
                ("offset", &offset.to_string()),
            ],
        );
        let page = match proxy_ncm(policy, &path, idempotency_key, timeout_ms, true).await {
            Ok(resp) => ncm_song_items(&resp),
            Err(error) => {
                if !songs.is_empty() {
                    eprintln!(
                        "NCM 歌单 track/all 分页中断（已取 {} 首）：{error}",
                        songs.len()
                    );
                }
                break;
            }
        };
        if page.is_empty() {
            break;
        }
        let mut added = 0;
        for song in &page {
            if ncm_value_u64_id(song).is_some_and(|id| !seen.insert(id)) {
                continue;
            }
            songs.push(song.clone());
            added += 1;
            if songs.len() >= NCM_MAX_PLAYLIST_TRACKS {
                break;
            }
        }
        if added == 0 || page.len() < limit {
            break;
        }
        offset += page.len();
    }
    if songs.is_empty() {
        if let Some(fallback) =
            ncm_playlist_tracks_via_detail(playlist_id, policy, idempotency_key, timeout_ms).await
        {
            songs = fallback;
        }
    }
    songs
}

/// 镜像 index.mjs NCM_PLAYBACK_QUALITY_FALLBACKS：偏好质量 → 降级链。
fn ncm_playback_levels(quality: &str) -> &'static [&'static str] {
    match quality {
        "hires" => &["hires", "lossless", "exhigh", "standard"],
        "lossless" => &["lossless", "exhigh", "standard"],
        "exhigh" => &["exhigh", "standard"],
        "standard" => &["standard"],
        _ => &["hires", "lossless", "exhigh", "standard"],
    }
}

/// 播放地址（镜像 index.mjs getPlaybackUrl）：level 路径 → 码率路径 → 反解兜底
/// 依次尝试，返回第一个可用 URL（未登录已由调用方拦截）。
async fn ncm_playback_url(
    song_id: u64,
    quality: &str,
    idempotency_key: Option<&str>,
    timeout_ms: u32,
    policy: &path_policy::PathPolicy,
) -> Result<Option<String>, String> {
    for level in ncm_playback_levels(quality) {
        let path = ncm_path(
            "/song/url/v1",
            &[
                ("id", &song_id.to_string()),
                ("level", level),
                ("encodeType", "flac"),
            ],
        );
        if let Ok(resp) = proxy_ncm(policy, &path, idempotency_key, timeout_ms, true).await {
            if let Some(url) = ncm_official_playback_url(&resp) {
                return Ok(Some(url));
            }
        }
    }
    for br in ["999000", "320000", "128000"] {
        let path = ncm_path("/song/url", &[("id", &song_id.to_string()), ("br", br)]);
        if let Ok(resp) = proxy_ncm(policy, &path, idempotency_key, timeout_ms, true).await {
            if let Some(url) = ncm_official_playback_url(&resp) {
                return Ok(Some(url));
            }
        }
    }
    let match_path = ncm_path("/song/url/match", &[("id", &song_id.to_string())]);
    if let Ok(resp) = proxy_ncm(policy, &match_path, idempotency_key, timeout_ms, true).await {
        if let Some(url) = ncm_unblocked_playback_url(&resp) {
            return Ok(Some(url));
        }
    }
    Ok(None)
}

/// 镜像 index.mjs getPlaybackStreamItems + getOfficialPlaybackUrl +
/// normalizePlaybackStreamUrl：取第一个 code==200 的流 URL。
fn ncm_official_playback_url(data: &Value) -> Option<String> {
    let items: Vec<&Value> = if let Some(array) = data.get("data").and_then(Value::as_array) {
        array.iter().collect()
    } else if let Some(array) = data.get("urls").and_then(Value::as_array) {
        array.iter().collect()
    } else if data.get("url").is_some() {
        vec![data]
    } else {
        Vec::new()
    };
    let top_code = data.get("code").and_then(Value::as_u64);
    for item in items {
        let item_code = item.get("code").and_then(Value::as_u64);
        if let Some(code) = item_code {
            if code != 200 {
                continue;
            }
        }
        if let Some(top) = top_code {
            if top != 200 && item_code.is_none() {
                continue;
            }
        }
        if let Some(url) = item.get("url").and_then(Value::as_str) {
            if let Some(normalized) = normalize_playback_stream_url(url) {
                return Some(normalized);
            }
        }
    }
    None
}

/// 镜像 index.mjs normalizePlaybackStreamUrl：`//` → `https:`，非 http(s) 返回 None。
fn normalize_playback_stream_url(url: &str) -> Option<String> {
    let normalized = if let Some(rest) = url.strip_prefix("//") {
        format!("https:{rest}")
    } else {
        url.to_string()
    };
    if normalized.starts_with("https://") || normalized.starts_with("http://") {
        Some(normalized)
    } else {
        None
    }
}

/// 镜像 index.mjs getUnblockedPlaybackUrl：反解兜底，`data.code === 200` 时取候选字段。
fn ncm_unblocked_playback_url(data: &Value) -> Option<String> {
    if data.get("code").and_then(Value::as_u64) != Some(200) {
        return None;
    }
    let candidates: [Option<&Value>; 6] = [
        data.get("data"),
        data.pointer("/data/url"),
        data.pointer("/body/data"),
        data.pointer("/body/data/url"),
        data.get("proxyUrl"),
        data.pointer("/body/proxyUrl"),
    ];
    for candidate in candidates.into_iter().flatten() {
        if let Some(url) = candidate.as_str() {
            if let Some(normalized) = normalize_playback_stream_url(url) {
                return Some(normalized);
            }
        }
    }
    None
}

/// `providers.call`：校验并分派 Provider 调用。
///
/// 参数校验镜像 Electron `providers:call`（provider id / method 白名单 / args 上限 /
/// options 仅允许 idempotencyKey+requestId / requestId 模式）；Provider 未启用或内置
/// manifest 缺失时返回 `Provider 未启用`（不记录健康）。NCM 调用经 `ncm_gateway`
/// 代理到本地 Node 网关；成功记录健康成功，失败（含网关不可用）记录一次健康失败。
#[tauri::command]
pub async fn providers_call(
    app: AppHandle,
    registry: State<'_, ProviderCallRegistry>,
    provider_id: String,
    method: String,
    args: Option<Value>,
    options: Option<Value>,
) -> Result<Value, String> {
    let provider_id = normalize_provider_id(&provider_id)?;
    let method = normalize_provider_method(&method)?;
    let args = normalize_provider_args(args)?;
    let (request_id, idempotency_key) = normalize_provider_call_options(options)?;
    let timeout_ms = get_provider_call_timeout_ms(&method);

    // 与 `providers_list` 相同的门控：内置插件启用且 manifest 可读，否则 Provider 不可用。
    let policy = path_policy::get_path_policy(&app);
    let state = read_plugin_state(&policy);
    let enabled = state
        .get(BUNDLED_PLUGIN_ID)
        .and_then(|record| record.get("enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    if !enabled {
        return Err(format!("Provider 未启用：{provider_id}"));
    }
    let manifest_ok = bundled_plugin_root(&app)
        .and_then(|bundled_root| read_manifest(&bundled_root).ok())
        .is_some_and(|manifest| {
            manifest.get("id").and_then(Value::as_str) == Some(BUNDLED_PLUGIN_ID)
        });
    if !manifest_ok {
        return Err(format!("Provider 未启用：{provider_id}"));
    }

    // 惰性启动/复用插件宿主：激活成功后宿主会在 `providers/register` 时登记 Provider，
    // 与 Electron `findProviderRoute` 的可用性判定一致。
    let handle = match crate::plugin_host::ensure_host(&app, BUNDLED_PLUGIN_ID).await {
        Ok(handle) => handle,
        Err(error) => {
            record_provider_call(&policy, &provider_id, &method, false, Some(&error));
            return Err(error);
        }
    };

    if let Some(request_id) = &request_id {
        registry
            .0
            .lock()
            .expect("provider call registry lock")
            .insert(request_id.clone(), provider_id.clone());
    }

    let call = json!({
        "kind": "provider-call",
        "requestId": crate::plugin_host::next_request_id(),
        "providerId": provider_id,
        "method": method,
        "args": args,
        "idempotencyKey": idempotency_key,
    });
    let call_request_id = call
        .get("requestId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let result = crate::plugin_host::provider_call(
        &handle,
        &call,
        &call_request_id,
        Some(&registry),
        request_id.as_deref(),
        Duration::from_millis(timeout_ms as u64),
    )
    .await;

    if let Some(request_id) = &request_id {
        registry
            .0
            .lock()
            .expect("provider call registry lock")
            .remove(request_id);
    }

    match result {
        Ok(value) => {
            record_provider_call(&policy, &provider_id, &method, true, None);
            Ok(value)
        }
        Err(error) => {
            // 连接中断（宿主崩溃/退出）：把宿主移出注册表，下一次调用惰性重新 spawn。
            if error.contains("连接中断") || error.contains("已退出") {
                crate::plugin_host::drop_host(&app, BUNDLED_PLUGIN_ID).await;
            }
            record_provider_call(&policy, &provider_id, &method, false, Some(&error));
            Err(error)
        }
    }
}

/// `providers.cancel`：校验 requestId 并从活动调用注册表移除，中止 sidecar RPC。
///
/// Tauri 的 Provider 调用在 `plugin_host::provider_call` 的读循环中检查注册表：
/// 条目被移除后下一次读前即返回「已取消」，从而真正中断在途调用。
#[tauri::command]
pub fn providers_cancel(
    registry: State<'_, ProviderCallRegistry>,
    request_id: String,
) -> Result<(), String> {
    let request_id = normalize_provider_request_id(&request_id)?;
    registry
        .0
        .lock()
        .expect("provider call registry lock")
        .remove(&request_id);
    Ok(())
}

pub(crate) fn read_manifest(root: &Path) -> Result<Value, String> {
    let text = fs::read_to_string(root.join("plugin.json"))
        .map_err(|error| format!("读取 plugin.json 失败：{error}"))?;
    serde_json::from_str(&text).map_err(|error| format!("plugin.json 不是合法 JSON：{error}"))
}

pub(crate) fn parse_version(s: &str) -> Option<(u32, u32, u32)> {
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
pub(crate) fn engine_range_compatible(range: &str) -> bool {
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
pub(crate) fn validate_manifest(manifest: &Value, version_root: &Path) -> Result<(), String> {
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
pub(crate) fn manifest_descriptor(
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
    out.insert(
        "enabled".to_string(),
        json!(effective_enabled && error.is_none()),
    );
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
    match read_manifest(version_root)
        .and_then(|manifest| validate_manifest(&manifest, version_root).map(|()| manifest))
    {
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
pub(crate) fn find_descriptor(
    app: &AppHandle,
    policy: &path_policy::PathPolicy,
    id: &str,
) -> Option<Value> {
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
pub(crate) fn bundled_plugin_root(app: &AppHandle) -> Option<PathBuf> {
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
    let descriptor =
        find_descriptor(app, &policy, id).ok_or_else(|| format!("插件未找到：{id}"))?;
    if descriptor.get("status").and_then(Value::as_str) == Some("invalid") {
        return Err(descriptor
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("插件无效")
            .to_string());
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

/// `plugins.enable`：启用插件并激活宿主（写入持久化状态 + spawn Node sidecar）。
/// 仅有 `main` 入口的 JS 插件会启动宿主；无 `main`（如纯 DSP/声明式插件）只写状态，
/// 与 Electron `enableUnchecked` 的 `if (refreshed.main) startPlugin` 分支一致。
/// 宿主启动/激活失败时，把持久化状态回滚为未启用并抛回错误（与 Electron `enableUnchecked`
/// 的失败标记语义一致）。
#[tauri::command]
pub async fn plugins_enable(app: AppHandle, id: String) -> Result<Value, String> {
    let has_main = {
        let policy = path_policy::get_path_policy(&app);
        find_descriptor(&app, &policy, &id).and_then(|descriptor| {
            descriptor
                .get("main")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
    };
    if has_main.as_deref().is_some_and(|main| !main.is_empty()) {
        crate::plugin_host::ensure_host(&app, &id).await?;
    }
    match set_plugin_enabled(&app, &id, true) {
        Ok(value) => Ok(value),
        Err(error) => {
            // 宿主已启动但状态写入失败：尽力停用宿主，避免残留进程。
            crate::plugin_host::stop_host(&app, &id).await;
            Err(error)
        }
    }
}

/// `plugins.disable`：停用插件（写入持久化状态 + 停止宿主进程）。
#[tauri::command]
pub async fn plugins_disable(app: AppHandle, id: String) -> Result<Value, String> {
    crate::plugin_host::stop_host(&app, &id).await;
    set_plugin_enabled(&app, &id, false)
}

/// `plugins.uninstall`：删除插件目录（可选删除数据目录）并清除状态。
/// 内置插件拒绝卸载（与 Electron `uninstallUnchecked` 一致）。
#[tauri::command]
pub async fn plugins_uninstall(
    app: AppHandle,
    id: String,
    remove_data: Option<bool>,
) -> Result<Value, String> {
    if id == BUNDLED_PLUGIN_ID {
        return Err("自带插件不能卸载；如需关闭，请在插件页停用".to_string());
    }
    // 先停用并终止宿主（吞掉错误，与 Electron `disableUnchecked(id).catch(() => undefined)` 一致）。
    crate::plugin_host::stop_host(&app, &id).await;
    let _ = set_plugin_enabled(&app, &id, false);

    let policy = path_policy::get_path_policy(&app);
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
    let descriptor =
        find_descriptor(&app, &policy, &id).ok_or_else(|| format!("插件未找到：{id}"))?;
    let log_path = descriptor
        .get("paths")
        .and_then(|paths| paths.get("logPath"))
        .and_then(Value::as_str)
        .ok_or_else(|| "插件路径缺失".to_string())?;
    match fs::read_to_string(log_path) {
        Ok(raw) => {
            let start = raw
                .char_indices()
                .nth_back(19999)
                .map(|(i, _)| i)
                .unwrap_or(0);
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
    let descriptor =
        find_descriptor(&app, &policy, &id).ok_or_else(|| format!("插件未找到：{id}"))?;
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

/// `providers.list`：返回内置 NCM Provider 的静态注册，叠加 `provider-health.json`
/// 持久化记录合成 `health`（镜像 Electron `getProviderHealth`），以真实 `plugin.json`
/// 存在 **且持久化状态为启用** 为门控；资源缺失或已停用时返回真实空数组。
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
            let mut provider = bundled_ncm_provider_registration();
            if let Some(object) = provider.as_object_mut() {
                let health = read_provider_health(&policy);
                let record = health.get(BUNDLED_NCM_PROVIDER_ID);
                object.insert(
                    "health".to_string(),
                    provider_health_descriptor(record, "enabled"),
                );
            }
            Value::Array(vec![provider])
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

// ── Stage 5C：安装 / 索引 / 扩展命令薄封装 ──────────────────────────────

/// `plugins.installFromPath`：从目录或 `.tep` 包安装插件。
#[tauri::command]
pub async fn plugins_install_from_path(
    app: AppHandle,
    source_path: String,
) -> Result<Value, String> {
    plugins_install::install_from_path(app, source_path).await
}

/// `plugins.chooseAndInstall`：文件对话框选择 `.tep` 包安装；取消返回 `None`。
#[tauri::command]
pub async fn plugins_choose_and_install(app: AppHandle) -> Result<Option<Value>, String> {
    plugins_install::choose_and_install(app).await
}

/// `plugins.listIndex`：读取插件市场索引并叠加安装状态。
#[tauri::command]
pub fn plugins_list_index(app: AppHandle) -> Result<Vec<Value>, String> {
    plugins_index::list_index(app)
}

/// `plugins.refreshIndex`：经网关拉远端索引，失败回退打包索引。
#[tauri::command]
pub async fn plugins_refresh_index(app: AppHandle) -> Result<Vec<Value>, String> {
    plugins_index::refresh_index(app).await
}

/// `plugins.getIndexStatus`：插件市场索引状态。
#[tauri::command]
pub fn plugins_get_index_status(app: AppHandle) -> Result<Value, String> {
    plugins_index::get_index_status(app)
}

/// `plugins.installFromIndex`：从插件市场下载、校验并安装。
#[tauri::command]
pub async fn plugins_install_from_index(app: AppHandle, id: String) -> Result<Value, String> {
    plugins_index::install_from_index(app, id).await
}

/// `plugins.setNativeDspParameters`：DSP 插件原生参数持久化。
#[tauri::command]
pub fn plugins_set_native_dsp_parameters(
    app: AppHandle,
    id: String,
    parameters: Value,
) -> Result<Value, String> {
    plugins_index::set_native_dsp_parameters(app, id, parameters)
}

/// `extensions.executeCommand`：扩展命令（Tauri 无扩展宿主，恒定报错）。
/// 若插件宿主已激活且注册了对应 UI command，则经宿主转发；否则返回结构化错误。
#[tauri::command]
pub async fn extensions_execute_command(
    app: AppHandle,
    command: String,
    args: Option<Value>,
) -> Result<Value, String> {
    plugins_ext::execute_command(&app, &command, args).await
}

/// `extensions.readThemeStylesheet`：主题 stylesheet（Tauri 无扩展宿主，恒定报错）。
#[tauri::command]
pub async fn extensions_read_theme_stylesheet(
    app: AppHandle,
    stylesheet_path: String,
) -> Result<String, String> {
    plugins_ext::read_theme_stylesheet(&app, &stylesheet_path).await
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

    #[test]
    fn provider_health_roundtrips_with_backup() {
        let root = std::env::temp_dir().join("twilight-provider-health-test-roundtrip");
        let _ = fs::remove_dir_all(&root);
        let policy = standard_policy(&root);
        let health = json!({
            "ncm": {
                "providerId": "ncm",
                "pluginId": BUNDLED_PLUGIN_ID,
                "totalCalls": 1,
                "successfulCalls": 0,
                "failedCalls": 1,
                "methodStats": {},
                "lastError": "boom",
                "lastCheckedAt": "2026-08-15T00:00:00Z"
            }
        });
        write_provider_health(&policy, &health);
        assert_eq!(read_provider_health(&policy), health);
        assert!(
            root.join("provider-health.json.bak").is_file(),
            "应写入 .bak 备份"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn record_provider_call_updates_counters_and_method_stats() {
        let root = std::env::temp_dir().join("twilight-provider-health-test-record");
        let _ = fs::remove_dir_all(&root);
        let policy = standard_policy(&root);

        record_provider_call(&policy, "ncm", "searchSongs", false, Some("网关不可用"));
        record_provider_call(&policy, "ncm", "searchSongs", true, None);

        let health = read_provider_health(&policy);
        let record = provider_health_record(&health, "ncm");
        assert_eq!(record.get("totalCalls").and_then(Value::as_u64), Some(2));
        assert_eq!(
            record.get("successfulCalls").and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(record.get("failedCalls").and_then(Value::as_u64), Some(1));
        assert_eq!(record.get("lastError"), Some(&Value::Null));
        assert!(record
            .get("lastCheckedAt")
            .and_then(Value::as_str)
            .is_some_and(|stamp| stamp.ends_with('Z')));
        let method = &record.get("methodStats").unwrap()["searchSongs"];
        assert_eq!(method.get("totalCalls").and_then(Value::as_u64), Some(2));
        assert_eq!(
            method.get("successfulCalls").and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(method.get("failedCalls").and_then(Value::as_u64), Some(1));

        // 最近一次成功应把 lastError 清空，且 descriptor 仍按成功记录合成。
        let descriptor = provider_health_descriptor(Some(&record), "enabled");
        assert_eq!(
            descriptor.get("pluginStatus").and_then(Value::as_str),
            Some("enabled")
        );
        assert_eq!(
            descriptor.get("available").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            descriptor.get("successRate").and_then(Value::as_f64),
            Some(0.5)
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn provider_health_descriptor_defaults_when_no_record() {
        let descriptor = provider_health_descriptor(None, "enabled");
        assert_eq!(
            descriptor.get("providerId").and_then(Value::as_str),
            Some("ncm")
        );
        assert_eq!(
            descriptor.get("pluginId").and_then(Value::as_str),
            Some(BUNDLED_PLUGIN_ID)
        );
        assert_eq!(
            descriptor.get("totalCalls").and_then(Value::as_u64),
            Some(0)
        );
        assert_eq!(
            descriptor.get("successRate").and_then(Value::as_f64),
            Some(1.0)
        );
        assert_eq!(
            descriptor.get("available").and_then(Value::as_bool),
            Some(true)
        );
        // 无记录时 pluginStatus 仍反映当前启用态。
        let disabled = provider_health_descriptor(None, "disabled");
        assert_eq!(
            disabled.get("available").and_then(Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn provider_arg_normalization_mirrors_electron() {
        assert_eq!(normalize_provider_id("  NCM  ").unwrap(), "ncm");
        assert!(normalize_provider_id("-bad").is_err());
        assert!(normalize_provider_id("").is_err());
        assert_eq!(
            normalize_provider_method("searchSongs").unwrap(),
            "searchSongs"
        );
        assert!(normalize_provider_method("notAMethod").is_err());
        assert!(normalize_provider_method("createDownload").is_err());
        assert_eq!(
            normalize_provider_request_id("abc-123:ok").unwrap(),
            "abc-123:ok"
        );
        assert!(normalize_provider_request_id("").is_err());
        assert_eq!(
            normalize_provider_args(Some(json!([1, 2, 3, 4]))).unwrap(),
            json!([1, 2, 3, 4])
        );
        assert_eq!(
            normalize_provider_args(Some(json!({"a": 1}))).unwrap(),
            json!([])
        );
        assert_eq!(normalize_provider_call_options(None).unwrap(), (None, None));
        assert_eq!(
            normalize_provider_call_options(Some(
                json!({ "requestId": "req-1", "idempotencyKey": "k-1" })
            ))
            .unwrap(),
            (Some("req-1".to_string()), Some("k-1".to_string()))
        );
        assert!(normalize_provider_call_options(Some(json!({ "bogus": 1 }))).is_err());
        assert_eq!(
            get_provider_call_timeout_ms("fetchUserLibrary"),
            PLUGIN_PROVIDER_SLOW_TIMEOUT_MS
        );
        assert_eq!(
            get_provider_call_timeout_ms("getLyrics"),
            PLUGIN_PROVIDER_MEDIUM_TIMEOUT_MS
        );
        assert_eq!(
            get_provider_call_timeout_ms("followArtist"),
            PLUGIN_PROVIDER_DEFAULT_TIMEOUT_MS
        );
    }
}
