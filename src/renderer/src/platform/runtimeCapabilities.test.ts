import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  RuntimeCapabilityError,
  getCapabilityState,
  getRuntimeCapabilities,
  isCapabilitySupported,
  isRuntimeCapabilityError,
  isTauriRuntime,
  UNSUPPORTED_CAPABILITY_CODE,
  type RuntimeCapabilityId
} from './runtimeCapabilities.ts'

/* ── Behavioral: the capability matrix itself ─────────────────────────── */

test('Electron is the full-featured baseline: every capability is supported', () => {
  const matrix = getRuntimeCapabilities(false)
  for (const state of Object.values(matrix)) {
    assert.equal(state.status, 'supported', `expected ${state.id} to be supported`)
    assert.equal(state.code, 'runtime-supported')
  }
})

test('Tauri matrix marks the read-only list surfaces partial and fonts unsupported', () => {
  const matrix = getRuntimeCapabilities(true)
  // Only fonts is still fully unimplemented on Tauri.
  assert.equal(matrix.fonts.status, 'unsupported')
  assert.equal(matrix.fonts.code, UNSUPPORTED_CAPABILITY_CODE)
  assert.match(matrix.fonts.message, /当前运行时不支持/)
  // Settings is implemented on Tauri; list surfaces and the rest are partial.
  assert.equal(matrix.settings.status, 'supported')
  for (const id of [
    'plugins',
    'providers',
    'extensions',
    'data',
    'themes',
    'localLibrary',
    'audioEngine'
  ] as const) {
    assert.equal(matrix[id].status, 'partial', `${id} is a partial migration on Tauri`)
  }
})

test('getCapabilityState / isCapabilitySupported route through the same matrix', () => {
  assert.equal(getCapabilityState('plugins', true).status, 'partial')
  assert.equal(getCapabilityState('plugins', false).status, 'supported')
  assert.equal(isCapabilitySupported('plugins', true), false)
  assert.equal(isCapabilitySupported('plugins', false), true)
  assert.equal(isCapabilitySupported('settings', true), true)
  assert.equal(isCapabilitySupported('fonts', true), false)
})

/* ── Behavioral: RuntimeCapabilityError ───────────────────────────────── */

test('RuntimeCapabilityError carries a stable machine-readable code', () => {
  const error = new RuntimeCapabilityError('plugins')
  assert.equal(error.capability, 'plugins')
  assert.equal(error.code, UNSUPPORTED_CAPABILITY_CODE)
  assert.equal(error.name, 'RuntimeCapabilityError')
  assert.match(error.message, /当前运行时不支持/)
})

test('isRuntimeCapabilityError distinguishes capability gaps from other failures', () => {
  assert.equal(isRuntimeCapabilityError(new RuntimeCapabilityError('providers')), true)
  assert.equal(isRuntimeCapabilityError(new Error('boom')), false)
  assert.equal(isRuntimeCapabilityError(null), false)
  assert.equal(isRuntimeCapabilityError('plugins'), false)
})

test('runtime detection is safe in a non-browser environment', () => {
  assert.equal(isTauriRuntime(), false)
  // Every capability id is a valid matrix key.
  const matrix = getRuntimeCapabilities(false)
  const ids = [
    'settings',
    'data',
    'plugins',
    'providers',
    'extensions',
    'fonts',
    'themes',
    'localLibrary',
    'audioEngine'
  ] as RuntimeCapabilityId[]
  for (const id of ids) {
    assert.ok(matrix[id], `matrix missing key ${id}`)
  }
})

/* ── Contract: the Tauri bridge must reject, never lie ────────────────── */

