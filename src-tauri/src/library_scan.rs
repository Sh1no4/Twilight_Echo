
use crate::local_fs::{fnv1a, is_audio_path};
use crate::path_policy;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration as StdDuration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::Picture;
use lofty::tag::Accessor;

const UNKNOWN_ALBUM: &str = "未知专辑";
const UNKNOWN_ARTIST: &str = "未知艺术家";
const MAX_EMBEDDED_COVER_BYTES: usize = 8 * 1024 * 1024;

// ── 基础工具 ─────────────────────────────────────────────────────────────────────

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn new_job_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("scan-{}-{}", now_ms(), n)
}

fn normalize(value: &str) -> String {
    value
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase()
}

fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

fn file_identity(path: &Path) -> (u64, u64, String) {
    let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let mtime_ms = fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let format = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    (size, mtime_ms, format)
}

fn name_from_file(path: &Path) -> (String, String) {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    if let Some(dash) = stem.find(" - ") {
        let artist = stem[..dash].trim().to_string();
        let title = stem[dash + 3..].trim().to_string();
        (artist, title)
    } else {
        (UNKNOWN_ARTIST.to_string(), stem)
    }
}

fn mime_for_path(file_path: &str) -> String {
    let ext = Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "wav" | "wave" => "audio/wav",
        "aac" => "audio/aac",
        "ogg" | "opus" => "audio/ogg",
        "wma" => "audio/x-ms-wma",
        "m4a" | "mp4" | "alac" => "audio/mp4",
        "aiff" | "aif" => "audio/aiff",
        "webm" => "audio/webm",
        "ape" => "audio/ape",
        "wv" => "audio/wavpack",
        "dsf" => "audio/x-dsf",
        "dff" => "audio/x-dff",
        _ => "application/octet-stream",
    }
    .to_string()
}

// ── 音乐库文档读写（与 lib.rs 的 data_load/save_music_library 同路径）──────────────

pub(crate) fn music_library_path(app: &AppHandle) -> PathBuf {
    let policy = path_policy::get_path_policy(app);
    path_policy::categorized_data_path(&policy, "database", &["music-library.json"])
}

pub(crate) fn load_music_library(app: &AppHandle) -> Value {
    fs::read_to_string(music_library_path(app))
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_else(|| {
            json!({ "version": 2, "revision": 0, "tracks": [], "folders": [], "exclusions": [] })
        })
}

pub(crate) fn save_music_library(app: &AppHandle, doc: &Value) -> Result<(), String> {
    let path = music_library_path(app);
    let serialized = serde_json::to_vec_pretty(doc).map_err(|e| format!("序列化失败：{e}"))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    fs::write(&path, serialized).map_err(|e| format!("写入失败：{e}"))
}

fn load_settings(app: &AppHandle) -> Value {
    let policy = path_policy::get_path_policy(app);
    let path = path_policy::categorized_data_path(&policy, "config", &["settings.json"]);
    fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_else(|| json!({}))
}

// ── 授权范围（与 Electron `src/main/security/localPaths.ts` 语义对齐）───────────────

pub(crate) fn authorized_audio_roots(app: &AppHandle) -> Vec<PathBuf> {
    let settings = load_settings(app);
    let library = load_music_library(app);
    let mut roots: Vec<PathBuf> = Vec::new();
    for array in [
        settings.get("libraryFolders").and_then(Value::as_array),
        library.get("folders").and_then(Value::as_array),
    ]
    .into_iter()
    .flatten()
    {
        for folder in array.iter().filter_map(Value::as_str) {
            if !folder.trim().is_empty() {
                roots.push(PathBuf::from(folder));
            }
        }
    }
    for key in ["musicCachePath", "cachePath"] {
        if let Some(folder) = settings.get(key).and_then(Value::as_str) {
            if !folder.trim().is_empty() {
                roots.push(PathBuf::from(folder));
            }
        }
    }
    roots
}

