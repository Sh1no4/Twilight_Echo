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

test('actual PlayingMusic UI manages a provider track without lyrics and surfaces persistence and dialog results', async () => {
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
    assert.ok(bundleName, 'Vite should bundle the real PlayingMusic component')
    await writeFile(htmlPath, runtimeHtml(bundleName), 'utf8')
    await writeFile(runnerPath, electronRunnerSource(), 'utf8')

    const electronPath = require('electron') as string
    const { stderr } = await execFileAsync(electronPath, ['--no-sandbox', runnerPath, htmlPath], {
      timeout: 45_000,
      windowsHide: true
    })
    assert.match(stderr, /PLAYING_MUSIC_LYRICS_RUNTIME_OK/)
    assert.doesNotMatch(stderr, /PLAYING_MUSIC_LYRICS_RUNTIME_FAILED/)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

function runtimeEntrySource(): string {
  const componentPath = join(
    workspaceRoot,
    'src/renderer/src/components/PlayingMusic.vue'
  ).replaceAll('\\', '/')
  const playerStorePath = join(
    workspaceRoot,
    'src/renderer/src/stores/usePlayerStore.ts'
  ).replaceAll('\\', '/')
  return `import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import PlayingMusic from ${JSON.stringify(componentPath)}
import { usePlayerStore } from ${JSON.stringify(playerStorePath)}

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
  const importControl = [...document.querySelectorAll('.lyric-manager--dialog button')].find((item) => item.textContent.includes('Import'))
  const originalEditor = document.querySelector('.lyric-manager--dialog textarea')
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
  const track = {
    id: 'fixture-provider:no-lyrics', title: 'No lyrics yet', artist: 'Twilight', album: 'Echo',
    filePath: '', fileName: '', duration: 180, size: 0, cover: null,
    lyrics: '', translatedLyrics: null, romanizedLyrics: null,
    lyricsSource: null, translatedLyricsSource: null, romanizedLyricsSource: null,
    source: 'fixture-provider'
  }
  player.currentTrack.value = structuredClone(track)
  player.queue.value = [structuredClone(track)]

  createApp({ render: () => h(PlayingMusic) }).use(pinia).mount('#app')
  await tick()
  const beforeCurrent = JSON.stringify(player.currentTrack.value)
  const beforeQueue = JSON.stringify(player.queue.value)

  expect(document.querySelector('.layout--single'), 'provider track without lyrics should use the single-column layout')
  const coverEntry = document.querySelector('.lyric-manage-button--cover')
  expect(coverEntry, 'provider track without lyrics has no lyrics-management entry')
  coverEntry.click()
  await waitFor(() => document.querySelector('.lyric-manager--dialog'), 'lyrics manager did not open')

  const dialog = document.querySelector('.lyric-manager--dialog')
  const buttons = () => [...dialog.querySelectorAll('button')]
  const button = (label) => {
    const found = buttons().find((item) => item.textContent.trim() === label)
    if (!found) throw new Error('missing button ' + label + '; available: ' + buttons().map((item) => item.textContent.trim()).join(' | '))
    return found
  }
  const textareas = dialog.querySelectorAll('textarea')
  const source = dialog.querySelector('select')
  const importButton = button('Import LRC')
  const saveLrcButton = button('Save LRC')

  window.__lyricsFixture.rejectNextSave = true
  button('Original').click()
  await waitFor(
    () => document.querySelector('.lyric-manager-error')?.textContent.includes('fixture CAS conflict'),
    'CAS conflict was not surfaced in the actual manager UI'
  )
  expect(button('Original').getAttribute('aria-pressed') === 'true', 'CAS authority was not restored in the UI')

  button('Romanization').click()
  await waitFor(
    () => button('Romanization').getAttribute('aria-pressed') === 'true',
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
      buttons().some((item) => item.textContent.trim() === 'Import LRC'),
    'import cancel did not finish through the UI bridge'
  )
  expect(textareas[0].value === originalBeforeCancel, 'import cancel changed the editor')

  window.__lyricsFixture.importResult = '[00:03.00]Imported original'
  button('Import LRC').click()
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
      buttons().some((item) => item.textContent.trim() === 'Save LRC'),
    'save cancel did not finish through the UI bridge'
  )
  expect(!document.querySelector('.lyric-manager-notice'), 'save cancel reported a successful write')

  window.__lyricsFixture.saveResult = 'D:/authorized/edited.lrc'
  saveLrcButton.click()
  await waitFor(
    () =>
      document.querySelector('.lyric-manager-notice')?.textContent.includes('edited.lrc') &&
      buttons().some((item) => item.textContent.trim() === 'Save LRC'),
    'successful LRC save was not reported'
  )
  expect(window.__lyricsFixture.lastSavedContents === '[00:03.00]Imported original', 'Save LRC did not use edited original text')

  window.__lyricsFixture.saveResult = null
  saveLrcButton.click()
  await waitFor(
    () =>
      window.__lyricsFixture.saveCalls === 3 &&
      buttons().some((item) => item.textContent.trim() === 'Save LRC'),
    'second save cancel did not complete'
  )
  expect(!document.querySelector('.lyric-manager-notice'), 'save cancel retained a stale success notice')

  button('Save lyrics').click()
  await waitFor(() => !document.querySelector('.lyric-manager--dialog'), 'Save lyrics did not close after persistence')
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
window.api = {
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
    getLyrics: async () => null
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