test('Tauri bridge wires plugin lifecycle and Stage 5C install/index commands to invoke()', () => {
  const source = readFileSync(new URL('./tauriHostBridge.ts', import.meta.url), 'utf8')
  const pluginsSection = source.slice(source.indexOf('plugins: {'), source.indexOf('fonts: {'))
  // plugins.list plus the five Stage 5A lifecycle ops are real Tauri commands.
  assert.match(
    pluginsSection,
    /list: \(\) => invoke\('plugins_list'\)/,
    'plugins.list must invoke the real plugins_list command'
  )
  assert.match(
    pluginsSection,
    /enable: \(id: string\) => invoke\('plugins_enable', \{ id \}\)/,
    'plugins.enable must invoke the real plugins_enable command'
  )
  assert.match(
    pluginsSection,
    /disable: \(id: string\) => invoke\('plugins_disable', \{ id \}\)/,
    'plugins.disable must invoke the real plugins_disable command'
  )
  assert.match(
    pluginsSection,
    /uninstall: \(id: string, options\?: \{ removeData\?: boolean \}\) =>\s*invoke\('plugins_uninstall', \{ id, removeData: options\?\.removeData \}\)/,
    'plugins.uninstall must invoke the real plugins_uninstall command'
  )
  assert.match(
    pluginsSection,
    /openLog: \(id: string\) => invoke\('plugins_open_log', \{ id \}\)/,
    'plugins.openLog must invoke the real plugins_open_log command'
  )
  assert.match(
    pluginsSection,
    /getLog: \(id: string\) => invoke\('plugins_get_log', \{ id \}\)/,
    'plugins.getLog must invoke the real plugins_get_log command'
  )
  // Stage 5C turned the .tep install and marketplace index surfaces into real commands.
  assert.match(
    pluginsSection,
    /installFromPath: \(path: string\) => invoke\('plugins_install_from_path', \{ sourcePath: path \}\)/,
    'plugins.installFromPath must invoke the real plugins_install_from_path command'
  )
  assert.match(
    pluginsSection,
    /chooseAndInstall: \(\) => invoke\('plugins_choose_and_install'\)/,
    'plugins.chooseAndInstall must invoke the real plugins_choose_and_install command'
  )
  assert.match(
    pluginsSection,
    /listIndex: \(\) => invoke\('plugins_list_index'\)/,
    'plugins.listIndex must invoke the real plugins_list_index command'
  )
  assert.match(
    pluginsSection,
    /refreshIndex: \(\) => invoke\('plugins_refresh_index'\)/,
    'plugins.refreshIndex must invoke the real plugins_refresh_index command'
  )
  assert.match(
    pluginsSection,
    /getIndexStatus: \(\) => invoke\('plugins_get_index_status'\)/,
    'plugins.getIndexStatus must invoke the real plugins_get_index_status command'
  )
  assert.match(
    pluginsSection,
    /installFromIndex: \(id: string\) => invoke\('plugins_install_from_index', \{ id \}\)/,
    'plugins.installFromIndex must invoke the real plugins_install_from_index command'
  )
  assert.match(
    pluginsSection,
    /setNativeDspParameters: \(id: string, parameters: Record<string, number>\) =>\s*invoke\('plugins_set_native_dsp_parameters', \{ id, parameters \}\)/,
    'plugins.setNativeDspParameters must invoke the real plugins_set_native_dsp_parameters command'
  )
})

