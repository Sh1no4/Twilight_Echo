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
