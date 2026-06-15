import { useExtensionRegistry } from './registry'

const STYLE_ID = 'twilight-plugin-theme-runtime'
let listenerSetup = false

export function setupPluginThemeRuntime(): void {
  if (listenerSetup) return
  listenerSetup = true
  void applyPluginThemes()
  window.api.plugins.onChanged(() => {
    void applyPluginThemes()
  })
}

export async function applyPluginThemes(): Promise<void> {
  const { syncExtensions, themeContributions } = useExtensionRegistry()
  await syncExtensions()

  const css: string[] = []
  const rootVariables: string[] = []
  for (const theme of themeContributions.value) {
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
