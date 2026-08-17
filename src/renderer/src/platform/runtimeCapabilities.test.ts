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
  getRuntimeKind,
  loadRuntimeManifest,
  UNSUPPORTED_CAPABILITY_CODE,
  type RuntimeCapabilityId
} from './runtimeCapabilities.ts'

import {
  buildRuntimeManifest,
  runtimeCapabilitiesForManifest,
  missingMethodsForCapability
} from '../../../shared/runtimeManifest.ts'

/* ── Behavioral: the capability matrix itself ─────────────────────────── */

test('Electron is the full-featured baseline: every capability is supported', () => {
  const matrix = getRuntimeCapabilities(false)
  for (const state of Object.values(matrix)) {
    assert.equal(state.status, 'supported', `expected ${state.id} to be supported`)
    assert.equal(state.code, 'runtime-supported')
  }
})

test('Tauri matrix marks partially migrated surfaces partial and none fully unsupported', () => {
  const matrix = getRuntimeCapabilities(true)
  // Stage 3 wired real persistence for settings/data/themes/fonts; every
  // capability is now at least partial on Tauri.
  assert.equal(matrix.fonts.status, 'partial')
  assert.match(matrix.fonts.message, /系统字体枚举已支持/)
  assert.notEqual(matrix.fonts.code, UNSUPPORTED_CAPABILITY_CODE)
  assert.equal(matrix.settings.status, 'partial')
  for (const id of [
    'settings',
    'plugins',
    'providers',
    'extensions',
    'data',
    'themes',
    'localLibrary',
    'audioEngine',
    'fonts'
  ] as const) {
    assert.equal(matrix[id].status, 'partial', `${id} is a partial migration on Tauri`)
  }
})

