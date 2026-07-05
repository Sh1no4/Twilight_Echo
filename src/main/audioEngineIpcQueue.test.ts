import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

const source = readFileSync(new URL('./audio/engineIpc.ts', import.meta.url), 'utf8')
const deviceHotplugSource = readFileSync(new URL('./audio/deviceHotplug.ts', import.meta.url), 'utf8')
const windowSource = readFileSync(new URL('./app/window.ts', import.meta.url), 'utf8')

test('audioEngine loadQueue IPC accepts renderer queue items with source field', () => {
  const start = source.indexOf('function toQueueItem')
  const end = source.indexOf("ipcMain.handle('audioEngine:loadQueue'", start)
  assert.notEqual(start, -1, 'toQueueItem should exist')
  assert.notEqual(end, -1, 'audioEngine:loadQueue handler should exist')
  const toQueueItem = source.slice(start, end)

  assert.match(toQueueItem, /typeof item\.source === 'string'/)
  assert.match(toQueueItem, /source,\s*\n\s*title:/)
  assert.equal(
    /typeof item\.filePath === 'string'[\s\S]*typeof item\.source === 'string'/.test(toQueueItem),
    false,
    'source must be checked before filePath because renderer queue items no longer include filePath'
  )
})

test('main window installs Windows audio device hotplug watcher', () => {
  assert.match(deviceHotplugSource, /const WM_DEVICECHANGE = 0x0219/)
  assert.match(deviceHotplugSource, /process\.platform !== 'win32'/)
  assert.match(deviceHotplugSource, /win\.hookWindowMessage\(WM_DEVICECHANGE/)
  assert.match(deviceHotplugSource, /AUDIO_DEVICE_CHANGE_DEBOUNCE_MS = 250/)
  assert.match(
    deviceHotplugSource,
    /notifyAudioDeviceOptionsChanged\(\s*'platform-device-change:wm-devicechange'\s*\)/
  )
  assert.match(windowSource, /installAudioDeviceHotplugWatcher\(runtime\.mainWindow\)/)
})

test('audio hotplug watcher listens for ALSA hw device node changes on Linux', () => {
  assert.match(deviceHotplugSource, /const ALSA_DEVICE_DIR = '\/dev\/snd'/)
  assert.match(deviceHotplugSource, /const ALSA_DEVICE_WATCH_RETRY_MS = 5000/)
  assert.match(deviceHotplugSource, /process\.platform === 'linux'/)
  assert.match(deviceHotplugSource, /installAlsaDeviceHotplugWatcher\(\)/)
  assert.match(deviceHotplugSource, /watch\(ALSA_DEVICE_DIR, \{ persistent: false \}/)
  assert.match(deviceHotplugSource, /scheduleAlsaDeviceWatchRetry\(\)/)
  assert.match(deviceHotplugSource, /watcher\.on\('error'/)
  assert.match(deviceHotplugSource, /watcher\.on\('close'/)
  assert.match(deviceHotplugSource, /alsaWatchRetryTimer\.unref\?\.\(\)/)
  assert.match(
    deviceHotplugSource,
    /notifyAudioDeviceOptionsChanged\(\s*'platform-device-change:alsa-dev-snd'\s*\)/
  )
})
