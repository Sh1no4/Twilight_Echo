import type { IpcMain } from 'electron'
import { assertTrustedIpcSender } from '../security/electronSecurity.ts'
import { runtime, type DiscordActivityData } from '../core/runtime.ts'
import {
  clearDiscordActivity,
  getDiscordRpcStatus,
  updateDiscordActivity
} from '../integrations/discord.ts'
import { stringifyJsonForIpcStorage } from '../security/ipcValidation.ts'

const MAX_DISCORD_ACTIVITY_BYTES = 16 * 1024

export function registerDiscordIpc(ipcMain: IpcMain): void {
  ipcMain.handle('discord:getStatus', (event) => {
    assertTrustedIpcSender(event, 'Discord IPC')
    return getDiscordRpcStatus()
  })

  ipcMain.handle('discord:updateActivity', (event, data: DiscordActivityData) => {
    assertTrustedIpcSender(event, 'Discord IPC')
    stringifyJsonForIpcStorage(data, 'Discord activity', MAX_DISCORD_ACTIVITY_BYTES)
    if (runtime.appSettings.discordRpcEnabled) updateDiscordActivity(data)
    return true
  })

  ipcMain.handle('discord:clearActivity', (event) => {
    assertTrustedIpcSender(event, 'Discord IPC')
    clearDiscordActivity()
    return true
  })
}
