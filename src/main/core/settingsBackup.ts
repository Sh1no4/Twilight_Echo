export function exportAppSettingsForBackup<T extends object>(settings: T): string {
  return JSON.stringify(settings, null, 2)
}

export function importAppSettingsFromBackup<T extends object>(
  json: string,
  currentSettings: T,
  normalize: (settings: Partial<T>) => T
): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Invalid settings backup JSON')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Settings backup must be a JSON object')
  }

  return normalize({
    ...currentSettings,
    ...(parsed as Partial<T>)
  })
}
