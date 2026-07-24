<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  BUILT_IN_THEME_PRESETS,
  BUILT_IN_THEME_FONTS,
  DEFAULT_THEME_TONE_SCHEDULE,
  THEME_ACCENT_PALETTES,
  THEME_BACKGROUND_PALETTES,
  THEME_MODE_DEFINITIONS,
  THEME_TOKEN_DEFINITIONS,
  TWILIGHT_DEFAULT_THEME,
  TWILIGHT_DEFAULT_THEME_ID,
  createThemeAccentTokenOverrides,
  getBuiltInThemePreset,
  normalizeThemeModes,
  normalizeThemeTokenOverrides,
  normalizeThemeTokenValue,
  resolveThemeProfileModes,
  resolveThemeProfileTokens,
  resolveThemeProfileWindowDefaults,
  themeContrastRatio,
  type BuiltInThemePresetId,
  type ThemeAssetBindings,
  type ThemeAssetType,
  type ThemeModes,
  type ThemePlayerLayout,
  type ThemeProfileHistoryEntry,
  type ThemeProfileV2,
  type ThemeSelection,
  type ThemeTokenDefinition,
  type ThemeTone,
  type ThemeVisibilitySlotId,
  type ThemeWindowDefaults
} from '../../../shared/theme.ts'
import { useExtensionRegistry, type ThemeContribution } from '../extensions/registry'
import { getPluginThemeKey } from '../extensions/themeSelection'
import { useThemeStore } from '../stores/useThemeStore'
import { createThemePreviewScheduler } from '../utils/themePreviewScheduler'
import EqualizerPage from './EqualizerPage.vue'
import LocalDashboard from './LocalDashboard.vue'
import PlayerBar from './PlayerBar.vue'
import PlayingMusic from './PlayingMusic.vue'
import SideMenu from './SideMenu.vue'
import TitleBar from './TitleBar.vue'

type ThemePreviewSurface = 'dashboard' | 'player' | 'equalizer'
type ThemeStudioDomain =
  | 'presets'
  | 'personalization'
  | 'shell'
  | 'navigation'
  | 'library'
  | 'typography'
  | 'player'
  | 'windows'
  | 'motion'
  | 'advanced'

const props = defineProps<{ initialDomain?: ThemeStudioDomain }>()
const emit = defineEmits<{ back: [] }>()
const themeStore = useThemeStore()
const { themeContributions, syncExtensions } = useExtensionRegistry()
const selectedKey = ref(`preset:${TWILIGHT_DEFAULT_THEME_ID}`)
const tone = ref<ThemeTone>('pureWhite')
const domain = ref<ThemeStudioDomain>(props.initialDomain ?? 'presets')
const studioSearchQuery = ref('')
const previewSurface = ref<ThemePreviewSurface>('dashboard')
const previewViewportRef = ref<HTMLElement | null>(null)
const previewViewportStyle = ref<Record<string, string>>({})
const previewCanvasStyle = ref<Record<string, string>>({})
let previewResizeObserver: ResizeObserver | null = null
const draft = ref<ThemeProfileV2 | null>(null)
const savedDraft = ref('')
const history = ref<ThemeProfileV2[]>([])
const historyIndex = ref(-1)
const localError = ref('')
const notice = ref('')
let originalTone: ThemeTone = 'pureWhite'
const previewScheduler = createThemePreviewScheduler((profile: ThemeProfileV2) =>
  themeStore.preview(profile)
)

const domains: Array<{ id: ThemeStudioDomain; label: string; icon: string }> = [
  { id: 'presets', label: '预设画廊', icon: 'ph ph-grid-four' },
  { id: 'personalization', label: '个性化与材质', icon: 'ph ph-palette' },
  { id: 'shell', label: '界面与设置', icon: 'ph ph-squares-four' },
  { id: 'navigation', label: '图标与导航', icon: 'ph ph-sidebar' },
  { id: 'library', label: '媒体库', icon: 'ph ph-music-notes-simple' },
  { id: 'typography', label: '字体与歌词', icon: 'ph ph-text-aa' },
  { id: 'player', label: '播放器与封面', icon: 'ph ph-play-circle' },
  { id: 'windows', label: '独立窗口', icon: 'ph ph-app-window' },
  { id: 'motion', label: '动效', icon: 'ph ph-wind' },
  { id: 'advanced', label: '高级令牌', icon: 'ph ph-sliders-horizontal' }
]

const playerLayouts: Array<{ id: ThemePlayerLayout; label: string }> = [
  { id: 'standard', label: '标准' },
  { id: 'full-cover', label: '全封面' },
  { id: 'lyrics-focus', label: '歌词聚焦' },
  { id: 'split', label: '桌面双栏' },
  { id: 'minimal', label: '极简' }
]

const previewSurfaces: Array<{ id: ThemePreviewSurface; label: string; icon: string }> = [
  { id: 'dashboard', label: '主页', icon: 'ph ph-house' },
  { id: 'player', label: '播放页', icon: 'ph ph-disc' },
  { id: 'equalizer', label: '均衡器', icon: 'ph ph-sliders-horizontal' }
]

const visibilityOptions: Array<{ id: ThemeVisibilitySlotId; label: string }> = [
  { id: 'playerAlbumArtist', label: '专辑与艺术家' },
  { id: 'playerArtwork', label: '播放器封面' },
  { id: 'playerTrackMenu', label: '曲目菜单' },
  { id: 'playerMiscIcons', label: '杂项图标' },
  { id: 'playerDuration', label: '时长显示' },
  { id: 'playerWaveform', label: '进度轨道' },
  { id: 'playerTrackInfo', label: '曲目信息' },
  { id: 'equalizerGrid', label: '均衡器辅助线' },
  { id: 'equalizerFrequencyGuides', label: '频率准线' },
  { id: 'equalizerSpectrum', label: '频谱曲线' },
  { id: 'previousButton', label: '上一首按钮' },
  { id: 'nextButton', label: '下一首按钮' },
  { id: 'miniPlayerArtwork', label: '小窗封面' }
]

const minimalHiddenSlots = new Set<ThemeVisibilitySlotId>([
  'playerAlbumArtist',
  'playerTrackMenu',
  'playerMiscIcons',
  'playerDuration',
  'playerWaveform'
])

const personalizationTokenIds = new Set([
  'color.primary.500',
  'surface.app',
  'surface.card',
  'surface.cardBorder',
  'material.glassShadow',
  'shape.globalRadius',
  'material.surfaceOpacity',
  'layout.uiScale',
  'background.gradientStart',
  'background.gradientEnd',
  'background.gradientAngle',
  'background.coverBlur',
  'background.overlayOpacity'
])

const typographyTokenIds = new Set([
  'typography.bodySize',
  'typography.titleWeight',
  'typography.chromeText'
])

const unifiedSurfaceTokenIds = new Set([
  'shape.dialogRadius',
  'shape.searchRadius',
  'shape.toastRadius',
  'shape.trackTitleRadius',
  'material.trackTitleOpacity'
])
const tokenDefinitionById = new Map(
  THEME_TOKEN_DEFINITIONS.map((definition) => [definition.id, definition])
)

function domainForToken(definition: ThemeTokenDefinition): ThemeStudioDomain {
  if (personalizationTokenIds.has(definition.id)) return 'personalization'
  if (
    definition.id.startsWith('shell.') ||
    definition.id.startsWith('settings.') ||
    ['surface.settings', 'surface.local', 'surface.streaming'].includes(definition.id) ||
    unifiedSurfaceTokenIds.has(definition.id)
  ) {
    return 'shell'
  }
  if (definition.id.startsWith('navigation.')) return 'navigation'
  if (definition.id.startsWith('library.')) return 'library'
  if (typographyTokenIds.has(definition.id) || definition.id.startsWith('typography.')) {
    return 'typography'
  }
  if (definition.group === 'playback') return 'player'
  if (definition.group === 'motion') return 'motion'
  return 'advanced'
}

function domainForModeId(modeId: string): ThemeStudioDomain {
  const root = modeId.split('.')[0]
  if (root === 'appearance') return 'personalization'
  if (root === 'navigation' || root === 'icons') return 'navigation'
  if (root === 'library') return 'library'
  if (root === 'typography') return 'typography'
  if (root === 'player' || root === 'artwork' || root === 'equalizer') return 'player'
  return 'advanced'
}

type StudioSearchHit = {
  domain: ThemeStudioDomain
  kind: 'token' | 'mode' | 'section'
  id: string
  title: string
  terms: string
}

const STUDIO_SEARCH_INDEX: readonly StudioSearchHit[] = Object.freeze([
  ...domains.map((item) => ({
    domain: item.id,
    kind: 'section' as const,
    id: item.id,
    title: item.label,
    terms: `${item.id} ${item.label}`
  })),
  ...THEME_TOKEN_DEFINITIONS.map((definition) => ({
    domain: domainForToken(definition),
    kind: 'token' as const,
    id: definition.id,
    title: definition.label,
    terms: `${definition.id} ${definition.surface} ${definition.group} ${definition.cssVariable}`
  })),
  ...THEME_MODE_DEFINITIONS.map((definition) => ({
    domain: domainForModeId(definition.id),
    kind: 'mode' as const,
    id: definition.id,
    title: definition.label,
    terms: `${definition.id} ${definition.options.join(' ')}`
  })),
  {
    domain: 'player',
    kind: 'section',
    id: 'visibility',
    title: '可见性',
    terms: 'visibility 可见性 隐藏 显示'
  },
  {
    domain: 'personalization',
    kind: 'section',
    id: 'palettes',
    title: '精选色板',
    terms: 'palette 色板 强调色 背景色'
  }
])

const definitions = computed(() => {
  if (domain.value === 'presets' || domain.value === 'windows') return []
  if (domain.value === 'personalization') {
    return THEME_TOKEN_DEFINITIONS.filter((definition) =>
      personalizationTokenIds.has(definition.id)
    )
  }
  if (domain.value === 'shell') {
    return THEME_TOKEN_DEFINITIONS.filter(
      (definition) =>
        definition.id.startsWith('shell.') ||
        definition.id.startsWith('settings.') ||
        ['surface.settings', 'surface.local', 'surface.streaming'].includes(definition.id) ||
        unifiedSurfaceTokenIds.has(definition.id)
    )
  }
  if (domain.value === 'navigation') {
    return THEME_TOKEN_DEFINITIONS.filter((definition) => definition.id.startsWith('navigation.'))
  }
  if (domain.value === 'library') {
    return THEME_TOKEN_DEFINITIONS.filter((definition) => definition.id.startsWith('library.'))
  }
  if (domain.value === 'typography') {
    return THEME_TOKEN_DEFINITIONS.filter((definition) => typographyTokenIds.has(definition.id))
  }
  if (domain.value === 'player') {
    return THEME_TOKEN_DEFINITIONS.filter((definition) => definition.group === 'playback')
  }
  if (domain.value === 'motion') {
    return THEME_TOKEN_DEFINITIONS.filter((definition) => definition.group === 'motion')
  }
  return [...THEME_TOKEN_DEFINITIONS]
})

