<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  BUILT_IN_THEME_FONTS,
  DEFAULT_THEME_TONE_SCHEDULE,
  THEME_ACCENT_PALETTES,
  THEME_BACKGROUND_PALETTES,
  THEME_TOKEN_DEFINITIONS,
  TWILIGHT_DEFAULT_THEME,
  TWILIGHT_DEFAULT_THEME_ID,
  createThemeAccentTokenOverrides,
  normalizeThemeTokenOverrides,
  normalizeThemeTokenValue,
  resolveThemeProfileModes,
  themeContrastRatio,
  type ThemeAssetBindings,
  type ThemeAssetType,
  type ThemeModes,
  type ThemeProfileV2,
  type ThemeSelection,
  type ThemeTokenDefinition,
  type ThemeTone
} from '../../../shared/theme.ts'
import { useExtensionRegistry, type ThemeContribution } from '../extensions/registry'
import { getPluginThemeKey } from '../extensions/themeSelection'
import { useThemeStore } from '../stores/useThemeStore'

const emit = defineEmits<{ back: [] }>()
const themeStore = useThemeStore()
const { themeContributions, syncExtensions } = useExtensionRegistry()
const selectedKey = ref('builtin')
const tone = ref<ThemeTone>('pureWhite')
type ThemeStudioDomain =
  | 'personalization'
  | 'shell'
  | 'navigation'
  | 'library'
  | 'typography'
  | 'player'
  | 'motion'
  | 'advanced'

const domain = ref<ThemeStudioDomain>('personalization')
const draft = ref<ThemeProfileV2 | null>(null)
const savedDraft = ref('')
const history = ref<ThemeProfileV2[]>([])
const historyIndex = ref(-1)
const localError = ref('')
const notice = ref('')
let originalTone: ThemeTone = 'pureWhite'

const domains: Array<{ id: ThemeStudioDomain; label: string; icon: string }> = [
  { id: 'personalization', label: '个性化与材质', icon: 'ph ph-palette' },
  { id: 'shell', label: '界面与设置', icon: 'ph ph-squares-four' },
  { id: 'navigation', label: '图标与导航', icon: 'ph ph-sidebar' },
  { id: 'library', label: '媒体库', icon: 'ph ph-music-notes-simple' },
  { id: 'typography', label: '字体与歌词', icon: 'ph ph-text-aa' },
  { id: 'player', label: '播放器与封面', icon: 'ph ph-play-circle' },
  { id: 'motion', label: '动效', icon: 'ph ph-wind' },
  { id: 'advanced', label: '高级令牌', icon: 'ph ph-sliders-horizontal' }
]

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

