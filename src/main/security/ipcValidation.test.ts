import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const {
  normalizeFiniteNumber,
  normalizeInteger,
  normalizeIpcArray,
  normalizeIpcString,
  normalizeOptionalIpcString,
  stringifyJsonForIpcStorage
} = (await import(new URL('./ipcValidation.ts', import.meta.url).href)) as typeof import('./ipcValidation')

test('normalizes IPC strings and rejects control characters or oversized input', () => {
  assert.equal(normalizeIpcString('  ok  ', 'field'), 'ok')
  assert.equal(normalizeOptionalIpcString('', 'field'), undefined)
  assert.throws(() => normalizeIpcString('bad\nvalue', 'field'), /invalid characters/)
  assert.throws(() => normalizeIpcString('x'.repeat(5), 'field', 4), /too long/)
  assert.throws(() => normalizeIpcString(null, 'field'), /must be a string/)
})

test('normalizes finite numbers and arrays from untrusted IPC input', () => {
  assert.equal(normalizeFiniteNumber(2, 'value', 0, 0, 1), 1)
  assert.equal(normalizeFiniteNumber(Number.NaN, 'value', 0.5, 0, 1), 0.5)
  assert.equal(normalizeInteger(2.9, 'value', 0, 0, 10), 2)
  assert.deepEqual(
    normalizeIpcArray([1, 'x', 2, 3], 'items', 3, (item) =>
      typeof item === 'number' ? item * 2 : null
    ),
    [2, 4]
  )
})

test('limits JSON payloads before writing renderer-controlled data to disk', () => {
  assert.equal(stringifyJsonForIpcStorage({ ok: true }, 'payload', 32), '{"ok":true}')
  assert.throws(() => stringifyJsonForIpcStorage('x'.repeat(32), 'payload', 8), /too large/)
  assert.throws(() => stringifyJsonForIpcStorage(undefined, 'payload', 8), /serializable/)
})

test('data IPC applies path and storage limits before touching local files', () => {
  const source = readFileSync(new URL('../ipc/data.ts', import.meta.url), 'utf8')

  assert.match(source, /const MAX_MUSIC_LIBRARY_BYTES = 100 \* 1024 \* 1024/)
  assert.match(source, /stringifyJsonForIpcStorage\(library, 'music library', MAX_MUSIC_LIBRARY_BYTES\)/)
  assert.match(source, /stringifyJsonForIpcStorage\(session, 'playback session', MAX_PLAYBACK_SESSION_BYTES\)/)
  assert.match(source, /stringifyJsonForIpcStorage\(playlists, 'playlists', MAX_PLAYLISTS_BYTES\)/)
  assert.match(source, /normalizeLocalPath\(folderPath, 'music folder path'\)/)
  assert.match(source, /resolveAuthorizedAudioFile\(normalizeLocalPath\(filePath, 'audio file path'\)\)/)
  assert.match(source, /normalizeCoverDataUrl\(handle\)/)
  assert.match(source, /resolveAuthorizedAudioFile\(normalizeLocalPath\(filePath, 'lyrics audio file path'\)\)/)
})

