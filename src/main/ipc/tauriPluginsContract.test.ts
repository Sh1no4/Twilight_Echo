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

test('Tauri registers the three read-only list commands and the Rust module', () => {
  assert.match(libSource, /mod plugins;/)
  assert.match(
    libSource,
    /plugins::plugins_list,\s*\n\s*plugins::providers_list,\s*\n\s*plugins::extensions_list/
  )
  assert.match(
    pluginsSource,
    /#\[tauri::command\]\s*pub fn plugins_list\(app: AppHandle\) -> Value/
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

test('Rust providers_list gates the static NCM registration on the real bundled manifest', () => {
  assert.match(pluginsSource, /fn bundled_plugin_root\(app: &AppHandle\) -> Option<PathBuf>/)
  assert.match(pluginsSource, /fn bundled_ncm_provider_registration\(\) -> Value/)
  assert.match(pluginsSource, /BUNDLED_NCM_PROVIDER_ID: &str = "ncm"/)
  assert.match(
    pluginsSource,
    /Ok\(manifest\) if manifest\.get\("id"\)\.and_then\(Value::as_str\) == Some\(BUNDLED_PLUGIN_ID\)/
  )
})

test('bundled NCM plugin is packaged into the Tauri resources', () => {
  assert.match(tauriConf, /"resources": \{/)
  assert.match(tauriConf, /"\.\.\/resources\/plugins\/ncm-provider": "plugins\/ncm-provider"/)
})

test('tauriHostBridge wires the three lists to invoke() and keeps write ops rejected', () => {
  assert.match(bridgeSource, /plugins: \{[\s\S]*?list: \(\) => invoke\('plugins_list'\)/)
  assert.match(bridgeSource, /providers: \{[\s\S]*?list: \(\) => invoke\('providers_list'\)/)
  assert.match(bridgeSource, /extensions: \{[\s\S]*?list: \(\) => invoke\('extensions_list'\)/)
  // Write / side-effect operations must still be explicitly disabled.
  assert.match(
    bridgeSource,
    /installFromPath: \(\) => Promise\.reject\(capabilityError\('plugins'\)\)/
  )
  assert.match(
    bridgeSource,
    /chooseAndInstall: \(\) => Promise\.reject\(capabilityError\('plugins'\)\)/
  )
  assert.match(bridgeSource, /enable: \(\) => Promise\.reject\(capabilityError\('plugins'\)\)/)
  assert.match(bridgeSource, /disable: \(\) => Promise\.reject\(capabilityError\('plugins'\)\)/)
  assert.match(bridgeSource, /uninstall: \(\) => Promise\.reject\(capabilityError\('plugins'\)\)/)
  assert.match(bridgeSource, /listIndex: \(\) => Promise\.reject\(capabilityError\('plugins'\)\)/)
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
    /plugins: partial\('plugins', '已支持插件列表；安装与启停待迁移'\)/
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