test('getCapabilityState / isCapabilitySupported route through the same matrix', () => {
  assert.equal(getCapabilityState('plugins', true).status, 'partial')
  assert.equal(getCapabilityState('plugins', false).status, 'supported')
  assert.equal(isCapabilitySupported('plugins', true), false)
  assert.equal(isCapabilitySupported('plugins', false), true)
  assert.equal(isCapabilitySupported('settings', true), false)
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

test('RuntimeCapabilityError carries method-level rejection details', () => {
  const error = new RuntimeCapabilityError('localLibrary', '未接通', {
    surface: 'fs',
    method: 'readAudioFile',
    reasonCode: 'transport-not-migrated',
    recoverable: false
  })
  assert.equal(error.surface, 'fs')
  assert.equal(error.method, 'readAudioFile')
  assert.equal(error.reasonCode, 'transport-not-migrated')
  assert.equal(error.code, 'transport-not-migrated')
  assert.equal(error.recoverable, false)
})
test('isRuntimeCapabilityError distinguishes capability gaps from other failures', () => {
  assert.equal(isRuntimeCapabilityError(new RuntimeCapabilityError('providers')), true)
  assert.equal(isRuntimeCapabilityError(new Error('boom')), false)
  assert.equal(isRuntimeCapabilityError(null), false)
  assert.equal(isRuntimeCapabilityError('plugins'), false)
})

test('runtime detection is safe in a non-browser environment', () => {
  assert.equal(isTauriRuntime(), false)
  assert.equal(getRuntimeKind(), 'web')
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

test('runtime manifest derives method states and aggregate capability details', () => {
  const manifest = buildRuntimeManifest({
    runtimeKind: 'tauri',
    os: 'windows',
    arch: 'x86_64',
    version: '1.0.5',
    checkedAt: '2026-08-16T00:00:00Z',
    isWindows: true
  })
  const plugins = manifest.surfaces.find((surface) => surface.surface === 'plugins')
  assert.equal(plugins?.methods.find((method) => method.method === 'list')?.state, 'supported')
  assert.equal(plugins?.methods.find((method) => method.method === 'onChanged')?.state, 'unavailable')
  const aggregates = runtimeCapabilitiesForManifest(manifest)
  assert.equal(aggregates.plugins.status, 'partial')
  assert.ok(missingMethodsForCapability(manifest, 'plugins').some((method) => method.method === 'onChanged'))
})

test('web runtime manifest marks methods unsupported', () => {
  const manifest = buildRuntimeManifest({
    runtimeKind: 'web',
    os: 'unknown',
    arch: 'unknown',
    version: 'unknown',
    checkedAt: '2026-08-16T00:00:00Z'
  })
  assert.ok(manifest.surfaces.every((surface) => surface.methods.every((method) => method.state === 'unsupported')))
})



test('Tauri bridge rejects unmigrated methods instead of returning business-shaped defaults', () => {
  const source = readFileSync(new URL('./tauriHostBridge.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /makeStubMethod|makeStubSurface|warnedStubMethods|emptyThemeLibrarySnapshot/)
  assert.match(source, /function rejectMethod\(surface: string, method: string\)/)
  assert.match(source, /onNavigate: \(cb: \(target: TrayNavigationTarget\) => void\) =>/)
  assert.match(source, /consumePendingNavigation: \(\) =>/)
  // Stage 4 wired the local library scan surface; methods that still lack a
  // backend (watcher status, tag writer, duplicate detection) fall through the
  // surrogate proxy reject and are not declared as fake defaults.
  assert.match(source, /scanStartup: \(\) => invoke\('library_scan_startup'\)/)
  assert.match(source, /getCover: \(handle: string\) => invoke<string \| null>\('data_get_cover', \{ handle \}\)/)
  // The remote-cover grant has no Tauri backend; a surrogate-proxy reject would
  // pass this by falling through, so it must be declared explicitly.
  assert.match(source, /grantRemoteCover: rejectMethod\('data', 'grantRemoteCover'\)/)
})

test('Tauri bridge rejects unmigrated writes instead of returning success or default snapshots', () => {
  const source = readFileSync(new URL('./tauriHostBridge.ts', import.meta.url), 'utf8')
  // settings sub-surfaces that previously returned null/0/'{}'/[] fake success.
  // Stage 7D wired exportBackup/importBackup to real commands; the remaining
  // dialog/path-copy methods still reject explicitly.
  for (const method of ['chooseCacheFolder', 'chooseBackgroundImage', 'importBackgroundImage']) {
    assert.match(
      source,
      new RegExp(`${method}: rejectMethod\\('settings', '${method}'\\)`),
      `settings.${method} must reject, not return a fake default`
    )
  }
  // settings.onChanged now subscribes via @tauri-apps/api/event (Stage 3).
  // themes import/export/asset (zip boundary) still reject; library CRUD is real.
  for (const method of ['importTheme', 'exportTheme', 'importAsset', 'validateAssets', 'copyAssets']) {
    assert.match(
      source,
      new RegExp(`${method}: rejectMethod\\('themes', '${method}'\\)`),
      `themes.${method} must reject, not return a default snapshot`
    )
  }
  // data session/playlist writes now persist through real versioned commands.
  // plugins.onChanged is a fake event source; it must reject, not no-op.
  assert.match(source, /onChanged: rejectMethod\('plugins', 'onChanged'\)/)
  // ncmCloud and miniPlayer must reject instead of returning fake transfer/settings shapes.
  assert.match(source, /upload: rejectMethod\('ncmCloud', 'upload'\)/)
  assert.match(source, /download: rejectMethod\('ncmCloud', 'download'\)/)
  // Stage 7A wired the miniPlayer window through real commands; the remaining
  // main-window settings sub-surfaces of miniPlayer that lack a Tauri backend
  // fall through the surrogate proxy reject.
  assert.match(source, /getBootstrap: \(\) => invoke\('mini_player_get_bootstrap'\)/)
  assert.match(source, /updateSettings: \(patch\) => invoke\('mini_player_update_settings', \{ patch \}\)/)
})

test('Tauri bridge wires Stage 3 persistence (settings cache, data, themes, fonts) to invoke()', () => {
  const source = readFileSync(new URL('./tauriHostBridge.ts', import.meta.url), 'utf8')
  // settings cache size / clear / shortcut statuses are real commands.
  assert.ok(source.includes("invoke<number>('settings_get_cache_size'"), 'settings.getCacheSize must invoke settings_get_cache_size')
  assert.ok(source.includes("invoke<number>('settings_clear_cache'"), 'settings.clearCache must invoke settings_clear_cache')
  assert.ok(source.includes("invoke('settings_get_shortcut_statuses'"), 'settings.getShortcutStatuses must invoke settings_get_shortcut_statuses')
  // Stage 7D wired backup export/import through real commands; paths with
  // system-dialog/copy semantics still reject explicitly.
  assert.ok(
    source.includes("exportBackup: () => invoke<string>('settings_export_backup')"),
    'settings.exportBackup must invoke settings_export_backup'
  )
  assert.ok(
    source.includes("importBackup: (json: string) => invoke<SettingsSnapshot>('settings_import_backup', { jsonString: json })"),
    'settings.importBackup must invoke settings_import_backup'
  )
  // settings/themes change events subscribe through the Tauri event bridge.
  assert.ok(
    source.includes("subscribeToTauriEvent<SettingsSnapshot>('settings:changed', cb)"),
    'settings.onChanged must subscribe to settings:changed'
  )
  assert.ok(
    source.includes("subscribeToTauriEvent<ThemeLibrarySnapshot>('themes:changed', cb)"),
    'themes.onChanged must subscribe to themes:changed'
  )
  // data session / playlists / lyrics management / bookmarks persistence.
  for (const [method, command] of [
    ['loadPlaybackSession', 'data_load_playback_session'],
    ['savePlaybackSession', 'data_save_playback_session'],
    ['clearPlaybackSession', 'data_clear_playback_session'],
    ['loadPlaylists', 'data_load_playlists'],
    ['savePlaylists', 'data_save_playlists'],
    ['loadLyricsManagement', 'data_load_lyrics_management'],
    ['saveLyricsManagement', 'data_save_lyrics_management'],
    ['loadPlaybackBookmarks', 'data_load_playback_bookmarks'],
    ['savePlaybackBookmarks', 'data_save_playback_bookmarks']
  ] as const) {
    assert.ok(
      source.includes(`invoke('${command}'`),
      `data.${method} must invoke ${command}`
    )
  }
  // themes library CRUD is real.
  assert.ok(source.includes("invoke('themes_get_bootstrap'"), 'themes.getBootstrap must invoke themes_get_bootstrap')
  assert.ok(source.includes("invoke('themes_list'"), 'themes.list must invoke themes_list')
  assert.ok(
    source.includes("invoke('themes_save', { profile, expectedRevision }"),
    'themes.save must invoke themes_save with profile + expectedRevision'
  )
  assert.ok(
    source.includes("invoke('themes_set_active', { selection, expectedRevision }"),
    'themes.setActive must invoke themes_set_active with selection + expectedRevision'
  )
  // fonts enumeration is a real command.
  assert.ok(source.includes("invoke<string[]>('fonts_list_installed'"), 'fonts.listInstalled must invoke fonts_list_installed')
})
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

test('Tauri bridge wires provider call/cancel, extension commands, and fonts enumeration', () => {
  const source = readFileSync(new URL('./tauriHostBridge.ts', import.meta.url), 'utf8')
  assert.match(
    source,
    /fonts: \{\s*listInstalled: \(\) => invoke<string\[\]>\('fonts_list_installed'\)/,
    'fonts.listInstalled must invoke the real fonts_list_installed command'
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
