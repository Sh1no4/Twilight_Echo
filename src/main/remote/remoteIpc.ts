import { ipcMain } from 'electron'
import { join } from 'node:path'
import { app } from 'electron'
import { assertTrustedIpcSender } from '../security/electronSecurity.ts'
import { normalizeIpcString } from '../security/ipcValidation.ts'
import { resolveAuthorizedAudioFile } from '../security/localPaths.ts'
import { runtime } from '../core/runtime.ts'
import type { PlayerShortcutAction } from '../core/types.ts'
import {
  createEmptyRemotePlaybackSnapshot,
  type DlnaDeviceInfo,
  type PlayerRemoteCommand,
  type RemoteControlStatus,
  type RemotePlaybackSnapshot
} from '../../shared/remoteControl.ts'
import { RemoteHttpServer } from './httpServer.ts'
import {
  discoverDlnaDevices,
  dlnaPause,
  dlnaPlay,
  dlnaSeek,
  dlnaSetAvTransportUri,
  dlnaSetVolume,
  dlnaStop
} from './dlnaClient.ts'
import { buildDidlLiteMetadata } from './didl.ts'
import { updateAppSettings } from '../audio/state.ts'

let server: RemoteHttpServer | null = null
let lastDlnaDevices: DlnaDeviceInfo[] = []
let activeCastUsn: string | null = null
let syncDesiredEnabled: boolean | null = null

function getStaticRoot(): string {
  return join(app.getAppPath(), 'resources', 'remote')
}

function ensureServer(): RemoteHttpServer {
  if (!server) {
    server = new RemoteHttpServer({
      staticRoot: getStaticRoot(),
      onCommand: async (command) => {
        await dispatchRemoteCommand(command)
      }
    })
  }
  return server
}

function sendPlayerCommand(action: PlayerShortcutAction): void {
  if (runtime.mainWindow?.isDestroyed() === false) {
    runtime.mainWindow.webContents.send('player:shortcut', action)
  }
}

async function dispatchRemoteCommand(command: PlayerRemoteCommand): Promise<void> {
  // When casting, transport/volume target the renderer (local engine paused) and
  // also forward to the active DLNA renderer when possible.
  switch (command.action) {
    case 'playPause':
      sendPlayerCommand('playPause')
      if (activeCastUsn) await tryDlnaPlayPause()
      return
    case 'play':
      sendPlayerCommand('play')
      if (activeCastUsn) await tryDlnaTransport('play')
      return
    case 'pause':
      sendPlayerCommand('pause')
      if (activeCastUsn) await tryDlnaTransport('pause')
      return
    case 'previous':
      sendPlayerCommand('previous')
      return
    case 'next':
      sendPlayerCommand('next')
      return
    case 'seek':
      sendPlayerCommand({ action: 'seek', positionSeconds: command.positionSeconds })
      if (activeCastUsn) await tryDlnaSeek(command.positionSeconds)
      return
    case 'setVolume':
      sendPlayerCommand({ action: 'setVolume', volume: command.volume })
      if (activeCastUsn) await tryDlnaVolume(command.volume)
      return
    case 'jumpQueue':
      sendPlayerCommand({ action: 'jumpQueue', index: command.index })
      return
  }
}

function findActiveDevice(): DlnaDeviceInfo | null {
  if (!activeCastUsn) return null
  return lastDlnaDevices.find((d) => d.usn === activeCastUsn) ?? null
}

async function tryDlnaTransport(kind: 'play' | 'pause' | 'stop'): Promise<void> {
  const device = findActiveDevice()
  if (!device?.avTransportUrl) return
  try {
    if (kind === 'play') await dlnaPlay(device.avTransportUrl)
    else if (kind === 'pause') await dlnaPause(device.avTransportUrl)
    else await dlnaStop(device.avTransportUrl)
  } catch (error) {
    console.warn('[remote] DLNA transport failed:', error)
  }
}

async function tryDlnaPlayPause(): Promise<void> {
  // Web remote playPause is ambiguous for DLNA; prefer Play (renderer mirrors toggle).
  await tryDlnaTransport('play')
}

