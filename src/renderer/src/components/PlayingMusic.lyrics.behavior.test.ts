import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import vue from '@vitejs/plugin-vue'
import { build } from 'vite'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const workspaceRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)))
const electronEnvironment = { ...process.env }
delete electronEnvironment.ELECTRON_RUN_AS_NODE

test('playbar lyrics manager panel manages provider tracks and projects into PlayingMusic', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twilight-playing-music-lyrics-'))
  try {
    const entryPath = join(directory, 'playing-music-lyrics-entry.ts')
    const bundleDirectory = join(directory, 'bundle')
    const htmlPath = join(directory, 'playing-music-lyrics.html')
    const runnerPath = join(directory, 'playing-music-lyrics-runner.cjs')
    await writeFile(entryPath, runtimeEntrySource(), 'utf8')

    await build({
      configFile: false,
      logLevel: 'error',
      root: workspaceRoot,
      plugins: [vue()],
      resolve: {
        alias: {
          '@renderer': join(workspaceRoot, 'src/renderer/src'),
          vue: require.resolve('vue/dist/vue.esm-bundler.js'),
          pinia: join(resolve(require.resolve('pinia/package.json'), '..'), 'dist/pinia.mjs')
        }
      },
      build: {
        outDir: bundleDirectory,
        emptyOutDir: true,
        minify: false,
        lib: {
          entry: entryPath,
          name: 'PlayingMusicLyricsRuntime',
          formats: ['iife'],
          fileName: 'runtime'
        }
      }
    })
    const bundleName = (await readdir(bundleDirectory)).find((name) => name.endsWith('.iife.js'))
    assert.ok(
      bundleName,
      'Vite should bundle the real PlayingMusic + LyricsManagerPanel components'
    )
    await writeFile(htmlPath, runtimeHtml(bundleName), 'utf8')
    await writeFile(runnerPath, electronRunnerSource(), 'utf8')

    const electronPath = require('electron') as string
    const { stderr } = await execFileAsync(electronPath, ['--no-sandbox', runnerPath, htmlPath], {
      env: electronEnvironment,
      timeout: 45_000,
      windowsHide: true
    })
    assert.match(stderr, /PLAYING_MUSIC_LYRICS_RUNTIME_OK/)
    assert.doesNotMatch(stderr, /PLAYING_MUSIC_LYRICS_RUNTIME_FAILED/)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('PlayingLyricWords advances YRC fill with the shared playback clock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twilight-playing-lyric-words-'))
  try {
    const entryPath = join(directory, 'playing-lyric-words-entry.ts')
    const bundleDirectory = join(directory, 'bundle')
    const htmlPath = join(directory, 'playing-lyric-words.html')
    const runnerPath = join(directory, 'playing-lyric-words-runner.cjs')
    await writeFile(entryPath, lyricWordsRuntimeEntrySource(), 'utf8')

    await build({
      configFile: false,
      logLevel: 'error',
      root: workspaceRoot,
      plugins: [vue()],
      resolve: {
        alias: {
          '@renderer': join(workspaceRoot, 'src/renderer/src'),
          vue: require.resolve('vue/dist/vue.esm-bundler.js'),
          pinia: join(resolve(require.resolve('pinia/package.json'), '..'), 'dist/pinia.mjs')
        }
      },
      build: {
        outDir: bundleDirectory,
        emptyOutDir: true,
        minify: false,
        lib: {
          entry: entryPath,
          name: 'PlayingLyricWordsRuntime',
          formats: ['iife'],
          fileName: 'runtime'
        }
      }
    })
    const bundleName = (await readdir(bundleDirectory)).find((name) => name.endsWith('.iife.js'))
    assert.ok(bundleName, 'Vite should bundle the real PlayingLyricWords component')
    await writeFile(htmlPath, runtimeHtml(bundleName), 'utf8')
    await writeFile(runnerPath, lyricWordsElectronRunnerSource(), 'utf8')

    const electronPath = require('electron') as string
    const { stderr } = await execFileAsync(electronPath, ['--no-sandbox', runnerPath, htmlPath], {
      env: electronEnvironment,
      timeout: 45_000,
      windowsHide: true
    })
    assert.match(stderr, /PLAYING_LYRIC_WORDS_RUNTIME_OK/)
    assert.doesNotMatch(stderr, /PLAYING_LYRIC_WORDS_RUNTIME_FAILED/)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

function lyricWordsRuntimeEntrySource(): string {
  const componentPath = join(
    workspaceRoot,
    'src/renderer/src/components/PlayingLyricWords.vue'
  ).replaceAll('\\', '/')
  return `import { createApp, h, nextTick, ref } from 'vue'
import PlayingLyricWords from ${JSON.stringify(componentPath)}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

window.runPlayingLyricWordsRuntime = async () => {
  const currentTime = ref(1)
  const isPlaying = ref(false)
  const playbackRate = ref(1)
  const reachedLineTimes = []
  const clock = { currentTime, isPlaying, playbackRate }
  createApp({
    render: () => h(PlayingLyricWords, {
      active: true,
      karaokeEnabled: true,
      offsetSeconds: 0,
      nextLineTime: 3,
      clock,
      onReachNextLine: (time) => reachedLineTimes.push(time),
      words: [
        { time: 1, endTime: 2, text: 'Null.' },
        { time: 2, endTime: 3, text: 'No light' }
      ]
    })
  }).mount('#app')
  await nextTick()
  const lyricWords = document.querySelectorAll('.lyric-word')
  const firstWord = lyricWords[0]
  const secondWord = lyricWords[1]
  expect(firstWord && secondWord, 'karaoke words were not rendered')
  expect(!document.querySelector('.lyric-word--active'), 'karaoke sweep retained a singled-out word')
  expect(
    firstWord.style.getPropertyValue('--lyric-word-progress') === '0%',
    'karaoke word did not start fully clipped'
  )
  expect(
    firstWord.style.getPropertyValue('--lyric-word-highlight-opacity') === '0',
    'zero-progress karaoke highlight retained an antialiased edge'
  )
  currentTime.value = 1.5
  await nextTick()
  expect(
    firstWord.style.getPropertyValue('--lyric-word-progress') === '50%',
    'karaoke fill did not react to the shared playback clock'
  )
  expect(
    firstWord.style.getPropertyValue('--lyric-word-highlight-opacity') === '1',
    'positive karaoke progress did not reveal the highlight layer'
  )
  isPlaying.value = true
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 90))
  const predictedProgress = Number.parseFloat(
    firstWord.style.getPropertyValue('--lyric-word-progress')
  )
  expect(
    predictedProgress > 54 && predictedProgress < 75,
    'karaoke fill did not advance between playback clock samples; progress=' + predictedProgress
  )
  isPlaying.value = false
  await nextTick()
  currentTime.value = 2
  await nextTick()
  expect(
    firstWord.style.getPropertyValue('--lyric-word-progress') === '100%',
    'karaoke word did not finish its fill'
  )
  expect(
    secondWord.style.getPropertyValue('--lyric-word-progress') === '0%',
    'karaoke sweep skipped ahead of playback order'
  )
  expect(!document.querySelector('.lyric-word--active'), 'karaoke sweep singled out a completed word')
  currentTime.value = 2.95
  isPlaying.value = true
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 150))
  expect(
    reachedLineTimes.some((time) => time >= 3),
    'karaoke clock did not signal the next lyric line boundary'
  )
  const disabledRoot = document.createElement('div')
  document.body.appendChild(disabledRoot)
  createApp({
    render: () => h(PlayingLyricWords, {
      active: true,
      karaokeEnabled: false,
      offsetSeconds: 0,
      nextLineTime: 3,
      clock,
      words: [
        { time: 1, endTime: 2, text: 'Null.' },
        { time: 2, endTime: 3, text: 'No light' }
      ]
    })
  }).mount(disabledRoot)
  await nextTick()
  const disabledWord = disabledRoot.querySelector('.lyric-word')
  expect(disabledWord, 'disabled karaoke words were not rendered')
  expect(
    disabledWord.style.getPropertyValue('--lyric-word-progress') === '',
    'disabled karaoke still updated word progress'
  )
  console.log('PLAYING_LYRIC_WORDS_RUNTIME_OK')
}
`
}

function lyricWordsElectronRunnerSource(): string {
  return `const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const target = process.argv.at(-1)
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, nodeIntegration: false } })
  window.webContents.on('console-message', (_event, _level, message, line, sourceId) => console.error('RENDERER', sourceId + ':' + line, message))
  try {
    await window.loadFile(path.resolve(target))
    await window.webContents.executeJavaScript('window.runPlayingLyricWordsRuntime()')
    console.error('PLAYING_LYRIC_WORDS_RUNTIME_OK')
    app.exit(0)
  } catch (error) {
    console.error('PLAYING_LYRIC_WORDS_RUNTIME_FAILED', error)
    app.exit(1)
  }
})
`
}

function runtimeEntrySource(): string {
  const componentPath = join(
    workspaceRoot,
    'src/renderer/src/components/PlayingMusic.vue'
  ).replaceAll('\\', '/')
  const panelPath = join(
    workspaceRoot,
    'src/renderer/src/components/player-bar/LyricsManagerPanel.vue'
  ).replaceAll('\\', '/')
  const playerStorePath = join(
    workspaceRoot,
    'src/renderer/src/stores/usePlayerStore.ts'
  ).replaceAll('\\', '/')
  const playbackQueueStorePath = join(
    workspaceRoot,
    'src/renderer/src/stores/usePlaybackQueueStore.ts'
  ).replaceAll('\\', '/')
  return `import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import PlayingMusic from ${JSON.stringify(componentPath)}
import LyricsManagerPanel from ${JSON.stringify(panelPath)}
import { usePlayerStore } from ${JSON.stringify(playerStorePath)}
import { usePlaybackQueueStore } from ${JSON.stringify(playbackQueueStorePath)}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

const tick = async () => {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

const waitFor = async (predicate, message) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await tick()
    if (predicate()) return
  }
  const importControl = [...document.querySelectorAll('.lyric-manager--panel button')].find((item) => item.textContent.includes('Import'))
  const originalEditor = document.querySelector('.lyric-manager--panel textarea')
  throw new Error(message + '; importCalls=' + window.__lyricsFixture?.importCalls + '; importDisabled=' + importControl?.disabled + '; original=' + originalEditor?.value)
}

const input = (element, value) => {
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

window.runPlayingMusicLyricsRuntime = async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const player = usePlayerStore()
  const compatibilityPlayer = usePlaybackQueueStore()
  expect(
    usePlaybackQueueStore === usePlayerStore,
    'compatibility store created a second playback factory'
  )
  expect(
    compatibilityPlayer.currentTime === player.currentTime,
    'compatibility store retained a second playback clock'
  )
  expect(
    compatibilityPlayer.currentTrack === player.currentTrack,
    'compatibility store retained a second current track'
  )
  const track = {
    id: 'fixture-provider:no-lyrics', title: 'No lyrics yet', artist: 'Twilight', album: 'Echo',
    filePath: '', fileName: '', duration: 180, size: 0, cover: null,
    lyrics: '', translatedLyrics: null, romanizedLyrics: null,
    lyricsSource: null, translatedLyricsSource: null, romanizedLyricsSource: null,
    source: 'fixture-provider'
  }
  player.currentTrack.value = structuredClone(track)
  player.queue.value = [structuredClone(track)]

  createApp({
    render: () => h('div', [
      h(PlayingMusic),
      h(LyricsManagerPanel)
    ])
  }).use(pinia).mount('#app')
  await tick()
  const beforeCurrent = JSON.stringify(player.currentTrack.value)
  const beforeQueue = JSON.stringify(player.queue.value)

  expect(document.querySelector('.layout--single'), 'provider track without lyrics should use the single-column layout')
  expect(!document.querySelector('.lyric-manage-button'), 'now-playing must not surface a Lyrics entry button')
  const panel = document.querySelector('.lyric-manager--panel')
  expect(panel, 'playbar lyrics manager panel is mounted')

  const buttons = () => [...panel.querySelectorAll('button')]
  const button = (label) => {
    const found = buttons().find((item) => item.textContent.trim() === label)
    if (!found) throw new Error('missing button ' + label + '; available: ' + buttons().map((item) => item.textContent.trim()).join(' | '))
    return found
  }
  const styleControls = panel.querySelector('.lyric-style-controls')
  const editorDisclosure = panel.querySelector('.lyric-editor-disclosure')
  expect(styleControls, 'lyrics style controls are mounted as a separate section')
  expect(editorDisclosure, 'custom lyrics editor is mounted in a disclosure')
  expect(!editorDisclosure.open, 'custom lyrics editor should start collapsed')
  expect(
    Boolean(styleControls.compareDocumentPosition(editorDisclosure) & Node.DOCUMENT_POSITION_FOLLOWING),
    'lyrics style controls should precede the custom lyrics editor'
  )
  button('左对齐').click()
  await waitFor(
    () => window.__settingsFixture.settings.lyricsAppearance?.align === 'left',
    'left alignment did not persist through the lyrics style controls'
  )
  expect(button('左对齐').getAttribute('aria-pressed') === 'true', 'left alignment was not projected')
  editorDisclosure.open = true
  const textareas = panel.querySelectorAll('textarea')
  const source = panel.querySelector('.lyric-source-grid select')
  const importButton = button('导入 LRC')
  const saveLrcButton = button('导出 LRC')

  window.__lyricsFixture.rejectNextSave = true
  button('原文').click()
  await waitFor(
    () => document.querySelector('.lyric-manager-error')?.textContent.includes('fixture CAS conflict'),
    'CAS conflict was not surfaced in the actual manager UI'
  )
  expect(button('原文').getAttribute('aria-pressed') === 'true', 'CAS authority was not restored in the UI')

  button('音译').click()
  await waitFor(
    () => button('音译').getAttribute('aria-pressed') === 'true',
    'romanization toggle was not persisted and projected'
  )
  expect(!document.querySelector('.lyric-manager-error'), 'successful retry left a stale CAS error')

  const originalBeforeCancel = textareas[0].value
  window.__lyricsFixture.importResult = null
  importButton.click()
  await waitFor(
    () =>
      window.__lyricsFixture.importCalls === 1 &&
      !importButton.disabled &&
      buttons().some((item) => item.textContent.trim() === '导入 LRC'),
    'import cancel did not finish through the UI bridge'
  )
  expect(textareas[0].value === originalBeforeCancel, 'import cancel changed the editor')

  window.__lyricsFixture.importResult = '[00:03.00]Imported original'
  button('导入 LRC').click()
  await waitFor(
    () =>
      window.__lyricsFixture.importCalls === 2 &&
      textareas[0].value === '[00:03.00]Imported original',
    'import result did not reach the editor'
  )
  expect(source.value === 'manual', 'import did not choose Manual source')

  input(textareas[1], '[00:03.00]Imported translation')
  input(textareas[2], '[00:03.00]Imported romanization')

  window.__lyricsFixture.saveResult = null
  saveLrcButton.click()
  await waitFor(
    () =>
      window.__lyricsFixture.saveCalls === 1 &&
      buttons().some((item) => item.textContent.trim() === '导出 LRC'),
    'save cancel did not finish through the UI bridge'
  )
  expect(!document.querySelector('.lyric-manager-notice'), 'save cancel reported a successful write')

  window.__lyricsFixture.saveResult = 'D:/authorized/edited.lrc'
  saveLrcButton.click()
  await waitFor(
    () =>
      document.querySelector('.lyric-manager-notice')?.textContent.includes('edited.lrc') &&
      buttons().some((item) => item.textContent.trim() === '导出 LRC'),
    'successful LRC save was not reported'
  )
  expect(window.__lyricsFixture.lastSavedContents === '[00:03.00]Imported original', 'Save LRC did not use edited original text')

  window.__lyricsFixture.saveResult = null
  saveLrcButton.click()
  await waitFor(
    () =>
      window.__lyricsFixture.saveCalls === 3 &&
      buttons().some((item) => item.textContent.trim() === '导出 LRC'),
    'second save cancel did not complete'
  )
  expect(
    !document.querySelector('.lyric-manager-notice')?.textContent.includes('edited.lrc'),
    'save cancel retained a stale success notice'
  )

  button('保存歌词').click()
  await waitFor(
    () => window.__lyricsFixture.document.tracks[track.id]?.original === '[00:03.00]Imported original',
    'Save lyrics did not persist the draft'
  )
  expect(document.querySelector('.lyric-manager--panel'), 'manager panel remains available after save')
  const stored = window.__lyricsFixture.document.tracks[track.id]
  expect(stored.source === 'manual', 'manual source was not persisted')
  expect(stored.original === '[00:03.00]Imported original', 'edited original was not persisted')
  expect(stored.translation === '[00:03.00]Imported translation', 'edited translation was not persisted')
  expect(stored.romanization === '[00:03.00]Imported romanization', 'edited romanization was not persisted')
  await waitFor(
    () => document.querySelector('.lyric-romanization')?.textContent.includes('Imported romanization'),
    'persisted visibility and manual lyrics were not projected by the actual component'
  )
  expect(document.querySelector('.lyric-text')?.textContent.includes('Imported original'), 'manual original was not rendered')
  expect(document.querySelector('.lyric-translation')?.textContent.includes('Imported translation'), 'manual translation was not rendered')
  expect(JSON.stringify(player.currentTrack.value) === beforeCurrent, 'manual UI projection mutated currentTrack')
  expect(
    JSON.stringify(player.queue.value) === beforeQueue,
    'manual UI projection mutated queue; before=' + beforeQueue + '; after=' + JSON.stringify(player.queue.value)
  )

  const sourceSelectors = panel.querySelectorAll('.lyric-editor-content select')
  sourceSelectors[2].value = 'automatic'
  sourceSelectors[2].dispatchEvent(new Event('change', { bubbles: true }))
  await tick()
  expect(!button('保存歌词').disabled, 'layer source change did not mark the lyric draft dirty')
  button('保存歌词').click()
  await waitFor(
    () => window.__lyricsFixture.document.tracks[track.id]?.translationSelection === 'automatic',
    'translation source did not persist independently from manual original and romanization'
  )
  const mixedStored = window.__lyricsFixture.document.tracks[track.id]
  expect(mixedStored.source === 'auto', 'mixed source selections did not keep automatic resolver active')
  expect(mixedStored.originalSelection === 'manual', 'manual original selection was lost')
  expect(mixedStored.translationSelection === 'automatic', 'automatic translation selection was lost')
  expect(mixedStored.romanizationSelection === 'manual', 'manual romanization selection was lost')

  const playbackTrack = {
    ...track,
    id: 'fixture-provider:playback-clock',
    title: 'Playback clock',
    lyrics: '[00:00.00]Start line\\n[00:01.00]Moving line\\n[00:03.00]Seek line',
    lyricsSource: 'embedded'
  }
  player.currentTrack.value = structuredClone(playbackTrack)
  player.queue.value = [structuredClone(playbackTrack)]
  player.queueIndex.value = 0
  player.currentTime.value = 0
  player.duration.value = 180
  player.isPlaying.value = true
  await tick()
  player.isLoading.value = true
  window.__audioFixture.emitProperty('time-pos', 0.25)
  const stalledNextSamples = window.setInterval(
    () => window.__audioFixture.emitProperty('time-pos', 0.25),
    100
  )
  await new Promise((resolve) => setTimeout(resolve, 1400))
  window.clearInterval(stalledNextSamples)
  await tick()
  expect(player.currentTime.value > 1, 'stalled engine samples froze the component playback clock')
  expect(!document.querySelector('.time-chip')?.textContent.includes('0:00'), 'lyrics time chip did not advance')
  const activeAfterStall = document.querySelector('.lyric-row.active')?.textContent ?? ''
  expect(
    activeAfterStall.includes('Moving line'),
    'active lyric did not advance; currentTime=' + player.currentTime.value + '; active=' + activeAfterStall
  )

  const seekLine = [...document.querySelectorAll('.lyric-row')].find((item) => item.textContent.includes('Seek line'))
  expect(seekLine, 'timed seek lyric was not rendered')
  seekLine.click()
  window.__audioFixture.emitProperty('time-pos', 3)
  const stalledSeekSamples = window.setInterval(
    () => window.__audioFixture.emitProperty('time-pos', 3),
    100
  )
  await new Promise((resolve) => setTimeout(resolve, 900))
  window.clearInterval(stalledSeekSamples)
  await tick()
  expect(player.currentTime.value > 3.4, 'lyric seek froze after repeated confirmation samples')
  expect(document.querySelector('.lyric-row.active')?.textContent.includes('Seek line'), 'clicked lyric did not stay active while time advanced')
  player.isLoading.value = false

  button('1 行').click()
  await waitFor(
    () => window.__settingsFixture.settings.lyricsAppearance?.focusLineCount === 1,
    'single-line lyric focus did not persist before the handoff regression probe'
  )
  const rapidLyricsTrack = {
    ...playbackTrack,
    id: 'fixture-provider:rapid-lyrics',
    title: 'Rapid lyrics',
    lyrics: '[00:20.00]Start line\\n[00:20.10]Brief line\\n[00:20.42]Following line'
  }
  player.currentTrack.value = structuredClone(rapidLyricsTrack)
  player.queue.value = [structuredClone(rapidLyricsTrack)]
  player.currentTime.value = 20
  player.isPlaying.value = true
  await tick()
  const observedActiveLines = new Set()
  let maxRenderedLyricRows = 0
  const activeLineProbe = window.setInterval(() => {
    observedActiveLines.add(document.querySelector('.lyric-row.active')?.textContent ?? '')
    maxRenderedLyricRows = Math.max(
      maxRenderedLyricRows,
      document.querySelectorAll('.lyric-row').length
    )
  }, 8)
  await new Promise((resolve) => setTimeout(resolve, 300))
  window.clearInterval(activeLineProbe)
  expect(
    [...observedActiveLines].some((line) => line.includes('Brief line')),
    'rapid plain LRC line never became active between playback time samples; currentTime=' +
      player.currentTime.value +
      '; isPlaying=' +
      player.isPlaying.value +
      '; observed=' +
      [...observedActiveLines].join(' | ')
  )
  expect(
    maxRenderedLyricRows === 1,
    'completed lyric was reinserted above the single-line focus window during handoff; maxRows=' +
      maxRenderedLyricRows
  )
  console.log('PLAYING_MUSIC_LYRICS_RUNTIME_OK')
}
`
}

function runtimeHtml(bundleName: string): string {
  return `<!doctype html><html><body><div id="app"></div>
<script>
window.process = { env: {} }
window.__lyricsFixture = {
  revision: 1,
  rejectNextSave: false,
  importResult: null,
  importCalls: 0,
  saveResult: null,
  saveCalls: 0,
  lastSavedContents: null,
  document: {
    schemaVersion: 1, globalOffsetMs: 0,
    showOriginal: true, showTranslation: true, showRomanization: false,
    tracks: {}
  }
}
const clone = (value) => JSON.parse(JSON.stringify(value))
const envelope = () => ({ version: 2, revision: window.__lyricsFixture.revision, savedAt: '2026-07-18T00:00:00.000Z', data: clone(window.__lyricsFixture.document) })
window.__settingsFixture = { settings: {}, patches: [] }
const settingsSnapshot = () => ({
  settings: clone(window.__settingsFixture.settings),
  defaults: { cachePath: '' },
  paths: { settingsFile: '', userDataPath: '', activeCachePath: '' },
  appVersion: 'test',
  platform: 'win32',
  restartRequired: false,
  restartReasons: []
})
window.__audioFixture = {
  propertyCallbacks: [],
  playbackInfoCallbacks: [],
  playbackInfo: { state: 'stopped', position: 0, duration: 0, source: '', queueIndex: -1, nativePlaybackActive: false },
  emitProperty(name, data) {
    for (const cb of this.propertyCallbacks) cb({ name, data })
  },
  emitPlaybackInfo(info) {
    this.playbackInfo = info
    for (const cb of this.playbackInfoCallbacks) cb(info)
  }
}
const subscribe = (list, cb) => {
  list.push(cb)
  return () => {
    const index = list.indexOf(cb)
    if (index >= 0) list.splice(index, 1)
  }
}
const noopSubscribe = () => () => {}
window.api = {
  settings: {
    get: async () => settingsSnapshot(),
    update: async (patch) => {
      window.__settingsFixture.patches.push(clone(patch))
      window.__settingsFixture.settings = {
        ...window.__settingsFixture.settings,
        ...patch,
        lyricsAppearance: {
          ...window.__settingsFixture.settings.lyricsAppearance,
          ...patch.lyricsAppearance
        }
      }
      return settingsSnapshot()
    },
    onChanged: () => () => {}
  },
  audioEngine: {
    onPropertyChange: (cb) => subscribe(window.__audioFixture.propertyCallbacks, cb),
    onPlaybackInfo: (cb) => subscribe(window.__audioFixture.playbackInfoCallbacks, cb),
    onEndFile: noopSubscribe,
    onStartFile: noopSubscribe,
    onReady: noopSubscribe,
    onError: noopSubscribe,
    onDisconnected: noopSubscribe,
    getPlaybackInfo: async () => window.__audioFixture.playbackInfo,
    getAudioOutputState: async () => { throw new Error('fixture output unavailable') },
    getAudioProcessing: async () => { throw new Error('fixture processing unavailable') },
    seek: async (position) => { window.__audioFixture.seekPosition = position }
  },
  data: {
    loadLyricsManagement: async () => envelope(),
    saveLyricsManagement: async (next, expectedRevision) => {
      const fixture = window.__lyricsFixture
      if (fixture.rejectNextSave) {
        fixture.rejectNextSave = false
        fixture.revision += 1
        const error = new Error('fixture CAS conflict')
        error.code = 'ERR_PERSISTENCE_REVISION_CONFLICT'
        error.expectedRevision = expectedRevision
        error.current = envelope()
        throw error
      }
      if (expectedRevision !== fixture.revision) throw new Error('unexpected lyrics revision')
      fixture.document = clone(next)
      fixture.revision += 1
      return envelope()
    },
    importLyrics: async () => {
      window.__lyricsFixture.importCalls += 1
      return window.__lyricsFixture.importResult
    },
    saveLyrics: async (contents) => {
      window.__lyricsFixture.saveCalls += 1
      window.__lyricsFixture.lastSavedContents = contents
      return window.__lyricsFixture.saveResult
    },
    getLyrics: async () => null,
    searchOnlineLyrics: async () => ({ candidates: [] })
  },
  providers: { list: async () => [], call: async () => null }
}
</script><script src="bundle/${bundleName}"></script></body></html>`
}

function electronRunnerSource(): string {
  return `const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const target = process.argv.at(-1)
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, nodeIntegration: false } })
  window.webContents.on('console-message', (_event, _level, message, line, sourceId) => console.error('RENDERER', sourceId + ':' + line, message))
  try {
    await window.loadFile(path.resolve(target))
    await window.webContents.executeJavaScript('window.runPlayingMusicLyricsRuntime()')
    app.exit(0)
  } catch (error) {
    console.error('PLAYING_MUSIC_LYRICS_RUNTIME_FAILED', error && error.stack ? error.stack : error)
    app.exit(1)
  }
})`
}