pub(crate) fn is_authorized_audio_file(app: &AppHandle, file_path: &str) -> Result<bool, String> {
    let path = PathBuf::from(file_path);
    if !path.is_file() || !is_audio_path(&path) {
        return Ok(false);
    }
    let canonical = fs::canonicalize(&path).map_err(|e| format!("解析文件路径失败：{e}"))?;
    for root in authorized_audio_roots(app) {
        if let Ok(canonical_root) = fs::canonicalize(&root) {
            if canonical.starts_with(&canonical_root) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

// ── 嵌入封面磁盘缓存 ──────────────────────────────────────────────────────────────

fn cover_cache_dir(app: &AppHandle) -> PathBuf {
    let policy = path_policy::get_path_policy(app);
    path_policy::categorized_data_path(&policy, "cache", &["cover-cache"])
}

fn cache_root_dir(app: &AppHandle) -> PathBuf {
    let policy = path_policy::get_path_policy(app);
    path_policy::categorized_data_path(&policy, "cache", &[])
}

fn ensure_cover_cache_dir(app: &AppHandle) -> PathBuf {
    let dir = cover_cache_dir(app);
    let _ = fs::create_dir_all(&dir);
    dir
}

fn cache_picture(app: &AppHandle, pic: &Picture) -> Option<String> {
    let data = pic.data();
    if data.is_empty() || data.len() > MAX_EMBEDDED_COVER_BYTES {
        return None;
    }
    let ext = pic.mime_type().and_then(|m| m.ext()).unwrap_or("jpg");
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(data);
    let digest = hasher.finalize();
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&digest[..8]);
    let name = format!("{:016x}.{}", u64::from_le_bytes(bytes), ext);
    let path = ensure_cover_cache_dir(app).join(&name);
    if !path.exists() && fs::write(&path, data).is_err() {
        return None;
    }
    Some(format!("cover://{name}"))
}

#[tauri::command]
pub fn data_get_cover(app: AppHandle, handle: String) -> Result<Option<String>, String> {
    let subdir = if handle.starts_with("cover://") {
        Some("cover-cache")
    } else if handle.starts_with("background://") {
        Some("")
    } else {
        None
    };
    let Some(subdir) = subdir else {
        return Ok(None);
    };
    let file_name = handle
        .split_once("://")
        .map(|(_, name)| name)
        .unwrap_or("")
        .trim_start_matches('/');
    if file_name.is_empty() || file_name.contains(['/', '\\']) {
        return Ok(None);
    }
    let path = if subdir.is_empty() {
        cache_root_dir(&app).join(file_name)
    } else {
        cover_cache_dir(&app).join(file_name)
    };
    let Ok(bytes) = fs::read(&path) else {
        return Ok(None);
    };
    let ext = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg")
        .to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "image/jpeg",
    };
    Ok(Some(format!(
        "data:{mime};base64,{}",
        base64_encode(&bytes)
    )))
}

// ── 曲目解析与 JSON 构建 ──────────────────────────────────────────────────────────

fn first_tag_string(
    tag: Option<&lofty::tag::Tag>,
    accessor: impl Fn(&lofty::tag::Tag) -> Option<std::borrow::Cow<'_, str>>,
) -> Option<String> {
    tag.and_then(accessor)
        .map(|cow| cow.into_owned())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[allow(clippy::too_many_arguments)]
fn build_track(
    file_path: &str,
    size: u64,
    mtime_ms: u64,
    title: String,
    artist: String,
    album: String,
    genre: Option<String>,
    album_artist: Option<String>,
    track_number: Option<u32>,
    disc_number: Option<u32>,
    duration: f64,
    format: String,
    sample_rate: Option<u32>,
    bitrate: Option<u32>,
    bit_depth: Option<u32>,
    cover: Option<String>,
    added_at: u64,
) -> Value {
    let path = Path::new(file_path);
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let dir = path
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let id = format!("local-{:x}", fnv1a(file_path.as_bytes()));
    let mut track = json!({
        "id": id,
        "title": title,
        "artist": artist,
        "album": album,
        "filePath": file_path,
        "fileName": file_name,
        "dir": dir,
        "duration": duration.round() as u64,
        "size": size,
        "cover": cover,
        "lyrics": Value::Null,
        "format": format,
        "addedAt": added_at,
        "mtimeMs": mtime_ms
    });
    if let Some(value) = genre {
        track["genre"] = json!(value);
    }
    if let Some(value) = album_artist {
        track["albumArtist"] = json!(value);
    }
    if let Some(value) = track_number {
        track["trackNumber"] = json!(value);
    }
    if let Some(value) = disc_number {
        track["discNumber"] = json!(value);
    }
    if let Some(value) = sample_rate {
        track["sampleRate"] = json!(value);
    }
    if let Some(value) = bitrate {
        track["bitrate"] = json!(value);
    }
    if let Some(value) = bit_depth {
        track["bitDepth"] = json!(value);
    }
    track
}

fn parse_track(
    app: Option<&AppHandle>,
    path: &Path,
    size: u64,
    mtime_ms: u64,
    added_at: u64,
) -> Value {
    let file_path = path.to_string_lossy().into_owned();
    let format = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let (file_artist, file_title) = name_from_file(path);
    let fallback = || {
        build_track(
            &file_path,
            size,
            mtime_ms,
            file_title.clone(),
            file_artist.clone(),
            UNKNOWN_ALBUM.to_string(),
            None,
            None,
            None,
            None,
            0.0,
            format.clone(),
            None,
            None,
            None,
            None,
            added_at,
        )
    };

    let tagged = match lofty::read_from_path(path) {
        Ok(tagged) => tagged,
        Err(_) => return fallback(),
    };

    let properties = tagged.properties();
    let duration = properties.duration().as_secs_f64();
    let sample_rate = properties.sample_rate();
    let bitrate = properties.overall_bitrate();
    let bit_depth = properties.bit_depth().map(u32::from);

    let tag = tagged.primary_tag();
    let artist = first_tag_string(tag, |t| Accessor::artist(t))
        .or_else(|| {
            tag.and_then(|t| t.get_string(&lofty::tag::ItemKey::AlbumArtist))
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| file_artist.clone());
    let album_artist = tag
        .and_then(|t| t.get_string(&lofty::tag::ItemKey::AlbumArtist))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let title = first_tag_string(tag, |t| Accessor::title(t)).unwrap_or_else(|| file_title.clone());
    let album =
        first_tag_string(tag, |t| Accessor::album(t)).unwrap_or_else(|| UNKNOWN_ALBUM.to_string());
    let genre = first_tag_string(tag, |t| Accessor::genre(t));
    let track_number = tag.and_then(|t| Accessor::track(t));
    let disc_number = tag.and_then(|t| Accessor::disk(t));

    let cover = app.and_then(|app| {
        tag.and_then(|t| t.pictures().first())
            .and_then(|pic| cache_picture(app, pic))
    });

    build_track(
        &file_path,
        size,
        mtime_ms,
        title,
        artist,
        album,
        genre,
        album_artist,
        track_number,
        disc_number,
        duration,
        format,
        sample_rate,
        bitrate,
        bit_depth,
        cover,
        added_at,
    )
}

pub(crate) fn scan_folder_tracks(folder_path: &str) -> Result<Value, String> {
    let root = PathBuf::from(folder_path);
    if !root.is_dir() {
        return Err(format!("目录不存在：{folder_path}"));
    }
    let now = now_ms();
    let mut tracks: Vec<Value> = Vec::new();
    let mut queue: Vec<PathBuf> = vec![root];
    while let Some(dir) = queue.pop() {
        let entries = fs::read_dir(&dir).map_err(|e| format!("读取目录失败：{e}"))?;
        for entry in entries.flatten() {
            let path = entry.path();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir {
                queue.push(path);
            } else if is_audio_path(&path) {
                let (size, mtime_ms, _) = file_identity(&path);
                tracks.push(parse_track(None, &path, size, mtime_ms, now));
            }
        }
    }
    tracks.sort_by(|a, b| {
        a.get("filePath")
            .and_then(Value::as_str)
            .cmp(&b.get("filePath").and_then(Value::as_str))
    });
    Ok(Value::Array(tracks))
}

// ── 扫描状态机（后台线程 + 命令共享）──────────────────────────────────────────────

pub struct LibraryScanManager {
    pub inner: Arc<Mutex<ScanControl>>,
}

#[derive(Default)]
pub struct ScanControl {
    pub active: bool,
    pub cancel: bool,
    pub pause: bool,
    pub status: Value,
}

impl Default for LibraryScanManager {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(ScanControl {
                active: false,
                cancel: false,
                pause: false,
                status: idle_status(),
            })),
        }
    }
}

