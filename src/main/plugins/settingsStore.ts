import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import {
  isSecureValueEnvelope,
  isSensitiveStorageKey,
  protectJsonValue,
  unprotectJsonValue
} from '../security/secureStorage.ts'
import { tryParseJsonWithNestingLimit } from '../security/jsonSafety.ts'

const MAX_PLUGIN_SETTINGS_FILE_BYTES = 1024 * 1024
const MAX_PLUGIN_SETTING_VALUE_BYTES = 512 * 1024
const MAX_PLUGIN_SETTING_KEY_LENGTH = 128

export async function getPluginSetting(storagePath: string, key?: string): Promise<unknown> {
  const settings = await readPluginSettings(storagePath)
  return key == null ? settings : settings[normalizeSettingsKey(key)]
}

export async function setPluginSetting(
  storagePath: string,
  key: string,
  value: unknown
): Promise<void> {
  const settings = await readPluginSettings(storagePath)
  settings[normalizeSettingsKey(key)] = value
  await writePluginSettings(storagePath, settings)
}

export async function deletePluginSetting(storagePath: string, key: string): Promise<void> {
  const settings = await readPluginSettings(storagePath)
  delete settings[normalizeSettingsKey(key)]
  await writePluginSettings(storagePath, settings)
}

export function pluginSettingsPath(storagePath: string): string {
  return join(storagePath, 'settings.json')
}

async function readPluginSettings(storagePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(pluginSettingsPath(storagePath), 'utf-8')
    if (Buffer.byteLength(raw, 'utf-8') > MAX_PLUGIN_SETTINGS_FILE_BYTES) return {}
    const parsed = tryParseJsonWithNestingLimit(raw)
    if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
      return {}
    }
    const settings = parsed.value as Record<string, unknown>
    let migrated = false
    for (const [key, value] of Object.entries(settings)) {
      if (isSecureValueEnvelope(value)) {
        settings[key] = unprotectJsonValue(value, secureScope(storagePath, key))
        continue
      }
      if (isSensitiveStorageKey(key)) {
        migrated = true
      }
    }
    if (migrated) await writePluginSettings(storagePath, settings)
    return settings
  } catch {
    return {}
  }
}

async function writePluginSettings(
  storagePath: string,
  settings: Record<string, unknown>
): Promise<void> {
  const filePath = pluginSettingsPath(storagePath)
  const serialized = serializePluginSettings(storagePath, settings)
  const json = JSON.stringify(serialized, null, 2)
  if (Buffer.byteLength(json, 'utf-8') > MAX_PLUGIN_SETTINGS_FILE_BYTES) {
    throw new Error('plugin settings file is too large')
  }
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, json, 'utf-8')
}

function normalizeSettingsKey(key: string): string {
  const normalized = key.trim()
  if (!normalized) throw new Error('settings key is required')
  if (normalized.length > MAX_PLUGIN_SETTING_KEY_LENGTH) throw new Error('settings key is too long')
  if (/[\0\r\n]/.test(normalized)) throw new Error('settings key contains invalid characters')
  return normalized
}

function serializePluginSettings(
  storagePath: string,
  settings: Record<string, unknown>
): Record<string, unknown> {
  const serialized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(settings)) {
    assertSettingValueSize(value)
    serialized[key] = isSensitiveStorageKey(key)
      ? protectJsonValue(value, secureScope(storagePath, key))
      : value
  }
  return serialized
}

function assertSettingValueSize(value: unknown): void {
  const json = JSON.stringify(value)
  if (json === undefined) return
  if (Buffer.byteLength(json, 'utf-8') > MAX_PLUGIN_SETTING_VALUE_BYTES) {
    throw new Error('plugin setting value is too large')
  }
}

function secureScope(storagePath: string, key: string): string {
  return `plugin-settings:${storagePath}:${key}`
}
