import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

function extractFunctionBody(source: string, functionName: string): string {
  const signatureIndex = source.indexOf(`export function ${functionName}`)
  assert.notEqual(signatureIndex, -1, `${functionName} export should exist`)

  const implementationStart = source.slice(signatureIndex).match(/\r?\n} \{/)
  assert.ok(implementationStart?.index != null, `${functionName} implementation should start`)

  const bodyStart = signatureIndex + implementationStart.index + implementationStart[0].length - 1

  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return source.slice(bodyStart + 1, index)
  }

  assert.fail(`${functionName} body should close`)
}

function extractInternalFunctionBody(source: string, functionName: string): string {
  const signature = new RegExp(`(?:async\\s+)?function ${functionName}\\([^)]*\\)[:\\w\\s<>\\[\\]'|]*\\s*\\{`)
  const match = source.match(signature)
  assert.ok(match?.index != null, `${functionName} function should exist`)
  const bodyStart = match.index + match[0].length - 1

  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return source.slice(bodyStart + 1, index)
  }

  assert.fail(`${functionName} body should close`)
}

test('usePlayerStore does not register reactive side effects per caller', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const body = extractFunctionBody(source, 'usePlayerStore')

  assert.match(body, /setupPlayerIntegrationSideEffects\(\)/)
  assert.equal(
    body.includes('watch('),
    false,
    'watchers in usePlayerStore run once per component that calls the store'
  )
})

test('playback info keeps loaded lyrics when reusing the current queue track', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')

  assert.match(source, /function mergeTrackTransientData/)
  assert.match(source, /const mergedTrack = mergeTrackTransientData\(track, currentTrack\.value\)/)
  assert.match(source, /patchTrackInQueues\(updatedTrack\)/)
})

test('desktop lyrics receives the current playback snapshot when enabled', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')

  assert.match(source, /function syncDesktopLyricsSnapshot\(\)/)
  assert.match(source, /window\.api\.desktopLyrics\.updateTrack\(\{/)
  assert.match(source, /window\.api\.desktopLyrics\.updateTime\(currentTime\.value\)/)
  assert.match(
    source,
    /window\.api\.desktopLyrics\.onToggle\(\(enabled: boolean\) => \{\s*if \(enabled\) syncDesktopLyricsSnapshot\(\)\s*\}\)/
  )
})

test('desktop lyrics window replays cached track and time on creation', () => {
  const source = readFileSync(new URL('../../../main/index.ts', import.meta.url), 'utf8')

  assert.match(source, /let latestDesktopLyricsTrack:/)
  assert.match(source, /let latestDesktopLyricsTime = 0/)
  assert.match(source, /function sendDesktopLyricsSnapshot\(\): void/)
  assert.match(source, /desktopLyricsWindow\.webContents\.send\('desktopLyrics:updateTrack', latestDesktopLyricsTrack\)/)
  assert.match(source, /desktopLyricsWindow\.webContents\.send\('desktopLyrics:updateTime', latestDesktopLyricsTime\)/)
  assert.match(source, /latestDesktopLyricsTrack = data/)
  assert.match(source, /latestDesktopLyricsTime = time/)
})

test('desktop lyrics html falls back to untimed plain lyrics', () => {
  const source = readFileSync(new URL('../../../../resources/desktop-lyrics.html', import.meta.url), 'utf8')

  assert.match(source, /function parsePlainLyrics\(lyrics\)/)
  assert.match(source, /function buildMergedLyrics\(lyrics, translatedLyrics\)/)
  assert.match(source, /var plain = parsePlainLyrics\(lyrics\)/)
  assert.match(source, /time: null/)
  assert.match(source, /mergedLines = buildMergedLyrics\(data\.lyrics, data\.translatedLyrics\)/)
})

test('streaming playback resume waits for plugin providers before restoring', () => {
  const appSource = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
  const mainSource = readFileSync(new URL('../../../main/index.ts', import.meta.url), 'utf8')

  assert.match(appSource, /import \{ syncPluginProviders \} from '\.\/providers'/)
  assert.match(
    appSource,
    /await syncPluginProviders\(\)[\s\S]*const restoredSession: PlaybackSession/
  )
  assert.match(mainSource, /let pluginManagerReady: Promise<void> \| null = null/)
  assert.match(mainSource, /pluginManagerReady = pluginManager\s*\.\s*initialize\(\)/)
  assert.match(
    mainSource,
    /ipcMain\.handle\('providers:list', async \(\) => \{\s*await pluginManagerReady\s*return pluginManager!\.listProviders\(\)\s*\}\)/
  )
  assert.match(
    mainSource,
    /'providers:call',[\s\S]*await pluginManagerReady[\s\S]*pluginManager!\.callProvider/
  )
})

test('renderer streaming resume seeks only after media metadata is available', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const playWithRendererAudio = source.match(/async function playWithRendererAudio[\s\S]*?\n}/)?.[0] ?? ''

  assert.match(source, /function seekRendererAudioWhenReady\(/)
  assert.match(source, /audio\.readyState >= HTMLMediaElement\.HAVE_METADATA/)
  assert.match(source, /audio\.addEventListener\('loadedmetadata', applySeek, \{ once: true \}\)/)
  assert.match(playWithRendererAudio, /seekRendererAudioWhenReady\(audio, startTime, track, loadToken\)/)
  assert.equal(
    playWithRendererAudio.includes('audio.currentTime = Math.max(0, startTime)'),
    false,
    'streaming resume must not seek before remote media metadata is available'
  )
})