impl LibraryScanManager {
    pub fn grant_runtime_paths(app: &AppHandle) {
        #[cfg(debug_assertions)]
        {
            use tauri::Manager;
            let scope = app.asset_protocol_scope();
            if let Ok(dir) = app.path().app_data_dir() {
                let _ = scope.allow_directory(&dir, true);
            }
        }
        let _ = app;
    }
}

fn idle_status() -> Value {
    json!({
        "jobId": Value::Null,
        "mode": Value::Null,
        "state": "idle",
        "current": 0,
        "total": 0,
        "parsedFileCount": 0,
        "skippedUnchanged": 0,
        "error": ""
    })
}

fn running_status(job_id: &str, mode: &str) -> Value {
    json!({
        "jobId": job_id,
        "mode": mode,
        "state": "running",
        "current": 0,
        "total": 0,
        "parsedFileCount": 0,
        "skippedUnchanged": 0,
        "error": ""
    })
}

fn snapshot_status(inner: &Arc<Mutex<ScanControl>>) -> Value {
    inner.lock().unwrap().status.clone()
}

fn current_job_id(inner: &Arc<Mutex<ScanControl>>) -> String {
    inner
        .lock()
        .unwrap()
        .status
        .get("jobId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn cancelled(inner: &Arc<Mutex<ScanControl>>) -> bool {
    inner.lock().unwrap().cancel
}

fn wait_if_paused(inner: &Arc<Mutex<ScanControl>>) {
    loop {
        let paused = inner.lock().unwrap().pause;
        if !paused {
            return;
        }
        std::thread::sleep(StdDuration::from_millis(80));
    }
}

fn emit_progress(
    app: &AppHandle,
    inner: &Arc<Mutex<ScanControl>>,
    mode: &str,
    phase: &str,
    current: u64,
    total: u64,
    parsed: u64,
    skipped: u64,
) {
    let job_id = current_job_id(inner);
    {
        let mut guard = inner.lock().unwrap();
        guard.status = json!({
            "jobId": job_id,
            "mode": mode,
            "state": "running",
            "current": current,
            "total": total,
            "parsedFileCount": parsed,
            "skippedUnchanged": skipped,
            "error": ""
        });
    }
    if current % 20 == 0 || current == total {
        let _ = app.emit(
            "library:scan-progress",
            json!({
                "jobId": job_id,
                "mode": mode,
                "phase": phase,
                "current": current,
                "total": total,
                "parsedFileCount": parsed,
                "skippedUnchanged": skipped
            }),
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn finish_scan(
    app: &AppHandle,
    inner: &Arc<Mutex<ScanControl>>,
    mode: &str,
    revision: u64,
    next_tracks: Vec<Value>,
    folders: Vec<Value>,
    exclusions: Vec<Value>,
    added: Vec<Value>,
    updated: Vec<Value>,
    removed: Vec<String>,
    parsed_count: u64,
    skipped: u64,
    cancelled: bool,
) -> Result<Value, String> {
    let job_id = current_job_id(inner);
    let state = if cancelled { "cancelled" } else { "completed" };
    let changed = !cancelled && (!added.is_empty() || !updated.is_empty() || !removed.is_empty());
    let next_revision = if changed { revision + 1 } else { revision };

    if changed {
        let doc = json!({
            "version": 2,
            "revision": next_revision,
            "tracks": next_tracks,
            "folders": folders,
            "exclusions": exclusions
        });
        save_music_library(app, &doc)?;
    }

    let update = json!({
        "jobId": job_id,
        "mode": mode,
        "state": state,
        "libraryRevision": next_revision,
        "exclusions": exclusions,
        "addedTracks": added,
        "updatedTracks": updated,
        "removedFilePaths": removed,
        "parsedFileCount": parsed_count,
        "skippedUnchanged": skipped
    });

    if changed {
        let _ = app.emit(
            "library:changed",
            json!({ "kind": "scan", "update": update }),
        );
        // 只有用户显式完整重扫（mode == "full"）且存在缺封面曲目时才提醒，避免每次启动都打扰。
        let dirty_count = next_tracks
            .iter()
            .filter(|t| {
                t.get("cover")
                    .and_then(Value::as_str)
                    .is_none_or(|c| c.is_empty())
            })
            .count() as u64;
        if mode == "full" && dirty_count > 0 {
            let _ = app.emit(
                "library:covers-missing",
                json!({ "dirtyCount": dirty_count }),
            );
        }
    }

    {
        let mut guard = inner.lock().unwrap();
        guard.status = json!({
            "jobId": job_id,
            "mode": mode,
            "state": state,
            "current": 0,
            "total": 0,
            "parsedFileCount": parsed_count,
            "skippedUnchanged": skipped,
            "error": ""
        });
        guard.active = false;
    }
    let _ = app.emit("library:scan-status", snapshot_status(inner));
    Ok(update)
}

fn run_library_scan(
    app: &AppHandle,
    inner: &Arc<Mutex<ScanControl>>,
    mode: &str,
) -> Result<Value, String> {
    let settings = load_settings(app);
    let existing = load_music_library(app);
    let existing_tracks = existing
        .get("tracks")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let exclusions = existing
        .get("exclusions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let revision = existing
        .get("revision")
        .and_then(Value::as_u64)
        .unwrap_or(0);

    // 收集并去重授权根目录（canonicalize 后比较）。
    let mut roots: Vec<PathBuf> = Vec::new();
    for array in [
        settings.get("libraryFolders").and_then(Value::as_array),
        existing.get("folders").and_then(Value::as_array),
    ]
    .into_iter()
    .flatten()
    {
        for folder in array.iter().filter_map(Value::as_str) {
            if !folder.trim().is_empty() {
                roots.push(PathBuf::from(folder));
            }
        }
    }
    let mut seen_roots: HashSet<PathBuf> = HashSet::new();
    let mut canonical_roots: Vec<PathBuf> = Vec::new();
    for root in roots {
        if let Ok(canonical) = fs::canonicalize(&root) {
            if seen_roots.insert(canonical.clone()) {
                canonical_roots.push(canonical);
            }
        }
    }
    canonical_roots.sort();

    let mut folders = Vec::new();
    let mut scanned: HashSet<String> = HashSet::new();
    let mut added: Vec<Value> = Vec::new();
    let mut updated: Vec<Value> = Vec::new();
    let mut removed: Vec<String> = Vec::new();
    let mut next_tracks: Vec<Value> = Vec::new();
    let mut parsed_count: u64 = 0;
    let mut skipped: u64 = 0;

    let excluded_paths: HashSet<String> = exclusions
        .iter()
        .filter_map(|e| e.get("filePath").and_then(Value::as_str))
        .map(normalize)
        .collect();

    // 1) 递归枚举音频文件（后台线程，不阻塞 command 主线程）。
    let mut audio_files: Vec<PathBuf> = Vec::new();
    let mut queue: Vec<PathBuf> = canonical_roots.clone();
    while let Some(dir) = queue.pop() {
        if cancelled(inner) {
            return finish_scan(
                app,
                inner,
                mode,
                revision,
                next_tracks,
                folders,
                exclusions,
                added,
                updated,
                removed,
                parsed_count,
                skipped,
                true,
            );
        }
        wait_if_paused(inner);
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                if !excluded_paths.contains(&normalize(&path.to_string_lossy())) {
                    queue.push(path);
                }
            } else if file_type.is_file() && is_audio_path(&path) {
                if excluded_paths.contains(&normalize(&path.to_string_lossy())) {
                    continue;
                }
                audio_files.push(path);
            }
        }
        emit_progress(
            app,
            inner,
            mode,
            "enumerating",
            audio_files.len() as u64,
            0,
            parsed_count,
            skipped,
        );
    }
    audio_files.sort();
    let total = audio_files.len() as u64;
    emit_progress(app, inner, mode, "parsing", 0, total, 0, 0);

    // 2) 逐文件解析元数据，与已持久化曲目做增量比对。
    let mut existing_by_path: HashMap<String, Value> = HashMap::new();
    for track in &existing_tracks {
        if let Some(file_path) = track.get("filePath").and_then(Value::as_str) {
            existing_by_path.insert(normalize(file_path), track.clone());
        }
    }

    let now = now_ms();
    for (index, path) in audio_files.iter().enumerate() {
        if cancelled(inner) {
            return finish_scan(
                app,
                inner,
                mode,
                revision,
                next_tracks,
                folders,
                exclusions,
                added,
                updated,
                removed,
                parsed_count,
                skipped,
                true,
            );
        }
        wait_if_paused(inner);
        let file_path = path.to_string_lossy().into_owned();
        let norm = normalize(&file_path);
        let (size, mtime_ms, _) = file_identity(path);
        scanned.insert(norm.clone());

        let unchanged = existing_by_path.get(&norm).is_some_and(|track| {
            track.get("size").and_then(Value::as_u64) == Some(size)
                && track.get("mtimeMs").and_then(Value::as_u64) == Some(mtime_ms)
        });

        if unchanged {
            skipped += 1;
            if let Some(existing_track) = existing_by_path.get(&norm) {
                next_tracks.push(existing_track.clone());
            }
        } else {
            parsed_count += 1;
            let added_at = existing_by_path
                .get(&norm)
                .and_then(|t| t.get("addedAt"))
                .and_then(Value::as_u64)
                .unwrap_or(now);
            let track = parse_track(Some(app), path, size, mtime_ms, added_at);
            if existing_by_path.contains_key(&norm) {
                updated.push(track.clone());
            } else {
                added.push(track.clone());
            }
            next_tracks.push(track);
        }
        emit_progress(
            app,
            inner,
            mode,
            "parsing",
            (index + 1) as u64,
            total,
            parsed_count,
            skipped,
        );
    }

    // 3) 删除检测：已持久化但本次未扫描到的文件路径。
    for track in &existing_tracks {
        if let Some(file_path) = track.get("filePath").and_then(Value::as_str) {
            if !scanned.contains(&normalize(file_path)) {
                removed.push(file_path.to_string());
            }
        }
    }

    for root in canonical_roots {
        folders.push(json!(root.to_string_lossy().into_owned()));
    }

    finish_scan(
        app,
        inner,
        mode,
        revision,
        next_tracks,
        folders,
        exclusions,
        added,
        updated,
        removed,
        parsed_count,
        skipped,
        false,
    )
}

async fn start_or_await_scan(
    app: &AppHandle,
    inner: &Arc<Mutex<ScanControl>>,
    mode: String,
) -> Result<Value, String> {
    {
        let mut guard = inner.lock().unwrap();
        if guard.active {
            return Err("已有音乐库扫描正在进行中".to_string());
        }
        guard.active = true;
        guard.cancel = false;
        guard.pause = false;
        guard.status = running_status(&new_job_id(), &mode);
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let app2 = app.clone();
    let inner2 = inner.clone();
    std::thread::spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_library_scan(&app2, &inner2, &mode)
        }))
        .unwrap_or_else(|_| Err("音乐库扫描内部错误".to_string()));
        let _ = tx.send(result);
    });
    rx.await.map_err(|_| "音乐库扫描进程意外结束".to_string())?
}