async function tryDlnaSeek(positionSeconds: number): Promise<void> {
  const device = findActiveDevice()
  if (!device?.avTransportUrl) return
  try {
    await dlnaSeek(device.avTransportUrl, positionSeconds)
  } catch (error) {
    console.warn('[remote] DLNA seek failed:', error)
  }
}

async function tryDlnaVolume(volume: number): Promise<void> {
  const device = findActiveDevice()
  if (!device?.renderingControlUrl) return
  try {
    await dlnaSetVolume(device.renderingControlUrl, volume)
  } catch (error) {
    console.warn('[remote] DLNA volume failed:', error)
  }
}

export async function syncRemoteControlWithSettings(): Promise<void> {
  const enabled = runtime.appSettings.remoteControlEnabled === true
  const preferredPort = runtime.appSettings.remoteControlPort ?? 0
  if (syncDesiredEnabled === enabled && server && enabled) {
    // already in desired state
    return
  }
  syncDesiredEnabled = enabled
  if (!enabled) {
    if (server) {
      await server.stop()
    }
    activeCastUsn = null
    return
  }
  const instance = ensureServer()
  if (!instance.getStatus().running) {
    await instance.start(preferredPort)
  }
}

export function getRemoteControlStatus(): RemoteControlStatus {
  if (!server) {
    return {
      enabled: runtime.appSettings.remoteControlEnabled === true,
      running: false,
      port: null,
      pin: null,
      urls: [],
      paired: false,
      clientCount: 0,
      lastError: null
    }
  }
  return server.getStatus()
}