const visibleDefinitions = computed(() => {
  const query = studioSearchQuery.value.trim().toLowerCase()
  if (!query) return definitions.value
  return definitions.value.filter((definition) =>
    `${definition.label} ${definition.id} ${definition.surface} ${definition.group}`
      .toLowerCase()
      .includes(query)
  )
})

const filteredStudioHits = computed(() => {
  const query = studioSearchQuery.value.trim().toLowerCase()
  if (!query) return [] as StudioSearchHit[]
  return STUDIO_SEARCH_INDEX.filter((hit) =>
    `${hit.title} ${hit.terms}`.toLowerCase().includes(query)
  ).slice(0, 40)
})

function jumpToSearchHit(hit: StudioSearchHit): void {
  domain.value = hit.domain
  if (hit.kind === 'section' && hit.id !== 'visibility' && hit.id !== 'palettes') {
    studioSearchQuery.value = ''
  }
}

const activeDomain = computed(() => domains.find((item) => item.id === domain.value) ?? domains[0])
const previewNavigationOpen = computed(
  () => previewSurface.value === 'dashboard' && domain.value === 'navigation'
)
const profiles = computed(() => themeStore.profiles.value)
const activeKey = computed(() => selectionKey(themeStore.activeTheme.value))
const selectedBuiltInPreset = computed(() => {
  if (!selectedKey.value.startsWith('preset:')) return null
  return getBuiltInThemePreset(selectedKey.value.slice('preset:'.length))
})
const persistedHistory = computed(() =>
  draft.value ? (themeStore.snapshot.value?.data.profileHistory[draft.value.id] ?? []) : []
)
const isUnsavedDraft = computed(
  () => draft.value != null && !profiles.value.some((profile) => profile.id === draft.value?.id)
)
const isDirty = computed(() =>
  draft.value ? JSON.stringify(draft.value) !== savedDraft.value : false
)
const canUndo = computed(() => historyIndex.value > 0)
const canRedo = computed(
  () => historyIndex.value >= 0 && historyIndex.value < history.value.length - 1
)
const selectedPluginTheme = computed(() =>
  themeContributions.value.find(
    (theme) => `plugin:${getPluginThemeKey(theme)}` === selectedKey.value
  )
)
const imageAssets = computed(
  () => draft.value?.assets?.filter((asset) => asset.type === 'image') ?? []
)
const fontAssets = computed(
  () => draft.value?.assets?.filter((asset) => asset.type === 'font') ?? []
)
const activeModes = computed(() =>
  resolveThemeProfileModes(draft.value ?? selectedBuiltInPreset.value)
)
const resolvedWindowDefaults = computed<Required<ThemeWindowDefaults>>(() => {
  const resolved = resolveThemeProfileWindowDefaults(draft.value ?? selectedBuiltInPreset.value)
  return {
    miniPlayer: {
      ...(TWILIGHT_DEFAULT_THEME.windowDefaults?.miniPlayer ?? {}),
      ...(resolved.miniPlayer ?? {})
    },
    desktopLyrics: {
      ...(TWILIGHT_DEFAULT_THEME.windowDefaults?.desktopLyrics ?? {}),
      ...(resolved.desktopLyrics ?? {})
    }
  }
})
const accentPalette = computed(() => THEME_ACCENT_PALETTES[tone.value])
const backgroundPalette = computed(() => THEME_BACKGROUND_PALETTES[tone.value])
const contrastWarnings = computed(() => {
  if (activeModes.value.appearance?.contrastGuard === 'off') return []
  const appBackground = valueForId('surface.app')
  const pairs = [
    {
      label: '主要文字 / 应用背景',
      foreground: valueForId('color.neutral.900'),
      background: appBackground,
      minimum: 4.5
    },
    {
      label: '设置文字 / 设置表面',
      foreground: valueForId('settings.text.primary'),
      background: valueForId('surface.settings'),
      minimum: 4.5
    },
    {
      label: '导航文字 / 导航表面',
      foreground: valueForId('navigation.text'),
      background: valueForId('navigation.surface'),
      minimum: 4.5
    },
    {
      label: '大标题 / 应用背景',
      foreground: valueForId('typography.chromeText'),
      background: appBackground,
      minimum: 3
    }
  ]
  return pairs.flatMap((pair) => {
    const ratio = themeContrastRatio(pair.foreground, pair.background, appBackground)
    return ratio != null && ratio < pair.minimum ? [{ ...pair, ratio }] : []
  })
})

const backgroundBindings: Array<{ key: keyof ThemeAssetBindings; label: string }> = [
  { key: 'appBackground', label: '全局背景' },
  { key: 'localBackground', label: '本地音乐背景' },
  { key: 'settingsBackground', label: '设置背景' },
  { key: 'streamingBackground', label: '流媒体背景' },
  { key: 'playerBackground', label: '播放页背景' }
]

const fontBindings: Array<{
  key: keyof ThemeAssetBindings
  tokenId: 'typography.sans' | 'typography.display' | 'typography.rounded'
  label: string
}> = [
  { key: 'sansFont', tokenId: 'typography.sans', label: '正文字体' },
  { key: 'displayFont', tokenId: 'typography.display', label: '标题字体' },
  { key: 'roundedFont', tokenId: 'typography.rounded', label: '歌词字体' }
]
const personalizationBackgroundBindings = backgroundBindings.slice(0, 1)

function cloneProfile(profile: ThemeProfileV2): ThemeProfileV2 {
  return JSON.parse(JSON.stringify(profile)) as ThemeProfileV2
}

function selectionKey(selection: ThemeSelection): string {
  if (selection.kind === 'builtin') return `preset:${selection.id}`
  if (selection.kind === 'user') return `profile:${selection.id}`
  return `plugin:${selection.pluginId}:${selection.themeId}`
}

function resetHistory(profile: ThemeProfileV2): void {
  const clone = cloneProfile(profile)
  history.value = [clone]
  historyIndex.value = 0
  savedDraft.value = JSON.stringify(clone)
}

function pushHistory(profile: ThemeProfileV2): void {
  history.value = history.value.slice(0, historyIndex.value + 1)
  history.value.push(cloneProfile(profile))
  if (history.value.length > 50) history.value.shift()
  historyIndex.value = history.value.length - 1
}

async function selectBuiltIn(
  presetId: BuiltInThemePresetId = TWILIGHT_DEFAULT_THEME_ID
): Promise<void> {
  previewScheduler.cancel()
  selectedKey.value = `preset:${presetId}`
  draft.value = null
  history.value = []
  historyIndex.value = -1
  await themeStore.previewTheme({ kind: 'builtin', id: presetId })
}

async function selectProfile(profile: ThemeProfileV2): Promise<void> {
  previewScheduler.cancel()
  selectedKey.value = `profile:${profile.id}`
  draft.value = cloneProfile(profile)
  resetHistory(draft.value)
  await themeStore.preview(draft.value)
}

async function selectPlugin(theme: ThemeContribution): Promise<void> {
  previewScheduler.cancel()
  selectedKey.value = `plugin:${getPluginThemeKey(theme)}`
  draft.value = null
  history.value = []
  historyIndex.value = -1
  await themeStore.previewTheme({ kind: 'plugin', pluginId: theme.pluginId, themeId: theme.id })
}

async function selectThemeKey(event: Event): Promise<void> {
  const key = (event.target as HTMLSelectElement).value
  if (key.startsWith('preset:')) {
    const presetId = key.slice('preset:'.length)
    if (getBuiltInThemePreset(presetId)) await selectBuiltIn(presetId as BuiltInThemePresetId)
    return
  }
  if (key.startsWith('profile:')) {
    const profile = profiles.value.find((entry) => `profile:${entry.id}` === key)
    if (profile) await selectProfile(profile)
    return
  }
  if (key.startsWith('plugin:')) {
    const theme = themeContributions.value.find(
      (entry) => `plugin:${getPluginThemeKey(entry)}` === key
    )
    if (theme) await selectPlugin(theme)
  }
}

function createProfileFromPlugin(theme: ThemeContribution): ThemeProfileV2 {
  const profile = themeStore.createProfile(`${theme.name} 副本`)
  for (const currentTone of ['pureWhite', 'dark'] as const) {
    const structured = theme.structured?.variants[currentTone]?.tokens
    if (structured) profile.overrides[currentTone] = normalizeThemeTokenOverrides(structured)
  }
  const byVariable = new Map(
    THEME_TOKEN_DEFINITIONS.map((definition) => [definition.cssVariable, definition.id])
  )
  for (const [variable, value] of Object.entries(theme.variables ?? {})) {
    const id = byVariable.get(variable as `--te-${string}`)
    if (!id) continue
    const normalized = normalizeThemeTokenValue(id, value)
    if (!normalized) continue
    profile.overrides.pureWhite[id] = normalized
    profile.overrides.dark[id] = normalized
  }
  if (theme.structured?.schemaVersion === 2) {
    profile.modes = normalizeThemeModes(theme.structured.modes)
  }
  return profile
}

async function duplicateSelected(): Promise<void> {
  previewScheduler.cancel()
  const sourceProfileId = draft.value?.id
  const source = draft.value
    ? cloneProfile(draft.value)
    : selectedBuiltInPreset.value
      ? selectedBuiltInPreset.value
      : selectedPluginTheme.value
        ? createProfileFromPlugin(selectedPluginTheme.value)
        : null
  const profile = themeStore.createProfile(source ? `${source.name} 自定义` : '自定义主题', source)
  selectedKey.value = `profile:${profile.id}`
  draft.value = profile
  resetHistory(profile)
  savedDraft.value = ''
  if (sourceProfileId && source?.assets?.length) {
    try {
      await themeStore.copyAssets(sourceProfileId, profile.id)
    } catch (cause) {
      localError.value = cause instanceof Error ? cause.message : '主题资源复制失败'
      return
    }
  }
  await themeStore.preview(profile)
}

async function derivePreset(preset: ThemeProfileV2): Promise<void> {
  await selectBuiltIn(preset.id as BuiltInThemePresetId)
  await duplicateSelected()
}