#[tauri::command]
pub async fn library_scan_startup(
    app: AppHandle,
    manager: State<'_, LibraryScanManager>,
) -> Result<Value, String> {
    let inner = manager.inner.clone();
    start_or_await_scan(&app, &inner, "startup".to_string()).await
}

#[tauri::command]
pub async fn library_scan_full(
    app: AppHandle,
    manager: State<'_, LibraryScanManager>,
) -> Result<Value, String> {
    let inner = manager.inner.clone();
    start_or_await_scan(&app, &inner, "full".to_string()).await
}

#[tauri::command]
pub fn library_get_scan_status(manager: State<'_, LibraryScanManager>) -> Value {
    snapshot_status(&manager.inner)
}

#[tauri::command]
pub fn library_pause_scan(manager: State<'_, LibraryScanManager>) -> bool {
    let mut guard = manager.inner.lock().unwrap();
    if !guard.active || guard.pause {
        return false;
    }
    guard.pause = true;
    guard.status["state"] = json!("paused");
    true
}

#[tauri::command]
pub fn library_resume_scan(manager: State<'_, LibraryScanManager>) -> bool {
    let mut guard = manager.inner.lock().unwrap();
    if !guard.active || !guard.pause {
        return false;
    }
    guard.pause = false;
    guard.status["state"] = json!("running");
    true
}