export function setupRemoteIpc(): void {
  ensureServer()

  ipcMain.handle('remote:getStatus', async (event) => {
    assertTrustedIpcSender(event, 'remote control IPC')
    return getRemoteControlStatus()
  })

  ipcMain.handle('remote:setEnabled', async (event, enabled: unknown) => {
    assertTrustedIpcSender(event, 'remote control IPC')
    await updateAppSettings({ remoteControlEnabled: enabled === true })
    await syncRemoteControlWithSettings()
    return getRemoteControlStatus()
  })

  ipcMain.handle('remote:rotatePin', async (event) => {
    assertTrustedIpcSender(event, 'remote control IPC')
    const instance = ensureServer()
    const pin = instance.rotatePin()
    return { pin, status: getRemoteControlStatus() }
  })

  ipcMain.handle('remote:publishState', async (event, snapshot: unknown) => {
    assertTrustedIpcSender(event, 'remote control IPC')
    if (!server) return false
    if (!snapshot || typeof snapshot !== 'object') return false
    const partial = snapshot as Partial<RemotePlaybackSnapshot>
    const next = createEmptyRemotePlaybackSnapshot({
      ...server.getPlaybackSnapshot(),
      ...partial,
      castTarget: activeCastUsn
        ? (findActiveDevice()?.friendlyName ?? activeCastUsn)
        : (partial.castTarget ?? null),
      updatedAt: Date.now()
    })
    server.updatePlaybackSnapshot(next)
    return true
  })

  ipcMain.handle('remote:discoverDlna', async (event) => {
    assertTrustedIpcSender(event, 'remote control IPC')
    lastDlnaDevices = await discoverDlnaDevices({ timeoutMs: 2500 })
    return lastDlnaDevices
  })

  ipcMain.handle('remote:getDlnaDevices', async (event) => {
    assertTrustedIpcSender(event, 'remote control IPC')
    return lastDlnaDevices
  })

  ipcMain.handle(
    'remote:castToDevice',
    async (
      event,
      payload: {
        usn?: unknown
        filePath?: unknown
        title?: unknown
        artist?: unknown
        album?: unknown
        positionSeconds?: unknown
      }
    ) => {
      assertTrustedIpcSender(event, 'remote control IPC')
      const usn = normalizeIpcString(payload?.usn, 'DLNA device usn', 512)
      const filePath = normalizeIpcString(payload?.filePath, 'media file path', 4096)
      const title =
        typeof payload?.title === 'string' ? payload.title.slice(0, 256) : undefined
      const artist =
        typeof payload?.artist === 'string' ? payload.artist.slice(0, 256) : undefined
      const album =
        typeof payload?.album === 'string' ? payload.album.slice(0, 256) : undefined
      const positionSeconds =
        typeof payload?.positionSeconds === 'number' && Number.isFinite(payload.positionSeconds)
          ? Math.max(0, payload.positionSeconds)
          : 0

      const device = lastDlnaDevices.find((d) => d.usn === usn)
      if (!device?.avTransportUrl) {
        throw new Error('DLNA device not found or missing AVTransport')
      }

      // Only stream authorized library/cache files.
      const authorizedPath = await resolveAuthorizedAudioFile(filePath)

      await syncRemoteControlWithSettings()
      const instance = ensureServer()
      if (!instance.getStatus().running) {
        await instance.start(runtime.appSettings.remoteControlPort ?? 0)
      }

      const mediaUrl = instance.issueMediaUrl(authorizedPath, title)
      if (!mediaUrl) throw new Error('Unable to issue media stream URL')

      const metadata = buildDidlLiteMetadata({
        title: title ?? 'Twilight Echo',
        artist,
        album,
        resUrl: mediaUrl
      })

      await dlnaSetAvTransportUri(device.avTransportUrl, mediaUrl, metadata)
      await dlnaPlay(device.avTransportUrl)
      if (positionSeconds > 1) {
        try {
          await dlnaSeek(device.avTransportUrl, positionSeconds)
        } catch {
          // Some renderers reject seek before buffering completes.
        }
      }

      activeCastUsn = usn
      // Pause local engine via renderer.
      sendPlayerCommand('pause')
      return {
        ok: true as const,
        usn,
        friendlyName: device.friendlyName,
        mediaUrl
      }
    }
  )

  ipcMain.handle('remote:stopCast', async (event) => {
    assertTrustedIpcSender(event, 'remote control IPC')
    if (activeCastUsn) {
      await tryDlnaTransport('stop')
    }
    activeCastUsn = null
    return { ok: true as const }
  })

  ipcMain.handle('remote:getCastTarget', async (event) => {
    assertTrustedIpcSender(event, 'remote control IPC')
    if (!activeCastUsn) return null
    const device = findActiveDevice()
    return device
      ? { usn: device.usn, friendlyName: device.friendlyName }
      : { usn: activeCastUsn, friendlyName: activeCastUsn }
  })

  /**
   * Fan-out in-app transport/volume to the active DLNA renderer while casting.
   * Local engine stays paused; renderer still tracks UI position/volume state.
   */
  ipcMain.handle(
    'remote:controlCast',
    async (
      event,
      payload: {
        seek?: unknown
        volume?: unknown
        pause?: unknown
        play?: unknown
      }
    ) => {
      assertTrustedIpcSender(event, 'remote control IPC')
      if (!activeCastUsn) return { ok: false as const, reason: 'no-active-cast' as const }
      if (payload?.seek !== undefined) {
        const seek =
          typeof payload.seek === 'number' && Number.isFinite(payload.seek)
            ? Math.max(0, payload.seek)
            : null
        if (seek === null) throw new Error('Cast seek position is invalid')
        await tryDlnaSeek(seek)
      }
      if (payload?.volume !== undefined) {
        const volume =
          typeof payload.volume === 'number' && Number.isFinite(payload.volume)
            ? Math.min(1, Math.max(0, payload.volume))
            : null
        if (volume === null) throw new Error('Cast volume is invalid')
        await tryDlnaVolume(volume)
      }
      if (payload?.pause === true) await tryDlnaTransport('pause')
      if (payload?.play === true) await tryDlnaTransport('play')
      return { ok: true as const }
    }
  )

  void syncRemoteControlWithSettings().catch((error) => {
    console.warn('[remote] initial sync failed:', error)
  })
}

export async function destroyRemoteIpc(): Promise<void> {
  activeCastUsn = null
  lastDlnaDevices = []
  syncDesiredEnabled = null
  if (server) {
    try {
      await server.stop()
    } catch {
      // ignore
    }
  }
  server = null
}

