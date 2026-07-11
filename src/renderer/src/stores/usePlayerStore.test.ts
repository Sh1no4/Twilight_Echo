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
  const signature = new RegExp(
    `(?:async\\s+)?function ${functionName}\\([^)]*\\)[:\\w\\s<>\\[\\]'|]*\\s*\\{`
  )
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
  const desktopLyricsSource = readFileSync(
    new URL('../../../main/integrations/desktopLyrics.ts', import.meta.url),
    'utf8'
  )
  const runtimeSource = readFileSync(
    new URL('../../../main/core/runtime.ts', import.meta.url),
    'utf8'
  )

  assert.match(runtimeSource, /latestDesktopLyricsTrack:/)
  assert.match(runtimeSource, /latestDesktopLyricsTime: 0,/)
  assert.match(desktopLyricsSource, /function sendDesktopLyricsSnapshot\(\): void/)
  assert.match(
    desktopLyricsSource,
    /runtime\.desktopLyricsWindow\.webContents\.send\('desktopLyrics:updateTrack', runtime\.latestDesktopLyricsTrack\)/
  )
  assert.match(
    desktopLyricsSource,
    /runtime\.desktopLyricsWindow\.webContents\.send\('desktopLyrics:updateTime', runtime\.latestDesktopLyricsTime\)/
  )
  assert.match(desktopLyricsSource, /runtime\.latestDesktopLyricsTrack = data/)
  assert.match(desktopLyricsSource, /Number\.isFinite\(time\)/)
  assert.match(desktopLyricsSource, /runtime\.latestDesktopLyricsTime = Math\.max\(0, time\)/)
  assert.match(desktopLyricsSource, /clampNumber\(Math\.round\(data\.x\)/)
})

