import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { THEME_TOKEN_DEFINITIONS } from '../../../shared/theme.ts'

const playingMusic = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')
const app = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
const settings = readFileSync(new URL('./SettingsPage.vue', import.meta.url), 'utf8')
const studio = readFileSync(new URL('./ThemeStudioPage.vue', import.meta.url), 'utf8')
const themeStore = readFileSync(new URL('../stores/useThemeStore.ts', import.meta.url), 'utf8')
const themeIpc = readFileSync(new URL('../../../main/ipc/themes.ts', import.meta.url), 'utf8')
const pluginIpc = readFileSync(new URL('../../../main/ipc/plugins.ts', import.meta.url), 'utf8')

test('every registered playback token is wired into the real playback surface', () => {
  const playbackVariables = THEME_TOKEN_DEFINITIONS.filter(
    (definition) => definition.group === 'playback'
  ).map((definition) => definition.cssVariable)
  assert.ok(playbackVariables.length >= 20)
  for (const variable of playbackVariables) assert.match(playingMusic, new RegExp(variable))
})

test('theme studio is a dedicated navigable settings surface', () => {
  assert.match(app, /ThemeStudioPage/)
  assert.match(app, /@open-theme-studio="openThemeStudioPage"/)
  assert.match(settings, /打开主题工作室/)
  assert.doesNotMatch(studio, /structuredClone\(profile\)/)
})

test('theme assets use typed local bindings instead of arbitrary stylesheet urls', () => {
  assert.match(studio, /importAsset\('image'\)/)
  assert.match(studio, /importAsset\('font'\)/)
  assert.match(themeStore, /theme-asset:\/\/asset\//)
  assert.match(themeStore, /@font-face/)
})

test('disabled or uninstalled plugin themes fall back to the built-in selection', () => {
  assert.match(themeIpc, /export async function reconcileThemeAfterPluginChange/)
  assert.match(themeIpc, /setActiveTheme\(\{ kind: 'builtin', id: TWILIGHT_DEFAULT_THEME_ID \}/)
  assert.match(pluginIpc, /reconcileThemeAfterPluginChange\(\)/)
})