test('streaming renderer playback is allowed after asynchronous provider URL resolution', () => {
  const mainSource = readFileSync(new URL('../../../main/index.ts', import.meta.url), 'utf8')

  assert.match(
    mainSource,
    /app\.commandLine\.appendSwitch\('autoplay-policy', 'no-user-gesture-required'\)/
  )
})

test('resolved streaming targets are patched back into restored queues', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const loadAndPlay = source.match(/async function loadAndPlay[\s\S]*?\n}/)?.[0] ?? ''

  assert.match(loadAndPlay, /const playTarget = await resolvePlayTarget\(track\)/)
  assert.match(loadAndPlay, /patchTrackInQueues\(track\)/)
  assert.ok(
    loadAndPlay.indexOf('patchTrackInQueues(track)') > loadAndPlay.indexOf('resolvePlayTarget(track)'),
    'queue should be patched after stream URL resolution mutates the track'
  )
})

test('restored provider queues stay out of native queue playback', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const syncNativeQueueState = extractInternalFunctionBody(source, 'syncNativeQueueState')
  const loadAndPlay = source.match(/async function loadAndPlay[\s\S]*?function next\(\)/)?.[0] ?? ''
  const getTrackSource = extractInternalFunctionBody(source, 'getTrackSource')
  const restorePlaybackSession = extractInternalFunctionBody(source, 'restorePlaybackSession')
  const resetPlaybackRuntimeStateForRestore = extractInternalFunctionBody(
    source,
    'resetPlaybackRuntimeStateForRestore'
  )

  assert.match(source, /function canUseNativeQueuePlayback\(\)/)
  assert.match(restorePlaybackSession, /resetPlaybackRuntimeStateForRestore\(\)/)
  assert.match(resetPlaybackRuntimeStateForRestore, /nativePlaybackActive = false/)
  assert.match(resetPlaybackRuntimeStateForRestore, /loadedTrackId = ''/)
  assert.match(resetPlaybackRuntimeStateForRestore, /stopRendererAudio\(true\)/)
  assert.match(resetPlaybackRuntimeStateForRestore, /void stopNativeAudio\(\)/)
  assert.match(
    getTrackSource,
    /\^\[a-zA-Z\]:\[\\\\\/\]/,
    'legacy local tracks whose id is a Windows path must not be mistaken for a provider prefix'
  )
  assert.match(
    source,
    /queue\.value\.every\(\(track\) => getTrackSource\(track\) === 'local'\)/,
    'only all-local queues may be delegated to native queue controls'
  )
  assert.match(
    syncNativeQueueState,
    /if \(!canUseNativeQueuePlayback\(\)\) \{\s*await stopNativeAudio\(\)\s*return\s*\}/,
    'provider queues must clear native queue state instead of syncing ncm:<id> placeholders'
  )
  assert.match(
    loadAndPlay,
    /const useNativePlayback = shouldUseNativePlayback\(track, playTarget\) && canUseNativeQueuePlayback\(\)/
  )
  assert.match(loadAndPlay, /if \(useNativePlayback\) \{[\s\S]*window\.api\.audioEngine\.loadQueue/)
})

test('provider next and previous controls re-enter renderer playback even if native state is stale', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const nextBody = extractInternalFunctionBody(source, 'next')
  const previousBody = extractInternalFunctionBody(source, 'previous')
  const togglePlayState = extractInternalFunctionBody(source, 'togglePlayState')
  const seekPlayback = extractInternalFunctionBody(source, 'seekPlayback')

  assert.match(nextBody, /if \(nativePlaybackActive && canUseNativeQueuePlayback\(\)\)/)
  assert.match(previousBody, /if \(nativePlaybackActive && canUseNativeQueuePlayback\(\)\)/)
  assert.match(togglePlayState, /if \(nativePlaybackActive && canUseNativeQueuePlayback\(\)\)/)
  assert.match(seekPlayback, /if \(nativePlaybackActive && canUseNativeQueuePlayback\(\)\)/)
  assert.match(nextBody, /currentTrack\.value = track[\s\S]*void loadAndPlay\(track\)/)
  assert.match(previousBody, /currentTrack\.value = track[\s\S]*void loadAndPlay\(track\)/)
})

test('local dashboard playback keeps a multi-track queue for next and previous controls', () => {
  const source = readFileSync(new URL('../components/LocalDashboard.vue', import.meta.url), 'utf8')
  const playDashboardTrack = source.match(/function playDashboardTrack[\s\S]*?\n}/)?.[0] ?? ''

  assert.match(source, /const nowPlayingTitle = computed\(\(\) => currentTrack\.value\?\.title/)
  assert.match(source, /const progressWidth = computed\(\(\) => `\$\{Math\.min\(100, Math\.max\(0, progress\.value\)\)\}%`\)/)
  assert.match(source, /@click="togglePlay"/)
  assert.match(source, /@click="next"/)
  assert.match(source, /@click="prev"/)
  assert.match(playDashboardTrack, /DASHBOARD_QUEUE_WINDOW/)
  assert.match(playDashboardTrack, /tracks\.value\.slice\(queueStart, end\)/)
  assert.match(
    playDashboardTrack,
    /if \(sourceIndex < 0\) \{\s*playTrack\(track, \[track\]\)\s*return\s*\}/,
    'dashboard playback should only fall back to a single-track queue when the track is not in the local library'
  )
})
