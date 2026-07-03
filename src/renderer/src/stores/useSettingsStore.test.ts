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
  assert.match(source, /if \(sequence === settingsUpdateSequence\) \{\s*applySnapshot\(snapshot\)\s*\}/)
})

test('background image import accepts ArrayBuffer views from Electron IPC', () => {
  const source = readFileSync(new URL('../../../main/library/coverCache.ts', import.meta.url), 'utf8')
  const ipcSource = readFileSync(new URL('../../../main/ipc/data.ts', import.meta.url), 'utf8')

  assert.match(source, /function normalizeBackgroundImageImportData\(data: unknown\): Buffer \| null/)
  assert.match(source, /if \(Buffer\.isBuffer\(data\)\) return data/)
  assert.match(source, /if \(data instanceof ArrayBuffer\) return Buffer\.from\(data\)/)
  assert.match(source, /if \(ArrayBuffer\.isView\(data\)\) \{/)
  assert.match(source, /Buffer\.from\(data\.buffer, data\.byteOffset, data\.byteLength\)/)
  assert.match(ipcSource, /const buffer = normalizeBackgroundImageImportData\(data\)/)
})

test('background protocol accepts chromium-normalized trailing slash urls', () => {
  const cacheSource = readFileSync(new URL('../../../main/library/coverCache.ts', import.meta.url), 'utf8')
  const lifecycleSource = readFileSync(new URL('../../../main/app/lifecycle.ts', import.meta.url), 'utf8')

  assert.ok(cacheSource.includes("const normalizedName = fileName.replace(/^\\/+|\\/+$/g, '')"))
  assert.ok(cacheSource.includes("const safeName = normalizedName.replace(/[^a-zA-Z0-9._-]/g, '')"))
  assert.ok(cacheSource.includes('safeName !== normalizedName'))
  assert.match(lifecycleSource, /protocol\.handle\('background'/)
  assert.match(lifecycleSource, /resolveBackgroundImageFile\(fileName\)/)
})

test('settings page quotes background image handles when building css url values', () => {
  const source = readFileSync(new URL('../components/SettingsPage.vue', import.meta.url), 'utf8')

  assert.match(source, /function toBackgroundImageStyle\(image: string\): string/)
  assert.ok(source.includes('return image ? `url("${image.replace(/"/g, \'\\\\"\')}")` : \'none\''))
  assert.match(source, /backgroundImage: toBackgroundImageStyle\(settings\.appBackground\.global\.image\)/)
  assert.match(source, /backgroundImage: toBackgroundImageStyle\(settings\.appBackground\.pages\[page\.value\]\.image\)/)
})

test('settings page sends plain app background objects through Electron IPC', () => {
  const source = readFileSync(new URL('../components/SettingsPage.vue', import.meta.url), 'utf8')

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
  const mainSettings = readFileSync(new URL('../../../main/core/settings.ts', import.meta.url), 'utf8')
  const settingsTypes = readFileSync(new URL('../types/settings.ts', import.meta.url), 'utf8')
  const storeSource = readFileSync(new URL('./useSettingsStore.ts', import.meta.url), 'utf8')
  const appSource = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
  const settingsPageSource = readFileSync(
    new URL('../components/SettingsPage.vue', import.meta.url),
    'utf8'
  )

  assert.match(settingsTypes, /export type StartupHomePage = 'local' \| 'streaming'/)
  assert.match(settingsTypes, /startupHomePage: StartupHomePage/)
  assert.match(mainTypes, /export type StartupHomePage = 'local' \| 'streaming'/)
  assert.match(mainSettings, /startupHomePage: 'local'/)
  assert.match(mainSettings, /function normalizeStartupHomePage\(value: unknown\): StartupHomePage/)
  assert.match(mainSettings, /startupHomePage: normalizeStartupHomePage\(settings\.startupHomePage\)/)
  assert.match(storeSource, /startupHomePage: 'local'/)
  assert.match(appSource, /if \(loadedSettings\.startupHomePage === 'streaming'\) \{/)
  assert.match(settingsPageSource, /const startupHomePageOptions/)
  assert.match(settingsPageSource, /function setStartupHomePage\(startupHomePage: StartupHomePage\)/)
  assert.match(settingsPageSource, /启动后进入/)
  assert.match(settingsPageSource, /本地音乐主页/)
  assert.match(settingsPageSource, /流媒体主页/)
})

test('audio settings expose advanced replaygain, fft, and crossfeed controls without fake loudnorm', () => {
  const settingsTypes = readFileSync(new URL('../types/settings.ts', import.meta.url), 'utf8')
  const storeSource = readFileSync(new URL('./useSettingsStore.ts', import.meta.url), 'utf8')
  const settingsPageSource = readFileSync(
    new URL('../components/SettingsPage.vue', import.meta.url),
    'utf8'
  )

  assert.match(settingsTypes, /crossfeedDelayMs: number/)
  assert.match(settingsTypes, /crossfeedCutoffHz: number/)
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
  assert.doesNotMatch(settingsPageSource, /value: 'loudnorm'/)
  assert.match(settingsPageSource, /预留项，当前原生 DSP 链未消费该开关/)
})

test('strict bit-perfect mode is persisted and exposed in audio settings', () => {
  const settingsTypes = readFileSync(new URL('../types/settings.ts', import.meta.url), 'utf8')
  const preloadTypes = readFileSync(new URL('../../../preload/types.ts', import.meta.url), 'utf8')
  const mainTypes = readFileSync(new URL('../../../main/core/types.ts', import.meta.url), 'utf8')
  const mainSettings = readFileSync(new URL('../../../main/core/settings.ts', import.meta.url), 'utf8')
  const settingsStoreSource = readFileSync(new URL('./useSettingsStore.ts', import.meta.url), 'utf8')
  const settingsPageSource = readFileSync(
    new URL('../components/SettingsPage.vue', import.meta.url),
    'utf8'
  )

  for (const source of [settingsTypes, preloadTypes, mainTypes]) {
    assert.match(source, /strictBitPerfectMode: boolean/)
  }
  assert.match(mainSettings, /strictBitPerfectMode: false/)
  assert.match(mainSettings, /strictBitPerfectMode: settings\.strictBitPerfectMode === true/)
  assert.match(settingsStoreSource, /strictBitPerfectMode: false/)
  assert.match(settingsPageSource, /function toggleStrictBitPerfectMode\(\): void/)
  assert.match(settingsPageSource, /updateSettings\(\{ strictBitPerfectMode: next \}\)/)
  assert.match(settingsPageSource, /严格 Bit-Perfect/)
})

test('cache strategy settings expose separate artifact and provider-controlled audio policies', () => {
  const mainTypes = readFileSync(new URL('../../../main/core/types.ts', import.meta.url), 'utf8')
  const mainSettings = readFileSync(new URL('../../../main/core/settings.ts', import.meta.url), 'utf8')
  const rendererTypes = readFileSync(new URL('../types/settings.ts', import.meta.url), 'utf8')
  const storeSource = readFileSync(new URL('./useSettingsStore.ts', import.meta.url), 'utf8')
  const preloadTypes = readFileSync(new URL('../../../preload/types.ts', import.meta.url), 'utf8')
  const preloadIndexTypes = readFileSync(new URL('../../../preload/index.d.ts', import.meta.url), 'utf8')
  const pluginIpcSource = readFileSync(new URL('../../../main/ipc/plugins.ts', import.meta.url), 'utf8')
  const settingsPageSource = readFileSync(
    new URL('../components/SettingsPage.vue', import.meta.url),
    'utf8'
  )

  for (const source of [mainTypes, rendererTypes, preloadTypes]) {
    assert.match(source, /export type StreamingAudioCachePolicy = 'off' \| 'provider'/)
    assert.match(source, /export interface MusicCachePolicySettings \{/)
    assert.match(source, /cover: boolean/)
    assert.match(source, /lyrics: boolean/)
    assert.match(source, /metadata: boolean/)
    assert.match(source, /streamingAudio: StreamingAudioCachePolicy/)
    assert.match(source, /cachePolicy: MusicCachePolicySettings/)
  }

  assert.match(preloadIndexTypes, /type StreamingAudioCachePolicy = 'off' \| 'provider'/)
  assert.match(preloadIndexTypes, /interface MusicCachePolicySettings \{/)
  assert.match(preloadIndexTypes, /cover: boolean/)
  assert.match(preloadIndexTypes, /lyrics: boolean/)
  assert.match(preloadIndexTypes, /metadata: boolean/)
  assert.match(preloadIndexTypes, /streamingAudio: StreamingAudioCachePolicy/)
  assert.match(preloadIndexTypes, /cachePolicy: MusicCachePolicySettings/)

  assert.match(mainSettings, /export const DEFAULT_MUSIC_CACHE_POLICY: MusicCachePolicySettings = \{/)
  assert.match(mainSettings, /cover: true/)
  assert.match(mainSettings, /lyrics: true/)
  assert.match(mainSettings, /metadata: true/)
  assert.match(mainSettings, /streamingAudio: 'provider'/)
  assert.match(mainSettings, /function normalizeMusicCachePolicy\(raw: unknown\): MusicCachePolicySettings/)
  assert.match(mainSettings, /cover: value\.cover !== false/)
  assert.match(mainSettings, /lyrics: value\.lyrics !== false/)
  assert.match(mainSettings, /metadata: value\.metadata !== false/)
  assert.match(mainSettings, /return value === 'off' \? 'off' : 'provider'/)
  assert.match(mainSettings, /cachePolicy: normalizeMusicCachePolicy\(settings\.cachePolicy\)/)
  assert.match(storeSource, /cachePolicy: \{/)
  assert.match(settingsPageSource, /function toggleCacheArtifact\(key: keyof MusicCachePolicySettings\): void/)
  assert.match(settingsPageSource, /function setStreamingAudioCachePolicy\(event: Event\): void/)
  assert.match(settingsPageSource, /封面缓存/)
  assert.match(settingsPageSource, /歌词缓存/)
  assert.match(settingsPageSource, /元数据缓存/)
  assert.match(settingsPageSource, /流媒体音频缓存/)
  assert.match(settingsPageSource, /由 Provider 规则控制/)
  assert.match(pluginIpcSource, /runtime\.appSettings\.cachePolicy\.streamingAudio !== 'provider'/)
  assert.match(pluginIpcSource, /return null/)
})