#[tauri::command]
pub fn library_cancel_scan(manager: State<'_, LibraryScanManager>) -> bool {
    let mut guard = manager.inner.lock().unwrap();
    if !guard.active {
        return false;
    }
    guard.cancel = true;
    true
}

// ── 曲库变更操作（remove / restore / reset）───────────────────────────────────────

fn move_to_quarantine(app: &AppHandle, file_path: &str) -> Result<(), String> {
    if !is_authorized_audio_file(app, file_path)? {
        return Err("文件未授权，无法移入回收区".to_string());
    }
    let policy = path_policy::get_path_policy(app);
    let dir = path_policy::categorized_data_path(&policy, "database", &[".trash"]);
    fs::create_dir_all(&dir).map_err(|e| format!("创建回收目录失败：{e}"))?;
    let name = Path::new(file_path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "untitled".to_string());
    let destination = dir.join(format!("{}-{}", now_ms(), name));
    fs::rename(file_path, &destination).map_err(|e| format!("移动文件到回收区失败：{e}"))
}

#[tauri::command]
pub fn library_remove_tracks(app: AppHandle, request: Value) -> Result<Value, String> {
    let mode = request
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("library")
        .to_string();
    let items = request
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let requested_revision = request
        .get("library")
        .and_then(|l| l.get("revision"))
        .and_then(Value::as_u64);

    let mut doc = load_music_library(&app);
    let persisted_revision = doc.get("revision").and_then(Value::as_u64).unwrap_or(0);
    if let Some(expected) = requested_revision {
        if expected != persisted_revision {
            return Err("音乐库修订号冲突，请刷新后重试".to_string());
        }
    }

    let item_paths: HashSet<String> = items
        .iter()
        .filter_map(|item| item.get("filePath").and_then(Value::as_str))
        .map(normalize)
        .collect();
    let mut present_paths: HashSet<String> = HashSet::new();
    let mut removed_track_ids: Vec<String> = Vec::new();
    let mut removed_file_paths: Vec<String> = Vec::new();

    let tracks = doc
        .get_mut("tracks")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "音乐库文档格式无效".to_string())?;
    let mut keep: Vec<Value> = Vec::with_capacity(tracks.len());
    for track in tracks.drain(..) {
        let file_path = track.get("filePath").and_then(Value::as_str);
        let matched = file_path.is_some_and(|p| item_paths.contains(&normalize(p)));
        if matched {
            if let Some(p) = file_path {
                present_paths.insert(normalize(p));
                removed_file_paths.push(p.to_string());
            }
            if let Some(id) = track.get("id").and_then(Value::as_str) {
                removed_track_ids.push(id.to_string());
            }
        } else {
            keep.push(track);
        }
    }
    *tracks = keep;

    let mut failures: Vec<Value> = Vec::new();
    for item in &items {
        let file_path = item
            .get("filePath")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !item_paths.contains(&normalize(file_path))
            || !present_paths.contains(&normalize(file_path))
        {
            failures
                .push(json!({ "filePath": file_path, "message": "曲目不在当前持久化音乐库中" }));
        }
    }

    if mode == "trash" {
        for file_path in &removed_file_paths {
            if let Err(error) = move_to_quarantine(&app, file_path) {
                failures.push(json!({ "filePath": file_path, "message": error }));
            }
        }
    }

    doc["revision"] = json!(persisted_revision + 1);
    save_music_library(&app, &doc)?;

    Ok(json!({
        "mode": mode,
        "library": doc,
        "removedTrackIds": removed_track_ids,
        "removedFilePaths": removed_file_paths,
        "failures": failures
    }))
}

