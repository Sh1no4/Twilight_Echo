//! 手写 ZIP / `.tep` 插件包读取器（Stage 5C）。
//!
//! 不引入 `zip` crate（crates 离线），按 ZIP 二进制格式手工解析：
//! - EOCD 记录签名 `0x06054b50`，取**最后一次**出现；
//! - 中央目录条目签名 `0x02014b50`，本地文件头签名 `0x04034b50`；
//! - 压缩方法 8 = 原始 DEFLATE → `flate2::read::DeflateDecoder`（不是 ZlibDecoder），
//!   方法 0 = stored；
//! - CRC-32 用 `crc32fast` 校验；
//! - symlink 检测：`(externalFileAttributes >> 16) & 0o170000 == 0o120000`。
//!
//! 安全边界（镜像 `src/main/plugins/packageSecurity.ts`）：包字节数、解压后总字节数、
//! 文件数、单条目字节数、条目路径长度全部设上限；解压时拒绝路径逃逸（`..`/绝对路径），
//! symlink 条目不写入磁盘。包校验或解压失败时清理临时目录并返回错误。
use crc32fast::Hasher;
use flate2::read::DeflateDecoder;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// 插件包字节数上限（50MB，镜像 `packageSecurity.ts` `MAX_PLUGIN_PACKAGE_BYTES`）。
pub const MAX_PLUGIN_PACKAGE_BYTES: usize = 50 * 1024 * 1024;
/// 插件包解压后总字节数上限（100MB）。
pub const MAX_PLUGIN_EXTRACTED_BYTES: usize = 100 * 1024 * 1024;
/// 插件包文件数上限（2000）。
pub const MAX_PLUGIN_PACKAGE_FILES: usize = 2000;
/// 单个条目解压后字节数上限（50MB）。
pub const MAX_PLUGIN_ENTRY_BYTES: usize = 50 * 1024 * 1024;
/// 单个条目路径长度上限（4096）。
pub const MAX_PLUGIN_ENTRY_PATH_LENGTH: usize = 4096;

const EOCD_SIGNATURE: u32 = 0x0605_4b50;
const CENTRAL_DIRECTORY_SIGNATURE: u32 = 0x0201_4b50;
const LOCAL_HEADER_SIGNATURE: u32 = 0x0403_4b50;
const METHOD_STORED: u16 = 0;
const METHOD_DEFLATED: u16 = 8;

/// 临时目录名序号（避免同毫秒并发冲突）。
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// 中央目录单条目（字段来自中央目录，解压位置/大小再结合本地文件头）。
struct CentralEntry {
    file_name: String,
    method: u16,
    compressed_size: u32,
    uncompressed_size: u32,
    crc32: u32,
    is_symlink: bool,
    local_header_offset: u32,
}

