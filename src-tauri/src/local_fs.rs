use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// 与 Electron `src/main/library/libraryFiles.ts` 的 `SUPPORTED_EXTENSIONS` 对齐。
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "wav", "wave", "aac", "ogg", "wma", "m4a", "mp4", "aiff", "aif",
    "opus", "webm", "alac", "ape", "wv", "dsf", "dff", "mqa", "iso",
];

/// FNV-1a 64-bit 哈希，用于给本地文件生成稳定的 id（不引入新 crate）。
fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

pub(crate) fn is_audio_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            AUDIO_EXTENSIONS.iter().any(|&e| e == lower)
        })
        .unwrap_or(false)
}

fn track_descriptor(path: &Path) -> Value {
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let title = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let dir = path
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let format = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    let file_path = path.to_string_lossy().into_owned();
    let id = format!("local-{:x}", fnv1a(file_path.as_bytes()));
    json!({
        "id": id,
        "title": title,
        "artist": "",
        "album": "",
        "filePath": file_path,
        "fileName": file_name,
        "dir": dir,
        "duration": 0,
        "size": size,
        "cover": Value::Null,
        "lyrics": Value::Null,
        "format": format
    })
}

/// 递归扫描目录下的音频文件，返回最小 TrackData 描述。
/// 原型阶段不做音频元数据解析（duration 为 0，artist/album 为空），
/// 只负责让「导入歌曲」真正扫出文件。
#[tauri::command]
pub fn fs_scan_music_files(folder_path: String) -> Result<Value, String> {
    let root = PathBuf::from(&folder_path);
    if !root.is_dir() {
        return Err(format!("目录不存在：{folder_path}"));
    }
    let mut tracks: Vec<Value> = Vec::new();
    let mut queue: Vec<PathBuf> = vec![root];
    while let Some(dir) = queue.pop() {
        let entries = fs::read_dir(&dir).map_err(|err| format!("读取目录失败：{err}"))?;
        for entry in entries.flatten() {
            let path = entry.path();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir {
                queue.push(path);
            } else if is_audio_path(&path) {
                tracks.push(track_descriptor(&path));
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    fn write_file(path: &Path, contents: &str) {
        let mut file = File::create(path).expect("create fixture file");
        file.write_all(contents.as_bytes()).expect("write fixture");
    }

    #[test]
    fn scan_finds_nested_audio_files_only() {
        let root = std::env::temp_dir().join(format!(
            "twilight-local-fs-scan-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("nested")).expect("create fixture dirs");
        write_file(&root.join("song.mp3"), "");
        write_file(&root.join("nested/track.flac"), "");
        write_file(&root.join("notes.txt"), "not audio");
        write_file(&root.join("cover.jpg"), "not audio");

        let result = fs_scan_music_files(root.to_string_lossy().into_owned())
            .expect("scan should succeed");
        let tracks = result.as_array().expect("array result");
        assert_eq!(tracks.len(), 2, "only audio files should be found");

        let paths: Vec<&str> = tracks
            .iter()
            .filter_map(|t| t.get("filePath").and_then(Value::as_str))
            .collect();
        assert!(paths.iter().any(|p| p.ends_with("song.mp3")));
        assert!(paths.iter().any(|p| p.ends_with("track.flac")));

        let song = tracks.iter().find(|t| {
            t.get("filePath")
                .and_then(Value::as_str)
                .is_some_and(|p| p.ends_with("song.mp3"))
        });
        let song = song.expect("song.mp3 descriptor");
        assert_eq!(song.get("title").and_then(Value::as_str), Some("song"));
        assert_eq!(song.get("format").and_then(Value::as_str), Some("mp3"));
        assert!(song.get("id").and_then(Value::as_str).is_some());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_rejects_missing_directory() {
        let missing = std::env::temp_dir().join("twilight-local-fs-missing-dir");
        assert!(fs_scan_music_files(missing.to_string_lossy().into_owned()).is_err());
    }

    #[test]
    fn fnv1a_is_stable() {
        assert_eq!(fnv1a(b"abc"), fnv1a(b"abc"));
        assert_ne!(fnv1a(b"abc"), fnv1a(b"abd"));
    }
}