async function importAsset(type: ThemeAssetType): Promise<void> {
  if (!draft.value) return
  try {
    const asset = await themeStore.importAsset(draft.value.id, type)
    if (!asset) return
    updateDraft((profile) => {
      const assets = profile.assets ?? []
      profile.assets = [...assets.filter((entry) => entry.id !== asset.id), asset]
    })
  } catch (cause) {
    localError.value = cause instanceof Error ? cause.message : '主题资源导入失败'
  }
}

function updateAssetBinding(key: keyof ThemeAssetBindings, event: Event): void {
  const assetId = (event.target as HTMLSelectElement).value
  updateDraft((profile) => {
    const bindings = { ...(profile.assetBindings ?? {}) }
    if (assetId) bindings[key] = assetId
    else delete bindings[key]
    profile.assetBindings = Object.keys(bindings).length > 0 ? bindings : undefined
    if (key === 'appBackground' && assetId) {
      profile.modes.appearance = {
        ...(profile.modes.appearance ?? {}),
        backgroundTreatment: 'image'
      }
    }
  })
}

type ThemeMiniPlayerDefaultKey = keyof NonNullable<ThemeWindowDefaults['miniPlayer']>
type ThemeDesktopLyricsDefaultKey = keyof NonNullable<ThemeWindowDefaults['desktopLyrics']>

function windowDefaultValue(
  section: 'miniPlayer' | 'desktopLyrics',
  key: ThemeMiniPlayerDefaultKey | ThemeDesktopLyricsDefaultKey
): string | number | boolean | undefined {
  return (resolvedWindowDefaults.value[section] as Record<string, string | number | boolean>)[key]
}

function updateWindowDefault(
  section: 'miniPlayer' | 'desktopLyrics',
  key: ThemeMiniPlayerDefaultKey | ThemeDesktopLyricsDefaultKey,
  value: string | number | boolean
): void {
  updateDraft((profile) => {
    const windowDefaults = { ...(profile.windowDefaults ?? {}) }
    const sectionDefaults = {
      ...(windowDefaults[section] ?? {}),
      [key]: value
    }
    profile.windowDefaults = {
      ...windowDefaults,
      [section]: sectionDefaults
    } as ThemeWindowDefaults
  })
}

function updateWindowText(
  section: 'miniPlayer' | 'desktopLyrics',
  key: ThemeMiniPlayerDefaultKey | ThemeDesktopLyricsDefaultKey,
  event: Event
): void {
  updateWindowDefault(section, key, (event.target as HTMLInputElement).value)
}

function updateWindowNumber(
  section: 'miniPlayer' | 'desktopLyrics',
  key: ThemeMiniPlayerDefaultKey | ThemeDesktopLyricsDefaultKey,
  event: Event
): void {
  updateWindowDefault(section, key, Number((event.target as HTMLInputElement).value))
}

function updateWindowBoolean(
  section: 'miniPlayer' | 'desktopLyrics',
  key: ThemeDesktopLyricsDefaultKey,
  event: Event
): void {
  updateWindowDefault(section, key, (event.target as HTMLInputElement).checked)
}

function valueFor(definition: ThemeTokenDefinition): string {
  if (draft.value) {
    return (
      resolveThemeProfileTokens(draft.value, tone.value)[definition.id] ??
      definition.defaults[tone.value]
    )
  }
  if (selectedBuiltInPreset.value) {
    return (
      resolveThemeProfileTokens(selectedBuiltInPreset.value, tone.value)[definition.id] ??
      definition.defaults[tone.value]
    )
  }
  return (
    TWILIGHT_DEFAULT_THEME.variants[tone.value].tokens[definition.id] ??
    definition.defaults[tone.value]
  )
}

function valueForId(id: string): string {
  const definition = tokenDefinitionById.get(id)
  return definition ? valueFor(definition) : ''
}

function sourceFor(definition: ThemeTokenDefinition): string {
  if (draft.value?.overrides[tone.value][definition.id] != null) return '当前配置档'
  const sourcePreset = getBuiltInThemePreset(draft.value?.baseThemeId)
  if (sourcePreset?.overrides[tone.value][definition.id] != null) return '来源预设'
  const plugin = selectedPluginTheme.value
  if (
    plugin?.structured?.variants[tone.value]?.tokens?.[definition.id] != null ||
    plugin?.variables?.[definition.cssVariable] != null
  ) {
    return '主题包'
  }
  return '内置默认'
}

function assetSource(key: keyof ThemeAssetBindings): string {
  return draft.value?.assetBindings?.[key] ? '当前配置档' : '内置默认'
}

function updateDraft(mutator: (profile: ThemeProfileV2) => void): void {
  if (!draft.value) return
  const next = cloneProfile(draft.value)
  mutator(next)
  next.updatedAt = new Date().toISOString()
  draft.value = next
  pushHistory(next)
  previewScheduler.schedule(next)
}

function updateToken(definition: ThemeTokenDefinition, raw: string): void {
  const normalized = normalizeThemeTokenValue(definition.id, raw)
  if (!normalized) {
    localError.value = `${definition.label}的值无效`
    return
  }
  localError.value = ''
  updateDraft((profile) => {
    if (definition.id === 'color.primary.500') {
      Object.assign(
        profile.overrides[tone.value],
        createThemeAccentTokenOverrides(normalized, tone.value, valueForId('surface.app'))
      )
    } else {
      profile.overrides[tone.value][definition.id] = normalized
    }
  })
}

function applyAccentPalette(value: string): void {
  updateDraft((profile) => {
    Object.assign(
      profile.overrides[tone.value],
      createThemeAccentTokenOverrides(value, tone.value, valueForId('surface.app'))
    )
  })
}

function applyBackgroundPalette(value: string): void {
  updateDraft((profile) => {
    for (const id of [
      'surface.app',
      'surface.local',
      'surface.settings',
      'surface.streaming',
      'surface.player'
    ]) {
      profile.overrides[tone.value][id] = value
    }
  })
}

function updateAppearanceMode(
  key:
    | 'accentSource'
    | 'backgroundTreatment'
    | 'toneScheduling'
    | 'contrastGuard'
    | 'effectsMode',
  event: Event
): void {
  const value = (event.target as HTMLSelectElement).value
  updateDraft((profile) => {
    const appearance = { ...(profile.modes.appearance ?? {}) }
    if (key === 'accentSource' && (value === 'fixed' || value === 'cover')) {
      appearance.accentSource = value
    } else if (
      key === 'backgroundTreatment' &&
      ['solid', 'gradient', 'cover-blur', 'image'].includes(value)
    ) {
      appearance.backgroundTreatment = value as NonNullable<
        ThemeModes['appearance']
      >['backgroundTreatment']
    } else if (key === 'toneScheduling' && ['manual', 'system', 'timed'].includes(value)) {
      appearance.toneScheduling = value as NonNullable<ThemeModes['appearance']>['toneScheduling']
      if (value === 'timed' && !profile.toneSchedule) {
        profile.toneSchedule = { ...DEFAULT_THEME_TONE_SCHEDULE }
      }
    } else if (key === 'contrastGuard' && ['off', 'warn', 'enforce'].includes(value)) {
      appearance.contrastGuard = value as NonNullable<ThemeModes['appearance']>['contrastGuard']
    } else if (key === 'effectsMode' && (value === 'full' || value === 'reduced')) {
      appearance.effectsMode = value
    }
    profile.modes.appearance = appearance
  })
}

function updateTypographyMode(key: 'titleCase' | 'lyricAccent' | 'titleColor', event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  updateDraft((profile) => {
    const typography = { ...(profile.modes.typography ?? {}) }
    if (key === 'titleCase' && (value === 'preserve' || value === 'uppercase')) {
      typography.titleCase = value
    } else if (key === 'lyricAccent' && (value === 'off' || value === 'accent')) {
      typography.lyricAccent = value
    } else if (key === 'titleColor' && ['off', 'track', 'artist-album'].includes(value)) {
      typography.titleColor = value as NonNullable<ThemeModes['typography']>['titleColor']
    }
    profile.modes.typography = typography
  })
}

function updateNavigationMode(key: 'style' | 'iconScale' | 'logo', event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  updateDraft((profile) => {
    const navigation = { ...(profile.modes.navigation ?? {}) }
    if (key === 'style' && ['expanded', 'compact', 'rail'].includes(value)) {
      navigation.style = value as NonNullable<ThemeModes['navigation']>['style']
    } else if (key === 'iconScale' && ['sm', 'md', 'lg'].includes(value)) {
      navigation.iconScale = value as NonNullable<ThemeModes['navigation']>['iconScale']
    } else if (key === 'logo' && (value === 'show' || value === 'hide')) {
      navigation.logo = value
    }
    profile.modes.navigation = navigation
  })
}

function updateLibraryMode(key: 'density' | 'selection' | 'titleOverlay', event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  updateDraft((profile) => {
    const library = { ...(profile.modes.library ?? {}) }
    if (key === 'density' && (value === 'comfortable' || value === 'compact')) {
      library.density = value
    } else if (key === 'selection' && (value === 'fill' || value === 'stroke')) {
      library.selection = value
    } else if (key === 'titleOverlay' && (value === 'off' || value === 'on')) {
      library.titleOverlay = value
    }
    profile.modes.library = library
  })
}

function updatePlayerMode(key: 'controls' | 'titleAlign' | 'progress', event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  updateDraft((profile) => {
    const player = { ...(profile.modes.player ?? {}) }
    if (key === 'controls' && (value === 'standard' || value === 'pro')) {
      player.controls = value
    } else if (key === 'titleAlign' && (value === 'left' || value === 'center')) {
      player.titleAlign = value
    } else if (key === 'progress' && ['line', 'ring', 'solid', 'spectrum'].includes(value)) {
      player.progress = value as NonNullable<ThemeModes['player']>['progress']
    }
    profile.modes.player = player
  })
}

function setPlayerLayout(layout: ThemePlayerLayout): void {
  updateDraft((profile) => {
    profile.modes.player = { ...(profile.modes.player ?? {}), layout }
  })
}

function updateArtworkMode(key: 'transition' | 'shadow', event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  updateDraft((profile) => {
    const artwork = { ...(profile.modes.artwork ?? {}) }
    if (key === 'transition' && ['fade', 'slide', 'none'].includes(value)) {
      artwork.transition = value as NonNullable<ThemeModes['artwork']>['transition']
    } else if (key === 'shadow' && (value === 'on' || value === 'off')) {
      artwork.shadow = value
    }
    profile.modes.artwork = artwork
  })
}

