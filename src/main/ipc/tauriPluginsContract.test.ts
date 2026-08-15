import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const libSource = readFileSync(new URL('../../../src-tauri/src/lib.rs', import.meta.url), 'utf8')
const pluginsSource = readFileSync(
  new URL('../../../src-tauri/src/plugins.rs', import.meta.url),
  'utf8'
)
const pluginIndexGatewaySource = readFileSync(
  new URL('../../../src-tauri/src/plugin_index_gateway.rs', import.meta.url),
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

test('Tauri registers the list + Stage 5A lifecycle + Stage 5C index/extension commands and the Rust modules', () => {
  assert.match(libSource, /mod plugins;/)
  assert.match(libSource, /mod plugin_index_gateway;/)
  assert.match(
    libSource,
    /plugins::plugins_list,\s*\n\s*plugins::plugins_enable,\s*\n\s*plugins::plugins_disable,\s*\n\s*plugins::plugins_uninstall,\s*\n\s*plugins::plugins_get_log,\s*\n\s*plugins::plugins_open_log,\s*\n\s*plugins::plugins_install_from_path,\s*\n\s*plugins::plugins_choose_and_install,\s*\n\s*plugins::plugins_list_index,\s*\n\s*plugins::plugins_refresh_index,\s*\n\s*plugins::plugins_get_index_status,\s*\n\s*plugins::plugins_install_from_index,\s*\n\s*plugins::plugins_set_native_dsp_parameters,\s*\n\s*plugins::providers_list,\s*\n\s*plugins::providers_call,\s*\n\s*plugins::providers_cancel,\s*\n\s*plugins::extensions_list,\s*\n\s*plugins::extensions_execute_command,\s*\n\s*plugins::extensions_read_theme_stylesheet/
  )
  assert.match(libSource, /\.manage\(plugins::ProviderCallRegistry::default\(\)\)/)
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
  assert.match(
    pluginsSource,
    /#\[tauri::command\]\s*pub async fn providers_call\(\s*app: AppHandle,\s*registry: State<'_, ProviderCallRegistry>,\s*provider_id: String,\s*method: String,\s*args: Option<Value>,\s*options: Option<Value>,\s*\) -> Result<Value, String>/
  )
  assert.match(
    pluginsSource,
    /#\[tauri::command\]\s*pub fn providers_cancel\(\s*registry: State<'_, ProviderCallRegistry>,\s*request_id: String,\s*\) -> Result<\(\), String>/
  )
})

test('Rust plugin-index gateway proxies index JSON and .tep bytes through the node sidecar', () => {
  // Stage 5C commands (plugins_install_from_path / *_index / extensions_*) proxy the
  // marketplace fetch through this std-TCP gateway, mirroring the ncm_gateway design.
  assert.match(pluginIndexGatewaySource, /pub const GATEWAY_HOST: &str = "127\.0\.0\.1";/)
  assert.match(pluginIndexGatewaySource, /pub const GATEWAY_PORT: u16 = 3101;/)
  assert.match(pluginIndexGatewaySource, /pub fn port_open\(\) -> bool/)
  assert.match(
    pluginIndexGatewaySource,
    /pub async fn proxy_index_json\(timeout: Duration\) -> Result<Value, String>/
  )
  assert.match(
    pluginIndexGatewaySource,
    /pub async fn proxy_package_bytes\(source_url: &str, timeout: Duration\) -> Result<Vec<u8>, String>/
  )
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

test('Rust provider RPC mirrors Electron normalization and timeout tiers', () => {
  // Contract constants mirror src/main/ipc/plugins.ts.
  assert.match(pluginsSource, /const MAX_PROVIDER_ID_LENGTH: usize = 128;/)
  assert.match(pluginsSource, /const MAX_PROVIDER_ARGS: usize = 16;/)
  assert.match(pluginsSource, /const MAX_PROVIDER_ARGS_BYTES: usize = 512 \* 1024;/)
  assert.match(pluginsSource, /const TWILIGHT_MEDIA_PROVIDER_METHODS: \[&str; 56\]/)
  assert.match(
    pluginsSource,
    /const HOST_ONLY_PROVIDER_METHODS: \[&str; 4\] = \[\s*"createDownload",\s*"getDownloadStatus",\s*"getDownloadFile",\s*"cancelDownload",\s*\]/
  )
  // Timeout tiers mirror manager.ts getProviderCallTimeoutMs.
  assert.match(pluginsSource, /const PLUGIN_PROVIDER_DEFAULT_TIMEOUT_MS: u32 = 15000;/)
  assert.match(pluginsSource, /const PLUGIN_PROVIDER_MEDIUM_TIMEOUT_MS: u32 = 30000;/)
  assert.match(pluginsSource, /const PLUGIN_PROVIDER_SLOW_TIMEOUT_MS: u32 = 120000;/)
  assert.match(pluginsSource, /const PROVIDER_SLOW_TIMEOUT_METHODS: \[&str; 18\]/)
  assert.match(pluginsSource, /const PROVIDER_MEDIUM_TIMEOUT_METHODS: \[&str; 8\]/)
  // Normalization helpers mirror normalizeProviderId / normalizeProviderMethod /
  // normalizePluginIpcArgs / normalizeProviderCallOptions.
  assert.match(pluginsSource, /fn normalize_provider_id\(value: &str\) -> Result<String, String>/)
  assert.match(
    pluginsSource,
    /fn normalize_provider_method\(value: &str\) -> Result<String, String>/
  )
  assert.match(
    pluginsSource,
    /fn normalize_provider_args\(value: Option<Value>\) -> Result<Value, String>/
  )
  assert.match(
    pluginsSource,
    /fn normalize_provider_call_options\(\s*value: Option<Value>,\s*\) -> Result<\(Option<String>, Option<String>\), String>/
  )
  assert.match(pluginsSource, /fn get_provider_call_timeout_ms\(method: &str\) -> u32/)
})

test('Rust persists provider health and merges it into providers_list', () => {
  assert.match(
    pluginsSource,
    /fn provider_health_path\(policy: &path_policy::PathPolicy\) -> PathBuf/
  )
  assert.match(
    pluginsSource,
    /categorized_app_path\(\s*policy,\s*"plugins",\s*&\["provider-health\.json"\],\s*"provider-health\.json",\s*\)/
  )
  assert.match(
    pluginsSource,
    /fn read_provider_health\(policy: &path_policy::PathPolicy\) -> Value/
  )
  assert.match(
    pluginsSource,
    /fn write_provider_health\(policy: &path_policy::PathPolicy, health: &Value\)/
  )
  assert.match(pluginsSource, /fn record_provider_call\(/)
  assert.match(
    pluginsSource,
    /fn provider_health_descriptor\(record: Option<&Value>, plugin_status: &str\) -> Value/
  )
  // providers_list now merges the persisted health descriptor into the bundled
  // NCM registration instead of returning a bare static descriptor.
  assert.match(pluginsSource, /provider_health_descriptor\(record, "enabled"\)/)
})

test('Rust providers_call gates on plugin enabled state and proxies NCM via the node gateway prototype', () => {
  assert.match(pluginsSource, /async fn dispatch_ncm_provider_call\(/)
  assert.match(pluginsSource, /"getQrKey" => "\/login\/qr\/key"/)
  assert.match(pluginsSource, /原型尚未映射 NCM 方法 \{method\} 到网关路径（\{provider_id\}）/)
  assert.match(pluginsSource, /Provider 未启用：\{provider_id\}/)
  assert.match(
    pluginsSource,
    /record_provider_call\(&policy, &provider_id, &method, false, Some\(&error\)\)/
  )
})

test('bundled NCM plugin and plugin-index are packaged into the Tauri resources', () => {
  assert.match(tauriConf, /"resources": \{/)
  assert.match(tauriConf, /"\.\.\/resources\/plugins\/ncm-provider": "plugins\/ncm-provider"/)
  assert.match(tauriConf, /"\.\.\/resources\/plugin-index": "plugin-index"/)
})

test('tauriHostBridge wires list + lifecycle + Stage 5C install/index/extension commands to invoke()', () => {
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
  // Stage 5C turned .tep install and marketplace index operations into real commands.
  assert.match(
    bridgeSource,
    /installFromPath: \(path: string\) => invoke\('plugins_install_from_path', \{ sourcePath: path \}\)/
  )
  assert.match(bridgeSource, /chooseAndInstall: \(\) => invoke\('plugins_choose_and_install'\)/)
  assert.match(bridgeSource, /listIndex: \(\) => invoke\('plugins_list_index'\)/)
  assert.match(bridgeSource, /refreshIndex: \(\) => invoke\('plugins_refresh_index'\)/)
  assert.match(bridgeSource, /getIndexStatus: \(\) => invoke\('plugins_get_index_status'\)/)
  assert.match(
    bridgeSource,
    /installFromIndex: \(id: string\) => invoke\('plugins_install_from_index', \{ id \}\)/
  )
  assert.match(
    bridgeSource,
    /setNativeDspParameters: \(id: string, parameters: Record<string, number>\) =>\s*invoke\('plugins_set_native_dsp_parameters', \{ id, parameters \}\)/
  )
  assert.match(
    bridgeSource,
    /call: \(\s*providerId: string,\s*method: string,\s*args: unknown\[\] = \[\],\s*options\?: \{ idempotencyKey\?: string; requestId\?: string \}\s*\) => invoke\('providers_call', \{ providerId, method, args, options \}\)/
  )
  assert.match(
    bridgeSource,
    /cancel: \(requestId: string\) => invoke\('providers_cancel', \{ requestId \}\)/
  )
  assert.match(
    bridgeSource,
    /executeCommand: \(command: string, args\?: unknown\[\]\) =>\s*invoke\('extensions_execute_command', \{ command, args \}\)/
  )
  assert.match(
    bridgeSource,
    /readThemeStylesheet: \(stylesheetPath: string\) =>\s*invoke\('extensions_read_theme_stylesheet', \{ stylesheetPath \}\)/
  )
  assert.match(bridgeSource, /listInstalled: \(\) => Promise\.reject\(capabilityError\('fonts'\)\)/)
})

test('Tauri capability matrix marks plugins/providers/extensions partial and fonts unsupported', () => {
  assert.match(
    capabilitiesSource,
    /plugins: partial\('plugins', '已支持插件安装\/启停\/卸载\/日志与市场索引'\)/
  )
  assert.match(
    capabilitiesSource,
    /providers: partial\('providers', '已支持调用\/取消与健康记录；网易云网关在 Tauri 不可用'\)/
  )
  assert.match(
    capabilitiesSource,
    /extensions: partial\('extensions', '已支持扩展列表；命令执行与主题样式读取接口已接通'\)/
  )
  assert.match(capabilitiesSource, /fonts: unsupported\('fonts'\)/)
})
