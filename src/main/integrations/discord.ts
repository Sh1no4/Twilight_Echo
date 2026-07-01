import DiscordRPC from 'discord-rpc'
import { runtime, type DiscordActivityData } from '../core/runtime'

export const DISCORD_CLIENT_ID = '1390521943809896488' // Twilight Echo application ID

export function connectDiscord(): void {
  if (runtime.discordConnectAttempted || runtime.discordConnected) return
  runtime.discordConnectAttempted = true
  try {
    runtime.discordClient = new DiscordRPC.Client({ transport: 'ipc' })
    runtime.discordClient.once('connected', () => {
      runtime.discordConnected = true
      if (runtime.lastDiscordActivity) updateDiscordActivity(runtime.lastDiscordActivity)
    })
    runtime.discordClient.once('disconnected', () => {
      runtime.discordConnected = false
      runtime.discordClient = null
      if (runtime.discordReconnectTimer) clearTimeout(runtime.discordReconnectTimer)
      runtime.discordReconnectTimer = setTimeout(() => {
        runtime.discordConnectAttempted = false
        if (runtime.appSettings.discordRpcEnabled) connectDiscord()
      }, 15000)
    })
    void runtime.discordClient.login({ clientId: DISCORD_CLIENT_ID }).catch(() => {
      // Discord not running or IPC unavailable — silently retry later
      runtime.discordConnected = false
      runtime.discordClient = null
      if (runtime.discordReconnectTimer) clearTimeout(runtime.discordReconnectTimer)
      runtime.discordReconnectTimer = setTimeout(() => {
        runtime.discordConnectAttempted = false
        if (runtime.appSettings.discordRpcEnabled) connectDiscord()
      }, 30000)
    })
  } catch {
    runtime.discordConnectAttempted = false
  }
}

export function disconnectDiscord(): void {
  if (runtime.discordReconnectTimer) {
    clearTimeout(runtime.discordReconnectTimer)
    runtime.discordReconnectTimer = null
  }
  if (runtime.discordClient) {
    try { void runtime.discordClient.destroy() } catch { /* ignore */ }
    runtime.discordClient = null
  }
  runtime.discordConnected = false
  runtime.discordConnectAttempted = false
}

export function updateDiscordActivity(data: DiscordActivityData): void {
  runtime.lastDiscordActivity = data
  if (!runtime.discordConnected || !runtime.discordClient) return
  const activity: DiscordRPC.Presence = {
    details: data.title || 'Unknown track',
    state: data.artist ? `by ${data.artist}` : '',
    instance: false
  }
  if (data.playing && data.startTime) {
    activity.startTimestamp = data.startTime
    activity.type = 2 // ActivityType.Listening
  }
  try {
    void runtime.discordClient.setActivity(activity)
  } catch {
    // ignore transient errors
  }
}

export function clearDiscordActivity(): void {
  runtime.lastDiscordActivity = null
  if (!runtime.discordConnected || !runtime.discordClient) return
  try { void runtime.discordClient.clearActivity() } catch { /* ignore */ }
}

export function applyDiscordRpcSetting(enabled: boolean): void {
  if (enabled) {
    connectDiscord()
  } else {
    clearDiscordActivity()
    disconnectDiscord()
  }
}