function updateEqualizerMode(
  key: 'panel' | 'slider' | 'knob' | 'spectrum' | 'button',
  event: Event
): void {
  const value = (event.target as HTMLSelectElement).value
  updateDraft((profile) => {
    const equalizer = { ...(profile.modes.equalizer ?? {}) }
    if (key === 'panel' && ['neutral', 'tinted', 'glass'].includes(value)) {
      equalizer.panel = value as NonNullable<ThemeModes['equalizer']>['panel']
    } else if (key === 'slider' && (value === 'ring' || value === 'solid')) {
      equalizer.slider = value
    } else if (key === 'knob' && (value === 'line' || value === 'dot')) {
      equalizer.knob = value
    } else if (key === 'spectrum' && ['bars', 'line', 'area'].includes(value)) {
      equalizer.spectrum = value as NonNullable<ThemeModes['equalizer']>['spectrum']
    } else if (key === 'button' && ['soft', 'outline', 'solid'].includes(value)) {
      equalizer.button = value as NonNullable<ThemeModes['equalizer']>['button']
    }
    profile.modes.equalizer = equalizer
  })
}

function visibilityValue(id: ThemeVisibilitySlotId): boolean {
  const explicit = activeModes.value.visibility?.[id]
  if (typeof explicit === 'boolean') return explicit
  return activeModes.value.player?.layout !== 'minimal' || !minimalHiddenSlots.has(id)
}

function updateVisibility(id: ThemeVisibilitySlotId, event: Event): void {
  const visible = (event.target as HTMLInputElement).checked
  updateDraft((profile) => {
    profile.modes.visibility = { ...(profile.modes.visibility ?? {}), [id]: visible }
  })
}

function updateIconFamily(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (!['outline', 'rounded', 'filled'].includes(value)) return
  updateDraft((profile) => {
    profile.modes.icons = {
      ...(profile.modes.icons ?? {}),
      family: value as NonNullable<ThemeModes['icons']>['family']
    }
  })
}

function scheduleTime(key: 'lightStartMinutes' | 'darkStartMinutes'): string {
  const minutes = draft.value?.toneSchedule?.[key] ?? DEFAULT_THEME_TONE_SCHEDULE[key]
  return `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`
}

function updateScheduleTime(key: 'lightStartMinutes' | 'darkStartMinutes', event: Event): void {
  const match = (event.target as HTMLInputElement).value.match(/^(\d{2}):(\d{2})$/)
  if (!match) return
  const minutes = Number(match[1]) * 60 + Number(match[2])
  updateDraft((profile) => {
    const next = { ...(profile.toneSchedule ?? DEFAULT_THEME_TONE_SCHEDULE), [key]: minutes }
    if (next.lightStartMinutes !== next.darkStartMinutes) profile.toneSchedule = next
  })
}

function fontSelection(binding: (typeof fontBindings)[number]): string {
  const assetId = draft.value?.assetBindings?.[binding.key]
  if (assetId) return `asset:${assetId}`
  const value = valueForId(binding.tokenId)
  const builtIn = BUILT_IN_THEME_FONTS.find((font) => font.value === value)
  return builtIn ? `builtin:${builtIn.id}` : 'custom'
}

function fontSource(binding: (typeof fontBindings)[number]): string {
  if (draft.value?.assetBindings?.[binding.key]) return '当前配置档 · 本地资源'
  if (draft.value?.overrides[tone.value][binding.tokenId]) return '当前配置档 · 内置字体'
  return '内置默认'
}

function updateFontSlot(binding: (typeof fontBindings)[number], event: Event): void {
  const selection = (event.target as HTMLSelectElement).value
  if (selection === 'custom') return
  updateDraft((profile) => {
    const bindings = { ...(profile.assetBindings ?? {}) }
    if (selection.startsWith('asset:')) {
      bindings[binding.key] = selection.slice('asset:'.length)
    } else {
      delete bindings[binding.key]
      const font = BUILT_IN_THEME_FONTS.find((entry) => `builtin:${entry.id}` === selection)
      if (font) profile.overrides[tone.value][binding.tokenId] = font.value
    }
    profile.assetBindings = Object.keys(bindings).length > 0 ? bindings : undefined
  })
}

function updateRange(definition: ThemeTokenDefinition, event: Event): void {
  const value = (event.target as HTMLInputElement).value
  updateToken(definition, `${value}${definition.unit ?? ''}`)
}

function removeOverride(definition: ThemeTokenDefinition): void {
  updateDraft((profile) => {
    if (definition.id === 'color.primary.500') {
      for (const id of [
        'color.primary.500',
        'color.primary.400',
        'color.primary.300',
        'color.primary.rgb',
        'material.glowMain',
        'surface.active',
        'navigation.activeText',
        'navigation.indicator',
        'playback.accent'
      ]) {
        delete profile.overrides[tone.value][id]
      }
    } else {
      delete profile.overrides[tone.value][definition.id]
    }
  })
}

function resetGroup(): void {
  updateDraft((profile) => {
    for (const definition of definitions.value) delete profile.overrides[tone.value][definition.id]
    if (domain.value === 'personalization') {
      profile.modes.appearance = undefined
      profile.toneSchedule = undefined
      for (const id of [
        'color.primary.400',
        'color.primary.300',
        'color.primary.rgb',
        'material.glowMain',
        'surface.active',
        'navigation.activeText',
        'navigation.indicator',
        'playback.accent'
      ]) {
        delete profile.overrides[tone.value][id]
      }
    }
    if (domain.value === 'typography') profile.modes.typography = undefined
    if (domain.value === 'navigation') {
      profile.modes.navigation = undefined
      profile.modes.icons = undefined
    }
    if (domain.value === 'library') profile.modes.library = undefined
    if (domain.value === 'player') {
      profile.modes.player = undefined
      profile.modes.artwork = undefined
      profile.modes.equalizer = undefined
      profile.modes.visibility = undefined
    }
    if (domain.value === 'windows') profile.windowDefaults = undefined
    if (
      profile.assetBindings &&
      (domain.value === 'personalization' || domain.value === 'typography')
    ) {
      if (domain.value === 'personalization') delete profile.assetBindings.appBackground
      if (domain.value === 'typography') {
        delete profile.assetBindings.sansFont
        delete profile.assetBindings.displayFont
        delete profile.assetBindings.roundedFont
      }
      if (Object.keys(profile.assetBindings).length === 0) profile.assetBindings = undefined
    }
  })
}

function resetAll(): void {
  updateDraft((profile) => {
    profile.overrides = { pureWhite: {}, dark: {} }
    profile.modes = {}
    profile.toneSchedule = undefined
    profile.windowDefaults = undefined
    profile.assetBindings = undefined
  })
}

function restoreVersion(entry: ThemeProfileHistoryEntry): void {
  if (!draft.value || entry.profile.id !== draft.value.id) return
  const restored = cloneProfile(entry.profile)
  restored.updatedAt = new Date().toISOString()
  draft.value = restored
  pushHistory(restored)
  previewScheduler.schedule(restored)
}

function historyLabel(entry: ThemeProfileHistoryEntry): string {
  const timestamp = Date.parse(entry.savedAt)
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('zh-CN') : entry.savedAt
}

function presetPreviewStyle(profile: ThemeProfileV2): Record<string, string> {
  const tokens = resolveThemeProfileTokens(profile, tone.value)
  return {
    '--preset-accent': tokens['color.primary.500'],
    '--preset-surface': tokens['surface.app'],
    '--preset-card': tokens['surface.card'],
    '--preset-border': tokens['surface.cardBorder']
  }
}

function undo(): void {
  if (!canUndo.value) return
  historyIndex.value -= 1
  draft.value = cloneProfile(history.value[historyIndex.value])
  previewScheduler.schedule(draft.value)
}

function redo(): void {
  if (!canRedo.value) return
  historyIndex.value += 1
  draft.value = cloneProfile(history.value[historyIndex.value])
  previewScheduler.schedule(draft.value)
}

async function applySelected(): Promise<void> {
  localError.value = ''
  notice.value = ''
  try {
    await previewScheduler.flush()
    if (draft.value) {
      const saved = await themeStore.saveProfile(draft.value)
      const persisted = saved.data.profiles.find((profile) => profile.id === draft.value?.id)
      if (!persisted) throw new Error('保存后的主题档案不可用')
      draft.value = cloneProfile(persisted)
      resetHistory(draft.value)
      await themeStore.setActive({ kind: 'user', id: draft.value.id })
      selectedKey.value = `profile:${draft.value.id}`
    } else if (selectedPluginTheme.value) {
      await themeStore.setActive({
        kind: 'plugin',
        pluginId: selectedPluginTheme.value.pluginId,
        themeId: selectedPluginTheme.value.id
      })
    } else if (selectedBuiltInPreset.value) {
      await themeStore.setActive({
        kind: 'builtin',
        id: selectedBuiltInPreset.value.id as BuiltInThemePresetId
      })
    }
    notice.value = '主题已应用'
  } catch (cause) {
    localError.value = cause instanceof Error ? cause.message : '主题保存失败'
  }
}

async function deleteSelected(): Promise<void> {
  if (!draft.value || !profiles.value.some((profile) => profile.id === draft.value?.id)) return
  if (!window.confirm(`删除主题“${draft.value.name}”？`)) return
  try {
    await themeStore.deleteProfile(draft.value.id)
    await selectBuiltIn()
  } catch (cause) {
    localError.value = cause instanceof Error ? cause.message : '主题删除失败'
  }
}

async function importTheme(): Promise<void> {
  try {
    const next = await themeStore.importTheme()
    const imported = next?.data.profiles.at(-1)
    if (imported) await selectProfile(imported)
  } catch (cause) {
    localError.value = cause instanceof Error ? cause.message : '主题导入失败'
  }
}

async function exportTheme(): Promise<void> {
  if (!draft.value || !profiles.value.some((profile) => profile.id === draft.value?.id)) return
  try {
    const output = await themeStore.exportTheme(draft.value.id)
    if (output) notice.value = '主题已导出'
  } catch (cause) {
    localError.value = cause instanceof Error ? cause.message : '主题导出失败'
  }
}

async function toggleWindowInheritance(key: 'miniPlayer' | 'desktopLyrics'): Promise<void> {
  const current = themeStore.snapshot.value?.data.windowInheritance
  if (!current) return
  try {
    await themeStore.setWindowInheritance({ ...current, [key]: !current[key] })
  } catch (cause) {
    localError.value = cause instanceof Error ? cause.message : '窗口主题继承设置失败'
  }
}

function changeName(event: Event): void {
  const name = (event.target as HTMLInputElement).value.trim().slice(0, 80)
  if (!name) return
  updateDraft((profile) => {
    profile.name = name
  })
}

