import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import typescript from 'typescript'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)

test('offline download UI keeps unknown progress indeterminate and announces every action failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twilight-offline-ui-'))
  try {
    const panel = await compileComponent('OfflineDownloadsPanel.vue', 'OfflineDownloadsPanel')
    const pinButton = await compileComponent('OfflinePinButton.vue', 'OfflinePinButton')
    const vueRuntime = await readFile(require.resolve('vue/dist/vue.global.prod.js'), 'utf8')
    const htmlPath = join(directory, 'offline-downloads.html')
    const runnerPath = join(directory, 'offline-downloads-runner.cjs')
    await writeFile(htmlPath, createFixture(vueRuntime, panel, pinButton), 'utf8')
    await writeFile(runnerPath, electronRunnerSource(), 'utf8')

    const electronPath = require('electron') as string
    const { stderr } = await execFileAsync(electronPath, ['--no-sandbox', runnerPath, htmlPath], {
      timeout: 30_000,
      windowsHide: true
    })
    assert.match(stderr, /OFFLINE_DOWNLOAD_UI_OK/)
    assert.doesNotMatch(stderr, /OFFLINE_DOWNLOAD_UI_FAILED/)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

async function compileComponent(fileName: string, globalName: string): Promise<string> {
  const source = await readFile(new URL(`./${fileName}`, import.meta.url), 'utf8')
  const parsed = parse(source, { filename: fileName })
  assert.equal(
    parsed.errors.length,
    0,
    `SFC parse errors in ${fileName}: ${parsed.errors.join(', ')}`
  )
  let compiled = compileScript(parsed.descriptor, {
    id: `twilight-${globalName}`,
    inlineTemplate: true
  }).content
  compiled = compiled.replace(
    /import\s+\{([^}]*)\}\s+from\s+['"]vue['"]\s*/g,
    (_match, bindings: string) => {
      const destructured = bindings.replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2')
      return `const {${destructured}} = Vue\n`
    }
  )
  compiled = compiled.replace(/import\s+type\s+[\s\S]*?\s+from\s+['"][^'"]+['"]\s*/g, '')
  compiled = compiled.replace(
    /import\s+\{\s*useOfflineDownloads\s*\}\s+from\s+['"][^'"]+['"]\s*/,
    'const useOfflineDownloads = window.__useOfflineDownloads\n'
  )
  compiled = compiled.replace(
    /import\s+\{\s*getTrackProviderId\s*\}\s+from\s+['"][^'"]+['"]\s*/,
    'const getTrackProviderId = window.__getTrackProviderId\n'
  )
  assert.doesNotMatch(compiled, /^import\s/m, `${fileName} fixture must run without imports`)
  compiled = compiled.replace('export default', `window.${globalName} =`)
  return typescript.transpileModule(compiled, {
    compilerOptions: { target: typescript.ScriptTarget.ES2022 }
  }).outputText
}

function createFixture(vueRuntime: string, panel: string, pinButton: string): string {
  return `<!doctype html>
<html><body>
  <script>window.addEventListener('error', (event) => console.error('FIXTURE_ERROR', event.message, event.error && event.error.stack))</script>
  <div id="app"></div>
  <script>${vueRuntime}</script>
  <script>
    const records = Vue.ref([{
      id: 'download-1', providerId: 'demo', trackId: 'demo:one', title: 'One', quality: 'lossless',
      pinned: true, status: 'downloading', bytesDownloaded: 4096, totalBytes: null,
      sha256: null, fileName: null, downloadedAt: null, expiresAt: null, error: null,
      retryCount: 0, updatedAt: '2026-07-18T00:00:00.000Z'
    }])
    const store = {
      records,
      pinnedBytes: Vue.ref(0),
      availableBytes: Vue.ref(1024 * 1024),
      error: Vue.ref(''),
      loading: Vue.ref(false),
      completedCount: Vue.computed(() => 0),
      refresh: async () => {},
      pinTrack: async () => { throw new Error('single pin failed visibly') },
      pinTracks: async () => { throw new Error('playlist pin failed visibly') },
      retry: async () => { throw new Error('retry failed visibly') },
      cancel: async () => { throw new Error('cancel failed visibly') },
      unpin: async () => { throw new Error('unpin failed visibly') }
    }
    window.__offlineRecords = records
    window.__useOfflineDownloads = () => store
    window.__getTrackProviderId = (track) => track.source && track.source !== 'local' ? track.source : null
  </script>
  <script>(() => { ${panel} })()</script>
  <script>(() => { ${pinButton} })()</script>
  <script>
    const track = {
      id: 'demo:one', title: 'One', artist: 'Artist', album: 'Album', filePath: 'demo:one',
      fileName: 'one.mp3', duration: 60, size: 1, cover: null, lyrics: null, source: 'demo'
    }
    Vue.createApp({
      components: { OfflineDownloadsPanel: window.OfflineDownloadsPanel, OfflinePinButton: window.OfflinePinButton },
      setup: () => ({ tracks: [track], track }),
      template: '<OfflineDownloadsPanel :tracks="tracks" /><OfflinePinButton :track="track" />'
    }).mount('#app')
    const tick = () => Vue.nextTick().then(() => new Promise((resolve) => setTimeout(resolve, 0))).then(() => Vue.nextTick())
    const replaceRecord = async (status, error = null) => {
      window.__offlineRecords.value = [{ ...window.__offlineRecords.value[0], status, error, totalBytes: status === 'downloading' ? null : 4096 }]
      await tick()
    }
    const expectActionAlert = (message) => {
      const alerts = [...document.querySelectorAll('[role="alert"][aria-live="assertive"]')]
      if (!alerts.some((element) => element.textContent.includes(message))) throw new Error('missing announced action error: ' + message)
    }
    window.runOfflineDownloadUi = async () => {
      document.querySelector('button[title^="固定当前在线歌曲"]').click()
      await tick()
      expectActionAlert('playlist pin failed visibly')

      document.querySelector('.offline-toggle').click()
      await tick()
      const progress = document.querySelector('progress')
      if (!progress) throw new Error('download progress did not render')
      if (progress.hasAttribute('value') || progress.hasAttribute('max')) throw new Error('unknown-length progress was rendered as determinate')
      if (!progress.getAttribute('aria-label').includes('总大小未知')) throw new Error('unknown total was not announced')
      if (!document.body.textContent.includes('总大小未知')) throw new Error('unknown total was not visible')

      document.querySelector('button[title="取消下载"]').click()
      await tick()
      expectActionAlert('cancel failed visibly')

      await replaceRecord('completed')
      document.querySelector('button[title="取消固定并删除离线文件"]').click()
      await tick()
      expectActionAlert('unpin failed visibly')

      await replaceRecord('failed', 'background download failed visibly')
      expectActionAlert('background download failed visibly')
      document.querySelector('button[title="使用新的在线地址重试下载"]').click()
      await tick()
      expectActionAlert('retry failed visibly')

      document.querySelector('.offline-pin-btn').click()
      await tick()
      expectActionAlert('single pin failed visibly')
      console.log('OFFLINE_DOWNLOAD_UI_OK')
    }
  </script>
</body></html>`
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
    await window.webContents.executeJavaScript('window.runOfflineDownloadUi()')
    app.exit(0)
  } catch (error) {
    console.error('OFFLINE_DOWNLOAD_UI_FAILED', error && error.stack ? error.stack : error)
    app.exit(1)
  }
})`
}
