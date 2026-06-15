import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'

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
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

async function writePluginSettings(
  storagePath: string,
  settings: Record<string, unknown>
): Promise<void> {
  const filePath = pluginSettingsPath(storagePath)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(settings, null, 2), 'utf-8')
}

function normalizeSettingsKey(key: string): string {
  const normalized = key.trim()
  if (!normalized) throw new Error('settings key is required')
  return normalized
}
