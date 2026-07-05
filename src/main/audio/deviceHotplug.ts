import type { BrowserWindow } from 'electron'
import { existsSync, watch, type FSWatcher } from 'fs'
import { runtime } from '../core/runtime'

const WM_DEVICECHANGE = 0x0219
const ALSA_DEVICE_DIR = '/dev/snd'
const AUDIO_DEVICE_CHANGE_DEBOUNCE_MS = 250
const ALSA_DEVICE_WATCH_RETRY_MS = 5000
const hookedWindows = new WeakSet<BrowserWindow>()
const pendingTimers = new WeakMap<BrowserWindow, NodeJS.Timeout>()
let alsaDeviceWatcher: FSWatcher | null = null
let alsaDeviceRefreshTimer: NodeJS.Timeout | null = null
let alsaWatchRetryTimer: NodeJS.Timeout | null = null

export function installAudioDeviceHotplugWatcher(win: BrowserWindow): void {
  if (process.platform === 'linux') {
    installAlsaDeviceHotplugWatcher()
    return
  }
  if (process.platform !== 'win32') return
  if (hookedWindows.has(win)) return
  if (typeof win.hookWindowMessage !== 'function') return

  hookedWindows.add(win)
  win.hookWindowMessage(WM_DEVICECHANGE, () => {
    scheduleAudioDeviceRefresh(win)
  })
  win.once('closed', () => {
    const timer = pendingTimers.get(win)
    if (timer) clearTimeout(timer)
    pendingTimers.delete(win)
  })
}

function scheduleAudioDeviceRefresh(win: BrowserWindow): void {
  const existing = pendingTimers.get(win)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    pendingTimers.delete(win)
    if (win.isDestroyed()) return
    runtime.audioEngineManager?.notifyAudioDeviceOptionsChanged(
      'platform-device-change:wm-devicechange'
    )
  }, AUDIO_DEVICE_CHANGE_DEBOUNCE_MS)
  pendingTimers.set(win, timer)
}

function installAlsaDeviceHotplugWatcher(): void {
  if (alsaDeviceWatcher || alsaWatchRetryTimer) return
  if (!existsSync(ALSA_DEVICE_DIR)) {
    scheduleAlsaDeviceWatchRetry()
    return
  }

  try {
    const watcher = watch(ALSA_DEVICE_DIR, { persistent: false }, () => {
      scheduleAlsaDeviceRefresh()
    })
    alsaDeviceWatcher = watcher
    watcher.on('error', (err) => {
      if (alsaDeviceWatcher !== watcher) return
      alsaDeviceWatcher = null
      console.warn('ALSA 设备热插拔监听失败，稍后重试：', err)
      scheduleAlsaDeviceWatchRetry()
    })
    watcher.on('close', () => {
      if (alsaDeviceWatcher !== watcher) return
      alsaDeviceWatcher = null
      scheduleAlsaDeviceWatchRetry()
    })
  } catch (err) {
    console.warn('无法监听 ALSA 设备热插拔，稍后重试：', err)
    scheduleAlsaDeviceWatchRetry()
  }
}

function scheduleAlsaDeviceWatchRetry(): void {
  if (alsaWatchRetryTimer) return
  alsaWatchRetryTimer = setTimeout(() => {
    alsaWatchRetryTimer = null
    installAlsaDeviceHotplugWatcher()
  }, ALSA_DEVICE_WATCH_RETRY_MS)
  alsaWatchRetryTimer.unref?.()
}

function scheduleAlsaDeviceRefresh(): void {
  if (alsaDeviceRefreshTimer) clearTimeout(alsaDeviceRefreshTimer)

  alsaDeviceRefreshTimer = setTimeout(() => {
    alsaDeviceRefreshTimer = null
    runtime.audioEngineManager?.notifyAudioDeviceOptionsChanged(
      'platform-device-change:alsa-dev-snd'
    )
  }, AUDIO_DEVICE_CHANGE_DEBOUNCE_MS)
}