fn read_u16(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

/// 定位 EOCD 记录（最后一次出现的签名）。
fn find_eocd(bytes: &[u8]) -> Result<usize, String> {
    let mut last: Option<usize> = None;
    let mut i = 0;
    while i + 4 <= bytes.len() {
        if read_u32(bytes, i) == EOCD_SIGNATURE {
            last = Some(i);
        }
        i += 1;
    }
    let offset = last.ok_or("插件包不是合法 ZIP：找不到 EOCD 记录")?;
    if offset + 22 > bytes.len() {
        return Err("插件包 EOCD 记录不完整".to_string());
    }
    Ok(offset)
}

/// 解析中央目录为条目列表。
fn parse_central_directory(
    bytes: &[u8],
    offset: usize,
    size: usize,
    count: usize,
) -> Result<Vec<CentralEntry>, String> {
    let end = offset + size;
    if end > bytes.len() {
        return Err("插件包中央目录越界".to_string());
    }
    let mut entries = Vec::with_capacity(count);
    let mut cursor = offset;
    for _ in 0..count {
        if cursor + 46 > end {
            return Err("插件包中央目录记录不完整".to_string());
        }
        if read_u32(bytes, cursor) != CENTRAL_DIRECTORY_SIGNATURE {
            return Err("插件包中央目录签名不匹配".to_string());
        }
        let method = read_u16(bytes, cursor + 10);
        let crc32 = read_u32(bytes, cursor + 16);
        let compressed_size = read_u32(bytes, cursor + 20);
        let uncompressed_size = read_u32(bytes, cursor + 24);
        let name_len = read_u16(bytes, cursor + 28) as usize;
        let extra_len = read_u16(bytes, cursor + 30) as usize;
        let comment_len = read_u16(bytes, cursor + 32) as usize;
        let external_attributes = read_u32(bytes, cursor + 38);
        let local_header_offset = read_u32(bytes, cursor + 42);

        let name_start = cursor + 46;
        let name_end = name_start + name_len;
        if name_end > end {
            return Err("插件包中央目录文件名越界".to_string());
        }
        let file_name = String::from_utf8(bytes[name_start..name_end].to_vec())
            .map_err(|_| "插件包文件名不是合法 UTF-8".to_string())?;

        let file_type = (external_attributes >> 16) & 0o170000;
        let is_symlink = file_type == 0o120000;
        entries.push(CentralEntry {
            file_name,
            method,
            compressed_size,
            uncompressed_size,
            crc32,
            is_symlink,
            local_header_offset,
        });
        cursor = name_end + extra_len + comment_len;
    }
    Ok(entries)
}

/// 解压并写入单个条目；目录与 symlink 条目跳过。写入前做路径逃逸与大小上限检查。
fn extract_entry(bytes: &[u8], entry: &CentralEntry, dest_root: &Path) -> Result<(), String> {
    if entry.file_name.is_empty() {
        return Ok(());
    }
    let normalized = entry.file_name.replace('\\', "/");
    if normalized.ends_with('/') {
        return Ok(()); // 目录
    }
    if normalized.len() > MAX_PLUGIN_ENTRY_PATH_LENGTH {
        return Err("插件包条目路径过长".to_string());
    }
    for component in Path::new(&normalized).components() {
        match component {
            Component::ParentDir => {
                return Err(format!("插件包包含非法路径：{}", entry.file_name))
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!("插件包包含绝对路径：{}", entry.file_name))
            }
            Component::CurDir | Component::Normal(_) => {}
        }
    }
    if entry.is_symlink {
        return Ok(()); // symlink 不写入磁盘，避免逃逸
    }
    if entry.uncompressed_size as usize > MAX_PLUGIN_ENTRY_BYTES {
        return Err("插件包单个文件超过 50MB 上限".to_string());
    }

    let local_offset = entry.local_header_offset as usize;
    if local_offset + 30 > bytes.len() {
        return Err("插件包本地文件头越界".to_string());
    }
    if read_u32(bytes, local_offset) != LOCAL_HEADER_SIGNATURE {
        return Err("插件包本地文件头签名不匹配".to_string());
    }
    let local_name_len = read_u16(bytes, local_offset + 26) as usize;
    let local_extra_len = read_u16(bytes, local_offset + 28) as usize;
    let data_start = local_offset + 30 + local_name_len + local_extra_len;
    let data_end = data_start + entry.compressed_size as usize;
    if data_end > bytes.len() {
        return Err("插件包数据越界".to_string());
    }
    let compressed = &bytes[data_start..data_end];

    let decompressed = match entry.method {
        METHOD_STORED => {
            if compressed.len() != entry.uncompressed_size as usize {
                return Err(format!("插件包 stored 条目长度不匹配：{}", entry.file_name));
            }
            compressed.to_vec()
        }
        METHOD_DEFLATED => {
            let decoder = DeflateDecoder::new(compressed);
            let mut out = Vec::with_capacity(entry.uncompressed_size as usize);
            decoder
                .take(MAX_PLUGIN_ENTRY_BYTES as u64 + 1)
                .read_to_end(&mut out)
                .map_err(|error| format!("插件包 DEFLATE 解压失败：{error}"))?;
            out
        }
        _ => {
            return Err(format!(
                "插件包包含不支持的压缩方法：{}",
                entry.method
            ))
        }
    };
    if decompressed.len() > MAX_PLUGIN_ENTRY_BYTES {
        return Err("插件包单个文件解压后超过 50MB 上限".to_string());
    }
    if decompressed.len() != entry.uncompressed_size as usize {
        return Err(format!("插件包条目长度与声明不符：{}", entry.file_name));
    }
    let mut hasher = Hasher::new();
    hasher.update(&decompressed);
    if hasher.finalize() != entry.crc32 {
        return Err(format!("插件包 CRC 校验失败：{}", entry.file_name));
    }

    let dest = dest_root.join(&normalized);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建插件解压目录失败：{error}"))?;
    }
    fs::write(&dest, &decompressed).map_err(|error| format!("写入插件文件失败：{error}"))
}

