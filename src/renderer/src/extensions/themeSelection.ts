import type { ThemeContribution } from './registry'

export function getPluginThemeKey(theme: Pick<ThemeContribution, 'pluginId' | 'id'>): string {
  return `${theme.pluginId}:${theme.id}`
}

export function resolveSelectedPluginTheme(
  themes: ThemeContribution[],
  selectedThemeId: string | null | undefined
): ThemeContribution | null {
  if (!selectedThemeId) return null
  return (
    themes.find(
      (theme) => getPluginThemeKey(theme) === selectedThemeId || theme.id === selectedThemeId
    ) ?? null
  )
}