test('desktop lyrics html falls back to untimed plain lyrics', () => {
  const source = readFileSync(
    new URL('../../../../resources/desktop-lyrics.html', import.meta.url),
    'utf8'
  )

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

  assert.match(
    source,
    /import \{ resolveLyricsWithSources \} from '\.\.\/utils\/lyricSourceResolution\.ts'/
  )
  assert.match(ensureCurrentTrackLyricsLoaded, /resolveLyricsWithSources\(\{/)
  assert.match(ensureCurrentTrackLyricsLoaded, /loadLocalLyrics:/)
  assert.match(ensureCurrentTrackLyricsLoaded, /loadProviderLyrics:/)
  assert.match(ensureCurrentTrackLyricsLoaded, /lyricsSource: resolved\.lyricsSource/)
  assert.match(
    ensureCurrentTrackLyricsLoaded,
    /translatedLyricsSource: resolved\.translatedLyricsSource/
  )
})

test('streaming playback resume waits for plugin providers before restoring', () => {
  const sessionPersistenceSource = readFileSync(
    new URL('../app/usePlaybackSessionPersistence.ts', import.meta.url),
    'utf8'
  )
  const pluginsSource = readFileSync(
    new URL('../../../main/ipc/plugins.ts', import.meta.url),
    'utf8'
  )
  const runtimeSource = readFileSync(
    new URL('../../../main/core/runtime.ts', import.meta.url),
    'utf8'
  )

  assert.match(
    sessionPersistenceSource,
    /await options\.syncPluginProviders\(\)[\s\S]*const restoredSession: PlaybackSession/
  )
  assert.match(runtimeSource, /pluginManagerReady: null as Promise<void> \| null,/)
  assert.match(
    pluginsSource,
    /runtime\.pluginManagerReady = runtime\.pluginManager\s*\.\s*initialize\(\)/
  )
  assert.match(
    pluginsSource,
    /ipcMain\.handle\('providers:list', async \(event\) => \{\s*assertTrustedIpcSender\(event, 'provider IPC'\)\s*await runtime\.pluginManagerReady\s*return runtime\.pluginManager!\.listProviders\(\)\s*\}\)/
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
  assert.match(appSource, /currentTrack[\s\S]*currentTime[\s\S]*isPlaying/)
  assert.match(
    sessionPersistenceSource,
    /watch\(\s*\[\(\) => options\.currentTrack\.value\?\.id, \(\) => getPlaybackResumeMode\(\)\]/
  )
  assert.match(sessionPersistenceSource, /DEFAULT_PLAYBACK_SESSION_POSITION_AUTOSAVE_MS/)
  assert.match(sessionPersistenceSource, /options\.dataApi\.savePlaybackSession\(session\)/)
})

test('renderer streaming resume seeks only after media metadata is available', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const playWithRendererAudio =
    source.match(/async function playWithRendererAudio[\s\S]*?\n}/)?.[0] ?? ''

  assert.match(source, /function seekRendererAudioWhenReady\(/)
  assert.match(source, /audio\.readyState >= HTMLMediaElement\.HAVE_METADATA/)
  assert.match(source, /audio\.addEventListener\('loadedmetadata', applySeek, \{ once: true \}\)/)
  assert.match(
    playWithRendererAudio,
    /seekRendererAudioWhenReady\(audio, startTime, track, loadToken\)/
  )
  assert.equal(
    playWithRendererAudio.includes('audio.currentTime = Math.max(0, startTime)'),
    false,
    'streaming resume must not seek before remote media metadata is available'
  )
})

test('streaming renderer playback is allowed after asynchronous provider URL resolution', () => {
  const mainSource = readFileSync(
    new URL('../../../main/app/lifecycle.ts', import.meta.url),
    'utf8'
  )

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
    loadAndPlay.indexOf('patchTrackInQueues(track)') >
      loadAndPlay.indexOf('resolvePlayTarget(track)'),
    'queue should be patched after stream URL resolution mutates the track'
  )
})

test('mini player switching recovers from stale unauthorized local tracks', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const preloadSource = readFileSync(new URL('../../../preload/index.ts', import.meta.url), 'utf8')
  const windowSource = readFileSync(new URL('../../../main/app/window.ts', import.meta.url), 'utf8')
  const resolvePlayTarget = extractInternalFunctionBody(source, 'resolvePlayTarget')
  const handlePlaybackFallback = extractInternalFunctionBody(source, 'handlePlaybackFallback')
  const handleProviderRematchFallback = extractInternalFunctionBody(
    source,
    'handleProviderRematchFallback'
  )

  assert.match(resolvePlayTarget, /window\.api\.fs\.isAudioFileAuthorized\(track\.filePath\)/)
  assert.match(preloadSource, /ipcRenderer\.invoke\('fs:isAudioFileAuthorized', filePath\)/)
  assert.match(handlePlaybackFallback, /await loadAndPlay\(fallback\)/)
  assert.match(handleProviderRematchFallback, /if \(failedSource !== 'local'\)/)
  assert.match(handleProviderRematchFallback, /await loadAndPlay\(rematched\)/)
  assert.match(windowSource, /backgroundThrottling: false/)
})

test('provider queues use native for resolved current targets without native queue delegation', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const syncNativeQueueState = extractInternalFunctionBody(source, 'syncNativeQueueState')
  const loadAndPlay = source.match(/async function loadAndPlay[\s\S]*?function next\(\)/)?.[0] ?? ''
  const getTrackSource = extractInternalFunctionBody(source, 'getTrackSource')
  const isNativeQueueDelegated = extractInternalFunctionBody(source, 'isNativeQueueDelegated')
  const restorePlaybackSession = extractInternalFunctionBody(source, 'restorePlaybackSession')
  const resetPlaybackRuntimeStateForRestore = extractInternalFunctionBody(
    source,
    'resetPlaybackRuntimeStateForRestore'
  )

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
  assert.match(isNativeQueueDelegated, /return nativeQueueDelegated/)
  assert.doesNotMatch(isNativeQueueDelegated, /canUseNativeQueuePlayback/)
  assert.match(
    syncNativeQueueState,
    /const preparedQueue = await prepareNativeQueue\(\{/,
    'queue synchronization must authorize candidates before delegating them to native playback'
  )
  assert.match(
    loadAndPlay,
    /const useNativePlayback = shouldUseNativePlayback\(track, playTarget\)/
  )
  assert.match(loadAndPlay, /if \(useNativePlayback\) \{[\s\S]*window\.api\.audioEngine\.loadQueue/)
})

test('player store prepares native queues before loading or synchronizing them', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const syncNativeQueueState = extractInternalFunctionBody(source, 'syncNativeQueueState')
  const loadAndPlay = source.match(/async function loadAndPlay[\s\S]*?function next\(\)/)?.[0] ?? ''

  assert.match(
    source,
    /import \{ prepareNativeQueue \} from '\.\.\/utils\/nativeQueuePreparation\.ts'/
  )
  assert.match(loadAndPlay, /const preparedQueue = await prepareNativeQueue\(\{/)
  assert.match(loadAndPlay, /preparedQueue\.items,\s*preparedQueue\.startIndex/)
  assert.match(loadAndPlay, /nativeQueueDelegated = preparedQueue\.delegated/)
  assert.match(syncNativeQueueState, /const preparedQueue = await prepareNativeQueue\(\{/)
  assert.match(syncNativeQueueState, /preparedQueue\.items, preparedQueue\.startIndex/)
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

test('player store does not pretend DSP bypass is strict bit-perfect mode', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const loadAndPlay = source.match(/async function loadAndPlay[\s\S]*?function next\(\)/)?.[0] ?? ''
  const setVolume = extractInternalFunctionBody(source, 'setVolume')

  assert.doesNotMatch(source, /strictBitPerfectMode/)
  assert.doesNotMatch(source, /function strictBitPerfectModeEnabled\(\)/)
  assert.doesNotMatch(loadAndPlay, /严格 Bit-Perfect 模式拒绝 renderer fallback/)
  assert.match(loadAndPlay, /原生音频引擎不可用，已启用临时播放通道/)
  assert.match(loadAndPlay, /playWithRendererAudio\(/)
  assert.match(setVolume, /volume\.value = vol/)
})

test('local dashboard playback keeps a multi-track queue for next and previous controls', () => {
  const source = readFileSync(new URL('../components/LocalDashboard.vue', import.meta.url), 'utf8')
  const playDashboardTrack = source.match(/function playDashboardTrack[\s\S]*?\n}/)?.[0] ?? ''

  assert.match(source, /const heroTrack = computed<Track \| null>/)
  assert.match(source, /@click="handleHeroPlay"/)
  assert.match(source, /@click="playDashboardTrack\(track\)"/)
  assert.match(source, /@click="playDashboardTrack\(entry\.track\)"/)
  assert.match(playDashboardTrack, /DASHBOARD_QUEUE_WINDOW/)
  assert.match(playDashboardTrack, /tracks\.value\.slice\(queueStart, end\)/)
  assert.match(
    playDashboardTrack,
    /if \(sourceIndex < 0\) \{\s*playTrack\(track, \[track\]\)\s*return\s*\}/,
    'dashboard playback should only fall back to a single-track queue when the track is not in the local library'
  )
})

test('local dashboard uses a single-line masthead heading without English section kickers', () => {
  const source = readFileSync(new URL('../components/LocalDashboard.vue', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /class="masthead-kicker"/)
  assert.doesNotMatch(source, /class="masthead-subtitle"/)
  assert.doesNotMatch(source, /<h1 class="greeting">[\s\S]*?<span>/)
  assert.doesNotMatch(source, /class="section-kicker"/)
})

test('playback session strips transient provider stream URLs before restore', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const cloneTrackForPlaybackSession = extractInternalFunctionBody(
    source,
    'cloneTrackForPlaybackSession'
  )

  assert.equal(
    /streamUrl: track\.source === 'ncm' \? null : track\.streamUrl/.test(
      cloneTrackForPlaybackSession
    ),
    false,
    'provider URL stripping must not be limited to the built-in ncm provider'
  )
  assert.match(cloneTrackForPlaybackSession, /const source = getTrackSource\(track\)/)
  assert.match(
    cloneTrackForPlaybackSession,
    /streamUrl: source === 'local' \? track\.streamUrl : null/,
    'restored provider playback should resolve a fresh stream URL instead of reusing a stale proxy URL'
  )
  assert.match(cloneTrackForPlaybackSession, /bpm: track\.bpm/)
  assert.match(cloneTrackForPlaybackSession, /bpmAnalysis: track\.bpmAnalysis/)
})

test('player store requests background BPM analysis and merges completed results', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const setupSideEffects = extractInternalFunctionBody(source, 'setupPlayerIntegrationSideEffects')
  const requestBpmAnalysis = extractInternalFunctionBody(source, 'requestBpmAnalysisForTrack')
  const applyBpmAnalysis = extractInternalFunctionBody(source, 'applyBpmAnalysisToTrack')
  const clearBpmAnalysis = extractInternalFunctionBody(source, 'clearBpmAnalysisFromPlaybackState')

  assert.match(source, /function hasAnalyzedBpm\(/)
  assert.match(source, /function isAutoBpmAnalysisEnabled\(/)
  assert.match(source, /function isAnalyzableAudioPath\(/)
  assert.match(requestBpmAnalysis, /window\.api\?\.bpmAnalysis\?\.request/)
  assert.match(requestBpmAnalysis, /!isAutoBpmAnalysisEnabled\(\)/)
  assert.match(requestBpmAnalysis, /hasAnalyzedBpm\(track\)/)
  assert.match(requestBpmAnalysis, /referenceBpm: track\.bpm/)
  assert.match(applyBpmAnalysis, /currentTrack\.value = updatedTrack/)
  assert.match(applyBpmAnalysis, /patchTrackInQueues\(updatedTrack\)/)
  assert.match(applyBpmAnalysis, /useMusicStore\(\)\.applyBpmAnalysis/)
  assert.match(clearBpmAnalysis, /currentTrack\.value/)
  assert.match(clearBpmAnalysis, /queue\.value = queue\.value\.map/)
  assert.match(clearBpmAnalysis, /originalQueue\.value = originalQueue\.value\.map/)
  assert.match(clearBpmAnalysis, /useMusicStore\(\)\.clearBpmAnalysis\(\)/)
  assert.match(source, /clearBpmAnalysisFromPlaybackState: \(\) => void/)
  assert.match(setupSideEffects, /window\.api\?\.bpmAnalysis\?\.onCompleted/)
  assert.match(setupSideEffects, /requestBpmAnalysisForTrack\(track\)/)
})

test('playback failure tries a same-song fallback variant from the queue', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const handlePlaybackFallback = extractInternalFunctionBody(source, 'handlePlaybackFallback')
  const loadAndPlay = source.match(/async function loadAndPlay[\s\S]*?function next\(\)/)?.[0] ?? ''

  assert.match(
    source,
    /import \{ findPlaybackFallbackTrack \} from '\.\.\/utils\/playbackFallback\.ts'/
  )
  assert.match(handlePlaybackFallback, /findPlaybackFallbackTrack\(\{/)
  assert.match(handlePlaybackFallback, /failedTrack/)
  assert.match(handlePlaybackFallback, /candidates: queue\.value/)
  assert.match(handlePlaybackFallback, /sourceReliability: getProviderSourceReliability\(\)/)
  assert.match(handlePlaybackFallback, /queue\.value = queue\.value\.map/)
  assert.match(handlePlaybackFallback, /currentTrack\.value = fallback/)
  assert.match(handlePlaybackFallback, /await loadAndPlay\(fallback\)/)
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
  assert.match(panelSource, /const visualizerSrc = ref\(buildVisualizerSrc\(\)\)/)
  assert.match(panelSource, /function buildVisualizerSrc\(\): string/)
  assert.match(panelSource, /visualizerSrc\.value = buildVisualizerSrc\(\)/)
  assert.match(panelSource, /iframeReady\.value = false/)
  assert.match(panelSource, /event\.data\?\.kind !== 'control'/)
  assert.match(panelSource, /case 'togglePlay':\s*void togglePlay\(\)/)
  assert.match(panelSource, /case 'previous':\s*prev\(\)/)
  assert.match(panelSource, /case 'next':\s*next\(\)/)
  assert.match(panelSource, /case 'seek':[\s\S]*seek\(position\)/)
  assert.match(
    panelSource,
    /window\.api\.audioEngine\.getVisualizationData\(visualizationOptions\)/
  )
  assert.match(panelSource, /const VISUALIZER_ANALYSIS_POINTS = 4096/)
  assert.match(panelSource, /spectrumPoints: VISUALIZER_ANALYSIS_POINTS/)
  assert.match(panelSource, /const VISUALIZER_BAR_COUNT = 140/)
  assert.match(panelSource, /visualizerBarCount: VISUALIZER_BAR_COUNT/)
  assert.match(panelSource, /spectrogramFrames: 0/)
  assert.match(panelSource, /oscilloscopePoints: 0/)
  assert.match(panelSource, /VISUALIZER_POLL_INTERVAL_MS = 33/)
  assert.match(panelSource, /CONTROL_VISUALIZATION_PAUSE_MS = 220/)
  assert.match(panelSource, /let visualizationPausedUntil = 0/)
  assert.match(panelSource, /if \(performance\.now\(\) < visualizationPausedUntil\) return/)
  assert.match(panelSource, /function pauseVisualizationForControl\(\)/)
  assert.match(panelSource, /pauseVisualizationForControl\(\)/)
  assert.match(panelSource, /audioEngineReady/)
  assert.match(panelSource, /const shouldPollVisualization = computed/)
  assert.match(
    panelSource,
    /props\.active &&\s*iframeReady\.value &&\s*isPlaying\.value &&\s*audioEngineReady\.value &&\s*currentTrack\.value/
  )
  assert.match(panelSource, /if \(!shouldPollVisualization\.value\) return/)
  assert.match(panelSource, /function syncVisualizationPolling\(\)/)
  assert.match(panelSource, /postInactiveVisualizationFrame\(\)/)
  assert.doesNotMatch(panelSource, /Float32Array\.from\(v\.spectrum\)/)
  assert.match(panelSource, /Float32Array\.from\(v\.waveform\)/)
  assert.match(panelSource, /v\.tapStatus === 'synthetic-fallback'/)
  assert.match(panelSource, /postInactiveVisualizationFrame\(\)\s*return/)
  assert.match(panelSource, /v\.visualizerBars/)
  assert.doesNotMatch(panelSource, /function mapSpectrumToVisualizerBars/)
  assert.match(panelSource, /const bars = Float32Array\.from\(v\.visualizerBars \?\? \[\]\)/)
  assert.doesNotMatch(panelSource, /function spectrumValueToAmplitude/)
  assert.doesNotMatch(panelSource, /function amplitudeToVisualizerLevel/)
  assert.doesNotMatch(panelSource, /function applyVisualizerSpectralContrast/)
  assert.doesNotMatch(panelSource, /spectralTilt/)
  assert.doesNotMatch(panelSource, /subBinTexture/)
  assert.match(panelSource, /\[bars\.buffer, waveform\.buffer\]/)
  assert.match(panelSource, /kind: 'spectrum'/)
  assert.doesNotMatch(panelSource, /data: spectrum/)
  assert.match(panelSource, /bars,/)
  assert.match(panelSource, /waveform,/)
  assert.match(panelSource, /startVisualizationPolling\(\)/)

  assert.match(visualizerSource, /let dataArray = new Float32Array\(4096\)/)
  assert.match(visualizerSource, /let precomputedBars = new Float32Array\(SPECTRUM_BAR_COUNT\)/)
  assert.match(
    visualizerSource,
    /let previousPrecomputedBars = new Float32Array\(SPECTRUM_BAR_COUNT\)/
  )
  assert.match(
    visualizerSource,
    /let displayPrecomputedBars = new Float32Array\(SPECTRUM_BAR_COUNT\)/
  )
  assert.match(visualizerSource, /let precomputedBarsTransitionStartedAt = performance\.now\(\)/)
  assert.match(visualizerSource, /const PRECOMPUTED_BAR_TRANSITION_MS = 48/)
  assert.match(visualizerSource, /let usingPrecomputedBars = false/)
  assert.match(visualizerSource, /function currentPrecomputedBarValue\(/)
  assert.match(visualizerSource, /function retargetPrecomputedBars\(/)
  assert.match(visualizerSource, /progress \* progress \* \(3 - 2 \* progress\)/)
  assert.match(visualizerSource, /const binWidth = sampleRate \/ fftSize/)
  assert.doesNotMatch(visualizerSource, /function spectrumValueToAmplitude\(value\)/)
  assert.doesNotMatch(visualizerSource, /function amplitudeToVisualizerLevel\(amplitude\)/)
  assert.doesNotMatch(visualizerSource, /function applyVisualizerSpectralContrast\(bars\)/)
  assert.doesNotMatch(visualizerSource, /weightedSquares \+= amplitude \* amplitude \* overlap/)
  assert.doesNotMatch(
    visualizerSource,
    /amplitudeToVisualizerLevel\(rms \* 0\.85 \+ peak \* 0\.15\)/
  )
  assert.doesNotMatch(
    visualizerSource,
    /rawComputedBars = applyVisualizerSpectralContrast\(rawComputedBars\)/
  )
  assert.doesNotMatch(visualizerSource, /subBinTexture/)
  assert.doesNotMatch(visualizerSource, /spectralTilt/)
  assert.match(visualizerSource, /const barSpacing = 1\.5/)
  assert.match(visualizerSource, /const totalSpacing = barSpacing \* \(barCount - 1\)/)
  assert.match(visualizerSource, /const barWidth = \(width - totalSpacing\) \/ barCount/)
  assert.match(
    visualizerSource,
    /function buildLogFrequencyBinCenters\(barCount, sampleRate, fftSize\)/
  )
  assert.match(
    visualizerSource,
    /const frequency = minF \* Math\.pow\(frequencyRatio, i \/ frequencyStepCount\)/
  )
  assert.match(visualizerSource, /spectrumBinCenters\[i\] = frequency \/ binWidth/)
  assert.match(visualizerSource, /const valLow = \(dataArray\[indexLow\] \|\| 0\) \* 255/)
  assert.match(visualizerSource, /const valHigh = \(dataArray\[indexHigh\] \|\| 0\) \* 255/)
  assert.match(visualizerSource, /const val = valLow \+ \(valHigh - valLow\) \* fract/)
  assert.match(visualizerSource, /let sourceLevels = new Float32Array\(SPECTRUM_BAR_COUNT\)/)
  assert.match(visualizerSource, /currentPrecomputedBarValue\(i, now\)/)
  assert.match(
    visualizerSource,
    /sourceLevels = applyLowFrequencyShelfContour\(rawComputedBars, binCenters, contourPhase\)/
  )
  assert.match(
    visualizerSource,
    /sourceLevels = applyLowFrequencyShelfContour\(rawPrecomputedBars, binCenters, contourPhase\)/
  )
  assert.doesNotMatch(visualizerSource, /SPECTRUM_GAIN_TARGET_MIX/)
  assert.doesNotMatch(visualizerSource, /const sourceFloorLevel = frameContrastFloor/)
  assert.doesNotMatch(visualizerSource, /const sourceLevel = expandFrameContrast/)
  assert.doesNotMatch(visualizerSource, /adaptiveDisplayGain/)
  assert.match(visualizerSource, /const val = visualizerDisplayLevel\(sourceLevels\[i\]\) \* 255/)
  assert.doesNotMatch(visualizerSource, /Math\.max\(lastSpectrumHeights\[i\], 2\)/)
  assert.match(visualizerSource, /i \* \(barWidth \+ barSpacing\)/)
  assert.match(visualizerSource, /specCtx\.setTransform\(dpr, 0, 0, dpr, 0, 0\)/)
  assert.match(visualizerSource, /new ResizeObserver\(resizeCanvases\)/)
  assert.match(visualizerSource, /function isNumericSequence\(value\)/)
  assert.match(visualizerSource, /ArrayBuffer\.isView\(value\)/)
  assert.match(
    visualizerSource,
    /const incomingBars = isNumericSequence\(msg\.bars\) \? msg\.bars : null/
  )
  assert.match(visualizerSource, /\? Math\.max\(0, Math\.min\(1, incomingBars\[i\]\)\)/)
  assert.match(visualizerSource, /retargetPrecomputedBars\(incomingBars\)/)
  assert.doesNotMatch(visualizerSource, /\? Math\.max\(0, incomingBars\[i\]\)/)
  assert.match(visualizerSource, /usingPrecomputedBars = true/)
  assert.match(visualizerSource, /usingPrecomputedBars = false/)
  assert.match(visualizerSource, /if \(msg\.active === false\) \{/)
  assert.doesNotMatch(visualizerSource, /msg\.active === false \|\| !isPlaying/)
  assert.match(visualizerSource, /let spectrumAnimationFrame = 0/)
  assert.match(visualizerSource, /const SPECTRUM_ATTACK_SECONDS = 0\.014/)
  assert.match(visualizerSource, /const SPECTRUM_DECAY_SECONDS = 0\.16/)
  assert.match(visualizerSource, /const SPECTRUM_BAR_COUNT = 140/)
  assert.match(visualizerSource, /const SPECTRUM_DISPLAY_GAIN = 1\.38;/)
  assert.match(visualizerSource, /const SPECTRUM_DISPLAY_RANGE = 1\.16/)
  assert.match(visualizerSource, /const SPECTRUM_DISPLAY_GAMMA = 0\.78/)
  assert.match(visualizerSource, /const SPECTRUM_DISPLAY_HEADROOM = 1/)
  assert.match(visualizerSource, /const SPECTRUM_CONTRAST_FLOOR = 0\.16/)
  assert.match(visualizerSource, /const SPECTRUM_CONTRAST_POWER = 0\.68/)
  assert.match(visualizerSource, /let lowFrequencyContourPhase = 0/)
  assert.match(visualizerSource, /function updateLowFrequencyContourPhase\(rawBars, deltaSeconds\)/)
  assert.match(visualizerSource, /justify-content: flex-start;/)
  assert.match(visualizerSource, /flex: 0 0 calc\(250px \+ var\(--spectrum-top-growth\)\);/)
  assert.match(visualizerSource, /height: calc\(250px \+ var\(--spectrum-top-growth\)\);/)
  assert.doesNotMatch(visualizerSource, /\.spectrum-outer-container \{[^}]*flex-grow: 1;/)
  assert.match(visualizerSource, /const SPECTRUM_HEIGHT_SCALE = 1/)
  assert.match(visualizerSource, /const LOW_FREQUENCY_CONTOUR_BAR_LIMIT = 72/)
  assert.match(visualizerSource, /const LOW_FREQUENCY_CONTOUR_FLAT_RANGE = 0\.2/)
  assert.match(visualizerSource, /const LOW_FREQUENCY_CONTOUR_BASE_DEPTH = 0\.24/)
  assert.match(visualizerSource, /const LOW_FREQUENCY_CONTOUR_DEPTH = 0\.52/)
  assert.match(
    visualizerSource,
    /const tertiary = Math\.sin\(\(barIndex \+ 1\) \* 2\.37 \+ phase \* 0\.9\)/
  )
  assert.match(visualizerSource, /function visualizerDisplayLevel\(value\)/)
  assert.doesNotMatch(visualizerSource, /function smoothPeakSourceLevel/)
  assert.doesNotMatch(visualizerSource, /function frameContrastFloor/)
  assert.doesNotMatch(visualizerSource, /function expandFrameContrast/)
  assert.match(
    visualizerSource,
    /return Math\.pow\(level, SPECTRUM_DISPLAY_GAMMA\) \* SPECTRUM_DISPLAY_HEADROOM/
  )
  assert.match(
    visualizerSource,
    /function applyLowFrequencyShelfContour\(rawBars, binCenters, contourPhase\)/
  )
  assert.match(
    visualizerSource,
    /sourceLevels = applyLowFrequencyShelfContour\(rawComputedBars, binCenters, contourPhase\)/
  )
  assert.match(
    visualizerSource,
    /sourceLevels = applyLowFrequencyShelfContour\(rawPrecomputedBars, binCenters, contourPhase\)/
  )
  assert.match(visualizerSource, /lowFrequencyContourPhase: contourPhase/)
  assert.match(visualizerSource, /const val = visualizerDisplayLevel\(sourceLevels\[i\]\) \* 255/)
  assert.match(
    visualizerSource,
    /const targetHeight = \(val \/ 255\) \* height \* SPECTRUM_HEIGHT_SCALE/
  )
  assert.match(visualizerSource, /window\.__twilightVisualizerDebug = \(\) => lastSpectrumDebug/)
  assert.match(visualizerSource, /function smoothSpectrumHeight\(/)
  assert.match(visualizerSource, /1 - Math\.exp\(-deltaSeconds \/ smoothingSeconds\)/)
  assert.match(
    visualizerSource,
    /lastSpectrumHeights\[i\] = smoothSpectrumHeight\(\s*lastSpectrumHeights\[i\],\s*targetHeight,\s*deltaSeconds\s*\)/
  )
  assert.match(visualizerSource, /function startSpectrumLoop\(\)/)
  assert.match(visualizerSource, /function stopSpectrumLoop\(\)/)
  assert.match(visualizerSource, /cancelAnimationFrame\(spectrumAnimationFrame\)/)
  assert.match(visualizerSource, /spectrumAnimationFrame = requestAnimationFrame\(drawSpectrum\)/)
  assert.doesNotMatch(
    visualizerSource,
    /function drawSpectrum\(\) \{\s*requestAnimationFrame\(drawSpectrum\)/
  )
  assert.match(
    visualizerSource,
    /if \(msg\.active === false\) \{[\s\S]*if \(isPlaying\) \{[\s\S]*dataArray\.fill\(0\)[\s\S]*startSpectrumLoop\(\)[\s\S]*\} else \{[\s\S]*lastSpectrumHeights\.fill\(0\)[\s\S]*stopSpectrumLoop\(\)[\s\S]*renderSpectrumFrame\(performance\.now\(\)\)/
  )
  assert.match(visualizerSource, /function postHostControl\(action, payload = \{\}\)/)
  assert.match(visualizerSource, /waveCtx\.strokeStyle = 'rgba\(60, 62, 68, 0\.78\)'/)
  assert.match(visualizerSource, /waveCtx\.lineWidth = 1\.35/)
  assert.match(visualizerSource, /waveCtx\.lineTo\(x, y\)/)
  assert.match(visualizerSource, /const amplitudeScale = height \* 0\.38/)
  assert.match(visualizerSource, /const visualGain = maxAbs > 0/)
  assert.match(visualizerSource, /Math\.min\(3\.2, Math\.max\(1, 0\.72 \/ maxAbs\)\)/)
  assert.doesNotMatch(visualizerSource, /const barWidth = Math\.max\(1, step - gap\)/)
  assert.doesNotMatch(visualizerSource, /waveCtx\.fillRect\(x, y, barWidth, h\)/)
  assert.doesNotMatch(visualizerSource, /background: #111827/)
  assert.match(visualizerSource, /kind: 'control'/)
  assert.match(visualizerSource, /btnPlayPause\.addEventListener\('click'[\s\S]*'togglePlay'/)
  assert.match(visualizerSource, /btn-prev'\)\.addEventListener\('click'[\s\S]*'previous'/)
  assert.match(visualizerSource, /btn-next'\)\.addEventListener\('click'[\s\S]*'next'/)
  assert.match(
    visualizerSource,
    /scrubber\.addEventListener\('click'[\s\S]*postHostControl\('seek', \{ position \}\)/
  )
})

test('player bar exposes a HiFi console drawer instead of visualization meters', () => {
  const playerBarSource = readFileSync(
    new URL('../components/PlayerBar.vue', import.meta.url),
    'utf8'
  )
  const hifiSidebarSource = readFileSync(
    new URL('../components/player-bar/HiFiSidebar.vue', import.meta.url),
    'utf8'
  )

  assert.match(playerBarSource, /import HiFiSidebar from '\.\/player-bar\/HiFiSidebar\.vue'/)
  assert.match(playerBarSource, /<HiFiSidebar/)
  assert.match(playerBarSource, /class="hifi-overlay"/)
  assert.match(playerBarSource, /title="HiFi 控制台"/)
  assert.match(playerBarSource, /ph ph-faders/)
  assert.match(playerBarSource, /openEqualizer/)
  assert.match(playerBarSource, /onReloadLyrics/)
  assert.match(playerBarSource, /setAudioDevice/)
  assert.doesNotMatch(playerBarSource, /const visualizationStateText = computed/)
  assert.doesNotMatch(playerBarSource, /class="visualization-panel"/)
  assert.doesNotMatch(playerBarSource, /oscilloscopeCanvasRef/)
  assert.doesNotMatch(playerBarSource, /spectrogramCanvasRef/)
  assert.match(hifiSidebarSource, /HiFi Studio/)
  assert.match(hifiSidebarSource, /Master DSP/)
  assert.match(hifiSidebarSource, /Devices/)
  assert.match(hifiSidebarSource, /Lyrics Source/)
  assert.match(hifiSidebarSource, /Source Quality/)
  assert.match(hifiSidebarSource, /toggleExpanded/)
  assert.match(hifiSidebarSource, /openEqualizer/)
})


test('player bar visualization polling stays light and stops behind the full visualizer', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')

  assert.match(source, /spectrumPoints: 64/)
  assert.match(source, /waveformPoints: 48/)
  assert.match(source, /spectrogramFrames: 32/)
  assert.match(source, /oscilloscopePoints: 512/)
  assert.match(source, /if \(visualizerActive\.value\) return/)
  assert.match(source, /let visualizationPollingGeneration = 0/)
  assert.match(source, /const requestGeneration = visualizationPollingGeneration/)
  assert.match(source, /if \(requestGeneration !== visualizationPollingGeneration\) return/)
  assert.match(source, /visualizationPollingGeneration \+= 1/)
  assert.match(
    source,
    /\[isPlaying, audioEngineReady, \(\) => currentTrack\.value\?\.id, visualizerActive\]/
  )
})

test('player store exposes audio service recovery notice state', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const body = extractFunctionBody(source, 'usePlayerStore')

  assert.match(source, /const audioEngineRecoveryNotice = ref/)
  assert.match(source, /function setAudioServiceCrashNotice/)
  assert.match(source, /function setAudioServiceReadyNotice/)
  assert.match(source, /outputRouteSynced/)
  assert.match(source, /restoreErrors/)
  assert.match(source, /canResume: outputRouteSynced/)
  assert.match(source, /api\.onServiceCrash/)
  assert.match(source, /api\.onServiceReady/)
  assert.match(source, /kind: 'service-crash'/)
  assert.match(source, /kind: 'service-ready'/)
  assert.match(source, /message\.includes\('音频服务已重启'\)/)
  assert.match(source, /dismissAudioEngineRecoveryNotice/)
  assert.match(body, /audioEngineRecoveryNotice/)
  assert.match(body, /dismissAudioEngineRecoveryNotice/)
})

test('renderer audio device normalization derives tri-state capability fallbacks', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const helper = extractInternalFunctionBody(source, 'normalizeAudioDeviceOptions')

  assert.match(source, /function deriveDopSupportState/)
  assert.match(source, /function deriveNativeDsdSupportState/)
  assert.match(source, /fallbackBackend: AudioOutputId \| '' = ''/)
  assert.match(source, /id\.startsWith\('hw:'\)/)
  assert.match(
    source,
    /normalizeAudioDeviceOptions\(\s*state\.deviceOptions,\s*state\.device,\s*state\.output\s*\)/
  )
  assert.match(source, /dopSupportState: 'runtime-probed'/)
  assert.match(source, /nativeDsdSupportState: 'unsupported'/)
  assert.match(
    helper,
    /withAudioCapabilitySupportStates\(\s*\{\s*id,\s*label: formatAudioDeviceLabel\(id\),\s*isDefault: id === 'auto'\s*\},\s*selectedOutput\s*\)/
  )
  assert.match(
    helper,
    /withAudioCapabilitySupportStates\(\s*\{\s*\.\.\.\(record as Partial<AudioDeviceOption>\),/
  )
  assert.match(helper, /withAudioCapabilitySupportStates\(\s*\{\s*id: selectedDevice,/)
})

test('dominant cover color extraction ignores stale async results', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')

  assert.match(source, /let dominantColorRequestId = 0/)
  assert.match(source, /const requestId = \+\+dominantColorRequestId/)
  assert.match(source, /const color = await extractDominantColor\(cover\)/)
  assert.match(source, /requestId === dominantColorRequestId/)
  assert.match(source, /currentTrack\.value\?\.cover === cover/)
  assert.match(source, /appSettings\.value\?\.useCoverTheme/)
})

test('audio output refresh reruns when hotplug arrives during an in-flight request', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const helper = extractInternalFunctionBody(source, 'refreshAudioOutputState')

  assert.match(source, /let audioEngineStateRefreshQueued = false/)
  assert.match(
    helper,
    /if \(audioEngineStateRequest\) \{\s*audioEngineStateRefreshQueued = true\s*return audioEngineStateRequest\s*\}/
  )
  assert.match(helper, /audioEngineStateRefreshQueued = false[\s\S]*api\.getAudioOutputState\(\)/)
  assert.match(helper, /audioEngineStateRequest = null/)
  assert.match(
    helper,
    /if \(audioEngineStateRefreshQueued\) \{\s*await refreshAudioOutputState\(\)\s*\}/
  )
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

  assert.match(
    source,
    /import \{[\s\S]*findProviderRematchCandidate[\s\S]*\} from '\.\.\/utils\/libraryRepair\.ts'/
  )
  assert.match(
    handlePlaybackFallback,
    /await handleProviderRematchFallback\(failedTrack, loadToken\)/
  )
  assert.match(handleProviderRematchFallback, /useMediaProviders\(\)\.searchAllSongs\(\{/)
  assert.match(
    handleProviderRematchFallback,
    /findProviderRematchCandidate\(failedTrack, candidates\)/
  )
  assert.match(handleProviderRematchFallback, /queue\.value = queue\.value\.map/)
  assert.match(handleProviderRematchFallback, /currentTrack\.value = rematched/)
  assert.match(handleProviderRematchFallback, /await loadAndPlay\(rematched\)/)
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
  const settingsStoreSource = readFileSync(
    new URL('./useSettingsStore.ts', import.meta.url),
    'utf8'
  )
  const mainSource = readFileSync(
    new URL('../../../main/core/settings.ts', import.meta.url),
    'utf8'
  )
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

test('playback end auto-advance stops at queue end without changing manual next wrap', () => {
  const playerSource = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const handlePlaybackEnded = extractInternalFunctionBody(playerSource, 'handlePlaybackEnded')
  const handleNativePlaybackEnded = extractInternalFunctionBody(
    playerSource,
    'handleNativePlaybackEnded'
  )
  const advanceAfterPlaybackEnded = extractInternalFunctionBody(
    playerSource,
    'advanceAfterPlaybackEnded'
  )
  const setupAudioEngineListeners = extractInternalFunctionBody(
    playerSource,
    'setupAudioEngineListeners'
  )
  const next = extractInternalFunctionBody(playerSource, 'next')
  const scheduleCrossfadeIfNeeded = extractInternalFunctionBody(
    playerSource,
    'scheduleCrossfadeIfNeeded'
  )

  assert.match(handlePlaybackEnded, /advanceAfterPlaybackEnded\(\)/)
  assert.doesNotMatch(handlePlaybackEnded, /\n\s*next\(\)/)
  assert.match(advanceAfterPlaybackEnded, /const nextIndex = queueIndex\.value \+ 1/)
  assert.match(advanceAfterPlaybackEnded, /nextIndex < queue\.value\.length/)
  assert.match(advanceAfterPlaybackEnded, /isPlaying\.value = false/)
  assert.match(advanceAfterPlaybackEnded, /stopVisualizationPolling\(true\)/)
  assert.match(handleNativePlaybackEnded, /if \(!nativePlaybackActive\) return/)
  assert.match(handleNativePlaybackEnded, /if \(isNativeQueueDelegated\(\)\) return/)
  assert.match(handleNativePlaybackEnded, /handlePlaybackEnded\(\)/)
  assert.match(setupAudioEngineListeners, /case 'eof-reached':\s*handleNativePlaybackEnded\(\)/)
  assert.match(
    setupAudioEngineListeners,
    /if \(nativePlaybackActive && reason === 'eof'\) \{\s*handleNativePlaybackEnded\(\)/
  )
  assert.match(next, /queueIndex\.value = 0/)
  assert.match(scheduleCrossfadeIfNeeded, /queueIndex\.value \+ 1 >= queue\.value\.length/)
})

test('current playlist selection preserves the existing shuffled queue order', () => {
  const playerBarSource = readFileSync(
    new URL('../components/PlayerBar.vue', import.meta.url),
    'utf8'
  )
  const playTrackAt = extractInternalFunctionBody(playerBarSource, 'playTrackAt')

  assert.doesNotMatch(
    playTrackAt,
    /playTrack\(track,\s*queue\.value\)/,
    'selecting from the current queue must not pass that queue back through the shuffle initializer'
  )
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
  assert.match(
    restorePlaybackSession,
    /setPlayModeInternal\(session\.playMode, \{ persist: false \}\)/
  )
})