#[tauri::command]
pub fn library_restore_exclusions(app: AppHandle, request: Value) -> Result<Value, String> {
    let file_paths = request
        .get("filePaths")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let requested_revision = request
        .get("library")
        .and_then(|l| l.get("revision"))
        .and_then(Value::as_u64);

    let mut doc = load_music_library(&app);
    let persisted_revision = doc.get("revision").and_then(Value::as_u64).unwrap_or(0);
    if let Some(expected) = requested_revision {
        if expected != persisted_revision {
            return Err("音乐库修订号冲突，请刷新后重试".to_string());
        }
    }

    let targets: HashSet<String> = file_paths
        .iter()
        .filter_map(Value::as_str)
        .map(normalize)
        .collect();
    let mut restored: Vec<String> = Vec::new();
    let mut kept: Vec<Value> = Vec::new();
    if let Some(exclusions) = doc.get_mut("exclusions").and_then(Value::as_array_mut) {
        for exclusion in exclusions.drain(..) {
            let file_path = exclusion.get("filePath").and_then(Value::as_str);
            if file_path.is_some_and(|p| targets.contains(&normalize(p))) {
                if let Some(p) = file_path {
                    restored.push(p.to_string());
                }
            } else {
                kept.push(exclusion);
            }
        }
        *exclusions = kept;
    }

    doc["revision"] = json!(persisted_revision + 1);
    save_music_library(&app, &doc)?;

    Ok(json!({ "library": doc, "restoredFilePaths": restored }))
}

