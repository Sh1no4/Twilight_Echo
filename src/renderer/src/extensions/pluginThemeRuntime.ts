import {
  TWILIGHT_DEFAULT_THEME,
  normalizeThemeTokenOverrides,
  resolveThemeModes,
  themeTokensToCssVariables,
  type StructuredPluginTheme,
  type ThemeModes,
  type ThemeTone
} from '../../../shared/theme.ts'

interface PluginThemeRuntimeInput {
  variables?: Record<string, string>
  structured?: StructuredPluginTheme
}

export interface PluginThemeRuntimeContract {
  modes: ThemeModes
  resolvedTokens: Record<string, string>
  variables: Record<string, string>
  usesStructuredModes: boolean
}

export function resolvePluginThemeRuntimeContract(
  contribution: PluginThemeRuntimeInput,
  tone: ThemeTone
): PluginThemeRuntimeContract {
  const structuredTokens = normalizeThemeTokenOverrides(
    contribution.structured?.variants[tone]?.tokens ?? {}
  )
  const resolvedTokens = {
    ...TWILIGHT_DEFAULT_THEME.variants[tone].tokens,
    ...structuredTokens
  }
  const variables: Record<string, string> = {}
  if (contribution.structured) {
    Object.assign(
      variables,
      themeTokensToCssVariables(TWILIGHT_DEFAULT_THEME.variants[tone].tokens)
    )
  }
  Object.assign(variables, contribution.variables ?? {})
  if (Object.keys(structuredTokens).length > 0) {
    Object.assign(variables, themeTokensToCssVariables(resolvedTokens))
  }
  const structuredModes =
    contribution.structured?.schemaVersion === 2 ? contribution.structured.modes : undefined
  const usesStructuredModes = contribution.structured?.schemaVersion === 2
  return {
    modes: resolveThemeModes(structuredModes),
    resolvedTokens,
    variables,
    usesStructuredModes
  }
}