test('Tauri bridge wires provider call/cancel and extension command/stylesheet commands while fonts reject', () => {
  const source = readFileSync(new URL('./tauriHostBridge.ts', import.meta.url), 'utf8')
  assert.match(
    source,
    /fonts: \{\s*listInstalled: \(\) => Promise\.reject\(capabilityError\('fonts'\)\)/,
    'fonts.listInstalled must reject with a fonts capability error'
  )
  assert.match(
    source,
    /extensions: \{\s*list: \(\) => invoke\('extensions_list'\)/,
    'extensions.list must invoke the real extensions_list command'
  )
  assert.match(
    source,
    /providers: \{\s*list: \(\) => invoke\('providers_list'\)/,
    'providers.list must invoke the real providers_list command'
  )
  assert.match(
    source,
    /providers: \{\s*list: \(\) => invoke\('providers_list'\)[\s\S]*?call: \(\s*providerId: string,\s*method: string,\s*args: unknown\[\] = \[\],\s*options\?: \{ idempotencyKey\?: string; requestId\?: string \}\s*\) => invoke\('providers_call', \{ providerId, method, args, options \}\)/,
    'providers.call must invoke the real providers_call command'
  )
  assert.match(
    source,
    /cancel: \(requestId: string\) => invoke\('providers_cancel', \{ requestId \}\)/,
    'providers.cancel must invoke the real providers_cancel command'
  )
  assert.match(
    source,
    /extensions: \{\s*list: \(\) => invoke\('extensions_list'\)[\s\S]*?executeCommand: \(command: string, args\?: unknown\[\]\) =>\s*invoke\('extensions_execute_command', \{ command, args \}\)/,
    'extensions.executeCommand must invoke the real extensions_execute_command command'
  )
  assert.match(
    source,
    /readThemeStylesheet: \(stylesheetPath: string\) =>\s*invoke\('extensions_read_theme_stylesheet', \{ stylesheetPath \}\)/,
    'extensions.readThemeStylesheet must invoke the real extensions_read_theme_stylesheet command'
  )
})

/* ── Contract: stores and composables surface the capability state ────── */

test('provider store exposes a structured capability ref, not just an empty list', () => {
  const source = readFileSync(new URL('../stores/useProviderStore.ts', import.meta.url), 'utf8')
  assert.match(source, /providerCapability: Ref<CapabilityState>/)
  assert.match(
    source,
    /const providerCapability = ref<CapabilityState>\(getCapabilityState\('providers'\)\)/
  )
  assert.match(source, /if \(capability\.status === 'unsupported'\)/)
  assert.match(source, /providerCapability,/)
})

test('font picker exposes fontsUnavailable for runtime capability gaps', () => {
  const source = readFileSync(
    new URL('../composables/useLyricsFontPicker.ts', import.meta.url),
    'utf8'
  )
  assert.match(source, /fontsUnavailable: Ref<boolean>/)
  assert.match(
    source,
    /fontsUnavailable = ref\(getCapabilityState\('fonts'\)\.status === 'unsupported'\)/
  )
  assert.match(source, /fontsUnavailable\.value = isRuntimeCapabilityError\(error\)/)
})

test('extension registry swallows capability errors so App bootstrap cannot crash', () => {
  const source = readFileSync(new URL('../extensions/registry.ts', import.meta.url), 'utf8')
  assert.match(source, /if \(isRuntimeCapabilityError\(error\)\) return \[\]/)
})

/* ── Contract: minimal UI unavailability hints ────────────────────────── */

test('plugin page says not-supported instead of no-installed on unsupported runtimes', () => {
  const source = readFileSync(new URL('../components/PluginPage.vue', import.meta.url), 'utf8')
  assert.match(source, /const pluginsUnsupported = computed/)
  assert.match(source, /当前运行时不支持插件系统/)
  assert.match(source, /getCapabilityState\('plugins'\)\.status === 'unsupported'/)
})

test('streaming page distinguishes runtime-unsupported from no-provider-configured', () => {
  const source = readFileSync(new URL('../components/StreamingPage.vue', import.meta.url), 'utf8')
  assert.match(source, /const providerRuntimeUnsupported = computed/)
  assert.match(source, /providerCapability\.value\.status === 'unsupported'/)
  assert.match(source, /当前运行时不支持在线音源/)
})

test('lyrics appearance customizer shows the font capability gap', () => {
  const source = readFileSync(
    new URL('../components/LyricsAppearanceCustomizer.vue', import.meta.url),
    'utf8'
  )
  assert.match(source, /fontPicker\.fontsUnavailable\.value/)
  assert.match(source, /当前运行时不支持/)
})