/// 创建独立的临时解压目录（`std::env::temp_dir()` 下，进程 id + 纳秒时间戳 + 序号）。
fn new_temp_dir() -> Result<PathBuf, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let seq = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "twilight-echo-plugin-{}-{nanos}-{seq}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).map_err(|error| format!("创建临时目录失败：{error}"))?;
    Ok(dir)
}

/// 校验 `.tep` 包并解压到临时目录，返回临时目录路径。包不合法或超限时清理并返回错误；
/// 调用方负责在成功后清理返回的目录。
pub fn validate_and_extract_tep(bytes: &[u8]) -> Result<PathBuf, String> {
    if bytes.len() > MAX_PLUGIN_PACKAGE_BYTES {
        return Err("插件包超过 50MB 上限".to_string());
    }
    if bytes.is_empty() {
        return Err("插件包为空".to_string());
    }
    let eocd = find_eocd(bytes)?;
    let total_entries = read_u16(bytes, eocd + 10) as usize;
    let central_size = read_u32(bytes, eocd + 12) as usize;
    let central_offset = read_u32(bytes, eocd + 16) as usize;
    if total_entries > MAX_PLUGIN_PACKAGE_FILES {
        return Err(format!(
            "插件包含有 {total_entries} 个文件，超过 {MAX_PLUGIN_PACKAGE_FILES} 上限"
        ));
    }
    if central_offset + central_size > bytes.len() {
        return Err("插件包中央目录越界".to_string());
    }
    let entries = parse_central_directory(bytes, central_offset, central_size, total_entries)?;
    if entries.is_empty() {
        return Err("插件包中央目录为空".to_string());
    }

    let temp_root = new_temp_dir()?;
    let mut total_extracted: usize = 0;
    for entry in &entries {
        total_extracted = total_extracted.saturating_add(entry.uncompressed_size as usize);
        if total_extracted > MAX_PLUGIN_EXTRACTED_BYTES {
            let _ = fs::remove_dir_all(&temp_root);
            return Err("插件包解压后超过 100MB 上限".to_string());
        }
        if let Err(error) = extract_entry(bytes, entry, &temp_root) {
            let _ = fs::remove_dir_all(&temp_root);
            return Err(error);
        }
    }
    Ok(temp_root)
}

