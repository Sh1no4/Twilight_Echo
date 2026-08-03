import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('background settings updates are applied optimistically and protected from stale snapshots', () => {
  const source = readFileSync(new URL('./useSettingsStore.ts', import.meta.url), 'utf8')

  assert.match(source, /let settingsUpdateQueue: Promise<void> = Promise\.resolve\(\)/)
  assert.match(source, /let pendingSettingsUpdates = 0/)
  assert.match(source, /let settingsUpdateSequence = 0/)
  assert.match(source, /if \(pendingSettingsUpdates > 0\) return/)
  assert.match(source, /Object\.prototype\.hasOwnProperty\.call\(patch, 'appBackground'\)/)
  assert.match(source, /applyDomSettings\(\)/)
  assert.match(
    source,
    /if \(sequence === settingsUpdateSequence\) \{\s*applySnapshot\(snapshot\)\s*\}/
  )
})

test('first-use appearance defaults to blue accents and bilingual desktop lyrics', () => {
  const rendererSource = readFileSync(new URL('./useSettingsStore.ts', import.meta.url), 'utf8')
  const mainSource = readFileSync(
    new URL('../../../main/core/settings.ts', import.meta.url),
    'utf8'
  )
  const themeSource = readFileSync(new URL('./useThemeStore.ts', import.meta.url), 'utf8')

  for (const source of [rendererSource, mainSource]) {
    assert.match(source, /lightAccentColor: 'blue'/)
    assert.match(source, /darkAccentColor: 'blue'/)
    assert.match(source, /layout: 'bilingual'/)
    assert.match(source, /highlightColor: '#3b82f6'/)
    assert.match(source, /lineOffset: 0/)
  }
  assert.match(themeSource, /let lightAccentColor = 'blue'/)
  assert.match(themeSource, /let darkAccentColor = 'blue'/)
  assert.match(mainSource, /DEFAULT_DESKTOP_LYRICS\.layout/)
})