test('plugin and NCM IPC validate renderer-controlled IDs, methods, paths, and payload sizes', () => {
  const pluginsSource = readFileSync(new URL('../ipc/plugins.ts', import.meta.url), 'utf8')
  const ncmSource = readFileSync(new URL('../ncm/api.ts', import.meta.url), 'utf8')
  const providerRoutingSource = readFileSync(
    new URL('../plugins/providerRouting.ts', import.meta.url),
    'utf8'
  )

  assert.match(providerRoutingSource, /export function isTwilightMediaProviderMethod/)
  assert.match(pluginsSource, /normalizePluginId\(id\)/)
  assert.match(pluginsSource, /normalizeProviderId\(providerId\)/)
  assert.match(pluginsSource, /normalizeProviderMethod\(method\)/)
  assert.match(pluginsSource, /normalizePluginIpcArgs\(args, 'provider call args', MAX_PROVIDER_ARGS\)/)
  assert.match(pluginsSource, /stringifyJsonForIpcStorage\(args, field, MAX_PLUGIN_IPC_ARGS_BYTES\)/)
  assert.match(pluginsSource, /normalizeNativeDspParameters\(parameters\)/)
  assert.match(pluginsSource, /realpathSync\(/)

  assert.match(ncmSource, /const MAX_NCM_API_PATH_LENGTH = 4096/)
  assert.match(ncmSource, /normalizeNcmApiPath\(path\)/)
  assert.match(ncmSource, /normalizeNcmCookie\(cookie\)/)
  assert.match(ncmSource, /normalizeNcmSongId\(songId\)/)
  assert.match(ncmSource, /normalizeIpcString\(url, 'NCM cache url', MAX_NCM_REMOTE_URL_LENGTH\)/)
})

test('settings, background image, OPRA, and BPM IPC apply input limits before expensive work', () => {
  const dataSource = readFileSync(new URL('../ipc/data.ts', import.meta.url), 'utf8')
  const coverCacheSource = readFileSync(new URL('../library/coverCache.ts', import.meta.url), 'utf8')
  const opraSource = readFileSync(new URL('../ipc/opra.ts', import.meta.url), 'utf8')
  const bpmSource = readFileSync(new URL('../bpm/bpmIpc.ts', import.meta.url), 'utf8')

  assert.match(coverCacheSource, /export const MAX_BACKGROUND_IMAGE_BYTES = 20 \* 1024 \* 1024/)
  assert.match(coverCacheSource, /fileStat\.size > MAX_BACKGROUND_IMAGE_BYTES/)
  assert.match(dataSource, /const MAX_SETTINGS_PATCH_BYTES = 512 \* 1024/)
  assert.match(dataSource, /const MAX_SETTINGS_BACKUP_BYTES = 2 \* 1024 \* 1024/)
  assert.match(dataSource, /stringifyJsonForIpcStorage\(patch, 'settings patch', MAX_SETTINGS_PATCH_BYTES\)/)
  assert.match(dataSource, /Buffer\.byteLength\(json, 'utf-8'\) > MAX_SETTINGS_BACKUP_BYTES/)
  assert.match(dataSource, /normalizeNcmCookieForSave\(cookie\)/)
  assert.match(dataSource, /stringifyJsonForIpcStorage\(data, 'Discord activity', MAX_DISCORD_ACTIVITY_BYTES\)/)

  assert.match(opraSource, /normalizeOptionalIpcString\(query, 'OPRA query', MAX_OPRA_QUERY_LENGTH\)/)
  assert.match(opraSource, /normalizeOptionalIpcString\(eqId, 'OPRA profile id', MAX_OPRA_PROFILE_ID_LENGTH\)/)
  assert.match(bpmSource, /await resolvePlayableAudioFile/)
  assert.match(bpmSource, /normalizeIpcString\(value\.filePath, 'BPM file path', MAX_BPM_FILE_PATH_LENGTH\)/)
})

test('Electron documents use local CSP, denied permissions, and trusted IPC sender checks', () => {
  const electronSecuritySource = readFileSync(new URL('./electronSecurity.ts', import.meta.url), 'utf8')
  const lifecycleSource = readFileSync(new URL('../app/lifecycle.ts', import.meta.url), 'utf8')
  const rendererHtml = readFileSync(new URL('../../renderer/index.html', import.meta.url), 'utf8')
  const dataSource = readFileSync(new URL('../ipc/data.ts', import.meta.url), 'utf8')
  const pluginsSource = readFileSync(new URL('../ipc/plugins.ts', import.meta.url), 'utf8')
  const audioIpcSource = readFileSync(new URL('../audio/engineIpc.ts', import.meta.url), 'utf8')
  const desktopLyricsSource = readFileSync(
    new URL('../integrations/desktopLyrics.ts', import.meta.url),
    'utf8'
  )

  assert.match(lifecycleSource, /installElectronSecurity\(\)/)
  assert.match(electronSecuritySource, /setPermissionRequestHandler/)
  assert.match(electronSecuritySource, /callback\(false\)/)
  assert.match(electronSecuritySource, /setPermissionCheckHandler\(\(\) => false\)/)
  assert.match(electronSecuritySource, /onHeadersReceived/)
  assert.match(electronSecuritySource, /Content-Security-Policy/)
  assert.match(electronSecuritySource, /default-src 'none'/)
  assert.match(electronSecuritySource, /script-src \$\{scriptSrc\}/)
  assert.match(electronSecuritySource, /Permissions-Policy/)
  assert.doesNotMatch(rendererHtml, /unpkg\.com|fonts\.googleapis\.com|unsafe-inline' https:/)
  assert.match(rendererHtml, /script-src 'self'/)

  assert.match(dataSource, /assertTrustedIpcSender|shouldAcceptIpcEvent/)
  assert.match(pluginsSource, /assertTrustedIpcSender/)
  assert.match(audioIpcSource, /assertTrustedIpcSender/)
  assert.match(desktopLyricsSource, /shouldAcceptIpcEvent/)
})
