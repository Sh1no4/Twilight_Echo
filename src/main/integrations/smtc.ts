import { nativeImage, type ThumbarButton } from 'electron'
import { join } from 'path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { runtime } from '../core/runtime'

// Windows taskbar-thumbnail toolbar (thumbnail hover / taskbar preview). The
// buttons mirror media-key hardware buttons and use the app's existing
// `player:shortcut` dispatch so the rendered player store stays the single
// source of truth.

function getThumbarIconPath(name: string): string {
  if (process.platform === 'win32') {
    return is.dev
      ? join(app.getAppPath(), 'build', 'smtc', `${name}.ico`)
      : join(process.resourcesPath, 'smtc', `${name}.ico`)
  }
  return ''
}

let lastSignature = ''

function buildThumbarButtons(): ThumbarButton[] {
  const state = runtime.latestMiniPlayerState
  const hasTrack = state?.track != null
  const isPlaying = state?.isPlaying === true
  return [
    {
      tooltip: '上一首',
      icon: nativeImage.createFromPath(getThumbarIconPath('previous')),
      flags: hasTrack ? ['enabled'] : ['disabled'],
      click: () => {
        runtime.mainWindow?.webContents.send('player:shortcut', 'previous')
      }
    },
    {
      tooltip: isPlaying ? '暂停' : '播放',
      icon: nativeImage.createFromPath(getThumbarIconPath(isPlaying ? 'pause' : 'play')),
      flags: hasTrack ? ['enabled'] : ['disabled'],
      click: () => {
        runtime.mainWindow?.webContents.send('player:shortcut', 'playPause')
      }
    },
    {
      tooltip: '下一首',
      icon: nativeImage.createFromPath(getThumbarIconPath('next')),
      flags: hasTrack ? ['enabled'] : ['disabled'],
      click: () => {
        runtime.mainWindow?.webContents.send('player:shortcut', 'next')
      }
    }
  ]
}

export function refreshSmtcButtons(force = false): void {
  if (process.platform !== 'win32') return
  const win = runtime.mainWindow
  if (!win || win.isDestroyed()) return
  const state = runtime.latestMiniPlayerState
  const signature = `${state?.track?.id ?? null}:${state?.isPlaying === true}`
  if (!force && signature === lastSignature) return
  lastSignature = signature
  win.setThumbarButtons(buildThumbarButtons())
}

export function createSmtcButtons(): void {
  if (process.platform !== 'win32') return
  runtime.refreshSmtcButtons = refreshSmtcButtons
  refreshSmtcButtons(true)
}

export function destroySmtcButtons(): void {
  runtime.refreshSmtcButtons = null
}