test('settings chrome no longer dual-writes theme-owned CSS variables', () => {
  const source = readFileSync(new URL('./useSettingsStore.ts', import.meta.url), 'utf8')
  const themeSource = readFileSync(new URL('./useThemeStore.ts', import.meta.url), 'utf8')
  const appSource = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
  const songListSource = readFileSync(
    new URL('../components/song-list/SongList.css', import.meta.url),
    'utf8'
  )

  assert.match(source, /THEME_OWNED_INLINE_STYLE_VARS/)
  assert.match(source, /clearLegacyThemeOwnedInlineStyles/)
  assert.match(source, /dataset\.themePreference/)
  assert.doesNotMatch(source, /setProperty\('--te-primary-500'/)
  assert.doesNotMatch(source, /setProperty\('--brand-500'/)
  assert.doesNotMatch(source, /setProperty\('--te-app-bg'/)
  assert.doesNotMatch(source, /function applyCardAppearance/)
  assert.doesNotMatch(source, /dataset\.theme = resolvedTheme/)
  assert.match(themeSource, /function applyAppBackgroundVariables/)
  assert.match(themeSource, /function syncThemeSettingsAppearance/)
  assert.match(
    themeSource,
    /variables\['--te-app-bg-image'\] = toBackgroundImageValue\(globalBackground\)/
  )
  assert.match(themeSource, /applyAppBackgroundVariables\(tone, variables\)/)
  assert.doesNotMatch(appSource, /body\s*\{\s*background:\s*transparent/)
  assert.match(songListSource, /background-image:[\s\S]*var\(--te-local-bg-image\)/)
})

test('background image import accepts ArrayBuffer views from Electron IPC', () => {
  const source = readFileSync(
    new URL('../../../main/library/coverCache.ts', import.meta.url),
    'utf8'
  )
  const ipcSource = readFileSync(new URL('../../../main/ipc/data.ts', import.meta.url), 'utf8')

  assert.match(
    source,
    /function normalizeBackgroundImageImportData\(data: unknown\): Buffer \| null/
  )
  assert.match(source, /if \(Buffer\.isBuffer\(data\)\) return data/)
  assert.match(source, /if \(data instanceof ArrayBuffer\) return Buffer\.from\(data\)/)
  assert.match(source, /if \(ArrayBuffer\.isView\(data\)\) \{/)
  assert.match(source, /Buffer\.from\(data\.buffer, data\.byteOffset, data\.byteLength\)/)
  assert.match(ipcSource, /const buffer = normalizeBackgroundImageImportData\(data\)/)
})

test('background protocol accepts chromium-normalized trailing slash urls', () => {
  const cacheSource = readFileSync(
    new URL('../../../main/library/coverCache.ts', import.meta.url),
    'utf8'
  )
  const lifecycleSource = readFileSync(
    new URL('../../../main/app/lifecycle.ts', import.meta.url),
    'utf8'
  )

  assert.ok(cacheSource.includes("const normalizedName = fileName.replace(/^\\/+|\\/+$/g, '')"))
  assert.ok(cacheSource.includes("const safeName = normalizedName.replace(/[^a-zA-Z0-9._-]/g, '')"))
  assert.ok(cacheSource.includes('safeName !== normalizedName'))
  assert.match(lifecycleSource, /protocol\.handle\('background'/)
  assert.match(lifecycleSource, /resolveBackgroundImageFile\(fileName\)/)
})

function readSettingsPageSources(): string {
  const root = new URL('../components/', import.meta.url)
  return [
    'SettingsPage.vue',
    'settings-page/types.ts',
    'settings-page/AboutSettingsSection.vue',
    'settings-page/ShortcutsSettingsSection.vue',
    'settings-page/MiniPlayerSettingsSection.vue'
  ]
    .map((relative) => readFileSync(new URL(relative, root), 'utf8'))
    .join('\n')
}

test('about settings expose local-only sponsor payment options and sponsor list', () => {
  const source = readSettingsPageSources()
  const gitignore = readFileSync(new URL('../../../../.gitignore', import.meta.url), 'utf8')

  assert.match(source, /const AFDIAN_URL = 'https:\/\/ifdian\.net\/a\/pxasen'/)
  assert.match(source, />\s*赞助作者\s*</)
  assert.match(source, />\s*赞助名单\s*</)
  assert.match(source, /请务必添加我的联系方式，我会将你加入软件的赞助者名单中，感谢你的支持！/)
  assert.match(source, /const ALIPAY_QR_URL = '\/sponsor\/alipay\.jpg'/)
  assert.match(source, /const WECHAT_QR_URL = '\/sponsor\/wechat\.png'/)
  assert.match(source, /useEscapeToClose\(sponsorDialogOpen, closeSponsorDialog\)/)
  assert.match(source, /useFocusTrap\(sponsorDialogRef, sponsorDialogOpen\)/)
  assert.match(source, /const QQ_GROUP_QR_URL = '\/qq-group-qrcode\.jpg'/)
  assert.match(source, />\s*Q群\s*</)
  assert.match(source, /TwilightEcho 交流群/)
  assert.match(source, /群号：1093775290/)
  assert.match(source, /useEscapeToClose\(qqGroupDialogOpen, closeQqGroupDialog\)/)
  assert.match(source, /useFocusTrap\(qqGroupDialogRef, qqGroupDialogOpen\)/)
  assert.match(gitignore, /^resources\/sponsor\/alipay\.jpg$/m)
  assert.match(gitignore, /^resources\/sponsor\/wechat\.png$/m)
})

test('settings page quotes background image handles when building css url values', () => {
  const source = readSettingsPageSources()

  assert.match(source, /function toBackgroundImageStyle\(image: string\): string/)
  assert.ok(source.includes('return image ? `url("${image.replace(/"/g, \'\\\\"\')}")` : \'none\''))
  assert.match(source, /backgroundImage: toBackgroundImageStyle\(/)
})

test('settings page sends plain app background objects through Electron IPC', () => {
  const source = readSettingsPageSources()

  assert.match(source, /function cloneAppBackground\(\): AppBackgroundSettings/)
  assert.match(source, /global: \{ \.\.\.background\.global \}/)
  assert.match(source, /local: \{ \.\.\.background\.pages\.local \}/)
  assert.match(source, /settings: \{ \.\.\.background\.pages\.settings \}/)
  assert.match(source, /streaming: \{ \.\.\.background\.pages\.streaming \}/)
  assert.match(source, /player: \{ \.\.\.background\.pages\.player \}/)
  assert.doesNotMatch(source, /\.\.\.settings\.value\.appBackground/)
  assert.doesNotMatch(source, /\.\.\.settings\.value\.appBackground\.pages/)
})

test('startup home page setting is persisted and selectable from general settings', () => {
  const mainTypes = readFileSync(new URL('../../../main/core/types.ts', import.meta.url), 'utf8')
  const mainSettings = readFileSync(
    new URL('../../../main/core/settings.ts', import.meta.url),
    'utf8'
  )
  const settingsTypes = readFileSync(new URL('../types/settings.ts', import.meta.url), 'utf8')
  const storeSource = readFileSync(new URL('./useSettingsStore.ts', import.meta.url), 'utf8')
  const appSource = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
  const settingsPageSource = readSettingsPageSources()

  assert.match(settingsTypes, /export type StartupHomePage = 'local' \| 'streaming'/)
  assert.match(settingsTypes, /startupHomePage: StartupHomePage/)
  assert.match(mainTypes, /export type StartupHomePage = 'local' \| 'streaming'/)
  assert.match(mainSettings, /startupHomePage: 'local'/)
  assert.match(mainSettings, /function normalizeStartupHomePage\(value: unknown\): StartupHomePage/)
  assert.match(
    mainSettings,
    /startupHomePage: normalizeStartupHomePage\(settings\.startupHomePage\)/
  )
  assert.match(storeSource, /startupHomePage: 'local'/)
  assert.match(appSource, /if \(loadedSettings\.startupHomePage === 'streaming'\) \{/)
  assert.match(settingsPageSource, /const startupHomePageOptions/)
  assert.match(
    settingsPageSource,
    /function setStartupHomePage\(startupHomePage: StartupHomePage\)/
  )
  assert.match(settingsPageSource, /启动后进入/)
  assert.match(settingsPageSource, /本地音乐主页/)
  assert.match(settingsPageSource, /流媒体主页/)
})

test('track activation mode is persisted across layers and applied to all track lists', () => {
  const mainTypes = readFileSync(new URL('../../../main/core/types.ts', import.meta.url), 'utf8')
  const mainSettings = readFileSync(
    new URL('../../../main/core/settings.ts', import.meta.url),
    'utf8'
  )
  const preloadTypes = readFileSync(new URL('../../../preload/types.ts', import.meta.url), 'utf8')
  const preloadDts = readFileSync(new URL('../../../preload/index.d.ts', import.meta.url), 'utf8')
  const rendererTypes = readFileSync(new URL('../types/settings.ts', import.meta.url), 'utf8')
  const storeSource = readFileSync(new URL('./useSettingsStore.ts', import.meta.url), 'utf8')
  const settingsPageSource = readSettingsPageSources()
  const songListSource = readFileSync(
    new URL('../components/SongList.vue', import.meta.url),
    'utf8'
  )
  const streamingPageSource = readFileSync(
    new URL('../components/StreamingPage.vue', import.meta.url),
    'utf8'
  )
  const streamingSearchSource = readFileSync(
    new URL('../components/StreamingSearch.vue', import.meta.url),
    'utf8'
  )
  const streamingDetailSource = readFileSync(
    new URL('../components/streaming-page/StreamingDetailStage.vue', import.meta.url),
    'utf8'
  )
  const streamingSocialSource = readFileSync(
    new URL('../components/streaming-page/StreamingSocialStage.vue', import.meta.url),
    'utf8'
  )
  const multiSelectSource = readFileSync(
    new URL('../components/song-list/useTrackMultiSelect.ts', import.meta.url),
    'utf8'
  )

  for (const source of [mainTypes, preloadTypes, rendererTypes]) {
    assert.match(source, /export type TrackActivationMode = 'singleClick' \| 'doubleClick'/)
    assert.match(source, /trackActivationMode: TrackActivationMode/)
  }
  assert.match(preloadDts, /type TrackActivationMode = 'singleClick' \| 'doubleClick'/)
  assert.match(preloadDts, /trackActivationMode: TrackActivationMode/)
  assert.match(mainSettings, /trackActivationMode: 'singleClick'/)
  assert.match(
    mainSettings,
    /export function normalizeTrackActivationMode\(value: unknown\): TrackActivationMode \{\s*return value === 'doubleClick' \? 'doubleClick' : 'singleClick'\s*\}/
  )
  assert.match(
    mainSettings,
    /trackActivationMode: normalizeTrackActivationMode\(settings\.trackActivationMode\)/
  )
  assert.match(storeSource, /trackActivationMode: 'singleClick'/)
  assert.match(settingsPageSource, /trackActivationModeOptions/)
  assert.match(settingsPageSource, /单击播放/)
  assert.match(settingsPageSource, /双击播放/)
  assert.match(settingsPageSource, /歌曲列表播放方式/)
  assert.match(songListSource, /trackActivationMode === 'doubleClick'/)
  assert.match(songListSource, /@dblclick="onRowDblClick\(track, \$event\)"/)
  assert.match(streamingPageSource, /trackActivationMode === 'doubleClick'/)
  assert.ok(
    (streamingPageSource.match(/:track-activation-mode=/g) ?? []).length >= 3,
    'search, detail, and social streaming track lists must receive the setting'
  )
  for (const source of [streamingSearchSource, streamingDetailSource, streamingSocialSource]) {
    assert.match(source, /trackActivationMode/)
    assert.match(source, /@dblclick/)
  }
  assert.doesNotMatch(multiSelectSource, /ensureContextSelection/)
  assert.doesNotMatch(songListSource, /ensureContextSelection/)
  assert.doesNotMatch(streamingPageSource, /ensureContextSelection/)
  assert.match(songListSource, /function onTrackContextMenu\([\s\S]*?onContextMenu\(event, track\)/)
  assert.match(
    streamingPageSource,
    /function onStreamingTrackContextMenu\([\s\S]*?streamingContextMenuTrack\.value = track/
  )
})

test('genre separators persist across settings layers and refresh derived library groups', () => {
  const mainTypes = readFileSync(new URL('../../../main/core/types.ts', import.meta.url), 'utf8')
  const mainSettings = readFileSync(
    new URL('../../../main/core/settings.ts', import.meta.url),
    'utf8'
  )
  const preloadTypes = readFileSync(new URL('../../../preload/types.ts', import.meta.url), 'utf8')
  const preloadDts = readFileSync(new URL('../../../preload/index.d.ts', import.meta.url), 'utf8')
  const rendererTypes = readFileSync(new URL('../types/settings.ts', import.meta.url), 'utf8')
  const storeSource = readFileSync(new URL('./useSettingsStore.ts', import.meta.url), 'utf8')
  const settingsPageSource = readSettingsPageSources()
  const songListSource = readFileSync(
    new URL('../components/SongList.vue', import.meta.url),
    'utf8'
  )

  for (const source of [mainTypes, preloadTypes, preloadDts, rendererTypes]) {
    assert.match(source, /genreSeparators: string/)
  }
  assert.match(mainSettings, /genreSeparators: DEFAULT_GENRE_SEPARATORS/)
  assert.match(
    mainSettings,
    /genreSeparators: normalizeGenreSeparators\(settings\.genreSeparators\)/
  )
  assert.match(storeSource, /genreSeparators: DEFAULT_GENRE_SEPARATORS/)
  assert.match(
    settingsPageSource,
    /async function setGenreSeparators\(event: Event\): Promise<void>/
  )
  assert.match(settingsPageSource, /updateSettings\(\{ genreSeparators: value \}\)/)
  assert.match(settingsPageSource, /aria-label="流派分隔符"/)
  assert.match(settingsPageSource, /@change="setGenreSeparators"/)
  assert.match(songListSource, /settingsStore\.settings\.value\.genreSeparators/)
  assert.match(songListSource, /\(\) => refreshLibraryIndex\(\)/)
})

test('audio settings expose advanced replaygain, fft, crossfeed, and real loudnorm option', () => {
  const settingsTypes = readFileSync(new URL('../types/settings.ts', import.meta.url), 'utf8')
  const storeSource = readFileSync(new URL('./useSettingsStore.ts', import.meta.url), 'utf8')
  const settingsPageSource = readSettingsPageSources()
  const hifiSidebarSource = readFileSync(
    new URL('../components/player-bar/HiFiSidebar.vue', import.meta.url),
    'utf8'
  )

  assert.match(settingsTypes, /crossfeedDelayMs: number/)
  assert.match(settingsTypes, /crossfeedCutoffHz: number/)
  assert.match(settingsTypes, /'loudnorm'/)
  assert.match(storeSource, /crossfeedDelayMs: 0\.35/)
  assert.match(storeSource, /crossfeedCutoffHz: 700/)
  assert.match(settingsPageSource, /function setReplayGainFallback\(event: Event\): void/)
  assert.match(settingsPageSource, /function toggleReplayGainClip\(\): void/)
  assert.match(settingsPageSource, /function toggleFftEnabled\(\): void/)
  assert.match(settingsPageSource, /function setCrossfeedDelay\(event: Event\): void/)
  assert.match(settingsPageSource, /function setCrossfeedCutoff\(event: Event\): void/)
  assert.match(settingsPageSource, /Fallback Gain/)
  assert.match(settingsPageSource, /ReplayGain Clip/)
  assert.match(settingsPageSource, /FFT Capture/)
  assert.match(settingsPageSource, /Crossfeed Delay/)
  assert.match(settingsPageSource, /Crossfeed Cutoff/)
  assert.match(
    settingsPageSource,
    /VOLUME_NORMALIZATION_OPTIONS|replayGainOptions = VOLUME_NORMALIZATION_OPTIONS/
  )
  assert.match(settingsPageSource, /replayGainOptions/)
  assert.match(hifiSidebarSource, /VOLUME_NORMALIZATION_OPTIONS|value: 'loudnorm'/)
  assert.match(settingsPageSource, /High-Res 当前为自动链路能力/)
  assert.match(settingsPageSource, /function capabilityStateLabel/)
  assert.ok(
    settingsPageSource.includes(
      `v-if="normalizeCapabilityState(device.dopSupportState) !== 'unsupported'"`
    )
  )
  assert.ok(
    settingsPageSource.includes(
      `v-if="normalizeCapabilityState(device.nativeDsdSupportState) !== 'unsupported'"`
    )
  )
  assert.match(settingsPageSource, /DoP \{\{ capabilityStateLabel\(device\.dopSupportState\) \}\}/)
  assert.match(
    settingsPageSource,
    /Native DSD \{\{ capabilityStateLabel\(device\.nativeDsdSupportState\) \}\}/
  )
})

test('audio settings do not expose DSP bypass as strict bit-perfect mode', () => {
  const settingsTypes = readFileSync(new URL('../types/settings.ts', import.meta.url), 'utf8')
  const preloadTypes = readFileSync(new URL('../../../preload/types.ts', import.meta.url), 'utf8')
  const mainTypes = readFileSync(new URL('../../../main/core/types.ts', import.meta.url), 'utf8')
  const mainSettings = readFileSync(
    new URL('../../../main/core/settings.ts', import.meta.url),
    'utf8'
  )
  const settingsStoreSource = readFileSync(
    new URL('./useSettingsStore.ts', import.meta.url),
    'utf8'
  )
  const settingsPageSource = readSettingsPageSources()

  for (const source of [
    settingsTypes,
    preloadTypes,
    mainTypes,
    mainSettings,
    settingsStoreSource
  ]) {
    assert.doesNotMatch(source, /strictBitPerfectMode/)
  }
  assert.doesNotMatch(settingsPageSource, /function toggleStrictBitPerfectMode\(\): void/)
  assert.doesNotMatch(settingsPageSource, /updateSettings\(\{ strictBitPerfectMode: next \}\)/)
  assert.doesNotMatch(settingsPageSource, /严格 Bit-Perfect/)
  assert.match(settingsPageSource, /DSP 旁路 \(DSP Bypass\)/)
})

test('cache strategy settings expose separate artifact and provider-controlled audio policies', () => {
  const mainTypes = readFileSync(new URL('../../../main/core/types.ts', import.meta.url), 'utf8')
  const mainSettings = readFileSync(
    new URL('../../../main/core/settings.ts', import.meta.url),
    'utf8'
  )
  const rendererTypes = readFileSync(new URL('../types/settings.ts', import.meta.url), 'utf8')
  const storeSource = readFileSync(new URL('./useSettingsStore.ts', import.meta.url), 'utf8')
  const preloadTypes = readFileSync(new URL('../../../preload/types.ts', import.meta.url), 'utf8')
  const preloadIndexTypes = readFileSync(
    new URL('../../../preload/index.d.ts', import.meta.url),
    'utf8'
  )
  const pluginIpcSource = readFileSync(
    new URL('../../../main/ipc/plugins.ts', import.meta.url),
    'utf8'
  )
  const settingsPageSource = readSettingsPageSources()

  for (const source of [mainTypes, rendererTypes, preloadTypes]) {
    assert.match(source, /export type StreamingAudioCachePolicy = 'off' \| 'provider'/)
    assert.match(source, /export interface MusicCachePolicySettings \{/)
    assert.match(source, /cover: boolean/)
    assert.match(source, /lyrics: boolean/)
    assert.match(source, /metadata: boolean/)
    assert.match(source, /streamingAudio: StreamingAudioCachePolicy/)
    assert.match(source, /cachePolicy: MusicCachePolicySettings/)
    assert.match(source, /autoAnalyzeBpm: boolean/)
  }

  assert.match(preloadIndexTypes, /type StreamingAudioCachePolicy = 'off' \| 'provider'/)
  assert.match(preloadIndexTypes, /interface MusicCachePolicySettings \{/)
  assert.match(preloadIndexTypes, /cover: boolean/)
  assert.match(preloadIndexTypes, /lyrics: boolean/)
  assert.match(preloadIndexTypes, /metadata: boolean/)
  assert.match(preloadIndexTypes, /streamingAudio: StreamingAudioCachePolicy/)
  assert.match(preloadIndexTypes, /cachePolicy: MusicCachePolicySettings/)
  assert.match(preloadIndexTypes, /autoAnalyzeBpm: boolean/)

  assert.match(
    mainSettings,
    /export const DEFAULT_MUSIC_CACHE_POLICY: MusicCachePolicySettings = \{/
  )
  assert.match(mainSettings, /cover: true/)
  assert.match(mainSettings, /lyrics: true/)
  assert.match(mainSettings, /metadata: true/)
  assert.match(mainSettings, /streamingAudio: 'provider'/)
  assert.match(mainSettings, /autoAnalyzeBpm: true/)
  assert.match(
    mainSettings,
    /function normalizeMusicCachePolicy\(raw: unknown\): MusicCachePolicySettings/
  )
  assert.match(mainSettings, /cover: value\.cover !== false/)
  assert.match(mainSettings, /lyrics: value\.lyrics !== false/)
  assert.match(mainSettings, /metadata: value\.metadata !== false/)
  assert.match(mainSettings, /return value === 'off' \? 'off' : 'provider'/)
  assert.match(mainSettings, /cachePolicy: normalizeMusicCachePolicy\(settings\.cachePolicy\)/)
  assert.match(mainSettings, /autoAnalyzeBpm: settings\.autoAnalyzeBpm !== false/)
  assert.match(storeSource, /cachePolicy: \{/)
  assert.match(storeSource, /autoAnalyzeBpm: true/)
  assert.match(storeSource, /formattedBpmAnalysisCacheSize/)
  assert.match(storeSource, /window\.api\.bpmAnalysis\.getCacheSize\(\)/)
  assert.match(storeSource, /window\.api\.bpmAnalysis\.clearCache\(\)/)
  assert.match(storeSource, /window\.api\.loudnessAnalysis\.getCacheSize\(\)/)
  assert.match(storeSource, /window\.api\.loudnessAnalysis\.clearCache\(\)/)
  assert.match(storeSource, /formattedLoudnessAnalysisCacheSize/)
  assert.match(
    readFileSync(new URL('./useMusicStore.ts', import.meta.url), 'utf8'),
    /function clearBpmAnalysis\(\): boolean/
  )
  assert.match(
    settingsPageSource,
    /function toggleCacheArtifact\(key: keyof MusicCachePolicySettings\): void/
  )
  assert.match(settingsPageSource, /function setStreamingAudioCachePolicy\(event: Event\): void/)
  assert.match(settingsPageSource, /function toggleAutoAnalyzeBpm\(\): void/)
  assert.match(settingsPageSource, /function confirmClearBpmAnalysisCache\(\): Promise<void>/)
  assert.match(settingsPageSource, /function confirmClearLoudnessAnalysisCache\(\): Promise<void>/)
  assert.match(settingsPageSource, /clearBpmAnalysisFromPlaybackState\(\)/)
  assert.match(settingsPageSource, /封面缓存/)
  assert.match(settingsPageSource, /歌词缓存/)
  assert.match(settingsPageSource, /元数据缓存/)
  assert.match(settingsPageSource, /流媒体音频缓存/)
  assert.match(settingsPageSource, /BPM 自动分析/)
  assert.match(settingsPageSource, /BPM 分析缓存/)
  assert.match(settingsPageSource, /Loudnorm \/ 响度分析缓存/)
  assert.match(settingsPageSource, /由 Provider 规则控制/)
  assert.match(pluginIpcSource, /runtime\.appSettings\.cachePolicy\.streamingAudio !== 'provider'/)
  assert.match(pluginIpcSource, /return null/)
})

test('settings page exposes search, backup, cache confirmation, and isolated plugin panel state', () => {
  const settingsPageSource = readSettingsPageSources()

  assert.match(settingsPageSource, /const settingsSearchQuery = ref\(''\)/)
  assert.match(settingsPageSource, /const filteredSettingsSections = computed/)
  assert.match(settingsPageSource, /function scrollToSearchResult/)
  assert.match(settingsPageSource, /function confirmClearCache/)
  assert.match(settingsPageSource, /确认清理缓存/)
  assert.match(settingsPageSource, /function exportSettingsBackup/)
  assert.match(settingsPageSource, /function importSettingsBackup/)
  assert.match(settingsPageSource, /function resetSettingsGroup/)
  assert.match(settingsPageSource, /function pluginPanelStateKey/)
  assert.match(settingsPageSource, /pluginSettingsResult\[pluginPanelStateKey\(panel\)\]/)
  assert.match(settingsPageSource, /High-Res 当前为自动链路能力/)
  assert.doesNotMatch(
    settingsPageSource,
    /aria-checked="false"[\s\S]{0,160}当前版本暂未接入原生处理链/
  )
})

test('settings backup and shortcut status APIs are exposed to the renderer', () => {
  const preloadSource = readFileSync(new URL('../../../preload/index.ts', import.meta.url), 'utf8')
  const preloadTypes = readFileSync(new URL('../../../preload/types.ts', import.meta.url), 'utf8')
  const preloadDts = readFileSync(new URL('../../../preload/index.d.ts', import.meta.url), 'utf8')
  const storeSource = readFileSync(new URL('./useSettingsStore.ts', import.meta.url), 'utf8')

  for (const source of [preloadTypes, preloadDts]) {
    assert.match(source, /interface PlayerShortcutStatus \{/)
    assert.match(source, /registered: boolean/)
    assert.match(source, /error: string \| null/)
  }

  assert.match(preloadSource, /exportBackup: \(\): Promise<string>/)
  assert.match(preloadSource, /importBackup: \(json: string\): Promise<SettingsSnapshot>/)
  assert.match(preloadSource, /getShortcutStatuses: \(\): Promise<PlayerShortcutStatus\[]>/)
  assert.match(storeSource, /exportSettingsBackup: \(\) => Promise<string>/)
  assert.match(storeSource, /importSettingsBackup: \(json: string\) => Promise<AppSettings>/)
  assert.match(storeSource, /getShortcutStatuses: \(\) => Promise<PlayerShortcutStatus\[]>/)
})