function rangeNumber(definition: ThemeTokenDefinition): number {
  return Number.parseFloat(valueFor(definition))
}

function supportsColorPicker(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value)
}

async function setTone(nextTone: ThemeTone): Promise<void> {
  await previewScheduler.flush()
  tone.value = nextTone
  await themeStore.setPreviewTone(nextTone)
}

function closeStudio(): void {
  if (isDirty.value && !window.confirm('放弃尚未应用的主题修改？')) return
  previewScheduler.cancel()
  document.documentElement.dataset.theme = originalTone
  void themeStore.setPreviewTone(null).then(() => themeStore.previewTheme(null))
  emit('back')
}

function updateLivePreviewScale(): void {
  const viewport = previewViewportRef.value
  if (!viewport) return
  const sourceWidth = Math.max(1, document.documentElement.clientWidth)
  const sourceHeight = Math.max(1, document.documentElement.clientHeight)
  previewViewportStyle.value = { aspectRatio: `${sourceWidth} / ${sourceHeight}` }
  const scale = Math.min(
    viewport.clientWidth / sourceWidth,
    viewport.clientHeight / sourceHeight,
    1
  )
  const left = Math.max(0, (viewport.clientWidth - sourceWidth * scale) / 2)
  const top = Math.max(0, (viewport.clientHeight - sourceHeight * scale) / 2)
  previewCanvasStyle.value = {
    width: `${sourceWidth}px`,
    height: `${sourceHeight}px`,
    transform: `translate3d(${left}px, ${top}px, 0) scale(${scale})`
  }
}

onMounted(async () => {
  previewResizeObserver = new ResizeObserver(updateLivePreviewScale)
  if (previewViewportRef.value) previewResizeObserver.observe(previewViewportRef.value)
  window.addEventListener('resize', updateLivePreviewScale)
  window.requestAnimationFrame(updateLivePreviewScale)
  await Promise.all([themeStore.load(), syncExtensions()])
  originalTone = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'pureWhite'
  tone.value = originalTone
  await themeStore.setPreviewTone(originalTone)
  if (domain.value === 'player' || domain.value === 'typography') previewSurface.value = 'player'
  const active = themeStore.activeTheme.value
  if (active.kind === 'user') {
    const profile = profiles.value.find((entry) => entry.id === active.id)
    if (profile) await selectProfile(profile)
  } else if (active.kind === 'plugin') {
    const theme = themeContributions.value.find(
      (entry) => entry.pluginId === active.pluginId && entry.id === active.themeId
    )
    if (theme) await selectPlugin(theme)
  } else {
    await selectBuiltIn(active.id)
  }
})

onBeforeUnmount(() => {
  previewScheduler.cancel()
  window.removeEventListener('resize', updateLivePreviewScale)
  previewResizeObserver?.disconnect()
  previewResizeObserver = null
  document.documentElement.dataset.theme = originalTone
  void themeStore.setPreviewTone(null).then(() => themeStore.previewTheme(null))
})
</script>

