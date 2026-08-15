import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const libSource = readFileSync(new URL('../../../src-tauri/src/lib.rs', import.meta.url), 'utf8')
const pluginsSource = readFileSync(
  new URL('../../../src-tauri/src/plugins.rs', import.meta.url),
  'utf8'
)
const tauriConf = readFileSync(
  new URL('../../../src-tauri/tauri.conf.json', import.meta.url),
  'utf8'
)
const bridgeSource = readFileSync(
  new URL('../../renderer/src/platform/tauriHostBridge.ts', import.meta.url),
  'utf8'
)
const capabilitiesSource = readFileSync(
  new URL('../../renderer/src/platform/runtimeCapabilities.ts', import.meta.url),
  'utf8'
)

test('Tauri registers the list + Stage 5A lifecycle commands and the Rust module', () => {
  assert.match(libSource, /mod plugins;/)
  assert.match(
    libSource,
    /plugins::plugins_list,\s*\n\s*plugins::plugins_enable,\s*\n\s*plugins::plugins_disable,\s*\n\s*plugins::plugins_uninstall,\s*\n\s*plugins::plugins_get_log,\s*\n\s*plugins::plugins_open_log,\s*\n\s*plugins::providers_list,\s*\n\s*plugins::extensions_list/
  )
  assert.match(
    pluginsSource,
    /#\[tauri::command\]\s*pub fn plugins_list\(app: AppHandle\) -> Value/
  )
  assert.match(
    pluginsSource,
    /#\[tauri::command\]\s*pub fn plugins_enable\(app: AppHandle, id: String\) -> Result<Value, String>/
  )
  assert.match(
    pluginsSource,
    /#\[tauri::command\]\s*pub fn plugins_disable\(app: AppHandle, id: String\) -> Result<Value, String>/
  )
  assert.match(
    pluginsSource,
    /#\[tauri::command\]\s*pub fn plugins_uninstall\(app: AppHandle, id: String, remove_data: Option<bool>\) -> Result<Value, String>/
  )
  assert.match(
    pluginsSource,
    /#\[tauri::command\]\s*pub fn plugins_get_log\(app: AppHandle, id: String\) -> Result<String, String>/
  )
  assert.match(
    pluginsSource,
    /#\[tauri::command\]\s*pub fn plugins_open_log\(app: AppHandle, id: String\) -> Result<\(\), String>/
  )
  assert.match(
    pluginsSource,
    /#\[tauri::command\]\s*pub fn providers_list\(app: AppHandle\) -> Value/
  )
  assert.match(pluginsSource, /#\[tauri::command\]\s*pub fn extensions_list\(\) -> Value/)
})

test('Rust plugins_list reads real plugin.json manifests instead of returning empty arrays', () => {
  assert.match(
    pluginsSource,
    /pub const BUNDLED_PLUGIN_ID: &str = "com\.twilightecho\.provider\.ncm"/
  )
  assert.match(pluginsSource, /fn read_manifest\(root: &Path\) -> Result<Value, String>/)
  assert.match(pluginsSource, /fn validate_manifest\(manifest: &Value, version_root: &Path\)/)
  assert.match(pluginsSource, /fn manifest_descriptor\(/)
  assert.match(pluginsSource, /fn invalid_descriptor\(/)
  assert.match(pluginsSource, /fs::read_dir\(&plugins_root\)/)
  assert.match(pluginsSource, /built_in = id == BUNDLED_PLUGIN_ID/)
})

test('Rust providers_list gates the static NCM registration on manifest and persisted enable state', () => {
  assert.match(pluginsSource, /fn bundled_plugin_root\(app: &AppHandle\) -> Option<PathBuf>/)
  assert.match(pluginsSource, /fn bundled_ncm_provider_registration\(\) -> Value/)
  assert.match(pluginsSource, /BUNDLED_NCM_PROVIDER_ID: &str = "ncm"/)
  assert.match(
    pluginsSource,
    /Ok\(manifest\) if manifest\.get\("id"\)\.and_then\(Value::as_str\) == Some\(BUNDLED_PLUGIN_ID\)/
  )
  // A disabled bundled plugin hides the provider; a missing state record defaults to enabled.
  assert.match(
    pluginsSource,
    /let enabled = state\n\s*\.get\(BUNDLED_PLUGIN_ID\)\n\s*\.and_then\(\|record\| record\.get\("enabled"\)\)\n\s*\.and_then\(Value::as_bool\)\n\s*\.unwrap_or\(true\);/
  )
  assert.match(pluginsSource, /if !enabled \{\s*return Value::Array\(vec!\[\]\);/)
})

test('Rust persists plugin enable state to plugin-state.json with a .bak backup', () => {
  assert.match(pluginsSource, /fn plugin_state_path\(policy: &path_policy::PathPolicy\) -> PathBuf/)
  assert.match(
    pluginsSource,
    /categorized_app_path\(policy, "plugins", &\["plugin-state\.json"\], "plugin-state\.json"\)/
  )
  assert.match(pluginsSource, /fn read_plugin_state\(policy: &path_policy::PathPolicy\) -> Value/)
  assert.match(
    pluginsSource,
    /fn write_plugin_state\(policy: &path_policy::PathPolicy, state: &Value\)/
  )
  assert.match(pluginsSource, /let backup = path\.with_extension\("json\.bak"\);/)
  assert.match(pluginsSource, /fn now_iso8601\(\) -> String/)
})

test('Rust set_plugin_enabled mirrors Electron setEnabled and rejects bundled uninstall', () => {
  assert.match(
    pluginsSource,
    /fn set_plugin_enabled\(app: &AppHandle, id: &str, enabled: bool\) -> Result<Value, String>/
  )
  assert.match(
    pluginsSource,
    /"installedAt": previous\.get\("installedAt"\)\.cloned\(\)\.unwrap_or_else\(\|\| json!\(now\)\)/
  )
  assert.match(
    pluginsSource,
    /"source": previous\.get\("source"\)\.and_then\(Value::as_str\)\.unwrap_or\(default_source\)/
  )
  assert.match(pluginsSource, /"lastError": Value::Null/)
  assert.match(pluginsSource, /自带插件不能卸载；如需关闭，请在插件页停用/)
})

test('bundled NCM plugin is packaged into the Tauri resources', () => {
  assert.match(tauriConf, /"resources": \{/)
  assert.match(tauriConf, /"\.\.\/resources\/plugins\/ncm-provider": "plugins\/ncm-provider"/)
})

test('tauriHostBridge wires list + lifecycle commands to invoke() and keeps install/index ops rejected', () => {
  assert.match(bridgeSource, /plugins: \{[\s\S]*?list: \(\) => invoke\('plugins_list'\)/)
  assert.match(bridgeSource, /providers: \{[\s\S]*?list: \(\) => invoke\('providers_list'\)/)
  assert.match(bridgeSource, /extensions: \{[\s\S]*?list: \(\) => invoke\('extensions_list'\)/)
  // Stage 5A lifecycle commands are real Tauri commands.
  assert.match(bridgeSource, /enable: \(id: string\) => invoke\('plugins_enable', \{ id \}\)/)
  assert.match(bridgeSource, /disable: \(id: string\) => invoke\('plugins_disable', \{ id \}\)/)
  assert.match(
    bridgeSource,
    /uninstall: \(id: string, options\?: \{ removeData\?: boolean \}\) =>\s*invoke\('plugins_uninstall', \{ id, removeData: options\?\.removeData \}\)/
  )
  assert.match(bridgeSource, /openLog: \(id: string\) => invoke\('plugins_open_log', \{ id \}\)/)
  assert.match(bridgeSource, /getLog: \(id: string\) => invoke\('plugins_get_log', \{ id \}\)/)
  // .tep install and marketplace index operations must still be explicitly disabled.
  assert.match(
    bridgeSource,
    /installFromPath: \(\) => Promise\.reject\(capabilityError\('plugins'\)\)/
  )
  assert.match(
    bridgeSource,
    /chooseAndInstall: \(\) => Promise\.reject\(capabilityError\('plugins'\)\)/
  )
  assert.match(bridgeSource, /listIndex: \(\) => Promise\.reject\(capabilityError\('plugins'\)\)/)
  assert.match(
    bridgeSource,
    /refreshIndex: \(\) => Promise\.reject\(capabilityError\('plugins'\)\)/
  )
  assert.match(
    bridgeSource,
    /getIndexStatus: \(\) => Promise\.reject\(capabilityError\('plugins'\)\)/
  )
  assert.match(
    bridgeSource,
    /installFromIndex: \(\) => Promise\.reject\(capabilityError\('plugins'\)\)/
  )
  assert.match(
    bridgeSource,
    /setNativeDspParameters: \(\) => Promise\.reject\(capabilityError\('plugins'\)\)/
  )
  assert.match(
    bridgeSource,
    /call: \(\) =>\s*Promise\.reject\(\s*capabilityError\('providers', 'Provider 未启用：当前运行时不支持在线音源'\)\s*\)/
  )
  assert.match(
    bridgeSource,
    /executeCommand: \(\) => Promise\.reject\(capabilityError\('extensions'\)\)/
  )
  assert.match(
    bridgeSource,
    /readThemeStylesheet: \(\) => Promise\.reject\(capabilityError\('extensions'\)\)/
  )
  assert.match(bridgeSource, /listInstalled: \(\) => Promise\.reject\(capabilityError\('fonts'\)\)/)
})

test('Tauri capability matrix marks plugins/providers/extensions partial and fonts unsupported', () => {
  assert.match(
    capabilitiesSource,
    /plugins: partial\('plugins', '已支持插件启停\/卸载与日志；安装与市场待迁移'\)/
  )
  assert.match(
    capabilitiesSource,
    /providers: partial\('providers', '已支持在线音源列表；调用与登录待迁移'\)/
  )
  assert.match(
    capabilitiesSource,
    /extensions: partial\('extensions', '已支持扩展列表；命令执行待迁移'\)/
  )
  assert.match(capabilitiesSource, /fonts: unsupported\('fonts'\)/)
})
