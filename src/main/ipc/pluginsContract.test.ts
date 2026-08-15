import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const pluginIpcSource = readFileSync(new URL('./plugins.ts', import.meta.url), 'utf8')
const managerSource = readFileSync(new URL('../plugins/manager.ts', import.meta.url), 'utf8')
const pluginPageSource = readFileSync(
  new URL('../../renderer/src/components/PluginPage.vue', import.meta.url),
  'utf8'
)
const streamingPageSource = readFileSync(
  new URL('../../renderer/src/components/StreamingPage.vue', import.meta.url),
  'utf8'
)
const streamingLibrarySource = readFileSync(
  new URL('../../renderer/src/components/StreamingLibrary.vue', import.meta.url),
  'utf8'
)

test('bundled NCM provider is auto-registered and enabled by default', () => {
  assert.match(pluginIpcSource, /const bundledPluginIds = \['com\.twilightecho\.provider\.ncm'\]/)
  assert.match(pluginIpcSource, /id: bundledPluginIds\[0\],/)
  assert.match(pluginIpcSource, /sourcePath: bundledPluginPath\('ncm-provider'\),/)
  assert.match(pluginIpcSource, /defaultEnabled: true/)
  assert.match(
    managerSource,
    /enabled: shouldRecoverBundledFailure\s*\?\s*bundled\.defaultEnabled === true\s*:\s*\(previous\?\.enabled \?\? bundled\.defaultEnabled === true\)/
  )
})

test('providers:list IPC surfaces running provider registrations with health', () => {
  assert.match(pluginIpcSource, /ipcMain\.handle\('providers:list',/)
  assert.match(pluginIpcSource, /return runtime\.pluginManager!\.listProviders\(\)/)
  assert.match(managerSource, /listProviders\(\): TwilightMediaProviderRegistration\[\] \{/)
  assert.match(
    managerSource,
    /dedupeProviderRegistrations\(this\.running\.values\(\)\)\.map\(\(provider\) => \(\{/
  )
  assert.match(managerSource, /health: this\.getProviderHealth\(provider\.id\)/)
})

test('providers:call normalizes and routes to the owning provider while gating host-only methods', () => {
  assert.match(pluginIpcSource, /ipcMain\.handle\(\s*'providers:call',/)
  assert.match(pluginIpcSource, /normalizeProviderId\(providerId\)/)
  assert.match(pluginIpcSource, /normalizeProviderMethod\(method\)/)
  assert.match(
    pluginIpcSource,
    /normalizePluginIpcArgs\(args, 'provider call args', MAX_PROVIDER_ARGS\)/
  )
  assert.match(pluginIpcSource, /normalizeProviderCallOptions\(options\)/)
  assert.match(pluginIpcSource, /\{ \.\.\.normalizedOptions, signal: controller\.signal \}/)
  assert.match(
    pluginIpcSource,
    /HOST_ONLY_PROVIDER_METHODS = new Set<TwilightMediaProviderMethod>\(\[/
  )
  assert.match(pluginIpcSource, /'provider download methods are host-only'/)
})

test('plugin enable, disable and log IPC handlers route to the plugin manager', () => {
  assert.match(pluginIpcSource, /ipcMain\.handle\('plugins:enable',/)
  assert.match(pluginIpcSource, /runtime\.pluginManager!\.enable\(normalizePluginId\(id\)\)/)
  assert.match(pluginIpcSource, /ipcMain\.handle\('plugins:disable',/)
  assert.match(pluginIpcSource, /runtime\.pluginManager!\.disable\(normalizePluginId\(id\)\)/)
  assert.match(pluginIpcSource, /ipcMain\.handle\('plugins:openLog',/)
  assert.match(pluginIpcSource, /runtime\.pluginManager!\.openLog\(normalizePluginId\(id\)\)/)
  assert.match(pluginIpcSource, /ipcMain\.handle\('plugins:getLog',/)
  assert.match(pluginIpcSource, /runtime\.pluginManager!\.getLog\(normalizePluginId\(id\)\)/)
})

test('failed plugins stay visible with a reason and renderer log access', () => {
  assert.match(
    managerSource,
    /status: error\s*\?\s*'invalid'\s*:\s*state\?\.lastError\s*\?\s*'failed'/
  )
  assert.match(managerSource, /error: error \?\? state\?\.lastError \?\? null,/)
  assert.match(managerSource, /await this\.startPlugin\(descriptor\)\.catch\(\(error\) => \{/)
  assert.match(managerSource, /this\.markFailed\(\s*descriptor\.id,/)
  assert.match(pluginPageSource, /<div v-if="plugin\.error"/)
  assert.match(pluginPageSource, /pi-exclamation-circle/)
  assert.match(pluginPageSource, /v-if="!plugin\.builtIn \|\| plugin\.error"/)
  assert.match(pluginPageSource, /@click="openLog\(plugin\)"/)
  assert.match(pluginPageSource, /window\.api\.plugins\.openLog\(plugin\.id\)/)
  assert.match(pluginPageSource, /aria-checked="plugin\.enabled"/)
  assert.match(pluginPageSource, /\{\{ plugin\.enabled \? '已启用' : '已停用' \}\}/)
})

test('unified library selector and provider fallback chain are wired through the streaming page', () => {
  assert.match(streamingPageSource, /getUnifiedLibraryProviders\(/)
  assert.match(streamingPageSource, /const libraryProviderOptions = computed/)
  assert.match(streamingPageSource, /const activeProvider = computed<string>\(\(\) => \{/)
  assert.match(
    streamingPageSource,
    /return libraryProviders\.value\[0\]\?\.id \?\? NCM_PROVIDER_ID/
  )
  assert.match(
    streamingPageSource,
    /settingsStore\.updateSettings\(\{ streamingActiveProvider: provider \}\)/
  )
  assert.match(
    streamingPageSource,
    /isExternalActive \? `\$\{activeProviderLabel\} 插件已停用` : '网易云音乐插件已停用'/
  )
  assert.match(streamingPageSource, /请在设置的插件页重新启用/)
  assert.match(
    streamingPageSource,
    /\/Provider 未启用\|provider is disabled\|does not implement\/i/
  )
  assert.match(
    streamingLibrarySource,
    /const canSwitchProvider = computed\(\(\) => providerOptions\.value\.length > 1\)/
  )
  assert.match(streamingLibrarySource, /v-if="canSwitchProvider" class="provider-switcher"/)
  assert.match(streamingLibrarySource, /@mousedown\.prevent="selectProvider\(provider\.id\)"/)
})
