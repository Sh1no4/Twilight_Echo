import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { THEME_TOKEN_DEFINITIONS } from '../../../shared/theme.ts'

const playingMusic = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')
const app = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
const baseStyle = readFileSync(new URL('../assets/base.css', import.meta.url), 'utf8')
const settingsPage = readFileSync(new URL('./SettingsPage.vue', import.meta.url), 'utf8')
const studio = readFileSync(new URL('./ThemeStudioPage.vue', import.meta.url), 'utf8')
const studioStyle = readFileSync(
  new URL('./theme-studio/ThemeStudioPage.css', import.meta.url),
  'utf8'
)
const sideMenu = readFileSync(new URL('./SideMenu.vue', import.meta.url), 'utf8')
const themeIcon = readFileSync(new URL('./ThemeIcon.vue', import.meta.url), 'utf8')
const titleBar = readFileSync(new URL('./TitleBar.vue', import.meta.url), 'utf8')
const songList = readFileSync(new URL('./song-list/SongList.css', import.meta.url), 'utf8')
const songListView = readFileSync(new URL('./SongList.vue', import.meta.url), 'utf8')
const virtualScroll = readFileSync(
  new URL('./song-list/useSongListVirtualScroll.ts', import.meta.url),
  'utf8'
)
const localDashboard = readFileSync(new URL('./LocalDashboard.css', import.meta.url), 'utf8')
const rendererMain = readFileSync(new URL('../main.ts', import.meta.url), 'utf8')
const settingsStyle = readFileSync(
  new URL('./settings-page/SettingsPage.css', import.meta.url),
  'utf8'
)
const themeStore = readFileSync(new URL('../stores/useThemeStore.ts', import.meta.url), 'utf8')
const playerStore = readFileSync(new URL('../stores/usePlayerStore.ts', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../../../preload/index.ts', import.meta.url), 'utf8')
const themeIpc = readFileSync(new URL('../../../main/ipc/themes.ts', import.meta.url), 'utf8')
const themeArchive = readFileSync(
  new URL('../../../main/themes/themeArchive.ts', import.meta.url),
  'utf8'
)
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
  assert.match(settingsPage, /打开主题工作室/)
  assert.doesNotMatch(studio, /structuredClone\(profile\)/)
  assert.match(studio, /个性化与材质/)
  assert.match(studio, /theme-domain-list/)
  assert.match(studio, /sourceFor\(definition\)/)
  assert.match(studio, /assetSource\(binding\.key\)/)
  assert.match(studio, /draft\.name \}\} · 未保存/)
})

