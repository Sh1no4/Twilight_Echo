import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { readdir, stat } from 'fs/promises'
import { dirname, join, resolve } from 'path'

export interface AppSettings {
  autoCheckLogin: boolean
  minimizeToTray: boolean
  launchAtLogin: boolean
  hardwareAcceleration: boolean
  cachePath: string
  blurEffect: boolean
  useCoverTheme: boolean
  lyricFontSize: number
}

export interface SettingsSnapshot {
  settings: AppSettings
  defaults: {
    cachePath: string
  }
  paths: {
    settingsFile: string
    userDataPath: string
    activeCachePath: string
  }
  appVersion: string
  platform: string
  restartRequired: boolean
  restartReasons: string[]
}

export type AppSettingsPatch = Partial<AppSettings>

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function boolOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function getDefaultCachePath(): string {
  return app.getPath('userData')
}

export function getDefaultSettings(): AppSettings {
  return {
    autoCheckLogin: true,
    minimizeToTray: false,
    launchAtLogin: false,
    hardwareAcceleration: true,
    cachePath: getDefaultCachePath(),
    blurEffect: true,
    useCoverTheme: true,
    lyricFontSize: 18
  }
}

export function getSettingsFilePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function normalizeSettings(raw: unknown): AppSettings {
  const defaults = getDefaultSettings()
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const rawCachePath =
    typeof source.cachePath === 'string' && source.cachePath.trim()
      ? source.cachePath.trim()
      : defaults.cachePath

  return {
    autoCheckLogin: boolOrDefault(source.autoCheckLogin, defaults.autoCheckLogin),
    minimizeToTray: boolOrDefault(source.minimizeToTray, defaults.minimizeToTray),
    launchAtLogin: boolOrDefault(source.launchAtLogin, defaults.launchAtLogin),
    hardwareAcceleration: boolOrDefault(source.hardwareAcceleration, defaults.hardwareAcceleration),
    cachePath: resolve(rawCachePath),
    blurEffect: boolOrDefault(source.blurEffect, defaults.blurEffect),
    useCoverTheme: boolOrDefault(source.useCoverTheme, defaults.useCoverTheme),
    lyricFontSize: clampNumber(source.lyricFontSize, 14, 28, defaults.lyricFontSize)
  }
}

export function loadSettings(): AppSettings {
  const filePath = getSettingsFilePath()
  if (!existsSync(filePath)) {
    return getDefaultSettings()
  }

  try {
    return normalizeSettings(JSON.parse(readFileSync(filePath, 'utf-8')))
  } catch (error) {
    console.warn('[settings] failed to read settings, using defaults:', error)
    return getDefaultSettings()
  }
}

export function saveSettings(settings: AppSettings): void {
  const filePath = getSettingsFilePath()
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(normalizeSettings(settings), null, 2), 'utf-8')
}

export function mergeSettings(settings: AppSettings, patch: AppSettingsPatch): AppSettings {
  return normalizeSettings({ ...settings, ...patch })
}

export function applyEarlySettings(settings: AppSettings): void {
  if (!settings.hardwareAcceleration) {
    app.disableHardwareAcceleration()
  }

  const defaultCachePath = resolve(getDefaultCachePath())
  const requestedCachePath = resolve(settings.cachePath || defaultCachePath)
  if (requestedCachePath !== defaultCachePath) {
    try {
      mkdirSync(requestedCachePath, { recursive: true })
      app.setPath('sessionData', requestedCachePath)
    } catch (error) {
      console.warn('[settings] failed to set session cache path:', error)
    }
  }
}

export function getRestartReasons(settings: AppSettings, launchSettings: AppSettings): string[] {
  const reasons: string[] = []
  if (settings.hardwareAcceleration !== launchSettings.hardwareAcceleration) {
    reasons.push('GPU 加速')
  }
  if (resolve(settings.cachePath) !== resolve(launchSettings.cachePath)) {
    reasons.push('缓存位置')
  }
  return reasons
}

export function createSettingsSnapshot(
  settings: AppSettings,
  launchSettings: AppSettings
): SettingsSnapshot {
  const restartReasons = getRestartReasons(settings, launchSettings)
  return {
    settings,
    defaults: {
      cachePath: getDefaultCachePath()
    },
    paths: {
      settingsFile: getSettingsFilePath(),
      userDataPath: app.getPath('userData'),
      activeCachePath: app.getPath('sessionData')
    },
    appVersion: app.getVersion(),
    platform: process.platform,
    restartRequired: restartReasons.length > 0,
    restartReasons
  }
}

export async function getDirectorySize(directory: string): Promise<number> {
  try {
    const info = await stat(directory)
    if (!info.isDirectory()) return info.size

    const entries = await readdir(directory, { withFileTypes: true })
    const sizes = await Promise.all(
      entries.map((entry) => {
        const fullPath = join(directory, entry.name)
        return entry.isDirectory() ? getDirectorySize(fullPath) : stat(fullPath).then((s) => s.size)
      })
    )
    return sizes.reduce((sum, size) => sum + size, 0)
  } catch {
    return 0
  }
}
