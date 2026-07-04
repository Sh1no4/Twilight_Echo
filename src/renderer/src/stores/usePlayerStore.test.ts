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
  assert.match(source, /const desktopLyricsApi = window\.api\?\.desktopLyrics/)
  assert.match(source, /desktopLyricsApi\.updateTrack\(\{/)
  assert.match(source, /lyricsSource: track\.lyricsSource \?\? null/)
  assert.match(source, /translatedLyricsSource: track\.translatedLyricsSource \?\? null/)
  assert.match(source, /desktopLyricsApi\.updateTime\(currentTime\.value\)/)
  assert.match(
    source,
    /window\.api\?\.desktopLyrics\?\.onToggle\(\(enabled: boolean\) => \{\s*if \(enabled\) syncDesktopLyricsSnapshot\(\)\s*\}\)/
  )
})

test('desktop lyrics window replays cached track and time on creation', () => {
  const desktopLyricsSource = readFileSync(new URL('../../../main/integrations/desktopLyrics.ts', import.meta.url), 'utf8')
  const runtimeSource = readFileSync(new URL('../../../main/core/runtime.ts', import.meta.url), 'utf8')

  assert.match(runtimeSource, /latestDesktopLyricsTrack:/)
  assert.match(runtimeSource, /latestDesktopLyricsTime: 0,/)
  assert.match(desktopLyricsSource, /function sendDesktopLyricsSnapshot\(\): void/)
  assert.match(desktopLyricsSource, /runtime\.desktopLyricsWindow\.webContents\.send\('desktopLyrics:updateTrack', runtime\.latestDesktopLyricsTrack\)/)
  assert.match(desktopLyricsSource, /runtime\.desktopLyricsWindow\.webContents\.send\('desktopLyrics:updateTime', runtime\.latestDesktopLyricsTime\)/)
  assert.match(desktopLyricsSource, /runtime\.latestDesktopLyricsTrack = data/)
  assert.match(desktopLyricsSource, /runtime\.latestDesktopLyricsTime = time/)
})

test('desktop lyrics html falls back to untimed plain lyrics', () => {
  const source = readFileSync(new URL('../../../../resources/desktop-lyrics.html', import.meta.url), 'utf8')

  assert.match(source, /function parsePlainLyrics\(lyrics\)/)
  assert.match(source, /function buildMergedLyrics\(lyrics, translatedLyrics\)/)
  assert.match(source, /var plain = parsePlainLyrics\(lyrics\)/)
  assert.match(source, /time: null/)
  assert.match(source, /mergedLines = buildMergedLyrics\(data\.lyrics, data\.translatedLyrics\)/)
})