#[tauri::command]
pub fn library_reset(app: AppHandle) -> Result<Value, String> {
    let mut doc = load_music_library(&app);
    let revision = doc.get("revision").and_then(Value::as_u64).unwrap_or(0);
    let mut removed_track_ids: Vec<String> = Vec::new();
    let mut removed_file_paths: Vec<String> = Vec::new();
    if let Some(tracks) = doc.get_mut("tracks").and_then(Value::as_array_mut) {
        for track in tracks.drain(..) {
            if let Some(id) = track.get("id").and_then(Value::as_str) {
                removed_track_ids.push(id.to_string());
            }
            if let Some(file_path) = track.get("filePath").and_then(Value::as_str) {
                removed_file_paths.push(file_path.to_string());
            }
        }
    }
    doc["tracks"] = json!([]);
    doc["revision"] = json!(revision + 1);
    save_music_library(&app, &doc)?;

    Ok(json!({
        "library": doc,
        "removedTrackIds": removed_track_ids,
        "removedFilePaths": removed_file_paths
    }))
}

// ── 授权音频文件读取 ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn fs_read_audio_file(app: AppHandle, file_path: String) -> Result<Value, String> {
    if !is_authorized_audio_file(&app, &file_path)? {
        return Err("音频文件未授权访问".to_string());
    }
    let bytes = fs::read(&file_path).map_err(|e| format!("读取音频文件失败：{e}"))?;
    let mime_type = mime_for_path(&file_path);
    Ok(json!({
        "buffer": base64_encode(&bytes),
        "mimeType": mime_type,
        "_encoding": "base64"
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_file(path: &Path, contents: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).expect("fixture dir");
        fs::write(path, contents).expect("write fixture");
    }

    fn fixture_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("twilight-libscan-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create fixture root");
        dir
    }

    #[test]
    fn normalize_handles_backslashes_and_case() {
        assert_eq!(
            normalize(r"C:\Music\Song.mp3"),
            normalize("c:/music/song.mp3")
        );
        assert_eq!(normalize("a/b/"), "a/b");
        assert_eq!(normalize(r"C:\Music\"), "c:/music");
    }

    #[test]
    fn base64_round_trip() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn scan_folder_tracks_rejects_missing_dir() {
        let missing = std::env::temp_dir().join("twilight-libscan-missing");
        assert!(scan_folder_tracks(&missing.to_string_lossy()).is_err());
    }

    #[test]
    fn scan_folder_tracks_builds_descriptors_for_empty_files() {
        // 空文件无法解析元数据 → 走文件名回退，仍产出合法曲目 JSON。
        let root = fixture_dir("empty");
        write_file(&root.join("Artist - Track.mp3"), b"");
        write_file(&root.join("nested/notes.txt"), b"not audio");

        let result = scan_folder_tracks(&root.to_string_lossy()).expect("scan");
        let tracks = result.as_array().expect("array");
        assert_eq!(tracks.len(), 1, "only audio files should be found");

        let song = &tracks[0];
        assert_eq!(song.get("artist").and_then(Value::as_str), Some("Artist"));
        assert_eq!(song.get("title").and_then(Value::as_str), Some("Track"));
        assert_eq!(song.get("format").and_then(Value::as_str), Some("mp3"));
        assert!(song.get("id").and_then(Value::as_str).is_some());
        assert_eq!(song.get("duration").and_then(Value::as_u64), Some(0));
        assert!(song.get("cover").is_none_or(|c| c.is_null()));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn track_ids_are_stable_across_scans() {
        let root = fixture_dir("stable");
        write_file(&root.join("song.mp3"), b"");
        let first = scan_folder_tracks(&root.to_string_lossy()).unwrap();
        let second = scan_folder_tracks(&root.to_string_lossy()).unwrap();
        assert_eq!(
            first[0].get("id"),
            second[0].get("id"),
            "same file must produce a stable id"
        );
        let _ = fs::remove_dir_all(&root);
    }
}

