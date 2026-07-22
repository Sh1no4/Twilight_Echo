import { applyActiveTheme, bootstrapThemeRuntime } from '../stores/useThemeStore'

export function setupPluginThemeRuntime(): void {
  void bootstrapThemeRuntime()
}

export async function applyPluginThemes(): Promise<void> {
  await applyActiveTheme(true)
}
