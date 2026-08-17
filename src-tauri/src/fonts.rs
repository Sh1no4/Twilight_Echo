
use std::collections::BTreeSet;
use std::process::Command;

const FONT_REGISTRY_KEY: &str = r"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts";
const USER_FONT_REGISTRY_KEY: &str = r"HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts";
const MAX_FONTS: usize = 600;

const STYLE_SUFFIXES: &[&str] = &[
    "thin",
    "extra light",
    "extralight",
    "ultra light",
    "ultralight",
    "light",
    "regular",
    "normal",
    "medium",
    "semi bold",
    "semibold",
    "demi bold",
    "demibold",
    "bold",
    "extra bold",
    "extrabold",
    "ultra bold",
    "ultrabold",
    "black",
    "heavy",
    "italic",
    "oblique",
];

fn strip_style_suffixes(candidate: &str) -> String {
    let mut family = candidate.trim().to_string();
    loop {
        let lower = family.to_lowercase();
        let mut longest_match: Option<usize> = None;
        for suffix in STYLE_SUFFIXES {
            let pattern = format!(" {suffix}");
            if lower.len() > pattern.len() && lower.ends_with(&pattern) {
                let prefix_len = lower.len() - pattern.len();
                if longest_match.is_none_or(|current| prefix_len < current) {
                    longest_match = Some(prefix_len);
                }
            }
        }
        match longest_match {
            Some(len) => family = family[..len].trim_end().to_string(),
            None => break,
        }
    }
    if family.is_empty() {
        candidate.trim().to_string()
    } else {
        family
    }
}

pub fn parse_windows_font_families(registry_output: &str) -> Vec<String> {
    let mut families = BTreeSet::new();
    for line in registry_output.lines() {
        let Some(reg_index) = line.find("REG_") else {
            continue;
        };
        let name_raw = line[..reg_index].trim();
        if name_raw.is_empty() {
            continue;
        }
        // 去掉格式标签："Arial (TrueType)" -> "Arial"。
        let name = match name_raw.rfind('(') {
            Some(idx) if name_raw.ends_with(')') => name_raw[..idx].trim_end(),
            _ => name_raw,
        };
        if name.is_empty() {
            continue;
        }
        // 单个条目可能注册多个本地化名称："宋体 & 新宋体"。
        for candidate in name.split('&') {
            let candidate = candidate.trim();
            if candidate.is_empty() || candidate.starts_with('@') || candidate.len() > 96 {
                continue;
            }
            let family = strip_style_suffixes(candidate);
            if !family.is_empty() {
                families.insert(family);
            }
        }
    }
    families.into_iter().collect()
}

fn query_registry(key: &str) -> String {
    match Command::new("reg").args(["query", key, "/s"]).output() {
        Ok(output) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).into_owned()
        }
        _ => String::new(),
    }
}

#[tauri::command]
pub fn fonts_list_installed() -> Result<Vec<String>, String> {
    if std::env::consts::OS != "windows" {
        return Err("字体枚举仅在 Windows 提供".to_string());
    }
    let combined = format!(
        "{}\n{}",
        query_registry(FONT_REGISTRY_KEY),
        query_registry(USER_FONT_REGISTRY_KEY)
    );
    let mut families = parse_windows_font_families(&combined);
    families.sort_by(|left, right| left.to_lowercase().cmp(&right.to_lowercase()));
    families.truncate(MAX_FONTS);
    Ok(families)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_extracts_families_and_drops_format_tags() {
        let output = "\n\
            \x20   Arial (TrueType)    REG_SZ    arial.ttf\n\
            \x20   Arial Bold Italic (TrueType)    REG_SZ    aribi.ttf\n\
            \x20   \u{5B8B}\u{4F53} & \u{65B0}\u{5B8B}\u{4F53} (TrueType)    REG_SZ    simsun.ttc\n\
            \x20   Segoe UI Semibold Italic (TrueType)    REG_SZ    seguisbi.ttf\n\
            \x20   Webdings (TrueType)    REG_SZ    webdings.ttf\n";
        let families = parse_windows_font_families(output);
        assert!(families.contains(&"Arial".to_string()));
        assert!(families.contains(&"Segoe UI".to_string()));
        assert!(families.contains(&"\u{5B8B}\u{4F53}".to_string()));
        assert!(families.contains(&"\u{65B0}\u{5B8B}\u{4F53}".to_string()));
        assert!(!families.contains(&"Arial Bold Italic".to_string()));
    }

    #[test]
    fn parse_is_sorted_and_deduplicated() {
        let output = "\n    Zebra (TrueType)    REG_SZ    zebra.ttf\n    Arial (TrueType)    REG_SZ    arial.ttf\n    Arial (TrueType)    REG_SZ    arial.ttf\n";
        let families = parse_windows_font_families(output);
        let mut sorted = families.clone();
        sorted.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
        assert_eq!(families, sorted);
        let mut deduped = families.clone();
        deduped.dedup();
        assert_eq!(families, deduped);
    }

    #[test]
    fn strip_style_suffixes_handles_multi_pass() {
        assert_eq!(strip_style_suffixes("Arial Bold Italic"), "Arial");
        assert_eq!(strip_style_suffixes("Segoe UI Semibold Italic"), "Segoe UI");
        assert_eq!(strip_style_suffixes("Webdings"), "Webdings");
        assert_eq!(strip_style_suffixes("Bold"), "Bold");
    }
}