test('player lyric loading records local and provider lyric sources', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const ensureCurrentTrackLyricsLoaded = extractInternalFunctionBody(
    source,
    'ensureCurrentTrackLyricsLoaded'
  )

  assert.match(source, /import \{ resolveLyricsWithSources \} from '\.\.\/utils\/lyricSourceResolution\.ts'/)
  assert.match(ensureCurrentTrackLyricsLoaded, /resolveLyricsWithSources\(\{/)
  assert.match(ensureCurrentTrackLyricsLoaded, /loadLocalLyrics:/)
  assert.match(ensureCurrentTrackLyricsLoaded, /loadProviderLyrics:/)
  assert.match(ensureCurrentTrackLyricsLoaded, /lyricsSource: resolved\.lyricsSource/)
  assert.match(ensureCurrentTrackLyricsLoaded, /translatedLyricsSource: resolved\.translatedLyricsSource/)
})

test('streaming playback resume waits for plugin providers before restoring', () => {
  const sessionPersistenceSource = readFileSync(
    new URL('../app/usePlaybackSessionPersistence.ts', import.meta.url),
    'utf8'
  )
  const pluginsSource = readFileSync(new URL('../../../main/ipc/plugins.ts', import.meta.url), 'utf8')
  const runtimeSource = readFileSync(new URL('../../../main/core/runtime.ts', import.meta.url), 'utf8')

  assert.match(
    sessionPersistenceSource,
    /await options\.syncPluginProviders\(\)[\s\S]*const restoredSession: PlaybackSession/
  )
  assert.match(runtimeSource, /pluginManagerReady: null as Promise<void> \| null,/)
  assert.match(pluginsSource, /runtime\.pluginManagerReady = runtime\.pluginManager\s*\.\s*initialize\(\)/)
  assert.match(
    pluginsSource,
    /ipcMain\.handle\('providers:list', async \(\) => \{\s*await runtime\.pluginManagerReady\s*return runtime\.pluginManager!\.listProviders\(\)\s*\}\)/
  )
  assert.match(
    pluginsSource,
    /'providers:call',[\s\S]*await runtime\.pluginManagerReady[\s\S]*runtime\.pluginManager!\.callProvider/
  )
})

test('playback session autosaves while playback changes instead of only on window close', () => {
  const appSource = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
  const sessionPersistenceSource = readFileSync(
    new URL('../app/usePlaybackSessionPersistence.ts', import.meta.url),
    'utf8'
  )

  assert.match(appSource, /createPlaybackSessionPersistence\(\{/)
  assert.match(sessionPersistenceSource, /function schedulePlaybackSessionAutosave\(/)
  assert.match(sessionPersistenceSource, /async function savePlaybackSessionSnapshot\(/)
  assert.match(appSource, /currentTrack, currentTime, isPlaying/)
  assert.match(
    sessionPersistenceSource,
    /watch\(\s*\[\(\) => options\.currentTrack\.value\?\.id, \(\) => getPlaybackResumeMode\(\)\]/
  )
  assert.match(sessionPersistenceSource, /DEFAULT_PLAYBACK_SESSION_POSITION_AUTOSAVE_MS/)
  assert.match(sessionPersistenceSource, /options\.dataApi\.savePlaybackSession\(session\)/)
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
  const mainSource = readFileSync(new URL('../../../main/app/lifecycle.ts', import.meta.url), 'utf8')

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

test('provider queues use native for resolved current targets without native queue delegation', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const syncNativeQueueState = extractInternalFunctionBody(source, 'syncNativeQueueState')
  const loadAndPlay = source.match(/async function loadAndPlay[\s\S]*?function next\(\)/)?.[0] ?? ''
  const getTrackSource = extractInternalFunctionBody(source, 'getTrackSource')
  const canUseNativeQueuePlayback = extractInternalFunctionBody(source, 'canUseNativeQueuePlayback')
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
    canUseNativeQueuePlayback,
    /queue\.value\.every\(\(track\) =>\s*shouldUseNativePlayback\(track, getTrackAudioSource\(track\)\)\s*\)/,
    'native queue controls require every queued target to already be native-capable'
  )
  assert.match(
    syncNativeQueueState,
    /if \(!canUseNativeQueuePlayback\(\)\) \{\s*await stopNativeAudio\(\)\s*return\s*\}/,
    'unresolved provider queues must clear native queue state instead of syncing provider id placeholders'
  )
  assert.match(
    loadAndPlay,
    /const useNativePlayback = shouldUseNativePlayback\(track, playTarget\)/
  )
  assert.match(loadAndPlay, /if \(useNativePlayback\) \{[\s\S]*window\.api\.audioEngine\.loadQueue/)
})

test('next and previous only use native controls when the native queue is delegated', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const nextBody = extractInternalFunctionBody(source, 'next')
  const previousBody = extractInternalFunctionBody(source, 'previous')
  const togglePlayState = extractInternalFunctionBody(source, 'togglePlayState')
  const seekPlayback = extractInternalFunctionBody(source, 'seekPlayback')

  assert.match(nextBody, /if \(nativePlaybackActive && isNativeQueueDelegated\(\)\)/)
  assert.match(previousBody, /if \(nativePlaybackActive && isNativeQueueDelegated\(\)\)/)
  assert.match(togglePlayState, /if \(nativePlaybackActive\)/)
  assert.match(seekPlayback, /if \(nativePlaybackActive\)/)
  assert.match(nextBody, /currentTrack\.value = track[\s\S]*void loadAndPlay\(track\)/)
  assert.match(previousBody, /currentTrack\.value = track[\s\S]*void loadAndPlay\(track\)/)
})

test('strict bit-perfect mode blocks DSP, software volume, renderer fallback, and non-perfect native output', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const loadAndPlay = source.match(/async function loadAndPlay[\s\S]*?function next\(\)/)?.[0] ?? ''
  const setVolume = extractInternalFunctionBody(source, 'setVolume')

  assert.match(source, /function strictBitPerfectModeEnabled\(\)/)
  assert.match(source, /function getStrictBitPerfectPlaybackBlockReason\(/)
  assert.match(source, /function handleStrictBitPerfectPlaybackInfo\(/)
  assert.match(source, /appSettings\.value\?\.strictBitPerfectMode === true/)
  assert.match(source, /audioProcessing\.value\.dspEnabled/)
  assert.match(source, /audioProcessing\.value\.volumeNormalization !== 'off'/)
  assert.match(source, /audioProcessing\.value\.crossfadeSeconds > 0/)
  assert.match(source, /audioOutputConfig\.value\.routingMode !== 'auto'/)
  assert.match(source, /Math\.abs\(volume\.value - 1\) > 0\.001/)
  assert.match(source, /!\(audioOutput\.value === 'asio' \|\| exclusiveMode\.value\)/)
  assert.match(loadAndPlay, /const strictBlockReason = getStrictBitPerfectPlaybackBlockReason\(track, playTarget\)/)
  assert.match(loadAndPlay, /if \(strictBlockReason\) throw new Error\(strictBlockReason\)/)
  assert.match(loadAndPlay, /if \(strictBitPerfectModeEnabled\(\)\) \{\s*throw new Error\(`严格 Bit-Perfect 模式拒绝 renderer fallback/)
  assert.match(loadAndPlay, /if \(strictBitPerfectModeEnabled\(\) && !nativeStarted\)/)
  assert.match(setVolume, /if \(strictBitPerfectModeEnabled\(\)\) \{\s*volume\.value = 1/)
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

test('playback session strips transient provider stream URLs before restore', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const cloneTrackForPlaybackSession = extractInternalFunctionBody(
    source,
    'cloneTrackForPlaybackSession'
  )

  assert.equal(
    /streamUrl: track\.source === 'ncm' \? null : track\.streamUrl/.test(cloneTrackForPlaybackSession),
    false,
    'provider URL stripping must not be limited to the built-in ncm provider'
  )
  assert.match(cloneTrackForPlaybackSession, /const source = getTrackSource\(track\)/)
  assert.match(
    cloneTrackForPlaybackSession,
    /streamUrl: source === 'local' \? track\.streamUrl : null/,
    'restored provider playback should resolve a fresh stream URL instead of reusing a stale proxy URL'
  )
})

test('playback failure tries a same-song fallback variant from the queue', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const handlePlaybackFallback = extractInternalFunctionBody(source, 'handlePlaybackFallback')
  const loadAndPlay = source.match(/async function loadAndPlay[\s\S]*?function next\(\)/)?.[0] ?? ''

  assert.match(source, /import \{ findPlaybackFallbackTrack \} from '\.\.\/utils\/playbackFallback\.ts'/)
  assert.match(handlePlaybackFallback, /findPlaybackFallbackTrack\(\{/)
  assert.match(handlePlaybackFallback, /failedTrack/)
  assert.match(handlePlaybackFallback, /candidates: queue\.value/)
  assert.match(handlePlaybackFallback, /sourceReliability: getProviderSourceReliability\(\)/)
  assert.match(handlePlaybackFallback, /queue\.value = queue\.value\.map/)
  assert.match(handlePlaybackFallback, /currentTrack\.value = fallback/)
  assert.match(handlePlaybackFallback, /void loadAndPlay\(fallback/)
  assert.match(loadAndPlay, /if \(await handlePlaybackFallback\(track, err, loadToken\)\) return/)
})

test('player bar surfaces playback fallback diagnostics from the player store', () => {
  const source = readFileSync(new URL('../components/PlayerBar.vue', import.meta.url), 'utf8')

  assert.match(source, /audioEngineError/)
  assert.match(source, /class="player-playback-diagnostic"/)
  assert.match(source, /v-if="audioEngineError"/)
  assert.match(source, /\{\{ audioEngineError \}\}/)
})

test('audio visualizer iframe controls are wired to the player store', () => {
  const panelSource = readFileSync(
    new URL('../components/AudioVisualizerPanel.vue', import.meta.url),
    'utf8'
  )
  const visualizerSource = readFileSync(
    new URL('../../../../resources/audio-visualizer/index.html', import.meta.url),
    'utf8'
  )

  assert.match(panelSource, /togglePlay,\s*next,\s*prev,\s*seek/)
  assert.match(panelSource, /event\.data\?\.kind !== 'control'/)
  assert.match(panelSource, /case 'togglePlay':\s*void togglePlay\(\)/)
  assert.match(panelSource, /case 'previous':\s*prev\(\)/)
  assert.match(panelSource, /case 'next':\s*next\(\)/)
  assert.match(panelSource, /case 'seek':[\s\S]*seek\(position\)/)
  assert.match(panelSource, /window\.api\.audioEngine\.getVisualizationData\(visualizationOptions\)/)
  assert.match(panelSource, /spectrumPoints: 4096/)
  assert.match(panelSource, /VISUALIZER_POLL_INTERVAL_MS = 50/)
  assert.match(panelSource, /kind: 'spectrum'/)
  assert.match(panelSource, /waveform: v\.waveform/)
  assert.match(panelSource, /startVisualizationPolling\(\)/)

  assert.match(visualizerSource, /function postHostControl\(action, payload = \{\}\)/)
  assert.match(visualizerSource, /kind: 'control'/)
  assert.match(visualizerSource, /btnPlayPause\.addEventListener\('click'[\s\S]*'togglePlay'/)
  assert.match(visualizerSource, /btn-prev'\)\.addEventListener\('click'[\s\S]*'previous'/)
  assert.match(visualizerSource, /btn-next'\)\.addEventListener\('click'[\s\S]*'next'/)
  assert.match(visualizerSource, /scrubber\.addEventListener\('click'[\s\S]*postHostControl\('seek', \{ position \}\)/)
})

test('playback fallback ranks provider variants by playback url health', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const helper = extractInternalFunctionBody(source, 'getProviderSourceReliability')
  const handlePlaybackFallback = extractInternalFunctionBody(source, 'handlePlaybackFallback')

  assert.match(helper, /useMediaProviders\(\)\.list\(\)/)
  assert.match(helper, /provider\.health\?\.methodStats\?\.getPlaybackUrl\?\.successRate/)
  assert.match(helper, /provider\.health\?\.successRate/)
  assert.match(helper, /reliability\[provider\.id\] = clampProviderReliability/)
  assert.match(source, /function clampProviderReliability\(/)
  assert.match(handlePlaybackFallback, /sourceReliability: getProviderSourceReliability\(\)/)
})

test('provider playback failure searches provider results to rematch expired ids when queue fallback misses', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const handleProviderRematchFallback = extractInternalFunctionBody(
    source,
    'handleProviderRematchFallback'
  )
  const handlePlaybackFallback = extractInternalFunctionBody(source, 'handlePlaybackFallback')

  assert.match(source, /import \{[\s\S]*findProviderRematchCandidate[\s\S]*\} from '\.\.\/utils\/libraryRepair\.ts'/)
  assert.match(handlePlaybackFallback, /await handleProviderRematchFallback\(failedTrack, loadToken\)/)
  assert.match(handleProviderRematchFallback, /useMediaProviders\(\)\.searchAllSongs\(\{/)
  assert.match(handleProviderRematchFallback, /findProviderRematchCandidate\(failedTrack, candidates\)/)
  assert.match(handleProviderRematchFallback, /queue\.value = queue\.value\.map/)
  assert.match(handleProviderRematchFallback, /currentTrack\.value = rematched/)
  assert.match(handleProviderRematchFallback, /void loadAndPlay\(rematched\)/)
})

test('missing local playback searches provider results instead of stopping at the local file error', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const handleProviderRematchFallback = extractInternalFunctionBody(
    source,
    'handleProviderRematchFallback'
  )

  assert.doesNotMatch(handleProviderRematchFallback, /if \(failedSource === 'local'\) return false/)
  assert.match(
    handleProviderRematchFallback,
    /failedSource === 'local'\s*\?\s*getTrackSource\(track\) !== 'local'/
  )
  assert.match(handleProviderRematchFallback, /已重新匹配到/)
})

test('play mode is persisted in settings and restored on launch', () => {
  const playerSource = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const settingsTypes = readFileSync(new URL('../types/settings.ts', import.meta.url), 'utf8')
  const settingsStoreSource = readFileSync(new URL('./useSettingsStore.ts', import.meta.url), 'utf8')
  const mainSource = readFileSync(new URL('../../../main/core/settings.ts', import.meta.url), 'utf8')
  const setPlayModeInternal = extractInternalFunctionBody(playerSource, 'setPlayModeInternal')

  assert.match(settingsTypes, /export type PlayMode = 'sequential' \| 'repeat' \| 'shuffle'/)
  assert.match(settingsTypes, /playMode: PlayMode/)
  assert.match(settingsStoreSource, /playMode: 'sequential'/)
  assert.match(mainSource, /import type \{ PlayMode \} from '\.\.\/audioEngineManager'/)
  assert.match(mainSource, /export function normalizePlayMode\(mode: unknown\): PlayMode/)
  assert.match(mainSource, /playMode: normalizePlayMode\(settings\.playMode\)/)
  assert.match(playerSource, /import type \{[\s\S]*PlayMode[\s\S]*\} from '\.\.\/types\/settings'/)
  assert.match(playerSource, /watch\(\s*\(\) => appSettings\.value\.playMode,/)
  assert.match(setPlayModeInternal, /void updateSettings\(\{ playMode: mode \}\)/)
})

test('playback session carries play mode for quit-time restore', () => {
  const playerSource = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const musicTypes = readFileSync(new URL('../types/music.ts', import.meta.url), 'utf8')
  const restorePlaybackSession = extractInternalFunctionBody(playerSource, 'restorePlaybackSession')
  const createPlaybackSession = extractInternalFunctionBody(playerSource, 'createPlaybackSession')

  assert.match(musicTypes, /import type \{ PlaybackResumeMode, PlayMode \} from '\.\/settings'/)
  assert.match(musicTypes, /playMode\?: PlayMode/)
  assert.match(createPlaybackSession, /playMode: playMode\.value/)
  assert.match(restorePlaybackSession, /if \(session\.playMode\) \{/)
  assert.match(restorePlaybackSession, /setPlayModeInternal\(session\.playMode, \{ persist: false \}\)/)
})