<template>
  <div class="theme-studio-page" data-te-surface="theme-studio">
    <header class="theme-studio-header">
      <button
        type="button"
        class="studio-icon-button"
        title="返回"
        aria-label="返回"
        @click="closeStudio"
      >
        <i class="ph ph-arrow-left"></i>
      </button>
      <div>
        <h1>主题工作室</h1>
        <span>{{ isDirty ? '有未应用的修改' : '所有修改已同步' }}</span>
      </div>
      <label class="theme-profile-picker">
        <span>配置档</span>
        <select :value="selectedKey" aria-label="当前主题配置档" @change="selectThemeKey">
          <optgroup label="内置预设">
            <option
              v-for="preset in BUILT_IN_THEME_PRESETS"
              :key="preset.id"
              :value="`preset:${preset.id}`"
            >
              {{ preset.name }}{{ activeKey === `preset:${preset.id}` ? ' · 已应用' : '' }}
            </option>
          </optgroup>
          <option v-if="draft && isUnsavedDraft" :value="`profile:${draft.id}`">
            {{ draft.name }} · 未保存
          </option>
          <optgroup v-if="profiles.length" label="个人主题">
            <option v-for="profile in profiles" :key="profile.id" :value="`profile:${profile.id}`">
              {{ profile.name }}{{ activeKey === `profile:${profile.id}` ? ' · 已应用' : '' }}
            </option>
          </optgroup>
          <optgroup v-if="themeContributions.length" label="插件主题">
            <option
              v-for="theme in themeContributions"
              :key="getPluginThemeKey(theme)"
              :value="`plugin:${getPluginThemeKey(theme)}`"
            >
              {{ theme.name
              }}{{ activeKey === `plugin:${getPluginThemeKey(theme)}` ? ' · 已应用' : '' }}
            </option>
          </optgroup>
        </select>
      </label>
      <div class="theme-studio-actions">
        <div class="studio-segment" aria-label="主题变体">
          <button
            type="button"
            title="浅色变体"
            aria-label="浅色变体"
            :class="{ active: tone === 'pureWhite' }"
            @click="setTone('pureWhite')"
          >
            <i class="ph ph-sun"></i>
          </button>
          <button
            type="button"
            title="深色变体"
            aria-label="深色变体"
            :class="{ active: tone === 'dark' }"
            @click="setTone('dark')"
          >
            <i class="ph ph-moon"></i>
          </button>
        </div>
        <button
          type="button"
          class="studio-icon-button"
          title="恢复当前视觉域"
          aria-label="恢复当前视觉域"
          :disabled="!draft || domain === 'presets'"
          @click="resetGroup"
        >
          <i class="ph ph-arrow-u-up-left"></i>
        </button>
        <button
          type="button"
          class="studio-icon-button"
          title="恢复完整默认值"
          aria-label="恢复完整默认值"
          :disabled="!draft"
          @click="resetAll"
        >
          <i class="ph ph-broom"></i>
        </button>
        <button
          type="button"
          class="studio-icon-button"
          title="撤销"
          aria-label="撤销"
          :disabled="!canUndo"
          @click="undo"
        >
          <i class="ph ph-arrow-counter-clockwise"></i>
        </button>
        <button
          type="button"
          class="studio-icon-button"
          title="重做"
          aria-label="重做"
          :disabled="!canRedo"
          @click="redo"
        >
          <i class="ph ph-arrow-clockwise"></i>
        </button>
        <button
          type="button"
          class="studio-icon-button"
          title="导入主题"
          aria-label="导入主题"
          @click="importTheme"
        >
          <i class="ph ph-download-simple"></i>
        </button>
        <button
          type="button"
          class="studio-icon-button"
          title="创建副本"
          aria-label="创建副本"
          @click="duplicateSelected"
        >
          <i class="ph ph-copy"></i>
        </button>
        <button
          type="button"
          class="studio-command primary"
          :disabled="themeStore.saving.value"
          @click="applySelected"
        >
          <i :class="themeStore.saving.value ? 'pi pi-spin pi-spinner' : 'ph ph-check'"></i
          ><span>应用</span>
        </button>
      </div>
    </header>

    <div class="theme-studio-workspace">
      <aside class="theme-library-pane" aria-label="视觉域">
        <div class="pane-heading">
          <strong>视觉域</strong>
        </div>
        <label class="studio-search">
          <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
          <input
            v-model="studioSearchQuery"
            type="search"
            placeholder="搜索设置、令牌或模式"
            aria-label="搜索主题设置"
          />
        </label>
        <div v-if="filteredStudioHits.length" class="studio-search-hits" role="listbox">
          <button
            v-for="hit in filteredStudioHits"
            :key="`${hit.kind}:${hit.id}`"
            type="button"
            role="option"
            @click="jumpToSearchHit(hit)"
          >
            <strong>{{ hit.title }}</strong>
            <small>{{ hit.kind }} · {{ hit.domain }}</small>
          </button>
        </div>
        <nav class="theme-domain-list">
          <button
            v-for="item in domains"
            :key="item.id"
            type="button"
            :class="{ active: domain === item.id }"
            @click="domain = item.id"
          >
            <i :class="item.icon"></i><span>{{ item.label }}</span>
          </button>
        </nav>

        <div class="window-inheritance">
          <label>
            <span>迷你播放器</span>
            <input
              type="checkbox"
              :checked="themeStore.snapshot.value?.data.windowInheritance.miniPlayer"
              @change="toggleWindowInheritance('miniPlayer')"
            />
          </label>
          <label>
            <span>桌面歌词</span>
            <input
              type="checkbox"
              :checked="themeStore.snapshot.value?.data.windowInheritance.desktopLyrics"
              @change="toggleWindowInheritance('desktopLyrics')"
            />
          </label>
        </div>
      </aside>

      <main class="theme-preview-pane">
        <div class="preview-toolbar">
          <div>
            <strong>实时应用视图</strong><span>{{ activeDomain.label }}</span>
          </div>
          <div class="studio-segment preview-surface-switcher" aria-label="预览页面">
            <button
              v-for="surface in previewSurfaces"
              :key="surface.id"
              type="button"
              :class="{ active: previewSurface === surface.id }"
              :aria-pressed="previewSurface === surface.id"
              @click="previewSurface = surface.id"
            >
              <i :class="surface.icon"></i><span>{{ surface.label }}</span>
            </button>
          </div>
        </div>

        <section
          ref="previewViewportRef"
          class="theme-preview-stage live-preview-viewport"
          :style="previewViewportStyle"
        >
          <div class="live-preview-canvas" :style="previewCanvasStyle" inert aria-hidden="true">
            <TitleBar
              :menu-open="previewNavigationOpen"
              :glass="previewSurface === 'player'"
              :streaming="false"
              :hide-start="false"
              title-surface="default"
            />
            <SideMenu
              v-if="previewSurface === 'dashboard'"
              :open="previewNavigationOpen"
              active-key="dashboard"
            />
            <div
              v-if="previewSurface === 'dashboard'"
              class="main-content live-preview-app"
              :class="{ 'menu-open': previewNavigationOpen }"
            >
              <LocalDashboard />
            </div>
            <PlayingMusic v-else-if="previewSurface === 'player'" />
            <EqualizerPage v-else />
            <PlayerBar
              v-if="previewSurface !== 'equalizer'"
              :glass="previewSurface === 'player'"
              :menu-open="previewNavigationOpen"
              preview
            />
          </div>
        </section>
      </main>

      <aside class="theme-editor-pane" aria-label="主题编辑器">
        <div class="pane-heading">
          <strong>{{ activeDomain.label }}</strong>
          <div>
            <button
              type="button"
              class="studio-icon-button"
              title="导出主题"
              aria-label="导出主题"
              :disabled="!draft"
              @click="exportTheme"
            >
              <i class="ph ph-upload-simple"></i>
            </button>
            <button
              type="button"
              class="studio-icon-button danger"
              title="删除主题"
              aria-label="删除主题"
              :disabled="!draft"
              @click="deleteSelected"
            >
              <i class="ph ph-trash"></i>
            </button>
          </div>
        </div>

        <section v-if="domain === 'presets'" class="preset-gallery-section">
          <div class="control-section-heading">
            <span>内置预设</span><small>预览后确认应用</small>
          </div>
          <div class="preset-gallery" aria-label="内置主题预设">
            <article
              v-for="preset in BUILT_IN_THEME_PRESETS"
              :key="preset.id"
              class="preset-gallery-item"
              :class="{
                selected: selectedKey === `preset:${preset.id}`,
                active: activeKey === `preset:${preset.id}`
              }"
            >
              <button
                type="button"
                class="preset-preview-command"
                :aria-pressed="selectedKey === `preset:${preset.id}`"
                @click="selectBuiltIn(preset.id as BuiltInThemePresetId)"
              >
                <span
                  class="preset-thumbnail"
                  :style="presetPreviewStyle(preset)"
                  :data-layout="resolveThemeProfileModes(preset).player?.layout"
                  aria-hidden="true"
                >
                  <i></i><i></i><i></i><i></i>
                </span>
                <span class="preset-copy">
                  <strong>{{ preset.name }}</strong>
                  <small>{{ preset.description }}</small>
                </span>
              </button>
              <div class="preset-item-actions">
                <span v-if="activeKey === `preset:${preset.id}`">当前使用</span>
                <button
                  type="button"
                  title="从预设派生"
                  aria-label="从预设派生"
                  @click="derivePreset(preset)"
                >
                  <i class="ph ph-copy"></i>
                </button>
              </div>
            </article>
          </div>

          <div class="control-section-heading user-profile-heading">
            <span>个人主题</span><small>{{ profiles.length }} / 32</small>
          </div>
          <div v-if="profiles.length" class="preset-gallery user-profile-gallery">
            <article
              v-for="profile in profiles"
              :key="profile.id"
              class="preset-gallery-item"
              :class="{
                selected: selectedKey === `profile:${profile.id}`,
                active: activeKey === `profile:${profile.id}`
              }"
            >
              <button
                type="button"
                class="preset-preview-command"
                :aria-pressed="selectedKey === `profile:${profile.id}`"
                @click="selectProfile(profile)"
              >
                <span
                  class="preset-thumbnail"
                  :style="presetPreviewStyle(profile)"
                  :data-layout="resolveThemeProfileModes(profile).player?.layout"
                  aria-hidden="true"
                >
                  <i></i><i></i><i></i><i></i>
                </span>
                <span class="preset-copy">
                  <strong>{{ profile.name }}</strong>
                  <small>
                    {{
                      profile.source?.kind === 'builtin-preset'
                        ? `派生自 ${getBuiltInThemePreset(profile.source.presetId)?.name ?? '内置预设'}`
                        : profile.description || '个人配置档'
                    }}
                  </small>
                </span>
              </button>
              <div class="preset-item-actions">
                <span v-if="activeKey === `profile:${profile.id}`">当前使用</span>
                <time>{{ new Date(profile.updatedAt).toLocaleDateString('zh-CN') }}</time>
              </div>
            </article>
          </div>
          <p v-else class="preset-empty-state">尚未创建个人主题</p>

          <section v-if="draft" class="profile-history-section">
            <div class="control-section-heading">
              <span>版本历史</span><small>最多保留 8 个版本</small>
            </div>
            <div v-if="persistedHistory.length" class="profile-history-list">
              <div v-for="entry in persistedHistory" :key="entry.savedAt">
                <span>
                  <strong>{{ entry.profile.name }}</strong>
                  <time>{{ historyLabel(entry) }}</time>
                </span>
                <button
                  type="button"
                  title="恢复此版本"
                  aria-label="恢复此版本"
                  @click="restoreVersion(entry)"
                >
                  <i class="ph ph-clock-counter-clockwise"></i>
                </button>
              </div>
            </div>
            <p v-else class="preset-empty-state">保存修改后会在此保留可恢复版本</p>
          </section>
        </section>

        <input
          v-if="draft && domain !== 'presets'"
          class="theme-name-input"
          :value="draft.name"
          maxlength="80"
          aria-label="主题名称"
          @change="changeName"
        />
        <div v-else-if="domain !== 'presets'" class="read-only-theme">
          <i class="ph ph-lock"></i><span>创建副本后编辑</span>
        </div>

        <section v-if="domain === 'personalization'" class="studio-control-section">
          <div class="control-section-heading">
            <span>个性化运行模式</span
            ><small>配置档 · {{ tone === 'dark' ? '深色' : '浅色' }}</small>
          </div>
          <label class="studio-setting-row">
            <span>强调色来源<small>封面模式复用已缓存主色</small></span>
            <select
              :value="activeModes.appearance?.accentSource"
              :disabled="!draft"
              @change="updateAppearanceMode('accentSource', $event)"
            >
              <option value="fixed">固定颜色</option>
              <option value="cover">当前封面</option>
            </select>
          </label>
          <label class="studio-setting-row">
            <span>背景处理<small>失败时保留实色背景</small></span>
            <select
              :value="activeModes.appearance?.backgroundTreatment"
              :disabled="!draft"
              @change="updateAppearanceMode('backgroundTreatment', $event)"
            >
              <option value="solid">实色</option>
              <option value="gradient">双色渐变</option>
              <option value="cover-blur">封面模糊</option>
              <option value="image">本地图片</option>
            </select>
          </label>
          <label class="studio-setting-row">
            <span>日夜调度<small>切换只重解析当前变体</small></span>
            <select
              :value="activeModes.appearance?.toneScheduling"
              :disabled="!draft"
              @change="updateAppearanceMode('toneScheduling', $event)"
            >
              <option value="manual">手动</option>
              <option value="system">跟随系统</option>
              <option value="timed">定时时段</option>
            </select>
          </label>
          <div v-if="activeModes.appearance?.toneScheduling === 'timed'" class="schedule-time-grid">
            <label>
              <span>浅色开始</span>
              <input
                type="time"
                :value="scheduleTime('lightStartMinutes')"
                :disabled="!draft"
                @change="updateScheduleTime('lightStartMinutes', $event)"
              />
            </label>
            <label>
              <span>深色开始</span>
              <input
                type="time"
                :value="scheduleTime('darkStartMinutes')"
                :disabled="!draft"
                @change="updateScheduleTime('darkStartMinutes', $event)"
              />
            </label>
          </div>
          <label class="studio-setting-row">
            <span>对比度保护<small>普通文本 4.5:1，大文本 3:1</small></span>
            <select
              :value="activeModes.appearance?.contrastGuard"
              :disabled="!draft"
              @change="updateAppearanceMode('contrastGuard', $event)"
            >
              <option value="off">关闭</option>
              <option value="warn">仅预警</option>
              <option value="enforce">安全回退</option>
            </select>
          </label>
          <label class="studio-setting-row">
            <span>特效模式<small>关闭模糊/玻璃/封面滤镜，不覆盖系统动效偏好</small></span>
            <select
              :value="activeModes.appearance?.effectsMode"
              :disabled="!draft"
              @change="updateAppearanceMode('effectsMode', $event)"
            >
              <option value="full">完整特效</option>
              <option value="reduced">关闭特效</option>
            </select>
          </label>
        </section>

        <section v-if="domain === 'personalization'" class="palette-editor">
          <div class="control-section-heading">
            <span>精选强调色</span><small>{{ accentPalette.length }} 色</small>
          </div>
          <div class="palette-grid" aria-label="精选强调色色板">
            <button
              v-for="entry in accentPalette"
              :key="entry.id"
              type="button"
              :class="{ active: valueForId('color.primary.500') === entry.value }"
              :style="{ '--swatch-color': entry.value }"
              :title="entry.label"
              :aria-label="entry.label"
              :disabled="!draft"
              @click="applyAccentPalette(entry.value)"
            ></button>
          </div>
          <div class="control-section-heading background-palette-heading">
            <span>精选背景色</span><small>{{ backgroundPalette.length }} 色</small>
          </div>
          <div class="palette-grid" aria-label="精选背景色色板">
            <button
              v-for="entry in backgroundPalette"
              :key="entry.id"
              type="button"
              :class="{ active: valueForId('surface.app') === entry.value }"
              :style="{ '--swatch-color': entry.value }"
              :title="entry.label"
              :aria-label="entry.label"
              :disabled="!draft"
              @click="applyBackgroundPalette(entry.value)"
            ></button>
          </div>
        </section>

        <section v-if="domain === 'navigation'" class="studio-control-section">
          <div class="control-section-heading">
            <span>图标与导航模式</span><small>静态宿主变体</small>
          </div>
          <label class="studio-setting-row">
            <span>图标族<small>语义槽保持不变</small></span>
            <select
              :value="activeModes.icons?.family"
              :disabled="!draft"
              @change="updateIconFamily"
            >
              <option value="outline">描边</option>
              <option value="rounded">圆润粗线</option>
              <option value="filled">填充</option>
            </select>
          </label>
          <label class="studio-setting-row">
            <span>导航布局<small>菜单结构不由主题修改</small></span>
            <select
              :value="activeModes.navigation?.style"
              :disabled="!draft"
              @change="updateNavigationMode('style', $event)"
            >
              <option value="expanded">展开</option>
              <option value="compact">紧凑</option>
              <option value="rail">图标栏</option>
            </select>
          </label>
          <label class="studio-setting-row">
            <span>导航图标大小<small>点击区域保持固定</small></span>
            <select
              :value="activeModes.navigation?.iconScale"
              :disabled="!draft"
              @change="updateNavigationMode('iconScale', $event)"
            >
              <option value="sm">小</option>
              <option value="md">中</option>
              <option value="lg">大</option>
            </select>
          </label>
          <label class="studio-setting-row">
            <span>内置标识<small>仅控制宿主品牌标识</small></span>
            <select
              :value="activeModes.navigation?.logo"
              :disabled="!draft"
              @change="updateNavigationMode('logo', $event)"
            >
              <option value="hide">隐藏</option>
              <option value="show">显示</option>
            </select>
          </label>
        </section>

        <section v-if="domain === 'library'" class="studio-control-section">
          <div class="control-section-heading">
            <span>媒体库模式</span><small>不改变数据流</small>
          </div>
          <label class="studio-setting-row">
            <span>信息密度<small>虚拟列表步长保持稳定</small></span>
            <select
              :value="activeModes.library?.density"
              :disabled="!draft"
              @change="updateLibraryMode('density', $event)"
            >
              <option value="comfortable">舒适</option>
              <option value="compact">紧凑</option>
            </select>
          </label>
          <label class="studio-setting-row">
            <span>选中样式<small>填充或描边</small></span>
            <select
              :value="activeModes.library?.selection"
              :disabled="!draft"
              @change="updateLibraryMode('selection', $event)"
            >
              <option value="fill">填充</option>
              <option value="stroke">描边</option>
            </select>
          </label>
          <label class="studio-setting-row">
            <span>标题区叠层<small>强度由下方令牌控制</small></span>
            <select
              :value="activeModes.library?.titleOverlay"
              :disabled="!draft"
              @change="updateLibraryMode('titleOverlay', $event)"
            >
              <option value="off">关闭</option>
              <option value="on">开启</option>
            </select>
          </label>
        </section>

        <section v-if="domain === 'player'" class="studio-control-section player-layout-section">
          <div class="control-section-heading">
            <span>播放器布局</span><small>宿主缩略图</small>
          </div>
          <div class="layout-gallery" aria-label="播放器布局">
            <button
              v-for="layout in playerLayouts"
              :key="layout.id"
              type="button"
              class="layout-choice"
              :class="{ active: activeModes.player?.layout === layout.id }"
              :aria-pressed="activeModes.player?.layout === layout.id"
              :disabled="!draft"
              @click="setPlayerLayout(layout.id)"
            >
              <span class="layout-thumbnail" :data-layout="layout.id" aria-hidden="true">
                <i></i><i></i><i></i>
              </span>
              <span>{{ layout.label }}</span>
            </button>
          </div>
        </section>

        <section v-if="domain === 'player'" class="studio-control-section">
          <div class="control-section-heading">
            <span>控制区与封面</span><small>静态呈现</small>
          </div>
          <label class="studio-setting-row">
            <span>控制区<small>业务按钮保持不变</small></span>
            <select
              :value="activeModes.player?.controls"
              :disabled="!draft"
              @change="updatePlayerMode('controls', $event)"
            >
              <option value="standard">标准</option>
              <option value="pro">Pro</option>
            </select>
          </label>
          <label class="studio-setting-row">
            <span>标题对齐<small>与布局正交</small></span>
            <select
              :value="activeModes.player?.titleAlign"
              :disabled="!draft"
              @change="updatePlayerMode('titleAlign', $event)"
            >
              <option value="left">左对齐</option>
              <option value="center">居中</option>
            </select>
          </label>
          <label class="studio-setting-row">
            <span>进度样式<small>原生 range 行为不变</small></span>
            <select
              :value="activeModes.player?.progress"
              :disabled="!draft"
              @change="updatePlayerMode('progress', $event)"
            >
              <option value="line">直线无滑块</option>
              <option value="ring">空心圆</option>
              <option value="solid">实心圆</option>
              <option value="spectrum">频谱轨道</option>
            </select>
          </label>
          <label class="studio-setting-row">
            <span>封面过渡<small>遵循减少动态效果</small></span>
            <select
              :value="activeModes.artwork?.transition"
              :disabled="!draft"
              @change="updateArtworkMode('transition', $event)"
            >
              <option value="fade">淡入</option>
              <option value="slide">滑入</option>
              <option value="none">无过渡</option>
            </select>
          </label>
          <label class="studio-setting-row">
            <span>封面阴影<small>只影响视觉层</small></span>
            <select
              :value="activeModes.artwork?.shadow"
              :disabled="!draft"
              @change="updateArtworkMode('shadow', $event)"
            >
              <option value="on">开启</option>
              <option value="off">关闭</option>
            </select>
          </label>
        </section>

        <section v-if="domain === 'player'" class="studio-control-section">
          <div class="control-section-heading">
            <span>均衡器视觉</span><small>不修改 DSP 参数</small>
          </div>
          <label class="studio-setting-row">
            <span>面板材质<small>中性、着色或玻璃</small></span>
            <select
              :value="activeModes.equalizer?.panel"
              :disabled="!draft"
              @change="updateEqualizerMode('panel', $event)"
            >
              <option value="neutral">中性</option>
              <option value="tinted">着色</option>
              <option value="glass">玻璃</option>
            </select>
          </label>
          <label class="studio-setting-row">
            <span>滑块<small>空心环或实心圆</small></span>
            <select
              :value="activeModes.equalizer?.slider"
              :disabled="!draft"
              @change="updateEqualizerMode('slider', $event)"
            >
              <option value="ring">空心环</option>
              <option value="solid">实心圆</option>
            </select>
          </label>
          <label class="studio-setting-row">
            <span>旋钮指示<small>线形或圆点</small></span>
            <select
              :value="activeModes.equalizer?.knob"
              :disabled="!draft"
              @change="updateEqualizerMode('knob', $event)"
            >
              <option value="line">线形</option>
              <option value="dot">圆点</option>
            </select>
          </label>
          <label class="studio-setting-row">
            <span>频谱<small>柱形、线形或面积</small></span>
            <select
              :value="activeModes.equalizer?.spectrum"
              :disabled="!draft"
              @change="updateEqualizerMode('spectrum', $event)"
            >
              <option value="bars">柱形</option>
              <option value="line">线形</option>
              <option value="area">面积</option>
            </select>
          </label>
          <label class="studio-setting-row">
            <span>按钮<small>柔和、描边或填充</small></span>
            <select
              :value="activeModes.equalizer?.button"
              :disabled="!draft"
              @change="updateEqualizerMode('button', $event)"
            >
              <option value="soft">柔和</option>
              <option value="outline">描边</option>
              <option value="solid">填充</option>
            </select>
          </label>
        </section>

        <section v-if="domain === 'player'" class="studio-control-section">
          <div class="control-section-heading"><span>可见性</span><small>白名单槽位</small></div>
          <div class="visibility-grid">
            <label v-for="option in visibilityOptions" :key="option.id">
              <span>{{ option.label }}</span>
              <input
                type="checkbox"
                :checked="visibilityValue(option.id)"
                :disabled="!draft"
                @change="updateVisibility(option.id, $event)"
              />
            </label>
          </div>
        </section>

        <section v-if="domain === 'typography'" class="studio-control-section">
          <div class="control-section-heading"><span>字体行为</span><small>配置档</small></div>
          <label class="studio-setting-row">
            <span>标题大写<small>不改写原始元数据</small></span>
            <select
              :value="activeModes.typography?.titleCase"
              :disabled="!draft"
              @change="updateTypographyMode('titleCase', $event)"
            >
              <option value="preserve">保留原样</option>
              <option value="uppercase">大写显示</option>
            </select>
          </label>
          <label class="studio-setting-row">
            <span>歌词强调高亮<small>当前行使用强调色</small></span>
            <select
              :value="activeModes.typography?.lyricAccent"
              :disabled="!draft"
              @change="updateTypographyMode('lyricAccent', $event)"
            >
              <option value="off">关闭</option>
              <option value="accent">强调色</option>
            </select>
          </label>
          <label class="studio-setting-row">
            <span>自适应标题颜色<small>按信息层级应用强调色</small></span>
            <select
              :value="activeModes.typography?.titleColor"
              :disabled="!draft"
              @change="updateTypographyMode('titleColor', $event)"
            >
              <option value="off">禁用</option>
              <option value="track">曲目标题</option>
              <option value="artist-album">艺术家与专辑</option>
            </select>
          </label>
        </section>

        <section v-if="domain === 'typography'" class="font-library-editor">
          <div class="asset-editor-heading">
            <span>字体风格库</span>
            <button type="button" :disabled="!draft" @click="importAsset('font')">
              <i class="ph ph-file-woff"></i><span>导入 WOFF2</span>
            </button>
          </div>
          <label v-for="binding in fontBindings" :key="binding.key">
            <span
              >{{ binding.label }}<small>{{ fontSource(binding) }}</small></span
            >
            <select
              :value="fontSelection(binding)"
              :disabled="!draft"
              @change="updateFontSlot(binding, $event)"
            >
              <option value="custom">自定义令牌</option>
              <optgroup label="内置字体">
                <option
                  v-for="font in BUILT_IN_THEME_FONTS"
                  :key="font.id"
                  :value="`builtin:${font.id}`"
                >
                  {{ font.label }} · {{ font.category }}
                </option>
              </optgroup>
              <optgroup v-if="fontAssets.length" label="本地资源">
                <option v-for="asset in fontAssets" :key="asset.id" :value="`asset:${asset.id}`">
                  {{ asset.path }}
                </option>
              </optgroup>
            </select>
          </label>
        </section>

        <div v-if="domain === 'windows'" class="window-default-grid">
          <section class="studio-control-section">
            <div class="control-section-heading">
              <span>迷你播放器</span><small>继承开启时生效</small>
            </div>
            <label class="studio-setting-row">
              <span>表面颜色<small>无封面时也保留</small></span>
              <input
                type="color"
                :value="String(windowDefaultValue('miniPlayer', 'surfaceColor'))"
                :disabled="!draft"
                @input="updateWindowText('miniPlayer', 'surfaceColor', $event)"
              />
            </label>
            <label class="studio-setting-row">
              <span>强调色<small>控件与进度</small></span>
              <input
                type="color"
                :value="String(windowDefaultValue('miniPlayer', 'accentColor'))"
                :disabled="!draft"
                @input="updateWindowText('miniPlayer', 'accentColor', $event)"
              />
            </label>
            <label class="studio-setting-row">
              <span>主要文字<small>覆盖自动取色</small></span>
              <input
                type="color"
                :value="String(windowDefaultValue('miniPlayer', 'primaryTextColor'))"
                :disabled="!draft"
                @input="updateWindowText('miniPlayer', 'primaryTextColor', $event)"
              />
            </label>
            <label class="studio-setting-row">
              <span>字体<small>本地字体栈</small></span>
              <input
                type="text"
                :value="String(windowDefaultValue('miniPlayer', 'fontFamily'))"
                :disabled="!draft"
                @change="updateWindowText('miniPlayer', 'fontFamily', $event)"
              />
            </label>
            <label class="studio-setting-row window-range-row">
              <span
                >表面透明度<small
                  >{{ windowDefaultValue('miniPlayer', 'surfaceOpacity') }}%</small
                ></span
              >
              <input
                type="range"
                min="40"
                max="100"
                :value="Number(windowDefaultValue('miniPlayer', 'surfaceOpacity'))"
                :disabled="!draft"
                @input="updateWindowNumber('miniPlayer', 'surfaceOpacity', $event)"
              />
            </label>
            <label class="studio-setting-row window-range-row">
              <span
                >玻璃模糊<small>{{ windowDefaultValue('miniPlayer', 'glassBlur') }}px</small></span
              >
              <input
                type="range"
                min="0"
                max="40"
                :value="Number(windowDefaultValue('miniPlayer', 'glassBlur'))"
                :disabled="!draft"
                @input="updateWindowNumber('miniPlayer', 'glassBlur', $event)"
              />
            </label>
            <label class="studio-setting-row window-range-row">
              <span
                >圆角<small>{{ windowDefaultValue('miniPlayer', 'cornerRadius') }}px</small></span
              >
              <input
                type="range"
                min="0"
                max="36"
                :value="Number(windowDefaultValue('miniPlayer', 'cornerRadius'))"
                :disabled="!draft"
                @input="updateWindowNumber('miniPlayer', 'cornerRadius', $event)"
              />
            </label>
            <label class="studio-setting-row">
              <span>边框颜色<small>独立窗口轮廓</small></span>
              <input
                type="color"
                :value="String(windowDefaultValue('miniPlayer', 'borderColor'))"
                :disabled="!draft"
                @input="updateWindowText('miniPlayer', 'borderColor', $event)"
              />
            </label>
            <label class="studio-setting-row">
              <span>阴影颜色<small>窗口层次</small></span>
              <input
                type="color"
                :value="String(windowDefaultValue('miniPlayer', 'shadowColor'))"
                :disabled="!draft"
                @input="updateWindowText('miniPlayer', 'shadowColor', $event)"
              />
            </label>
            <label class="studio-setting-row window-range-row">
              <span
                >阴影强度<small
                  >{{ windowDefaultValue('miniPlayer', 'shadowStrength') }}%</small
                ></span
              >
              <input
                type="range"
                min="0"
                max="100"
                :value="Number(windowDefaultValue('miniPlayer', 'shadowStrength'))"
                :disabled="!draft"
                @input="updateWindowNumber('miniPlayer', 'shadowStrength', $event)"
              />
            </label>
          </section>

          <section class="studio-control-section">
            <div class="control-section-heading">
              <span>桌面歌词</span><small>文字与窗口材质</small>
            </div>
            <label class="studio-setting-row">
              <span>文字颜色<small>未激活歌词</small></span>
              <input
                type="color"
                :value="String(windowDefaultValue('desktopLyrics', 'color'))"
                :disabled="!draft"
                @input="updateWindowText('desktopLyrics', 'color', $event)"
              />
            </label>
            <label class="studio-setting-row">
              <span>高亮颜色<small>当前歌词</small></span>
              <input
                type="color"
                :value="String(windowDefaultValue('desktopLyrics', 'highlightColor'))"
                :disabled="!draft"
                @input="updateWindowText('desktopLyrics', 'highlightColor', $event)"
              />
            </label>
            <label class="studio-setting-row">
              <span>背景颜色<small>桌面歌词窗口</small></span>
              <input
                type="color"
                :value="String(windowDefaultValue('desktopLyrics', 'backgroundColor'))"
                :disabled="!draft"
                @input="updateWindowText('desktopLyrics', 'backgroundColor', $event)"
              />
            </label>
            <label class="studio-setting-row">
              <span>字体<small>系统或内置字体 ID</small></span>
              <input
                type="text"
                :value="String(windowDefaultValue('desktopLyrics', 'fontFamily'))"
                :disabled="!draft"
                @change="updateWindowText('desktopLyrics', 'fontFamily', $event)"
              />
            </label>
            <label class="studio-setting-row window-range-row">
              <span
                >字号<small>{{ windowDefaultValue('desktopLyrics', 'fontSize') }}px</small></span
              >
              <input
                type="range"
                min="12"
                max="80"
                :value="Number(windowDefaultValue('desktopLyrics', 'fontSize'))"
                :disabled="!draft"
                @input="updateWindowNumber('desktopLyrics', 'fontSize', $event)"
              />
            </label>
            <label class="studio-setting-row window-range-row">
              <span
                >背景透明度<small
                  >{{ windowDefaultValue('desktopLyrics', 'backgroundOpacity') }}%</small
                ></span
              >
              <input
                type="range"
                min="0"
                max="100"
                :value="Number(windowDefaultValue('desktopLyrics', 'backgroundOpacity'))"
                :disabled="!draft"
                @input="updateWindowNumber('desktopLyrics', 'backgroundOpacity', $event)"
              />
            </label>
            <label class="studio-setting-row">
              <span>文字阴影<small>关闭后保留阴影参数</small></span>
              <input
                type="checkbox"
                :checked="Boolean(windowDefaultValue('desktopLyrics', 'shadow'))"
                :disabled="!draft"
                @change="updateWindowBoolean('desktopLyrics', 'shadow', $event)"
              />
            </label>
            <label class="studio-setting-row">
              <span>阴影颜色<small>文字边缘</small></span>
              <input
                type="color"
                :value="String(windowDefaultValue('desktopLyrics', 'shadowColor'))"
                :disabled="!draft"
                @input="updateWindowText('desktopLyrics', 'shadowColor', $event)"
              />
            </label>
            <label class="studio-setting-row window-range-row">
              <span
                >阴影模糊<small
                  >{{ windowDefaultValue('desktopLyrics', 'shadowBlur') }}px</small
                ></span
              >
              <input
                type="range"
                min="0"
                max="30"
                :value="Number(windowDefaultValue('desktopLyrics', 'shadowBlur'))"
                :disabled="!draft"
                @input="updateWindowNumber('desktopLyrics', 'shadowBlur', $event)"
              />
            </label>
          </section>
        </div>

        <section v-if="domain === 'personalization' || domain === 'advanced'" class="asset-editor">
          <div class="asset-editor-heading">
            <span>本地背景资源</span>
            <button type="button" :disabled="!draft" @click="importAsset('image')">
              <i class="ph ph-image-square"></i><span>导入图片</span>
            </button>
          </div>
          <label
            v-for="binding in domain === 'personalization'
              ? personalizationBackgroundBindings
              : backgroundBindings"
            :key="binding.key"
          >
            <span
              >{{ binding.label }}<small>{{ assetSource(binding.key) }}</small></span
            >
            <select
              :value="draft?.assetBindings?.[binding.key] ?? ''"
              :disabled="!draft"
              @change="updateAssetBinding(binding.key, $event)"
            >
              <option value="">不使用资源</option>
              <option v-for="asset in imageAssets" :key="asset.id" :value="asset.id">
                {{ asset.path }}
              </option>
            </select>
          </label>
        </section>

        <section v-if="domain === 'personalization' || domain === 'advanced'" class="asset-editor">
          <div class="asset-editor-heading">
            <span>本地字体资源</span>
            <button type="button" :disabled="!draft" @click="importAsset('font')">
              <i class="ph ph-file-woff"></i><span>导入 WOFF2</span>
            </button>
          </div>
          <label v-for="binding in fontBindings" :key="binding.key">
            <span
              >{{ binding.label }}<small>{{ assetSource(binding.key) }}</small></span
            >
            <select
              :value="draft?.assetBindings?.[binding.key] ?? ''"
              :disabled="!draft"
              @change="updateAssetBinding(binding.key, $event)"
            >
              <option value="">使用令牌字体</option>
              <option v-for="asset in fontAssets" :key="asset.id" :value="asset.id">
                {{ asset.path }}
              </option>
            </select>
          </label>
        </section>

        <div v-if="domain !== 'presets'" class="token-editor-list" :class="{ disabled: !draft }">
          <div v-for="definition in visibleDefinitions" :key="definition.id" class="token-editor-row">
            <div>
              <span
                ><strong>{{ definition.label }}</strong
                ><small>{{ definition.surface }}</small></span
              >
              <span class="token-source">{{ sourceFor(definition) }}</span>
            </div>
            <div class="token-control">
              <template v-if="definition.min != null && definition.max != null">
                <input
                  type="range"
                  :min="definition.min"
                  :max="definition.max"
                  :step="definition.step || 1"
                  :value="rangeNumber(definition)"
                  :disabled="!draft"
                  @input="updateRange(definition, $event)"
                />
                <code>{{ valueFor(definition) }}</code>
              </template>
              <template
                v-else-if="definition.kind === 'color' && supportsColorPicker(valueFor(definition))"
              >
                <input
                  type="color"
                  :value="valueFor(definition)"
                  :disabled="!draft"
                  @input="updateToken(definition, ($event.target as HTMLInputElement).value)"
                />
                <input
                  type="text"
                  :value="valueFor(definition)"
                  :disabled="!draft"
                  @change="updateToken(definition, ($event.target as HTMLInputElement).value)"
                />
              </template>
              <input
                v-else
                type="text"
                :value="valueFor(definition)"
                :disabled="!draft"
                @change="updateToken(definition, ($event.target as HTMLInputElement).value)"
              />
              <button
                type="button"
                class="studio-icon-button"
                title="恢复默认"
                aria-label="恢复默认"
                :disabled="!draft || !draft.overrides[tone][definition.id]"
                @click="removeOverride(definition)"
              >
                <i class="ph ph-arrow-u-up-left"></i>
              </button>
            </div>
          </div>
        </div>

        <section
          v-if="contrastWarnings.length && activeModes.appearance?.contrastGuard !== 'off'"
          class="contrast-warning"
          role="status"
        >
          <div><i class="ph ph-warning"></i><strong>对比度预警</strong></div>
          <p v-for="warning in contrastWarnings" :key="warning.label">
            {{ warning.label }}：{{ warning.ratio.toFixed(2) }}:1，最低
            {{ warning.minimum.toFixed(1) }}:1
          </p>
        </section>

        <section
          v-if="selectedPluginTheme?.compatibilityNotes?.length"
          class="contrast-warning"
          role="status"
        >
          <div><i class="ph ph-warning"></i><strong>主题兼容提示</strong></div>
          <p v-for="note in selectedPluginTheme.compatibilityNotes" :key="note">{{ note }}</p>
        </section>

        <p v-if="localError || themeStore.error.value" class="studio-message error">
          {{ localError || themeStore.error.value }}
        </p>
        <p v-else-if="notice" class="studio-message">{{ notice }}</p>
      </aside>
    </div>
  </div>
</template>

<style src="./theme-studio/ThemeStudioPage.css"></style>
type BuiltInThemePresetId, type ThemeProfileHistoryEntry,