const definitions = computed(() => {
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
const activeDomain = computed(() => domains.find((item) => item.id === domain.value) ?? domains[0])
const profiles = computed(() => themeStore.profiles.value)
const activeKey = computed(() => selectionKey(themeStore.activeTheme.value))
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
const activeModes = computed(() => resolveThemeProfileModes(draft.value))
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
  if (selection.kind === 'builtin') return 'builtin'
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

async function selectBuiltIn(): Promise<void> {
  selectedKey.value = 'builtin'
  draft.value = null
  history.value = []
  historyIndex.value = -1
  await themeStore.previewTheme({ kind: 'builtin', id: TWILIGHT_DEFAULT_THEME_ID })
}

async function selectProfile(profile: ThemeProfileV2): Promise<void> {
  selectedKey.value = `profile:${profile.id}`
  draft.value = cloneProfile(profile)
  resetHistory(draft.value)
  await themeStore.preview(draft.value)
}

async function selectPlugin(theme: ThemeContribution): Promise<void> {
  selectedKey.value = `plugin:${getPluginThemeKey(theme)}`
  draft.value = null
  history.value = []
  historyIndex.value = -1
  await themeStore.previewTheme({ kind: 'plugin', pluginId: theme.pluginId, themeId: theme.id })
}

async function selectThemeKey(event: Event): Promise<void> {
  const key = (event.target as HTMLSelectElement).value
  if (key === 'builtin') {
    await selectBuiltIn()
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
  return profile
}

async function duplicateSelected(): Promise<void> {
  const sourceProfileId = draft.value?.id
  const source = draft.value
    ? cloneProfile(draft.value)
    : selectedPluginTheme.value
      ? createProfileFromPlugin(selectedPluginTheme.value)
      : null
  const profile = themeStore.createProfile(source ? `${source.name} 副本` : '自定义主题', source)
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

function valueFor(definition: ThemeTokenDefinition): string {
  return (
    draft.value?.overrides[tone.value][definition.id] ??
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
  void themeStore.preview(next)
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
  key: 'accentSource' | 'backgroundTreatment' | 'toneScheduling' | 'contrastGuard',
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
      appearance.toneScheduling = value as NonNullable<
        ThemeModes['appearance']
      >['toneScheduling']
      if (value === 'timed' && !profile.toneSchedule) {
        profile.toneSchedule = { ...DEFAULT_THEME_TONE_SCHEDULE }
      }
    } else if (key === 'contrastGuard' && ['off', 'warn', 'enforce'].includes(value)) {
      appearance.contrastGuard = value as NonNullable<
        ThemeModes['appearance']
      >['contrastGuard']
    }
    profile.modes.appearance = appearance
  })
}

function updateTypographyMode(
  key: 'titleCase' | 'lyricAccent' | 'titleColor',
  event: Event
): void {
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

function scheduleTime(key: 'lightStartMinutes' | 'darkStartMinutes'): string {
  const minutes = draft.value?.toneSchedule?.[key] ?? DEFAULT_THEME_TONE_SCHEDULE[key]
  return `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`
}

function updateScheduleTime(
  key: 'lightStartMinutes' | 'darkStartMinutes',
  event: Event
): void {
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
      const font = BUILT_IN_THEME_FONTS.find(
        (entry) => `builtin:${entry.id}` === selection
      )
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
    if (profile.assetBindings && (domain.value === 'personalization' || domain.value === 'typography')) {
      if (domain.value === 'personalization') delete profile.assetBindings.appBackground
      delete profile.assetBindings.sansFont
      delete profile.assetBindings.displayFont
      delete profile.assetBindings.roundedFont
      if (Object.keys(profile.assetBindings).length === 0) profile.assetBindings = undefined
    }
  })
}

function undo(): void {
  if (!canUndo.value) return
  historyIndex.value -= 1
  draft.value = cloneProfile(history.value[historyIndex.value])
  void themeStore.preview(draft.value)
}

function redo(): void {
  if (!canRedo.value) return
  historyIndex.value += 1
  draft.value = cloneProfile(history.value[historyIndex.value])
  void themeStore.preview(draft.value)
}

async function applySelected(): Promise<void> {
  localError.value = ''
  notice.value = ''
  try {
    if (draft.value) {
      await themeStore.saveProfile(draft.value)
      await themeStore.setActive({ kind: 'user', id: draft.value.id })
      savedDraft.value = JSON.stringify(draft.value)
      selectedKey.value = `profile:${draft.value.id}`
    } else if (selectedPluginTheme.value) {
      await themeStore.setActive({
        kind: 'plugin',
        pluginId: selectedPluginTheme.value.pluginId,
        themeId: selectedPluginTheme.value.id
      })
    } else {
      await themeStore.setActive({ kind: 'builtin', id: TWILIGHT_DEFAULT_THEME_ID })
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

function setTone(nextTone: ThemeTone): void {
  tone.value = nextTone
  void themeStore.setPreviewTone(nextTone)
}

function closeStudio(): void {
  if (isDirty.value && !window.confirm('放弃尚未应用的主题修改？')) return
  document.documentElement.dataset.theme = originalTone
  void themeStore.setPreviewTone(null).then(() => themeStore.previewTheme(null))
  emit('back')
}

onMounted(async () => {
  await Promise.all([themeStore.load(), syncExtensions()])
  originalTone = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'pureWhite'
  tone.value = originalTone
  await themeStore.setPreviewTone(originalTone)
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
    await selectBuiltIn()
  }
})

onBeforeUnmount(() => {
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
          <option value="builtin">Twilight Echo 默认主题</option>
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
          :disabled="!draft"
          @click="resetGroup"
        >
          <i class="ph ph-arrow-u-up-left"></i>
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
          <strong>真实预览</strong><span>{{ activeDomain.label }}</span>
        </div>

        <section class="theme-preview-stage">
          <div class="preview-titlebar">
            <i class="ph ph-list"></i><span>Twilight Echo</span><i class="ph ph-gear"></i>
          </div>
          <div class="preview-app-shell">
            <nav class="preview-sidebar">
              <strong>音乐库</strong>
              <span class="active"><i class="ph ph-house"></i>主页</span>
              <span><i class="ph ph-music-notes"></i>全部歌曲</span>
              <span><i class="ph ph-disc"></i>专辑</span>
            </nav>
            <div class="preview-content">
              <div class="preview-heading">
                <div>
                  <small>本地音乐</small>
                  <h2>晚上好，暮色回声</h2>
                </div>
                <button><i class="ph ph-play"></i>播放全部</button>
              </div>
              <div class="preview-cards">
                <article>
                  <span class="preview-cover violet"></span><strong>夜间播放</strong
                  ><small>24 首歌曲</small>
                </article>
                <article>
                  <span class="preview-cover cyan"></span><strong>最近添加</strong
                  ><small>12 首歌曲</small>
                </article>
                <article>
                  <span class="preview-cover rose"></span><strong>我的收藏</strong
                  ><small>86 首歌曲</small>
                </article>
              </div>
              <div class="preview-song-row">
                <span>01</span><span class="preview-song-art"></span
                ><span
                  ><strong title="暮色回声 · Twilight Echo · 真夜中の音楽"
                    >暮色回声 · Twilight Echo · 真夜中の音楽</strong
                  ><small>Theme Studio · 테마 미리보기</small></span
                ><i class="ph ph-heart"></i><span>4:12</span>
              </div>
            </div>
          </div>
          <div class="preview-playerbar">
            <span class="preview-song-art"></span
            ><span
              ><strong title="暮色回声 · Twilight Echo · 真夜中の音楽"
                >暮色回声 · Twilight Echo · 真夜中の音楽</strong
              ><small>Theme Studio · 테마 미리보기</small></span
            ><i class="ph ph-skip-back"></i><button><i class="ph ph-pause"></i></button
            ><i class="ph ph-skip-forward"></i><span class="preview-progress"></span
            ><i class="ph ph-speaker-high"></i>
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

        <input
          v-if="draft"
          class="theme-name-input"
          :value="draft.name"
          maxlength="80"
          aria-label="主题名称"
          @change="changeName"
        />
        <div v-else class="read-only-theme">
          <i class="ph ph-lock"></i><span>创建副本后编辑</span>
        </div>

        <section v-if="domain === 'personalization'" class="studio-control-section">
          <div class="control-section-heading">
            <span>个性化运行模式</span><small>配置档 · {{ tone === 'dark' ? '深色' : '浅色' }}</small>
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
          <div
            v-if="activeModes.appearance?.toneScheduling === 'timed'"
            class="schedule-time-grid"
          >
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

        <section v-if="domain === 'typography'" class="studio-control-section">
          <div class="control-section-heading">
            <span>字体行为</span><small>配置档</small>
          </div>
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
            <span>{{ binding.label }}<small>{{ fontSource(binding) }}</small></span>
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

        <section
          v-if="domain === 'personalization' || domain === 'advanced'"
          class="asset-editor"
        >
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

        <div class="token-editor-list" :class="{ disabled: !draft }">
          <div v-for="definition in definitions" :key="definition.id" class="token-editor-row">
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

        <p v-if="localError || themeStore.error.value" class="studio-message error">
          {{ localError || themeStore.error.value }}
        </p>
        <p v-else-if="notice" class="studio-message">{{ notice }}</p>
      </aside>
    </div>
  </div>
</template>

<style src="./theme-studio/ThemeStudioPage.css"></style>