test('theme assets use typed local bindings instead of arbitrary stylesheet urls', () => {
  assert.match(studio, /importAsset\('image'\)/)
  assert.match(studio, /importAsset\('font'\)/)
  assert.match(themeStore, /theme-asset:\/\/asset\//)
  assert.match(themeStore, /@font-face/)
  assert.match(themeStore, /window\.api\.themes\.validateAssets/)
  assert.match(themeIpc, /themes:validateAssets/)
})

test('phase one semantic tokens are wired into shell, settings, navigation, and library surfaces', () => {
  assert.match(titleBar, /--te-shell-control-hover/)
  assert.match(sideMenu, /--te-navigation-active/)
  assert.match(settingsStyle, /--te-settings-control-border/)
  assert.match(songList, /--te-library-selection-bg/)
  assert.match(songList, /--te-library-table-shadow/)
})

test('phase two runtime reuses cached cover media and supports native and timed tone scheduling', () => {
  assert.match(playerStore, /extractDominantColor\(displayCover\)/)
  assert.match(playerStore, /themeCoverIdentity/)
  assert.match(app, /setAdaptiveMedia\(\{ identity, accentColor, coverUrl \}\)/)
  assert.match(themeStore, /createThemeAccentTokenOverrides/)
  assert.match(themeStore, /resolveScheduledThemeTone/)
  assert.match(themeStore, /scheduleTimedToneRefresh/)
  assert.match(themeIpc, /nativeTheme\.on\('updated'/)
  assert.match(preload, /themes:systemToneChanged/)
})

test('phase two studio exposes palettes, nine typography settings, and contrast protection', () => {
  assert.match(studio, /THEME_ACCENT_PALETTES/)
  assert.match(studio, /THEME_BACKGROUND_PALETTES/)
  assert.match(studio, /accentPalette\.length/)
  assert.match(studio, /backgroundPalette\.length/)
  assert.match(studio, /typography\.bodySize/)
  assert.match(studio, /typography\.titleWeight/)
  assert.match(studio, /typography\.chromeText/)
  assert.match(studio, /updateTypographyMode\('titleCase'/)
  assert.match(studio, /updateTypographyMode\('lyricAccent'/)
  assert.match(studio, /updateTypographyMode\('titleColor'/)
  assert.match(studio, /key: 'sansFont', tokenId: 'typography\.sans'/)
  assert.match(studio, /key: 'displayFont', tokenId: 'typography\.display'/)
  assert.match(studio, /key: 'roundedFont', tokenId: 'typography\.rounded'/)
  assert.match(studio, /themeContrastRatio/)
  assert.match(themeStore, /ensureThemeTextContrast/)
})

test('phase two unified surface and background tokens are wired into host CSS', () => {
  assert.match(baseStyle, /data-te-background-treatment='cover-blur'/)
  assert.match(baseStyle, /--te-background-cover-blur/)
  assert.match(baseStyle, /--te-dialog-radius/)
  assert.match(baseStyle, /--te-search-radius/)
  assert.match(baseStyle, /--te-toast-radius/)
  assert.match(baseStyle, /--te-track-title-radius/)
  assert.match(baseStyle, /data-te-title-case='uppercase'/)
  assert.match(baseStyle, /data-te-lyric-accent='accent'/)
})

test('phase three icon, navigation, and library modes use static host-owned presentation', () => {
  assert.match(rendererMain, /@phosphor-icons\/web\/bold/)
  assert.match(rendererMain, /@phosphor-icons\/web\/fill/)
  assert.match(themeIcon, /THEME_ICON_SLOT_REGISTRY/)
  assert.match(themeIcon, /data-theme-icon-slot/)
  assert.match(sideMenu, /icon-slot="navigation\.streaming"/)
  assert.match(sideMenu, /data-te-navigation-style='rail'/)
  assert.match(sideMenu, /data-te-navigation-icon-scale='lg'/)
  assert.match(studio, /updateIconFamily/)
  assert.match(studio, /updateNavigationMode\('style'/)
  assert.match(studio, /updateLibraryMode\('density'/)
  assert.match(songListView, /icon-slot="library\.search"/)
  assert.match(songList, /data-te-library-selection='stroke'/)
  assert.match(songList, /--te-library-action-bg/)
  assert.match(localDashboard, /data-te-library-density='compact'/)
  assert.match(localDashboard, /--te-library-cover-radius/)
  assert.match(studioStyle, /--te-navigation-opacity/)
  assert.match(studioStyle, /--te-library-cover-radius/)
  assert.doesNotMatch(studioStyle, /:global\(/)
  for (const scopedStyle of [themeIcon, sideMenu, songList, localDashboard]) {
    assert.doesNotMatch(scopedStyle, /:global\(html\[data-te-[^)]+\]\)\s+[.#:]/)
  }
  assert.match(virtualScroll, /const ROW_HEIGHT = 68/)
  assert.doesNotMatch(virtualScroll, /data-te-library-density/)
})

test('preview and failed writes restore the persisted runtime without partially committing assets', () => {
  assert.ok(
    themeStore.indexOf('await assertProfileAssetsAvailable') <
      themeStore.indexOf('style.textContent')
  )
  assert.match(themeStore, /previewProfile\.value = null[\s\S]*previewSelection\.value = null/)
  assert.match(studio, /onBeforeUnmount\([\s\S]*previewTheme\(null\)/)
})

test('theme archives export v2, accept v1 migration input, and reject unknown versions', () => {
  assert.match(themeArchive, /schemaVersion: THEME_ARCHIVE_SCHEMA_VERSION/)
  assert.match(themeArchive, /document\.schemaVersion !== 1/)
  assert.match(themeArchive, /不支持的主题包版本/)
})

test('disabled or uninstalled plugin themes fall back to the built-in selection', () => {
  assert.match(themeIpc, /export async function reconcileThemeAfterPluginChange/)
  assert.match(themeIpc, /setActiveTheme\(\{ kind: 'builtin', id: TWILIGHT_DEFAULT_THEME_ID \}/)
  assert.match(pluginIpc, /reconcileThemeAfterPluginChange\(\)/)
})
