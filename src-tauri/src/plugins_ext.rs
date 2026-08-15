//! 扩展命令（Stage 5C）。
//!
//! Tauri 侧没有扩展宿主，`extensions.executeCommand` / `extensions.readThemeStylesheet`
//! 恒定失败（与 Electron 侧真实扩展宿主的行为差异由 `tauriHostBridge.ts` 以
//! `RuntimeCapabilityError` 显式区分）。此处只做参数归一化与固定错误文本，保证命令
//! 存在且契约稳定。
use serde_json::Value;

/// `extensions.executeCommand`：同步命令，恒定报错。
pub fn execute_command(command: String, _args: Option<Value>) -> Result<Value, String> {
    let normalized = command.trim().to_lowercase();
    if normalized.is_empty() {
        return Err("UI command 不能为空".to_string());
    }
    Err(format!("UI command 未注册：{normalized}"))
}

/// `extensions.readThemeStylesheet`：同步命令，恒定报错。
pub fn read_theme_stylesheet(_stylesheet_path: String) -> Result<String, String> {
    Err("主题 stylesheet 未注册".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execute_command_always_errors() {
        assert!(execute_command(String::new(), None).is_err());
        let error = execute_command("  NCM.Search  ".to_string(), None).unwrap_err();
        assert_eq!(error, "UI command 未注册：ncm.search");
    }

    #[test]
    fn read_theme_stylesheet_always_errors() {
        let error = read_theme_stylesheet("theme.css".to_string()).unwrap_err();
        assert_eq!(error, "主题 stylesheet 未注册");
    }
}
