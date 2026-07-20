import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import { build } from 'vite'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const workspaceRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)))

test('actual renderer player store restores Auto precedence and keeps manual lyrics out of playback state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twilight-lyrics-player-runtime-'))
  try {
    const entryPath = join(directory, 'lyrics-player-runtime-entry.ts')
    const bundleDirectory = join(directory, 'bundle')
    const htmlPath = join(directory, 'lyrics-player-runtime.html')
    const runnerPath = join(directory, 'lyrics-player-runtime-runner.cjs')
    await writeFile(entryPath, runtimeEntrySource(), 'utf8')

    await build({
      configFile: false,
      logLevel: 'error',
      root: workspaceRoot,
      resolve: { alias: { '@renderer': join(workspaceRoot, 'src/renderer/src') } },
      build: {
        outDir: bundleDirectory,
        emptyOutDir: true,
        minify: false,
        lib: {
          entry: entryPath,
          name: 'LyricsPlayerRuntime',
          formats: ['iife'],
          fileName: 'runtime'
        }
      }
    })
    const bundleName = (await readdir(bundleDirectory)).find((name) => name.endsWith('.iife.js'))
    assert.ok(bundleName, 'Vite should bundle the real renderer player store')
    await writeFile(htmlPath, runtimeHtml(bundleName), 'utf8')
    await writeFile(runnerPath, electronRunnerSource(), 'utf8')

    const electronPath = require('electron') as string
    const { stderr } = await execFileAsync(electronPath, ['--no-sandbox', runnerPath, htmlPath], {
      timeout: 45_000,
      windowsHide: true
    })
    assert.match(stderr, /LYRICS_PLAYER_RUNTIME_OK/)
    assert.doesNotMatch(stderr, /LYRICS_PLAYER_RUNTIME_FAILED/)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

function runtimeEntrySource(): string {
  const playerStorePath = join(
    workspaceRoot,
    'src/renderer/src/stores/usePlayerStore.ts'
  ).replaceAll('\\', '/')
  const lyricsStorePath = join(
    workspaceRoot,
    'src/renderer/src/stores/lyricsManagement.ts'
  ).replaceAll('\\', '/')
  return `import { usePlayerStore } from ${JSON.stringify(playerStorePath)}
import { useLyricsManagement } from ${JSON.stringify(lyricsStorePath)}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

const clone = (value) => JSON.parse(JSON.stringify(value))
let document = {
  schemaVersion: 1,
  globalOffsetMs: 0,
  showOriginal: true,
  showTranslation: true,
  showRomanization: false,
  tracks: {}
}
let revision = 1
let deferProvider = false
let resolveDeferredProvider
let markDeferredProviderStarted
const deferredProviderStarted = new Promise((resolve) => {
  markDeferredProviderStarted = resolve
})

window.api = {
  data: {
    getLyrics: async () => null,
    loadLyricsManagement: async () => ({ version: 2, revision, savedAt: '2026-07-18T00:00:00.000Z', data: clone(document) }),
    saveLyricsManagement: async (next, expectedRevision) => {
      expect(expectedRevision === revision, 'lyrics management CAS revision should be current')
      document = clone(next)
      revision += 1
      return { version: 2, revision, savedAt: '2026-07-18T00:00:01.000Z', data: clone(document) }
    }
  },
  providers: {
    list: async () => [{ id: 'fixture-provider', name: 'Fixture provider', capabilities: ['lyrics'], health: { available: true } }],
    call: async (_providerId, method) => {
      expect(method === 'getLyrics', 'forced resolver should request provider lyrics')
      if (deferProvider) {
        markDeferredProviderStarted()
        return await new Promise((resolve) => {
          resolveDeferredProvider = () =>
            resolve({
              lyrics: '[00:01.00]Stale provider lyrics',
              translatedLyrics: '[00:01.00]Stale provider translation'
            })
        })
      }
      return { lyrics: '[00:01.00]Provider lyrics', translatedLyrics: '[00:01.00]Provider translation' }
    }
  }
}

const track = {
  id: 'fixture-provider:track-1',
  title: 'Provider fixture', artist: 'Twilight', album: 'Echo', filePath: '', fileName: '',
  duration: 180, size: 0, cover: null,
  lyrics: '[00:01.00]Automatic lyrics', translatedLyrics: '[00:01.00]Automatic translation',
  lyricsSource: 'embedded', translatedLyricsSource: 'embedded', source: 'fixture-provider'
}

window.runLyricsPlayerRuntime = async () => {
  const player = usePlayerStore()
  const management = useLyricsManagement()
  player.currentTrack.value = clone(track)
  player.queue.value = [clone(track)]
  await management.ensureLoaded()
  await management.selectSource(track.id, 'provider')
  await player.refreshCurrentLyrics()
  expect(player.currentTrack.value.lyrics === '[00:01.00]Provider lyrics', 'forced Provider did not update actual current track')

  await management.selectSource(track.id, 'auto')
  await player.refreshCurrentLyrics()
  expect(player.currentTrack.value.lyrics === '[00:01.00]Automatic lyrics', 'Auto did not restore resolver baseline: ' + player.currentTrack.value.lyrics)
  expect(player.currentTrack.value.translatedLyrics === '[00:01.00]Automatic translation', 'Auto did not restore translated baseline: ' + player.currentTrack.value.translatedLyrics)

  deferProvider = true
  await management.selectSource(track.id, 'provider')
  const staleProviderRefresh = player.refreshCurrentLyrics()
  await deferredProviderStarted
  await management.selectSource(track.id, 'auto')
  await player.refreshCurrentLyrics()
  expect(player.currentTrack.value.lyrics === '[00:01.00]Automatic lyrics', 'Auto did not win while a forced Provider lookup was pending')
  resolveDeferredProvider()
  await staleProviderRefresh
  expect(player.currentTrack.value.lyrics === '[00:01.00]Automatic lyrics', 'stale Provider result overwrote the newer Auto selection')

  const beforeCurrent = clone(player.currentTrack.value)
  const beforeQueue = clone(player.queue.value)
  await management.updateTrack(track.id, { source: 'manual', original: '[00:03.00]Manual original', romanization: '[00:03.00]Manual romanization' })
  await player.refreshCurrentLyrics()
  expect(JSON.stringify(player.currentTrack.value) === JSON.stringify(beforeCurrent), 'manual original mutated current track')
  expect(JSON.stringify(player.queue.value) === JSON.stringify(beforeQueue), 'manual romanization mutated queue')
  expect(management.entryFor(track.id).romanization === '[00:03.00]Manual romanization', 'manual romanization was not persisted')
  console.log('LYRICS_PLAYER_RUNTIME_OK')
}
`
}

function runtimeHtml(bundleName: string): string {
  return `<!doctype html><html><body><script>window.process = { env: {} }</script><script src="bundle/${bundleName}"></script></body></html>`
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
    await window.webContents.executeJavaScript('window.runLyricsPlayerRuntime()')
    app.exit(0)
  } catch (error) {
    console.error('LYRICS_PLAYER_RUNTIME_FAILED', error && error.stack ? error.stack : error)
    app.exit(1)
  }
})`
}
