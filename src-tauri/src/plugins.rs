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
use std::collections::HashMap;
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
    path_policy::categorized_app_path(policy, "plugins", &["plugin-state.json"], "plugin-state.json")
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
    if method.len() > MAX_PROVIDER_METHOD_LENGTH || !TWILIGHT_MEDIA_PROVIDER_METHODS.contains(&method) {
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
    if key.len() > MAX_PROVIDER_IDEMPOTENCY_KEY_LENGTH
        || !is_valid_provider_request_id(key)
    {
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
        Some(value) => Some(normalize_provider_request_id(
            value
                .as_str()
                .ok_or_else(|| "provider request id is invalid".to_string())?,
        )?),
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
    let total_calls = object.get("totalCalls").and_then(Value::as_u64).unwrap_or(0);
    let successful_calls = object
        .get("successfulCalls")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let failed_calls = object.get("failedCalls").and_then(Value::as_u64).unwrap_or(0);
    object.insert("totalCalls".to_string(), json!(total_calls + 1));
    object.insert(
        "successfulCalls".to_string(),
        json!(if success { successful_calls + 1 } else { successful_calls }),
    );
    object.insert(
        "failedCalls".to_string(),
        json!(if success { failed_calls } else { failed_calls + 1 }),
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
        json!(if success { method_failed } else { method_failed + 1 }),
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
    let total_calls = record.get("totalCalls").and_then(Value::as_u64).unwrap_or(0);
    let successful_calls = record
        .get("successfulCalls")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let failed_calls = record.get("failedCalls").and_then(Value::as_u64).unwrap_or(0);
    let last_error = record.get("lastError").and_then(Value::as_str).map(String::from);
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
            let method_total = stat
                .get("totalCalls")
                .and_then(Value::as_u64)
                .unwrap_or(0);
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
/// 拿到真实网易云 JSON。目前只映射零鉴权方法 `getQrKey`（→ `/login/qr/key`）验证链路；
/// 其余方法返回结构化的"原型未映射"错误，由 `providers_call` 记录一次健康失败。
async fn dispatch_ncm_provider_call(
    provider_id: &str,
    method: &str,
    _args: &Value,
    idempotency_key: Option<&str>,
    timeout_ms: u32,
) -> Result<Value, String> {
    let base_path = match method {
        "getQrKey" => "/login/qr/key".to_string(),
        _ => {
            return Err(format!(
                "原型尚未映射 NCM 方法 {method} 到网关路径（{provider_id}）"
            ))
        }
    };
    let sep = if base_path.contains('?') { '&' } else { '?' };
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = format!("{base_path}{sep}timestamp={now_ms}");
    let mut headers: Vec<(String, String)> = Vec::new();
    if let Some(key) = idempotency_key {
        headers.push(("X-Twilight-Idempotency-Key".to_string(), key.to_string()));
    }
    crate::ncm_gateway::proxy_json_call(&path, headers, Duration::from_millis(timeout_ms as u64)).await
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

    if let Some(request_id) = &request_id {
        registry
            .0
            .lock()
            .expect("provider call registry lock")
            .insert(request_id.clone(), provider_id.clone());
    }
    let result = dispatch_ncm_provider_call(
        &provider_id,
        &method,
        &args,
        idempotency_key.as_deref(),
        timeout_ms,
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
            record_provider_call(&policy, &provider_id, &method, false, Some(&error));
            Err(error)
        }
    }
}

/// `providers.cancel`：校验 requestId 并中止活动调用。
///
/// Tauri 下调用同步完成、注册表在请求结束时即清空，因此通常命中不到活动条目；该命令
/// 保证 requestId 校验与注册表契约面存在，网关迁移为异步后即可真正中断活动请求。
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
pub(crate) fn find_descriptor(app: &AppHandle, policy: &path_policy::PathPolicy, id: &str) -> Option<Value> {
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
pub async fn plugins_install_from_path(app: AppHandle, source_path: String) -> Result<Value, String> {
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
pub fn plugins_set_native_dsp_parameters(app: AppHandle, id: String, parameters: Value) -> Result<Value, String> {
    plugins_index::set_native_dsp_parameters(app, id, parameters)
}

/// `extensions.executeCommand`：扩展命令（Tauri 无扩展宿主，恒定报错）。
#[tauri::command]
pub fn extensions_execute_command(command: String, args: Option<Value>) -> Result<Value, String> {
    plugins_ext::execute_command(command, args)
}

/// `extensions.readThemeStylesheet`：主题 stylesheet（Tauri 无扩展宿主，恒定报错）。
#[tauri::command]
pub fn extensions_read_theme_stylesheet(stylesheet_path: String) -> Result<String, String> {
    plugins_ext::read_theme_stylesheet(stylesheet_path)
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
        assert!(
            record
                .get("lastCheckedAt")
                .and_then(Value::as_str)
                .is_some_and(|stamp| stamp.ends_with('Z'))
        );
        let method = &record.get("methodStats").unwrap()["searchSongs"];
        assert_eq!(method.get("totalCalls").and_then(Value::as_u64), Some(2));
        assert_eq!(method.get("successfulCalls").and_then(Value::as_u64), Some(1));
        assert_eq!(method.get("failedCalls").and_then(Value::as_u64), Some(1));

        // 最近一次成功应把 lastError 清空，且 descriptor 仍按成功记录合成。
        let descriptor = provider_health_descriptor(Some(&record), "enabled");
        assert_eq!(descriptor.get("pluginStatus").and_then(Value::as_str), Some("enabled"));
        assert_eq!(descriptor.get("available").and_then(Value::as_bool), Some(true));
        assert_eq!(descriptor.get("successRate").and_then(Value::as_f64), Some(0.5));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn provider_health_descriptor_defaults_when_no_record() {
        let descriptor = provider_health_descriptor(None, "enabled");
        assert_eq!(descriptor.get("providerId").and_then(Value::as_str), Some("ncm"));
        assert_eq!(descriptor.get("pluginId").and_then(Value::as_str), Some(BUNDLED_PLUGIN_ID));
        assert_eq!(descriptor.get("totalCalls").and_then(Value::as_u64), Some(0));
        assert_eq!(descriptor.get("successRate").and_then(Value::as_f64), Some(1.0));
        assert_eq!(descriptor.get("available").and_then(Value::as_bool), Some(true));
        // 无记录时 pluginStatus 仍反映当前启用态。
        let disabled = provider_health_descriptor(None, "disabled");
        assert_eq!(disabled.get("available").and_then(Value::as_bool), Some(false));
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
        assert_eq!(normalize_provider_request_id("abc-123:ok").unwrap(), "abc-123:ok");
        assert!(normalize_provider_request_id("").is_err());
        assert_eq!(
            normalize_provider_args(Some(json!([1, 2, 3, 4]))).unwrap(),
            json!([1, 2, 3, 4])
        );
        assert_eq!(normalize_provider_args(Some(json!({"a": 1}))).unwrap(), json!([]));
        assert_eq!(normalize_provider_call_options(None).unwrap(), (None, None));
        assert_eq!(
            normalize_provider_call_options(Some(json!({ "requestId": "req-1", "idempotencyKey": "k-1" })))
                .unwrap(),
            (Some("req-1".to_string()), Some("k-1".to_string()))
        );
        assert!(normalize_provider_call_options(Some(json!({ "bogus": 1 }))).is_err());
        assert_eq!(get_provider_call_timeout_ms("fetchUserLibrary"), PLUGIN_PROVIDER_SLOW_TIMEOUT_MS);
        assert_eq!(get_provider_call_timeout_ms("getLyrics"), PLUGIN_PROVIDER_MEDIUM_TIMEOUT_MS);
        assert_eq!(get_provider_call_timeout_ms("followArtist"), PLUGIN_PROVIDER_DEFAULT_TIMEOUT_MS);
    }
}
