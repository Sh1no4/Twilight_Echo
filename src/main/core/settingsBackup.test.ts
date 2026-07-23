import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  exportAppSettingsForBackup,
  importAppSettingsBackup,
  importAppSettingsFromBackup
} from './settingsBackup.ts'
import { createDefaultThemeLibraryDocument } from '../../shared/theme.ts'

const currentSettings = {
  theme: 'dark',
  proxyMode: 'off',
  proxyHost: '',
  proxyPort: 0,
  globalShortcuts: false
} as any

function normalizeSettings(settings: any): any {
  return {
    ...currentSettings,
    ...settings,
    theme: settings.theme === 'dark' || settings.theme === 'system' ? settings.theme : 'system',
    proxyPort: Math.min(65535, Math.max(0, Number(settings.proxyPort) || 0))
  }
}

test('exports current settings as formatted backup json', () => {
  const json = exportAppSettingsForBackup({
    ...currentSettings,
    theme: 'dark',
    proxyMode: 'custom',
    proxyHost: '127.0.0.1',
    proxyPort: 7897
  } as any)

  assert.match(json, /\n  "theme": "dark"/)
  assert.match(json, /\n  "proxyHost": "127\.0\.0\.1"/)
  assert.equal(JSON.parse(json).proxyPort, 7897)
})

test('imports valid settings backup through normal settings normalization', () => {
  const imported = importAppSettingsFromBackup(
    JSON.stringify({
      ...currentSettings,
      theme: 'not-a-theme',
      cachePath: 'D:/TwilightCache',
      proxyMode: 'custom',
      proxyPort: 70000,
      globalShortcuts: true
    }),
    currentSettings,
    normalizeSettings
  )

  assert.equal(imported.theme, 'system')
  assert.equal(imported.proxyMode, 'custom')
  assert.equal(imported.proxyPort, 65535)
  assert.equal(imported.globalShortcuts, true)
})

test('rejects invalid settings backup without producing replacement settings', () => {
  assert.throws(
    () => importAppSettingsFromBackup('{bad json', currentSettings, normalizeSettings),
    /Invalid settings backup JSON/
  )
  assert.throws(
    () => importAppSettingsFromBackup('null', currentSettings, normalizeSettings),
    /Settings backup must be a JSON object/
  )
})

test('version two settings backups round-trip normalized theme profiles and history', () => {
  const themeLibrary = createDefaultThemeLibraryDocument()
  themeLibrary.profiles.push({
    schemaVersion: 2,
    id: 'user:backup',
    name: 'Backup',
    description: '',
    baseThemeId: 'builtin:studio-split',
    source: { kind: 'builtin-preset', presetId: 'builtin:studio-split' },
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
    overrides: { pureWhite: {}, dark: {} },
    modes: {}
  })
  themeLibrary.profileHistory['user:backup'] = [
    {
      savedAt: '2026-07-23T00:01:00.000Z',
      profile: { ...themeLibrary.profiles[0], name: 'Earlier Backup' }
    }
  ]

  const json = exportAppSettingsForBackup(currentSettings, themeLibrary)
  const imported = importAppSettingsBackup(json, currentSettings, normalizeSettings)

  assert.equal(JSON.parse(json).schemaVersion, 2)
  assert.equal(imported.themeLibrary?.profiles[0].schemaVersion, 2)
  assert.equal(imported.themeLibrary?.profiles[0].source?.presetId, 'builtin:studio-split')
  assert.equal(
    imported.themeLibrary?.profileHistory['user:backup'][0].profile.name,
    'Earlier Backup'
  )
})

test('settings backup rejects malformed theme libraries without replacing settings', () => {
  assert.throws(
    () =>
      importAppSettingsBackup(
        JSON.stringify({ schemaVersion: 2, settings: currentSettings, themeLibrary: {} }),
        currentSettings,
        normalizeSettings
      ),
    /theme library is invalid/
  )
})
