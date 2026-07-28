import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const traySource = readFileSync(new URL('./shortcutsTray.ts', import.meta.url), 'utf8')
const trayPlayerSource = readFileSync(new URL('./trayPlayer.ts', import.meta.url), 'utf8')
const preloadSource = readFileSync(new URL('../../preload/index.ts', import.meta.url), 'utf8')
const rendererSource = readFileSync(
  new URL('../../renderer/src/tray-player/TrayPlayerApp.vue', import.meta.url),
  'utf8'
)
const appSource = readFileSync(new URL('../../renderer/src/App.vue', import.meta.url), 'utf8')

test('system tray exposes transport, popup, and direct home navigation actions', () => {
  assert.match(traySource, /label: '播放控制'/)
  assert.match(traySource, /label: '打开本地主页'/)
  assert.match(traySource, /openMainWindowAt\('local'\)/)
  assert.match(traySource, /label: '打开流媒体页'/)
  assert.match(traySource, /openMainWindowAt\('streaming'\)/)
  assert.match(traySource, /runtime\.tray\.on\('click',[\s\S]*toggleTrayPlayerWindow\(\)/)
  assert.match(traySource, /export function syncTrayState\(\): void \{[\s\S]*createTray\(\)/)
})

test('tray player window is isolated and forwards validated commands to the playback host', () => {
  assert.match(trayPlayerSource, /sandbox: true/)
  assert.match(trayPlayerSource, /contextIsolation: true/)
  assert.match(trayPlayerSource, /nodeIntegration: false/)
  assert.match(trayPlayerSource, /normalizeMiniPlayerCommand\(rawCommand\)/)
  assert.match(trayPlayerSource, /normalizeTrayNavigationTarget\(rawTarget\)/)
  assert.match(trayPlayerSource, /mainWindow\.webContents\.send\('miniPlayer:command', command\)/)
  assert.match(
    preloadSource,
    /if \(isTrayPlayerDocument\(\)\) return \{ trayPlayer: trayPlayerWindowApi \}/
  )
})

test('tray popup provides seek and transport controls backed by the shared playback snapshot', () => {
  assert.match(rendererSource, /type="range"/)
  assert.match(rendererSource, /aria-label="拖动播放进度"/)
  assert.match(rendererSource, /sendCommand\(\{ type: 'seek', value \}\)/)
  assert.match(rendererSource, /sendCommand\(\{ type: 'previous' \}\)/)
  assert.match(rendererSource, /sendCommand\(\{ type: 'next' \}\)/)
  assert.match(rendererSource, /sendCommand\(\{ type: 'toggle-play' \}\)/)
  assert.match(rendererSource, /navigate\('local'\)/)
  assert.match(rendererSource, /navigate\('streaming'\)/)
})

test('main window consumes pending tray navigation after renderer startup', () => {
  assert.match(trayPlayerSource, /runtime\.pendingTrayNavigation = target/)
  assert.match(trayPlayerSource, /export function consumePendingTrayNavigation/)
  assert.match(appSource, /window\.api\.app\.consumePendingNavigation\(\)/)
  assert.match(appSource, /if \(pendingNavigation\) applyExternalNavigation\(pendingNavigation\)/)
  assert.match(appSource, /onSelectView\('dashboard', null\)/)
  assert.match(appSource, /enterStreamingMode\(\)/)
})
