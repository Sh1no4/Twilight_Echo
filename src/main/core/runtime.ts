import { readAppSettings } from './settings'
import type { AppSettings } from './types'
import type { DesktopLyricsTrackPayload } from '../../preload/types'
import type { BrowserWindow, Tray } from 'electron'
import type { AudioEngineManager, PlaybackInfo } from '../audioEngineManager'
import type { OpraCatalog } from '../opraCatalog'
import type { TwilightPluginManager } from '../plugins/manager'
import type { PluginIndexService } from '../plugins/indexService'
import type { BpmAnalysisManager } from '../bpm/bpmAnalysisManager'
import type DiscordRPC from 'discord-rpc'

export interface DiscordActivityData {
  title: string
  artist: string
  album?: string
  playing: boolean
  startTime?: number
}

export const runtime = {
  appSettings: readAppSettings(),
  launchSettings: {} as AppSettings,
  pluginManager: null as TwilightPluginManager | null,
  pluginManagerReady: null as Promise<void> | null,
  pluginIndexService: null as PluginIndexService | null,
  opraCatalog: null as OpraCatalog | null,
  audioEngineManager: null as AudioEngineManager | null,
  bpmAnalysisManager: null as BpmAnalysisManager | null,
  mainWindow: null as BrowserWindow | null,
  desktopLyricsWindow: null as BrowserWindow | null,
  latestDesktopLyricsTrack: null as DesktopLyricsTrackPayload | null,
  latestDesktopLyricsTime: 0,
  ncmServer: null as import('http').Server | null,
  tray: null as Tray | null,
  forceQuit: false,
  closingAfterPlaybackSessionSave: false,
  savingPlaybackSessionBeforeClose: false,
  lastPluginPlaybackInfo: null as PlaybackInfo | null,
  discordClient: null as DiscordRPC.Client | null,
  discordConnected: false,
  discordConnectAttempted: false,
  discordReconnectTimer: null as NodeJS.Timeout | null,
  lastDiscordActivity: null as DiscordActivityData | null,
  coversMissingNotified: false,
  libraryWatcherDebounceMs: 2000
}