/// 按 `.tep` 语义定位插件根目录：根目录下直接有 `plugin.json` 用根目录；否则在解压树中
/// 递归查找包含 `plugin.json` 的目录，**唯一**命中时返回该目录，否则报错。
pub fn locate_plugin_root(temp_root: &Path) -> Result<PathBuf, String> {
    if temp_root.join("plugin.json").is_file() {
        return Ok(temp_root.to_path_buf());
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    let mut stack = vec![temp_root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if path.join("plugin.json").is_file() {
                        candidates.push(path.clone());
                    }
                    stack.push(path);
                }
            }
        }
    }
    if candidates.len() == 1 {
        Ok(candidates.into_iter().next().expect("len==1"))
    } else {
        Err("tep 包根目录必须包含 plugin.json".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::DeflateEncoder;
    use flate2::Compression;
    use std::io::Write;

    /// 手工构造最小 ZIP（stored 条目）。返回字节。
    fn make_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut local_parts: Vec<Vec<u8>> = Vec::new();
        let mut central_parts: Vec<Vec<u8>> = Vec::new();
        let mut offset: usize = 0;
        for (name, data) in entries {
            let name_bytes = name.as_bytes();
            let crc = crc32fast::hash(data);
            let mut local = Vec::new();
            local.extend_from_slice(&LOCAL_HEADER_SIGNATURE.to_le_bytes());
            local.extend_from_slice(&0u16.to_le_bytes());
            local.extend_from_slice(&0u16.to_le_bytes());
            local.extend_from_slice(&0u16.to_le_bytes());
            local.extend_from_slice(&0u16.to_le_bytes());
            local.extend_from_slice(&0u16.to_le_bytes());
            local.extend_from_slice(&crc.to_le_bytes());
            local.extend_from_slice(&(data.len() as u32).to_le_bytes());
            local.extend_from_slice(&(data.len() as u32).to_le_bytes());
            local.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
            local.extend_from_slice(&0u16.to_le_bytes());
            local.extend_from_slice(name_bytes);
            let local_start = offset;
            offset += local.len() + data.len();
            local.extend_from_slice(data);
            local_parts.push(local);

            let mut central = Vec::new();
            central.extend_from_slice(&CENTRAL_DIRECTORY_SIGNATURE.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&crc.to_le_bytes());
            central.extend_from_slice(&(data.len() as u32).to_le_bytes());
            central.extend_from_slice(&(data.len() as u32).to_le_bytes());
            central.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u32.to_le_bytes());
            central.extend_from_slice(&(local_start as u32).to_le_bytes());
            central.extend_from_slice(name_bytes);
            central_parts.push(central);
        }
        let central_offset = offset;
        let central_bytes = central_parts.concat();
        let mut out = local_parts.concat();
        out.extend_from_slice(&central_bytes);
        let central_size = out.len() - central_offset;
        let mut eocd = Vec::new();
        eocd.extend_from_slice(&EOCD_SIGNATURE.to_le_bytes());
        eocd.extend_from_slice(&0u16.to_le_bytes());
        eocd.extend_from_slice(&0u16.to_le_bytes());
        eocd.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        eocd.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        eocd.extend_from_slice(&(central_size as u32).to_le_bytes());
        eocd.extend_from_slice(&(central_offset as u32).to_le_bytes());
        eocd.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&eocd);
        out
    }

    fn manifest() -> &'static [u8] {
        br#"{"id":"com.example.test","name":"Test","version":"1.0.0","type":["provider"],"engines":{"twilightEcho":">=1.0.0"}}"#
    }

    #[test]
    fn extracts_stored_entries_to_temp_dir() {
        let bytes = make_zip(&[
            ("plugin.json", manifest()),
            ("lib/main.js", b"console.log('hi');"),
        ]);
        let root = validate_and_extract_tep(&bytes).expect("extract ok");
        assert!(root.join("plugin.json").is_file());
        assert_eq!(
            fs::read_to_string(root.join("lib/main.js")).expect("read"),
            "console.log('hi');"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn extracts_deflated_entry() {
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
        let payload = vec![b'x'; 4096];
        encoder.write_all(&payload).expect("write");
        let compressed = encoder.finish().expect("finish");

        // 用 DEFLATE 数据替换 stored 数据：把中央目录的 method 改成 8，并把
        // crc / 解压后大小改成 payload 的真实值（stored 时二者都等于
        // compressed.len()）。解析以中央目录为准：method 在 +10，crc 在 +16，
        // 解压后大小在 +24。
        let mut bytes = make_zip(&[("plugin.json", &compressed)]);
        let eocd = find_eocd(&bytes).expect("eocd");
        let central_offset = read_u32(&bytes, eocd + 16) as usize;
        let payload_crc = crc32fast::hash(&payload);
        bytes[central_offset + 10..central_offset + 12].copy_from_slice(&8u16.to_le_bytes());
        bytes[central_offset + 16..central_offset + 20].copy_from_slice(&payload_crc.to_le_bytes());
        bytes[central_offset + 24..central_offset + 28]
            .copy_from_slice(&(payload.len() as u32).to_le_bytes());

        let root = validate_and_extract_tep(&bytes).expect("extract ok");
        let got = fs::read(&root.join("plugin.json")).expect("read");
        assert_eq!(got.len(), payload.len());
        assert_eq!(got, payload);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_path_traversal() {
        let bytes = make_zip(&[
            ("plugin.json", manifest()),
            ("../evil.txt", b"pwned"),
        ]);
        let error = validate_and_extract_tep(&bytes).expect_err("should reject traversal");
        assert!(error.contains("非法路径"), "{error}");
    }

    #[test]
    fn rejects_absolute_path() {
        let bytes = make_zip(&[("plugin.json", manifest()), ("/etc/passwd", b"x")]);
        let error = validate_and_extract_tep(&bytes).expect_err("should reject absolute");
        assert!(error.contains("绝对路径"), "{error}");
    }

    #[test]
    fn rejects_oversized_single_entry() {
        // stored 条目声明 51MB，实际数据只有几个字节 → 应先命中大小上限。
        let small = b"tiny";
        let mut bytes = make_zip(&[("plugin.json", manifest()), ("big.bin", small)]);
        let eocd = find_eocd(&bytes).expect("eocd");
        let central_offset = read_u32(&bytes, eocd + 16) as usize;
        // 第二个中央目录条目：跳过第一个（46 + name len 11）。
        let first_name_len = read_u16(&bytes, central_offset + 28) as usize;
        let second = central_offset + 46 + first_name_len;
        // uncompressed_size 字段 @ second + 24
        let declared = (51 * 1024 * 1024) as u32;
        bytes[second + 24..second + 28].copy_from_slice(&declared.to_le_bytes());
        bytes[second + 20..second + 24].copy_from_slice(&declared.to_le_bytes());

        let error = validate_and_extract_tep(&bytes).expect_err("should reject oversized");
        assert!(error.contains("50MB 上限"), "{error}");
    }

    #[test]
    fn rejects_crc_mismatch() {
        let mut bytes = make_zip(&[("plugin.json", manifest())]);
        // 翻转数据字节，CRC 校验应失败。
        let eocd = find_eocd(&bytes).expect("eocd");
        let central_offset = read_u32(&bytes, eocd + 16) as usize;
        let local_offset = read_u32(&bytes, central_offset + 42) as usize;
        let name_len = read_u16(&bytes, local_offset + 26) as usize;
        let data_pos = local_offset + 30 + name_len;
        bytes[data_pos] ^= 0xff;
        let error = validate_and_extract_tep(&bytes).expect_err("should reject crc");
        assert!(error.contains("CRC 校验失败"), "{error}");
    }

    #[test]
    fn skips_symlink_entries() {
        let data: &[u8] = b"target";
        let mut bytes = make_zip(&[("link.txt", data)]);
        let eocd = find_eocd(&bytes).expect("eocd");
        let central_offset = read_u32(&bytes, eocd + 16) as usize;
        // 中央目录 external attributes @ +38，置为 S_IFLNK (0o120000 << 16)。
        bytes[central_offset + 38..central_offset + 42]
            .copy_from_slice(&(0o120000u32 << 16).to_le_bytes());
        let root = validate_and_extract_tep(&bytes).expect("extract ok");
        assert!(
            !root.join("link.txt").exists(),
            "symlink 条目不应写入磁盘"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_too_many_files() {
        let names: Vec<String> = (0..=MAX_PLUGIN_PACKAGE_FILES)
            .map(|i| format!("f{i}.txt"))
            .collect();
        let mut entries: Vec<(&str, &[u8])> = vec![("plugin.json", manifest())];
        for name in &names {
            entries.push((name.as_str(), b"x"));
        }
        let bytes = make_zip(&entries);
        let error = validate_and_extract_tep(&bytes).expect_err("should reject count");
        assert!(error.contains("个文件"), "{error}");
    }

    #[test]
    fn locate_plugin_root_finds_root_or_unique_subdir() {
        // 根目录直接有 plugin.json。
        let bytes = make_zip(&[("plugin.json", manifest())]);
        let root = validate_and_extract_tep(&bytes).expect("extract ok");
        assert_eq!(locate_plugin_root(&root).expect("root"), root);
        let _ = fs::remove_dir_all(&root);

        // 唯一子目录含 plugin.json。
        let bytes = make_zip(&[
            ("pkg/plugin.json", manifest()),
            ("pkg/lib/a.js", b"// a"),
        ]);
        let root = validate_and_extract_tep(&bytes).expect("extract ok");
        let located = locate_plugin_root(&root).expect("subdir");
        assert_eq!(located, root.join("pkg"));
        let _ = fs::remove_dir_all(&root);

        // 没有任何 plugin.json。
        let bytes = make_zip(&[("a.txt", b"x")]);
        let root = validate_and_extract_tep(&bytes).expect("extract ok");
        let error = locate_plugin_root(&root).expect_err("should fail");
        assert_eq!(error, "tep 包根目录必须包含 plugin.json");
        let _ = fs::remove_dir_all(&root);
    }
}
