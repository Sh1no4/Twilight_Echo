import { useExtensionRegistry } from './registry'
import { useSettingsStore } from '../stores/useSettingsStore'
import { resolveSelectedPluginTheme } from './themeSelection'

const STYLE_ID = 'twilight-plugin-theme-runtime'
let listenerSetup = false

export function setupPluginThemeRuntime(): void {
  if (listenerSetup) return
  listenerSetup = true
  void applyPluginThemes()
  window.api.plugins.onChanged(() => {
    void applyPluginThemes()
  })
  window.api.settings.onChanged(() => {
    void applyPluginThemes()
  })
}

export async function applyPluginThemes(): Promise<void> {
  const { syncExtensions, themeContributions } = useExtensionRegistry()
  const { settings, updateSettings } = useSettingsStore()
  await syncExtensions()

  const css: string[] = []
  const rootVariables: string[] = []
  const selectedThemeId = settings.value.pluginThemeId
  const selectedTheme = resolveSelectedPluginTheme(themeContributions.value, selectedThemeId)
  if (selectedThemeId && !selectedTheme) {
    void updateSettings({ pluginThemeId: null })
  }
  const activeThemes = selectedTheme ? [selectedTheme] : []
  for (const theme of activeThemes) {
    for (const [key, value] of Object.entries(theme.variables ?? {})) {
      rootVariables.push(`${key}: ${value};`)
    }
    if (theme.stylesheet) {
      css.push(await window.api.extensions.readThemeStylesheet(theme.stylesheet))
    }
  }
  if (rootVariables.length > 0) {
    css.unshift(`:root {\n${rootVariables.map((line) => `  ${line}`).join('\n')}\n}`)
  }

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = css.join('\n\n')
}
