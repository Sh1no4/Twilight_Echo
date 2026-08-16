use serde_json::Value;
use std::path::Path;

/// 与 Electron `src/main/library/libraryFiles.ts` 的 `SUPPORTED_EXTENSIONS` 对齐。
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "wav", "wave", "aac", "ogg", "wma", "m4a", "mp4", "aiff", "aif", "opus", "webm",
    "alac", "ape", "wv", "dsf", "dff", "mqa", "iso",
];

/// FNV-1a 64-bit 哈希，用于给本地文件生成稳定的 id（不引入新 crate）。
pub(crate) fn fnv1a(bytes: &[u8]) -> u64 {
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

/// 递归扫描目录下的音频文件，返回真实元数据 TrackData 描述。
/// 委托给 `library_scan::scan_folder_tracks`（lofty 元数据解析 + 文件名回退）。
#[tauri::command]
pub fn fs_scan_music_files(folder_path: String) -> Result<Value, String> {
    crate::library_scan::scan_folder_tracks(&folder_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;

    fn write_file(path: &Path, contents: &str) {
        let mut file = File::create(path).expect("create fixture file");
        file.write_all(contents.as_bytes()).expect("write fixture");
    }

    #[test]
    fn scan_finds_nested_audio_files_only() {
        let root =
            std::env::temp_dir().join(format!("twilight-local-fs-scan-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("nested")).expect("create fixture dirs");
        write_file(&root.join("song.mp3"), "");
        write_file(&root.join("nested/track.flac"), "");
        write_file(&root.join("notes.txt"), "not audio");
        write_file(&root.join("cover.jpg"), "not audio");

        let result =
            fs_scan_music_files(root.to_string_lossy().into_owned()).expect("scan should succeed");
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
