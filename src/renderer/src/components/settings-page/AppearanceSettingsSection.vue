<script setup lang="ts">
import { computed, ref } from 'vue'
import EditableRangeValue from '../EditableRangeValue.vue'
import MiniPlayerSettingsSection from './MiniPlayerSettingsSection.vue'
import LyricsAppearanceCustomizer from '../LyricsAppearanceCustomizer.vue'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useThemeStore } from '../../stores/useThemeStore'
import { useExtensionRegistry } from '../../extensions/registry'
import { getPluginThemeKey } from '../../extensions/themeSelection'
import { useLyricsAppearanceEditor } from '../../composables/useLyricsAppearanceEditor.ts'
import { LYRICS_RANGES } from '../../../../shared/lyricsAppearance.ts'
import {
  PLAYER_BAR_BOUNDS,
  normalizePlayerBarPageVisibility,
  playerBarAutoHideApplies,
  type PlayerBarMode,
  type PlayerBarPageMode,
  type PlayerBarPageVisibility,
  type PlayerBarVisibility
} from '../../../../shared/playerBar.ts'
import {
  accentColorOptions,
  appBackgroundPageOptions,
  colorModeOptions,
  fontFamilyOptions,
  lyricAlignOptions,
  lyricsAppearanceFontFamilyOptions,
  lyricsFocusLineCountOptions,
  motionPreferenceOptions,
  playerBarModeOptions,
  playerBarPageModeOptions,
  playerBarPageVisibilityOptions,
  playerBarVisibilityOptions,
  uiDensityOptions,
  type BooleanSettingKey
} from './types.ts'
import type {
  AppBackgroundKind,
  AppBackgroundPage,
  AppBackgroundSettings,
  AppSettings,
  AppTheme,
  CardAppearanceSettings,
  CardAppearanceTheme,
  CardHoverEffect,
  CardShadowStrength,
  LiquidGlassSettings,
  LiquidGlassTheme,
  LyricsAppearanceSettings,
  MotionPreference,
  UiDensity
} from '../../types/settings'

const emit = defineEmits<{
  openThemeStudio: []
}>()

const { settings, updateSettings, importBackgroundImage } = useSettingsStore()
const themeStore = useThemeStore()
const { themeContributions } = useExtensionRegistry()
const customBackgroundOpen = ref(false)
const cardAppearanceOpen = ref(false)
const backgroundPageOpen = ref<AppBackgroundPage | null>(null)
const backgroundFileInputRef = ref<HTMLInputElement | null>(null)
const pendingBackgroundTarget = ref<'global' | AppBackgroundPage | null>(null)

const lyricsEditor = useLyricsAppearanceEditor()
const lyricsRanges = LYRICS_RANGES
const lyricsCustomizerOpen = ref(false)

const pluginThemeOptions = computed(() =>
  themeContributions.value.map((theme) => ({
    value: getPluginThemeKey(theme),
    label: `${theme.name} (${theme.pluginId})`
  }))
)
const selectedPluginThemeKey = computed(() => {
  const selection = themeStore.activeTheme.value
  return selection.kind === 'plugin' ? `${selection.pluginId}:${selection.themeId}` : ''
})

function setTheme(theme: AppTheme): void {
  if (settings.value.theme === theme) return
  void updateSettings({ theme })
}

function setMotionPreference(event: Event): void {
  const motionPreference = (event.target as HTMLSelectElement).value as MotionPreference
  void updateSettings({ motionPreference })
}

function setAccentColor(mode: 'light' | 'dark', color: string): void {
  if (mode === 'light') {
    if (settings.value.lightAccentColor === color) return
    void updateSettings({ accentColor: color, lightAccentColor: color })
    return
  }
  if (settings.value.darkAccentColor === color) return
  void updateSettings({ darkAccentColor: color })
}

function setFontFamily(event: Event): void {
  void updateSettings({ fontFamily: (event.target as HTMLSelectElement).value })
}

async function setPluginTheme(event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value
  if (!value) {
    await themeStore.setActive({ kind: 'builtin', id: 'builtin:twilight-echo-default' })
    return
  }
  const contribution = themeContributions.value.find((theme) => getPluginThemeKey(theme) === value)
  if (!contribution) return
  await themeStore.setActive({
    kind: 'plugin',
    pluginId: contribution.pluginId,
    themeId: contribution.id
  })
}

function setUiDensity(density: UiDensity): void {
  if (settings.value.uiDensity === density) return
  void updateSettings({ uiDensity: density })
}

function toggleSetting(key: BooleanSettingKey): void {
  void updateSettings({ [key]: !settings.value[key] } as Partial<AppSettings>)
}

function toBackgroundImageStyle(image: string): string {
  return image ? `url("${image.replace(/"/g, '\\"')}")` : 'none'
}

function cloneAppBackground(): AppBackgroundSettings {
  const background = settings.value.appBackground
  return {
    global: { ...background.global },
    pages: {
      local: { ...background.pages.local },
      settings: { ...background.pages.settings },
      streaming: { ...background.pages.streaming },
      player: { ...background.pages.player }
    }
  }
}

function setGlobalBackgroundColor(mode: 'light' | 'dark', color: string): void {
  if (settings.value.appBackground.global[mode] === color) return
  const appBackground = cloneAppBackground()
  appBackground.global[mode] = color
  void updateSettings({
    appBackground
  })
}

function setGlobalBackgroundKind(kind: AppBackgroundKind): void {
  if (settings.value.appBackground.global.kind === kind) return
  const appBackground = cloneAppBackground()
  appBackground.global.kind = kind
  void updateSettings({
    appBackground
  })
}

function openBackgroundFilePicker(target: 'global' | AppBackgroundPage): void {
  pendingBackgroundTarget.value = target
  backgroundFileInputRef.value?.click()
}

async function applyGlobalBackgroundImage(image: string): Promise<void> {
  const appBackground = cloneAppBackground()
  appBackground.global.kind = 'image'
  appBackground.global.image = image
  void updateSettings({
    appBackground
  })
}

async function handleBackgroundFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const target = pendingBackgroundTarget.value
  input.value = ''
  pendingBackgroundTarget.value = null
  if (!file || !target) return
  const image = await importBackgroundImage(file)
  if (!image) return
  if (target === 'global') {
    await applyGlobalBackgroundImage(image)
    return
  }
  await applyPageBackgroundImage(target, image)
}

function clearGlobalBackgroundImage(): void {
  if (
    !settings.value.appBackground.global.image &&
    settings.value.appBackground.global.kind === 'color'
  )
    return
  const appBackground = cloneAppBackground()
  appBackground.global.kind = 'color'
  appBackground.global.image = ''
  void updateSettings({
    appBackground
  })
}

function setPageBackgroundInherited(page: AppBackgroundPage, inherit: boolean): void {
  const current = settings.value.appBackground.pages[page]
  if (current.inherit === inherit) return
  const appBackground = cloneAppBackground()
  appBackground.pages[page].inherit = inherit
  void updateSettings({
    appBackground
  })
}

function setPageBackgroundKind(page: AppBackgroundPage, kind: AppBackgroundKind): void {
  const current = settings.value.appBackground.pages[page]
  if (current.kind === kind) return
  const appBackground = cloneAppBackground()
  appBackground.pages[page].inherit = false
  appBackground.pages[page].kind = kind
  void updateSettings({
    appBackground
  })
}

function setPageBackgroundColor(
  page: AppBackgroundPage,
  mode: 'light' | 'dark',
  color: string
): void {
  const current = settings.value.appBackground.pages[page]
  if (current[mode] === color && !current.inherit) return
  const appBackground = cloneAppBackground()
  appBackground.pages[page].inherit = false
  appBackground.pages[page][mode] = color
  void updateSettings({
    appBackground
  })
}

async function applyPageBackgroundImage(page: AppBackgroundPage, image: string): Promise<void> {
  const appBackground = cloneAppBackground()
  appBackground.pages[page].inherit = false
  appBackground.pages[page].kind = 'image'
  appBackground.pages[page].image = image
  void updateSettings({
    appBackground
  })
}

function clearPageBackgroundImage(page: AppBackgroundPage): void {
  const current = settings.value.appBackground.pages[page]
  if (!current.image && current.kind === 'color') return
  const appBackground = cloneAppBackground()
  appBackground.pages[page].kind = 'color'
  appBackground.pages[page].image = ''
  void updateSettings({
    appBackground
  })
}

function toggleBackgroundPage(page: AppBackgroundPage): void {
  backgroundPageOpen.value = backgroundPageOpen.value === page ? null : page
}

function updateLyricsAppearance<K extends keyof LyricsAppearanceSettings>(
  key: K,
  value: LyricsAppearanceSettings[K]
): void {
  // The shared editor owns the legacy fan-out and the published bounds, so the
  // quick controls here cannot drift from the full editor in the drawer.
  lyricsEditor.setGlobal(key, value)
}

const cardAppearanceTab = ref<'light' | 'dark'>('light')

const cardShadowOptions: { value: CardShadowStrength; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'subtle', label: '弱' },
  { value: 'medium', label: '中' },
  { value: 'strong', label: '强' }
]

const cardHoverOptions: { value: CardHoverEffect; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'lift', label: '上浮' },
  { value: 'zoom', label: '放大' },
  { value: 'glow', label: '发光' }
]

function cloneCardAppearance(): CardAppearanceSettings {
  const ca = settings.value.cardAppearance
  return {
    enabled: ca.enabled,
    light: { ...ca.light },
    dark: { ...ca.dark },
    background: {
      enabled: ca.background.enabled,
      light: { ...ca.background.light },
      dark: { ...ca.background.dark }
    }
  }
}

function toggleCardAppearance(): void {
  const cardAppearance = cloneCardAppearance()
  cardAppearance.enabled = !cardAppearance.enabled
  void updateSettings({ cardAppearance })
}

function toggleCardBackgroundEffect(): void {
  const cardAppearance = cloneCardAppearance()
  cardAppearance.background.enabled = !cardAppearance.background.enabled
  void updateSettings({ cardAppearance })
}

function setCardField<K extends keyof CardAppearanceTheme>(
  field: K,
  value: CardAppearanceTheme[K]
): void {
  const cardAppearance = cloneCardAppearance()
  const theme = cardAppearanceTab.value
  cardAppearance[theme][field] = value
  void updateSettings({ cardAppearance })
}

function setBgEffectField<K extends keyof typeof settings.value.cardAppearance.background.light>(
  field: K,
  value: number
): void {
  const cardAppearance = cloneCardAppearance()
  const theme = cardAppearanceTab.value
  ;(cardAppearance.background[theme] as any)[field] = value
  void updateSettings({ cardAppearance })
}

const liquidGlassOpen = ref(false)
const liquidGlassTab = ref<'light' | 'dark'>('light')

function cloneLiquidGlass(): LiquidGlassSettings {
  const lg = settings.value.liquidGlass
  return {
    followPointer: lg.followPointer,
    overLight: lg.overLight,
    fullGlass: lg.fullGlass,
    light: { ...lg.light },
    dark: { ...lg.dark }
  }
}

function toggleLiquidGlass(): void {
  void updateSettings({
    surfaceMaterial: settings.value.surfaceMaterial === 'liquidGlass' ? 'standard' : 'liquidGlass'
  })
}

function toggleLiquidGlassPointer(): void {
  const liquidGlass = cloneLiquidGlass()
  liquidGlass.followPointer = !liquidGlass.followPointer
  void updateSettings({ liquidGlass })
}

function toggleLiquidGlassFull(): void {
  const liquidGlass = cloneLiquidGlass()
  liquidGlass.fullGlass = !liquidGlass.fullGlass
  void updateSettings({ liquidGlass })
}

function setLiquidGlassField<K extends keyof LiquidGlassTheme>(
  field: K,
  value: LiquidGlassTheme[K]
): void {
  const liquidGlass = cloneLiquidGlass()
  liquidGlass[liquidGlassTab.value][field] = value
  void updateSettings({ liquidGlass })
}

const playerBarOpen = ref(false)

function setPlayerBarMode(mode: PlayerBarMode): void {
  if (settings.value.playerBar.mode === mode) return
  void updateSettings({ playerBar: { ...settings.value.playerBar, mode } })
}

function setPlayerBarPlayingPageMode(value: string): void {
  const playingPageMode: PlayerBarPageMode =
    value === 'mini' || value === 'standard' ? value : 'inherit'
  if (settings.value.playerBar.playingPageMode === playingPageMode) return
  void updateSettings({ playerBar: { ...settings.value.playerBar, playingPageMode } })
}

function setPlayerBarVisibility(visibility: PlayerBarVisibility): void {
  if (settings.value.playerBar.visibility === visibility) return
  void updateSettings({ playerBar: { ...settings.value.playerBar, visibility } })
}

function setPlayerBarPlayingPageVisibility(value: string): void {
  const playingPageVisibility = normalizePlayerBarPageVisibility(value)
  if (settings.value.playerBar.playingPageVisibility === playingPageVisibility) return
  void updateSettings({ playerBar: { ...settings.value.playerBar, playingPageVisibility } })
}

function setPlayerBarNumber(field: 'revealThresholdPx' | 'hideDelayMs', value: number): void {
  if (!Number.isFinite(value)) return
  void updateSettings({ playerBar: { ...settings.value.playerBar, [field]: value } })
}

/**
 * The reveal sliders only matter if auto-hide can actually take effect somewhere,
 * so ask the shared policy about both scopes rather than re-deriving the rules.
 */
const autoHideAppliesAnywhere = computed(() => {
  const bar = settings.value.playerBar
  return (
    playerBarAutoHideApplies(bar, { onPlayingPage: false }) ||
    playerBarAutoHideApplies(bar, { onPlayingPage: true })
  )
})

/** Shape resolved for each scope, for explaining why auto-hide is unavailable. */
const globalResolvesMini = computed(() => settings.value.playerBar.mode === 'mini')
const playingPageResolvesMini = computed(() => {
  const bar = settings.value.playerBar
  return bar.playingPageMode === 'inherit' ? bar.mode === 'mini' : bar.playingPageMode === 'mini'
})

/**
 * Auto-hide needs the mini shape. Rather than letting the user pick a step that
 * silently does nothing, mark it unavailable per scope and say why.
 */
function visibilityOptionDisabled(value: PlayerBarVisibility | PlayerBarPageVisibility): boolean {
  return value === 'autoHide' && !globalResolvesMini.value
}

function pageVisibilityOptionDisabled(value: PlayerBarPageVisibility): boolean {
  return value === 'autoHide' && !playingPageResolvesMini.value
}
</script>

<template>
  <input
    ref="backgroundFileInputRef"
    class="visually-hidden-file-input"
    type="file"
    accept="image/jpeg,image/png,image/webp"
    @change="handleBackgroundFileSelected"
  />
  <section id="appearance" class="glass-card preview-section">
    <div class="section-title-row">
      <i class="pi pi-palette"></i>
      <h2>外观 (Appearance)</h2>
    </div>

    <div class="setting-list">
      <div class="setting-item">
        <div class="setting-copy">
          <strong>主题工作室 · Beta</strong>
          <span>深度主题编辑（Beta）。P7 收口前以契约测试为准，完整像素证据包仍待入库。</span>
        </div>
        <button type="button" class="primary-button" @click="emit('openThemeStudio')">
          <i class="ph ph-swatches"></i>
          打开主题工作室
        </button>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>主题模式</strong>
          <span>跟随系统或固定为浅色、深色。</span>
        </div>
        <div class="theme-segment">
          <button
            v-for="option in colorModeOptions"
            :key="option.value"
            type="button"
            :class="{ active: settings.theme === option.value }"
            @click="setTheme(option.value)"
          >
            <i :class="option.icon"></i>
            {{ option.label }}
          </button>
        </div>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>界面动效</strong>
          <span>完整模式提供更强的操作反馈；减少或关闭模式可降低视觉移动。</span>
        </div>
        <select
          class="preview-select wide"
          :value="settings.motionPreference"
          @change="setMotionPreference"
        >
          <option
            v-for="option in motionPreferenceOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>插件主题</strong>
          <span>从已启用主题插件中选择声明式主题样式。</span>
        </div>
        <select
          class="preview-select wide"
          :value="selectedPluginThemeKey"
          :disabled="pluginThemeOptions.length === 0"
          @change="setPluginTheme"
        >
          <option value="">不使用插件主题</option>
          <option v-for="option in pluginThemeOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>浅色强调色</strong>
          <span>浅色模式下设置、本地主页和主要控件使用的主题色。</span>
        </div>
        <div class="swatch-row">
          <span
            v-for="option in accentColorOptions"
            :key="option.value"
            class="swatch"
            data-te-interactive
            role="button"
            tabindex="0"
            :aria-label="option.label"
            :aria-pressed="settings.lightAccentColor === option.value"
            :class="[option.class, { active: settings.lightAccentColor === option.value }]"
            :title="option.label"
            @click="setAccentColor('light', option.value)"
            @keydown.enter.prevent="setAccentColor('light', option.value)"
            @keydown.space.prevent="setAccentColor('light', option.value)"
          >
            <i v-if="settings.lightAccentColor === option.value" class="pi pi-check"></i>
          </span>
        </div>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>深色强调色</strong>
          <span>深色模式下复用同一组选项，可与浅色模式独立保存。</span>
        </div>
        <div class="swatch-row">
          <span
            v-for="option in accentColorOptions"
            :key="option.value"
            class="swatch"
            data-te-interactive
            role="button"
            tabindex="0"
            :aria-label="option.label"
            :aria-pressed="settings.darkAccentColor === option.value"
            :class="[option.class, { active: settings.darkAccentColor === option.value }]"
            :title="option.label"
            @click="setAccentColor('dark', option.value)"
            @keydown.enter.prevent="setAccentColor('dark', option.value)"
            @keydown.space.prevent="setAccentColor('dark', option.value)"
          >
            <i v-if="settings.darkAccentColor === option.value" class="pi pi-check"></i>
          </span>
        </div>
      </div>
      <hr />
      <div class="setting-item top-align">
        <div class="setting-copy">
          <strong>自定义背景</strong>
          <span>控制整个 App 的统一主背景，可上传图片，也可给不同页面单独覆盖。</span>
        </div>
        <div class="background-accordion">
          <button
            type="button"
            class="background-accordion-trigger"
            :class="{ active: customBackgroundOpen }"
            @click="customBackgroundOpen = !customBackgroundOpen"
          >
            <span>
              {{
                settings.appBackground.global.kind === 'image' &&
                settings.appBackground.global.image
                  ? '图片背景'
                  : '纯色背景'
              }}
            </span>
            <i class="pi pi-chevron-down"></i>
          </button>
          <div v-if="customBackgroundOpen" class="background-accordion-panel">
            <section class="background-editor">
              <div class="background-editor-head">
                <div>
                  <strong>统一背景</strong>
                  <span>深色模式默认 #17181a，图片模式下颜色会作为回退底色。</span>
                </div>
                <div class="background-kind-toggle">
                  <button
                    type="button"
                    :class="{ active: settings.appBackground.global.kind === 'color' }"
                    @click="setGlobalBackgroundKind('color')"
                  >
                    纯色
                  </button>
                  <button
                    type="button"
                    :class="{ active: settings.appBackground.global.kind === 'image' }"
                    @click="setGlobalBackgroundKind('image')"
                  >
                    图片
                  </button>
                </div>
              </div>
              <div class="background-color-stack">
                <label class="color-field">
                  <span>浅色</span>
                  <input
                    type="color"
                    :value="settings.appBackground.global.light"
                    @input="
                      setGlobalBackgroundColor('light', ($event.target as HTMLInputElement).value)
                    "
                  />
                  <code>{{ settings.appBackground.global.light }}</code>
                </label>
                <label class="color-field">
                  <span>深色</span>
                  <input
                    type="color"
                    :value="settings.appBackground.global.dark"
                    @input="
                      setGlobalBackgroundColor('dark', ($event.target as HTMLInputElement).value)
                    "
                  />
                  <code>{{ settings.appBackground.global.dark }}</code>
                </label>
              </div>
              <div class="background-image-actions">
                <span
                  v-if="settings.appBackground.global.image"
                  class="background-image-preview"
                  :style="{
                    backgroundImage: toBackgroundImageStyle(settings.appBackground.global.image)
                  }"
                ></span>
                <button
                  type="button"
                  class="pill-action"
                  @click="openBackgroundFilePicker('global')"
                >
                  <i class="pi pi-image"></i>
                  <span>{{ settings.appBackground.global.image ? '更换图片' : '选择图片' }}</span>
                </button>
                <button
                  type="button"
                  class="pill-action ghost"
                  :disabled="!settings.appBackground.global.image"
                  @click="clearGlobalBackgroundImage"
                >
                  移除图片
                </button>
                <small>{{
                  settings.appBackground.global.image ? '已选择图片' : '支持 JPG / PNG / WebP'
                }}</small>
              </div>
            </section>

            <section class="background-editor">
              <div class="background-editor-head">
                <div>
                  <strong>页面背景覆盖</strong>
                  <span>默认继承统一背景，展开后可给单个页面单独设置纯色或图片。</span>
                </div>
              </div>
              <div class="page-background-list">
                <div
                  v-for="page in appBackgroundPageOptions"
                  :key="page.value"
                  class="page-background-row"
                  :class="{ expanded: backgroundPageOpen === page.value }"
                >
                  <button
                    type="button"
                    class="page-background-header"
                    @click="toggleBackgroundPage(page.value)"
                  >
                    <span class="page-background-copy">
                      <strong>{{ page.label }}</strong>
                      <span>{{ page.desc }}</span>
                    </span>
                    <span class="page-background-state">
                      {{
                        settings.appBackground.pages[page.value].inherit
                          ? '继承'
                          : settings.appBackground.pages[page.value].kind === 'image'
                            ? '图片'
                            : '纯色'
                      }}
                    </span>
                    <i class="pi pi-chevron-down"></i>
                  </button>
                  <div v-if="backgroundPageOpen === page.value" class="page-background-controls">
                    <button
                      type="button"
                      class="inherit-toggle"
                      :class="{ active: settings.appBackground.pages[page.value].inherit }"
                      @click="
                        setPageBackgroundInherited(
                          page.value,
                          !settings.appBackground.pages[page.value].inherit
                        )
                      "
                    >
                      {{
                        settings.appBackground.pages[page.value].inherit
                          ? '当前继承统一背景'
                          : '当前使用自定义背景'
                      }}
                    </button>
                    <div
                      class="background-kind-toggle"
                      :class="{ disabled: settings.appBackground.pages[page.value].inherit }"
                    >
                      <button
                        type="button"
                        :class="{
                          active: settings.appBackground.pages[page.value].kind === 'color'
                        }"
                        @click="setPageBackgroundKind(page.value, 'color')"
                      >
                        纯色
                      </button>
                      <button
                        type="button"
                        :class="{
                          active: settings.appBackground.pages[page.value].kind === 'image'
                        }"
                        @click="setPageBackgroundKind(page.value, 'image')"
                      >
                        图片
                      </button>
                    </div>
                    <div
                      class="background-color-stack compact"
                      :class="{ disabled: settings.appBackground.pages[page.value].inherit }"
                    >
                      <label class="color-field">
                        <span>浅色</span>
                        <input
                          type="color"
                          :value="settings.appBackground.pages[page.value].light"
                          @input="
                            setPageBackgroundColor(
                              page.value,
                              'light',
                              ($event.target as HTMLInputElement).value
                            )
                          "
                        />
                        <code>{{ settings.appBackground.pages[page.value].light }}</code>
                      </label>
                      <label class="color-field">
                        <span>深色</span>
                        <input
                          type="color"
                          :value="settings.appBackground.pages[page.value].dark"
                          @input="
                            setPageBackgroundColor(
                              page.value,
                              'dark',
                              ($event.target as HTMLInputElement).value
                            )
                          "
                        />
                        <code>{{ settings.appBackground.pages[page.value].dark }}</code>
                      </label>
                    </div>
                    <div
                      class="background-image-actions"
                      :class="{ disabled: settings.appBackground.pages[page.value].inherit }"
                    >
                      <span
                        v-if="settings.appBackground.pages[page.value].image"
                        class="background-image-preview"
                        :style="{
                          backgroundImage: toBackgroundImageStyle(
                            settings.appBackground.pages[page.value].image
                          )
                        }"
                      ></span>
                      <button
                        type="button"
                        class="pill-action"
                        @click="openBackgroundFilePicker(page.value)"
                      >
                        <i class="pi pi-image"></i>
                        <span>{{
                          settings.appBackground.pages[page.value].image ? '更换图片' : '选择图片'
                        }}</span>
                      </button>
                      <button
                        type="button"
                        class="pill-action ghost"
                        :disabled="!settings.appBackground.pages[page.value].image"
                        @click="clearPageBackgroundImage(page.value)"
                      >
                        移除图片
                      </button>
                      <small>{{
                        settings.appBackground.pages[page.value].image ? '已选择图片' : '未设置图片'
                      }}</small>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>封面主题色</strong>
          <span>播放页和底栏使用当前专辑封面提取的主题色。</span>
        </div>
        <span
          class="toggle-switch"
          :class="{ active: settings.useCoverTheme, inactive: !settings.useCoverTheme }"
          role="switch"
          :aria-checked="settings.useCoverTheme"
          @click="toggleSetting('useCoverTheme')"
        ></span>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>全局字体 (Typography)</strong>
          <span>更换界面的主要显示字体。</span>
        </div>
        <select class="preview-select wide" :value="settings.fontFamily" @change="setFontFamily">
          <option v-for="option in fontFamilyOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy">
          <strong>界面排版密度 (UI Density)</strong>
          <span>控制列表项的间距与信息密度。</span>
        </div>
        <div class="segmented-control density">
          <button
            v-for="option in uiDensityOptions"
            :key="option.value"
            type="button"
            :class="{ active: settings.uiDensity === option.value }"
            @click="setUiDensity(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <hr />
      <div class="setting-item lyric-style-item">
        <div class="setting-copy">
          <strong>歌词显示样式 (Lyrics Style)</strong>
          <span>控制主播放页的排版、聚焦范围和高亮效果。</span>
        </div>
        <div class="inline-controls">
          <select
            class="preview-select"
            :value="settings.lyricsAppearance.fontFamily"
            @change="
              updateLyricsAppearance(
                'fontFamily',
                ($event.target as HTMLSelectElement).value as LyricsAppearanceSettings['fontFamily']
              )
            "
          >
            <option
              v-for="option in lyricsAppearanceFontFamilyOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
          <select
            class="preview-select"
            :value="settings.lyricsAppearance.align"
            @change="
              updateLyricsAppearance(
                'align',
                ($event.target as HTMLSelectElement).value as LyricsAppearanceSettings['align']
              )
            "
          >
            <option v-for="option in lyricAlignOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <div class="range-pill">
            <span>字号</span>
            <input
              class="range-input"
              type="range"
              :min="lyricsRanges.fontSize.min"
              :max="lyricsRanges.fontSize.max"
              :value="settings.lyricsAppearance.fontSize"
              @input="
                updateLyricsAppearance(
                  'fontSize',
                  Number(($event.target as HTMLInputElement).value)
                )
              "
            />
            <EditableRangeValue
              :value="settings.lyricsAppearance.fontSize"
              :min="lyricsRanges.fontSize.min"
              :max="lyricsRanges.fontSize.max"
              suffix="px"
              aria-label="编辑歌词字号"
              @change="updateLyricsAppearance('fontSize', $event)"
            />
          </div>
          <div class="range-pill">
            <span>字重</span>
            <input
              class="range-input"
              type="range"
              min="400"
              max="700"
              step="100"
              :value="settings.lyricsAppearance.fontWeight"
              @input="
                updateLyricsAppearance(
                  'fontWeight',
                  Number(($event.target as HTMLInputElement).value)
                )
              "
            />
            <EditableRangeValue
              :value="settings.lyricsAppearance.fontWeight"
              :min="400"
              :max="700"
              :step="100"
              aria-label="编辑歌词字重"
              @change="updateLyricsAppearance('fontWeight', $event)"
            />
          </div>
          <div class="range-pill">
            <span>行距</span>
            <input
              class="range-input"
              type="range"
              :min="lyricsRanges.lineHeight.min"
              :max="lyricsRanges.lineHeight.max"
              :step="lyricsRanges.lineHeight.step"
              :value="settings.lyricsAppearance.lineHeight"
              @input="
                updateLyricsAppearance(
                  'lineHeight',
                  Number(($event.target as HTMLInputElement).value)
                )
              "
            />
            <EditableRangeValue
              :value="settings.lyricsAppearance.lineHeight"
              :min="lyricsRanges.lineHeight.min"
              :max="lyricsRanges.lineHeight.max"
              :step="lyricsRanges.lineHeight.step"
              aria-label="编辑歌词行距"
              @change="updateLyricsAppearance('lineHeight', $event)"
            />
          </div>
          <div class="range-pill">
            <span>未播放暗度</span>
            <input
              class="range-input"
              type="range"
              :min="lyricsRanges.inactiveOpacity.min"
              :max="lyricsRanges.inactiveOpacity.max"
              :step="lyricsRanges.inactiveOpacity.step"
              :value="settings.lyricsAppearance.inactiveOpacity"
              @input="
                updateLyricsAppearance(
                  'inactiveOpacity',
                  Number(($event.target as HTMLInputElement).value)
                )
              "
            />
            <EditableRangeValue
              :value="settings.lyricsAppearance.inactiveOpacity"
              :min="lyricsRanges.inactiveOpacity.min"
              :max="lyricsRanges.inactiveOpacity.max"
              suffix="%"
              aria-label="编辑未播放歌词暗度"
              @change="updateLyricsAppearance('inactiveOpacity', $event)"
            />
          </div>
        </div>
        <div class="inline-controls">
          <div class="segmented-control density" role="group" aria-label="歌词聚焦行数">
            <button
              v-for="option in lyricsFocusLineCountOptions"
              :key="option.value"
              type="button"
              :class="{ active: settings.lyricsAppearance.focusLineCount === option.value }"
              @click="updateLyricsAppearance('focusLineCount', option.value)"
            >
              {{ option.label }}
            </button>
          </div>
          <div class="setting-copy">
            <strong>逐字高亮</strong>
            <span>按逐字时间戳显示扫光效果。</span>
          </div>
          <span
            class="toggle-switch"
            :class="{
              active: settings.lyricsAppearance.karaokeEnabled,
              inactive: !settings.lyricsAppearance.karaokeEnabled
            }"
            role="switch"
            :aria-checked="settings.lyricsAppearance.karaokeEnabled"
            @click="
              updateLyricsAppearance('karaokeEnabled', !settings.lyricsAppearance.karaokeEnabled)
            "
          ></span>
        </div>
        <div class="inline-controls">
          <div class="segmented-control density" role="group" aria-label="歌词颜色来源">
            <button
              type="button"
              :class="{ active: settings.lyricsAppearance.colorMode === 'theme' }"
              @click="updateLyricsAppearance('colorMode', 'theme')"
            >
              跟随主题
            </button>
            <button
              type="button"
              :class="{ active: settings.lyricsAppearance.colorMode === 'custom' }"
              @click="updateLyricsAppearance('colorMode', 'custom')"
            >
              自定义
            </button>
          </div>
          <template v-if="settings.lyricsAppearance.colorMode === 'custom'">
            <label class="range-pill">
              <span>正文</span>
              <input
                type="color"
                class="color-picker"
                :value="settings.lyricsAppearance.textColor"
                @input="
                  updateLyricsAppearance('textColor', ($event.target as HTMLInputElement).value)
                "
              />
            </label>
            <label class="range-pill">
              <span>当前行</span>
              <input
                type="color"
                class="color-picker"
                :value="settings.lyricsAppearance.activeColor"
                @input="
                  updateLyricsAppearance('activeColor', ($event.target as HTMLInputElement).value)
                "
              />
            </label>
            <label class="range-pill">
              <span>逐字高亮</span>
              <input
                type="color"
                class="color-picker"
                :value="settings.lyricsAppearance.karaokeColor"
                @input="
                  updateLyricsAppearance('karaokeColor', ($event.target as HTMLInputElement).value)
                "
              />
            </label>
          </template>
        </div>
        <div class="inline-controls">
          <div class="setting-copy">
            <strong>逐层个性化</strong>
            <span>
              分别设置普通、当前、翻译、罗马音四层的字体与字号，以及封面间距、聚焦范围和动效强度。
            </span>
          </div>
          <button type="button" class="soft-button" @click="lyricsCustomizerOpen = true">
            打开歌词个性化
          </button>
        </div>
      </div>
      <MiniPlayerSettingsSection />
      <hr />
      <button
        type="button"
        class="settings-accordion-trigger"
        :class="{ open: playerBarOpen }"
        :aria-expanded="playerBarOpen"
        @click="playerBarOpen = !playerBarOpen"
      >
        <span class="setting-copy">
          <strong>播放条形态与可见性</strong>
          <span
            >标准或迷你形态，配合常显 / 自动隐藏 /
            完全隐藏三档可见性；两者都可以在播放页单独覆盖。</span
          >
        </span>
        <i class="pi pi-chevron-down"></i>
      </button>
      <div v-if="playerBarOpen" class="settings-accordion-body">
        <hr />
        <div class="setting-item">
          <div class="setting-copy">
            <strong>播放条形态</strong>
            <span>迷你形态不显示封面、内联进度条与底边框进度，只保留歌曲信息与播放控制。</span>
          </div>
          <div class="segmented-control">
            <button
              v-for="option in playerBarModeOptions"
              :key="option.value"
              type="button"
              :class="{ active: settings.playerBar.mode === option.value }"
              @click="setPlayerBarMode(option.value)"
            >
              <i :class="option.icon"></i>
              {{ option.label }}
            </button>
          </div>
        </div>
        <hr />
        <div class="setting-item">
          <div class="setting-copy">
            <strong>播放页形态</strong>
            <span>可以只在播放页使用迷你播放条，其余界面保持标准形态。</span>
          </div>
          <select
            class="preview-select"
            :value="settings.playerBar.playingPageMode"
            @change="setPlayerBarPlayingPageMode(($event.target as HTMLSelectElement).value)"
          >
            <option
              v-for="option in playerBarPageModeOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </div>
        <hr />
        <div class="setting-item">
          <div class="setting-copy">
            <strong>播放条可见性</strong>
            <span>
              常显始终保留播放条；自动隐藏平时收起、鼠标靠近窗口底边时滑出（需迷你形态）；完全隐藏则不再出现，也不会被鼠标唤出。
            </span>
          </div>
          <div class="segmented-control">
            <button
              v-for="option in playerBarVisibilityOptions"
              :key="option.value"
              type="button"
              :class="{
                active: settings.playerBar.visibility === option.value,
                disabled: visibilityOptionDisabled(option.value)
              }"
              :disabled="visibilityOptionDisabled(option.value)"
              :title="visibilityOptionDisabled(option.value) ? '自动隐藏需要全局形态为迷你' : ''"
              @click="setPlayerBarVisibility(option.value)"
            >
              <i :class="option.icon"></i>
              {{ option.label }}
            </button>
          </div>
        </div>
        <hr />
        <div class="setting-item">
          <div class="setting-copy">
            <strong>播放页可见性</strong>
            <span>可以只在播放页自动隐藏或完全隐藏播放条，其余界面保持全局可见性。</span>
          </div>
          <select
            class="preview-select"
            :value="settings.playerBar.playingPageVisibility"
            @change="setPlayerBarPlayingPageVisibility(($event.target as HTMLSelectElement).value)"
          >
            <option
              v-for="option in playerBarPageVisibilityOptions"
              :key="option.value"
              :value="option.value"
              :disabled="pageVisibilityOptionDisabled(option.value)"
            >
              {{ option.label }}
            </option>
          </select>
        </div>
        <template v-if="autoHideAppliesAnywhere">
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>触发距离</strong>
              <span>鼠标距窗口底边多少像素内触发滑出。</span>
            </div>
            <div class="range-pill">
              <span>距离</span>
              <input
                class="range-input"
                type="range"
                :min="PLAYER_BAR_BOUNDS.revealThresholdPx.min"
                :max="PLAYER_BAR_BOUNDS.revealThresholdPx.max"
                :value="settings.playerBar.revealThresholdPx"
                @input="
                  setPlayerBarNumber(
                    'revealThresholdPx',
                    Number(($event.target as HTMLInputElement).value)
                  )
                "
              />
              <EditableRangeValue
                :value="settings.playerBar.revealThresholdPx"
                :min="PLAYER_BAR_BOUNDS.revealThresholdPx.min"
                :max="PLAYER_BAR_BOUNDS.revealThresholdPx.max"
                suffix="px"
                aria-label="编辑触发距离"
                @change="setPlayerBarNumber('revealThresholdPx', $event)"
              />
            </div>
          </div>
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>收起延迟</strong>
              <span>鼠标离开触发区后延迟多久收起播放条。</span>
            </div>
            <div class="range-pill">
              <span>延迟</span>
              <input
                class="range-input"
                type="range"
                :min="PLAYER_BAR_BOUNDS.hideDelayMs.min"
                :max="PLAYER_BAR_BOUNDS.hideDelayMs.max"
                step="50"
                :value="settings.playerBar.hideDelayMs"
                @input="
                  setPlayerBarNumber(
                    'hideDelayMs',
                    Number(($event.target as HTMLInputElement).value)
                  )
                "
              />
              <EditableRangeValue
                :value="settings.playerBar.hideDelayMs"
                :min="PLAYER_BAR_BOUNDS.hideDelayMs.min"
                :max="PLAYER_BAR_BOUNDS.hideDelayMs.max"
                :step="50"
                suffix="ms"
                aria-label="编辑收起延迟"
                @change="setPlayerBarNumber('hideDelayMs', $event)"
              />
            </div>
          </div>
        </template>
      </div>
      <hr />
      <button
        type="button"
        class="settings-accordion-trigger"
        :class="{ open: liquidGlassOpen }"
        :aria-expanded="liquidGlassOpen"
        @click="liquidGlassOpen = !liquidGlassOpen"
      >
        <span class="setting-copy">
          <strong>液态玻璃材质</strong>
          <span>为卡片与播放栏启用折射玻璃质感，可与现有材质随时切换。</span>
        </span>
        <i class="pi pi-chevron-down"></i>
      </button>
      <div v-if="liquidGlassOpen" class="settings-accordion-body">
        <hr />
        <div class="setting-item">
          <div class="setting-copy">
            <strong>启用液态玻璃</strong>
            <span> 开启后卡片与播放栏改用折射玻璃材质。大型媒体库滚动时会有额外 GPU 开销。 </span>
          </div>
          <span
            class="toggle-switch"
            :class="{ active: settings.surfaceMaterial === 'liquidGlass' }"
            role="switch"
            :aria-checked="settings.surfaceMaterial === 'liquidGlass'"
            @click="toggleLiquidGlass"
          ></span>
        </div>
        <div v-if="settings.surfaceMaterial === 'liquidGlass'">
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>高光跟随指针</strong>
              <span>镜面高光角度随鼠标移动变化；关闭后使用固定光源。</span>
            </div>
            <span
              class="toggle-switch"
              :class="{ active: settings.liquidGlass.followPointer }"
              role="switch"
              :aria-checked="settings.liquidGlass.followPointer"
              @click="toggleLiquidGlassPointer"
            ></span>
          </div>
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>完整液态玻璃</strong>
              <span>始终启用背景模糊与边缘折射；关闭后仅悬停时启动，可降低滚动功耗。</span>
            </div>
            <span
              class="toggle-switch"
              :class="{ active: settings.liquidGlass.fullGlass }"
              role="switch"
              :aria-checked="settings.liquidGlass.fullGlass"
              @click="toggleLiquidGlassFull"
            ></span>
          </div>
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>亮色背景加深</strong>
              <span>浅色背景下使用深色玻璃，让玻璃在亮背景上更清晰。</span>
            </div>
            <span
              class="toggle-switch"
              :class="{ active: settings.liquidGlass.overLight }"
              role="switch"
              :aria-checked="settings.liquidGlass.overLight"
              @click="
                updateSettings({
                  liquidGlass: {
                    ...cloneLiquidGlass(),
                    overLight: !settings.liquidGlass.overLight
                  }
                })
              "
            ></span>
          </div>
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>编辑主题</strong>
              <span>分别设置浅色与深色模式下的玻璃参数。</span>
            </div>
            <div class="theme-segment">
              <button
                type="button"
                :class="{ active: liquidGlassTab === 'light' }"
                @click="liquidGlassTab = 'light'"
              >
                <i class="pi pi-sun"></i>
                浅色
              </button>
              <button
                type="button"
                :class="{ active: liquidGlassTab === 'dark' }"
                @click="liquidGlassTab = 'dark'"
              >
                <i class="pi pi-moon"></i>
                深色
              </button>
            </div>
          </div>
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>折射强度</strong>
              <span>边缘弯曲背景的位移量，越高玻璃感越强。</span>
            </div>
            <div class="range-pill">
              <span>折射</span>
              <input
                class="range-input"
                type="range"
                min="0"
                max="140"
                :value="settings.liquidGlass[liquidGlassTab].displacementScale"
                @input="
                  setLiquidGlassField(
                    'displacementScale',
                    Number(($event.target as HTMLInputElement).value)
                  )
                "
              />
              <EditableRangeValue
                :value="settings.liquidGlass[liquidGlassTab].displacementScale"
                :min="0"
                :max="140"
                aria-label="编辑折射强度"
                @change="setLiquidGlassField('displacementScale', $event)"
              />
            </div>
          </div>
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>色散强度</strong>
              <span>边缘彩色分离的程度，模拟玻璃的色散。</span>
            </div>
            <div class="range-pill">
              <span>色散</span>
              <input
                class="range-input"
                type="range"
                min="0"
                max="8"
                step="0.5"
                :value="settings.liquidGlass[liquidGlassTab].aberrationIntensity"
                @input="
                  setLiquidGlassField(
                    'aberrationIntensity',
                    Number(($event.target as HTMLInputElement).value)
                  )
                "
              />
              <EditableRangeValue
                :value="settings.liquidGlass[liquidGlassTab].aberrationIntensity"
                :min="0"
                :max="8"
                aria-label="编辑色散强度"
                @change="setLiquidGlassField('aberrationIntensity', $event)"
              />
            </div>
          </div>
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>玻璃模糊</strong>
              <span>玻璃后方背景的模糊半径。</span>
            </div>
            <div class="range-pill">
              <span>模糊</span>
              <input
                class="range-input"
                type="range"
                min="0"
                max="40"
                :value="settings.liquidGlass[liquidGlassTab].blurAmount"
                @input="
                  setLiquidGlassField(
                    'blurAmount',
                    Number(($event.target as HTMLInputElement).value)
                  )
                "
              />
              <EditableRangeValue
                :value="settings.liquidGlass[liquidGlassTab].blurAmount"
                :min="0"
                :max="40"
                suffix="px"
                aria-label="编辑玻璃模糊"
                @change="setLiquidGlassField('blurAmount', $event)"
              />
            </div>
          </div>
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>玻璃饱和度</strong>
              <span>透过玻璃的色彩饱和感。</span>
            </div>
            <div class="range-pill">
              <span>饱和度</span>
              <input
                class="range-input"
                type="range"
                min="80"
                max="200"
                :value="settings.liquidGlass[liquidGlassTab].saturation"
                @input="
                  setLiquidGlassField(
                    'saturation',
                    Number(($event.target as HTMLInputElement).value)
                  )
                "
              />
              <EditableRangeValue
                :value="settings.liquidGlass[liquidGlassTab].saturation"
                :min="80"
                :max="200"
                suffix="%"
                aria-label="编辑玻璃饱和度"
                @change="setLiquidGlassField('saturation', $event)"
              />
            </div>
          </div>
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>弹性跟随</strong>
              <span>玻璃向光标方向伸展的程度，0 表示固定不跟随。</span>
            </div>
            <div class="range-pill">
              <span>弹性</span>
              <input
                class="range-input"
                type="range"
                min="0"
                max="100"
                :value="settings.liquidGlass[liquidGlassTab].elasticity"
                @input="
                  setLiquidGlassField(
                    'elasticity',
                    Number(($event.target as HTMLInputElement).value)
                  )
                "
              />
              <EditableRangeValue
                :value="settings.liquidGlass[liquidGlassTab].elasticity"
                :min="0"
                :max="100"
                suffix="%"
                aria-label="编辑弹性跟随"
                @change="setLiquidGlassField('elasticity', $event)"
              />
            </div>
          </div>
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>镜面高光</strong>
              <span>描边与高光的亮度。</span>
            </div>
            <div class="range-pill">
              <span>高光</span>
              <input
                class="range-input"
                type="range"
                min="0"
                max="100"
                :value="settings.liquidGlass[liquidGlassTab].specularOpacity"
                @input="
                  setLiquidGlassField(
                    'specularOpacity',
                    Number(($event.target as HTMLInputElement).value)
                  )
                "
              />
              <EditableRangeValue
                :value="settings.liquidGlass[liquidGlassTab].specularOpacity"
                :min="0"
                :max="100"
                suffix="%"
                aria-label="编辑镜面高光"
                @change="setLiquidGlassField('specularOpacity', $event)"
              />
            </div>
          </div>
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>表面着色</strong>
              <span>玻璃自身的底色浓度，越低越通透。</span>
            </div>
            <div class="range-pill">
              <span>着色</span>
              <input
                class="range-input"
                type="range"
                min="0"
                max="100"
                :value="settings.liquidGlass[liquidGlassTab].tintOpacity"
                @input="
                  setLiquidGlassField(
                    'tintOpacity',
                    Number(($event.target as HTMLInputElement).value)
                  )
                "
              />
              <EditableRangeValue
                :value="settings.liquidGlass[liquidGlassTab].tintOpacity"
                :min="0"
                :max="100"
                suffix="%"
                aria-label="编辑表面着色"
                @change="setLiquidGlassField('tintOpacity', $event)"
              />
            </div>
          </div>
        </div>
      </div>
      <hr />
      <button
        type="button"
        class="settings-accordion-trigger"
        :class="{ open: cardAppearanceOpen }"
        :aria-expanded="cardAppearanceOpen"
        @click="cardAppearanceOpen = !cardAppearanceOpen"
      >
        <span class="setting-copy">
          <strong>卡片与背景自定义</strong>
          <span>自由调节卡片模糊、颜色、圆角、阴影及背景模糊等外观。</span>
        </span>
        <i class="pi pi-chevron-down"></i>
      </button>
      <div v-if="cardAppearanceOpen" class="settings-accordion-body">
        <hr />
        <div class="setting-item">
          <div class="setting-copy">
            <strong>启用自定义外观</strong>
            <span>开启后应用下方卡片与背景效果。</span>
          </div>
          <span
            class="toggle-switch"
            :class="{ active: settings.cardAppearance.enabled }"
            role="switch"
            :aria-checked="settings.cardAppearance.enabled"
            @click="toggleCardAppearance"
          ></span>
        </div>
        <div v-if="settings.cardAppearance.enabled">
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>编辑主题</strong>
              <span>分别设置浅色与深色模式下的卡片外观。</span>
            </div>
            <div class="theme-segment">
              <button
                type="button"
                :class="{ active: cardAppearanceTab === 'light' }"
                @click="cardAppearanceTab = 'light'"
              >
                <i class="pi pi-sun"></i>
                浅色
              </button>
              <button
                type="button"
                :class="{ active: cardAppearanceTab === 'dark' }"
                @click="cardAppearanceTab = 'dark'"
              >
                <i class="pi pi-moon"></i>
                深色
              </button>
            </div>
          </div>
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>卡片模糊强度</strong>
              <span>控制卡片毛玻璃的模糊半径。</span>
            </div>
            <div class="range-pill">
              <span>模糊</span>
              <input
                class="range-input"
                type="range"
                min="0"
                max="40"
                :value="settings.cardAppearance[cardAppearanceTab].blurRadius"
                @input="
                  setCardField('blurRadius', Number(($event.target as HTMLInputElement).value))
                "
              />
              <EditableRangeValue
                :value="settings.cardAppearance[cardAppearanceTab].blurRadius"
                :min="0"
                :max="40"
                suffix="px"
                aria-label="编辑卡片模糊强度"
                @change="setCardField('blurRadius', $event)"
              />
            </div>
          </div>
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>卡片模糊饱和度</strong>
              <span>增强或减弱毛玻璃的色彩饱和感。</span>
            </div>
            <div class="range-pill">
              <span>饱和度</span>
              <input
                class="range-input"
                type="range"
                min="80"
                max="180"
                :value="settings.cardAppearance[cardAppearanceTab].blurSaturation"
                @input="
                  setCardField('blurSaturation', Number(($event.target as HTMLInputElement).value))
                "
              />
              <EditableRangeValue
                :value="settings.cardAppearance[cardAppearanceTab].blurSaturation"
                :min="80"
                :max="180"
                suffix="%"
                aria-label="编辑卡片模糊饱和度"
                @change="setCardField('blurSaturation', $event)"
              />
            </div>
          </div>
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>卡片背景颜色</strong>
              <span>自定义卡片的底色。</span>
            </div>
            <div class="inline-controls">
              <input
                type="color"
                class="color-picker"
                :value="settings.cardAppearance[cardAppearanceTab].backgroundColor"
                @input="setCardField('backgroundColor', ($event.target as HTMLInputElement).value)"
              />
              <div class="range-pill">
                <span>不透明度</span>
                <input
                  class="range-input"
                  type="range"
                  min="0"
                  max="100"
                  :value="settings.cardAppearance[cardAppearanceTab].backgroundOpacity"
                  @input="
                    setCardField(
                      'backgroundOpacity',
                      Number(($event.target as HTMLInputElement).value)
                    )
                  "
                />
                <EditableRangeValue
                  :value="settings.cardAppearance[cardAppearanceTab].backgroundOpacity"
                  :min="0"
                  :max="100"
                  suffix="%"
                  aria-label="编辑卡片背景不透明度"
                  @change="setCardField('backgroundOpacity', $event)"
                />
              </div>
            </div>
          </div>
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>卡片边框</strong>
              <span>自定义边框颜色、透明度与宽度。</span>
            </div>
            <div class="inline-controls">
              <input
                type="color"
                class="color-picker"
                :value="settings.cardAppearance[cardAppearanceTab].borderColor"
                @input="setCardField('borderColor', ($event.target as HTMLInputElement).value)"
              />
              <div class="range-pill">
                <span>透明度</span>
                <input
                  class="range-input"
                  type="range"
                  min="0"
                  max="100"
                  :value="settings.cardAppearance[cardAppearanceTab].borderOpacity"
                  @input="
                    setCardField('borderOpacity', Number(($event.target as HTMLInputElement).value))
                  "
                />
                <EditableRangeValue
                  :value="settings.cardAppearance[cardAppearanceTab].borderOpacity"
                  :min="0"
                  :max="100"
                  suffix="%"
                  aria-label="编辑卡片边框透明度"
                  @change="setCardField('borderOpacity', $event)"
                />
              </div>
              <div class="range-pill">
                <span>宽度</span>
                <input
                  class="range-input"
                  type="range"
                  min="0"
                  max="3"
                  step="0.5"
                  :value="settings.cardAppearance[cardAppearanceTab].borderWidth"
                  @input="
                    setCardField('borderWidth', Number(($event.target as HTMLInputElement).value))
                  "
                />
                <EditableRangeValue
                  :value="settings.cardAppearance[cardAppearanceTab].borderWidth"
                  :min="0"
                  :max="3"
                  :step="0.5"
                  suffix="px"
                  aria-label="编辑卡片边框宽度"
                  @change="setCardField('borderWidth', $event)"
                />
              </div>
            </div>
          </div>
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>卡片圆角半径</strong>
              <span>控制卡片边角的圆滑程度。</span>
            </div>
            <div class="range-pill">
              <span>圆角</span>
              <input
                class="range-input"
                type="range"
                min="0"
                max="24"
                :value="settings.cardAppearance[cardAppearanceTab].borderRadius"
                @input="
                  setCardField('borderRadius', Number(($event.target as HTMLInputElement).value))
                "
              />
              <EditableRangeValue
                :value="settings.cardAppearance[cardAppearanceTab].borderRadius"
                :min="0"
                :max="24"
                suffix="px"
                aria-label="编辑卡片圆角半径"
                @change="setCardField('borderRadius', $event)"
              />
            </div>
          </div>
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>卡片阴影强度</strong>
              <span>控制卡片投影的深浅。</span>
            </div>
            <div class="segmented-control">
              <button
                v-for="option in cardShadowOptions"
                :key="option.value"
                type="button"
                :class="{
                  active: settings.cardAppearance[cardAppearanceTab].shadowStrength === option.value
                }"
                @click="setCardField('shadowStrength', option.value)"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>卡片悬浮效果</strong>
              <span>鼠标悬停时卡片的动效。</span>
            </div>
            <div class="segmented-control">
              <button
                v-for="option in cardHoverOptions"
                :key="option.value"
                type="button"
                :class="{
                  active: settings.cardAppearance[cardAppearanceTab].hoverEffect === option.value
                }"
                @click="setCardField('hoverEffect', option.value)"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>玻璃高光</strong>
              <span>在卡片顶部添加内描边光泽。</span>
            </div>
            <span
              class="toggle-switch"
              :class="{ active: settings.cardAppearance[cardAppearanceTab].glassHighlight }"
              role="switch"
              :aria-checked="settings.cardAppearance[cardAppearanceTab].glassHighlight"
              @click="
                setCardField(
                  'glassHighlight',
                  !settings.cardAppearance[cardAppearanceTab].glassHighlight
                )
              "
            ></span>
          </div>
          <hr />
          <div class="setting-item">
            <div class="setting-copy">
              <strong>背景模糊与暗化</strong>
              <span>对 App 背景图片施加模糊、亮度调节与暗化遮罩。</span>
            </div>
            <span
              class="toggle-switch"
              :class="{ active: settings.cardAppearance.background.enabled }"
              role="switch"
              :aria-checked="settings.cardAppearance.background.enabled"
              @click="toggleCardBackgroundEffect"
            ></span>
          </div>
          <div v-if="settings.cardAppearance.background.enabled">
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>背景模糊</strong>
                <span>模糊背景图片的半径。</span>
              </div>
              <div class="range-pill">
                <span>模糊</span>
                <input
                  class="range-input"
                  type="range"
                  min="0"
                  max="30"
                  :value="settings.cardAppearance.background[cardAppearanceTab].blur"
                  @input="
                    setBgEffectField('blur', Number(($event.target as HTMLInputElement).value))
                  "
                />
                <EditableRangeValue
                  :value="settings.cardAppearance.background[cardAppearanceTab].blur"
                  :min="0"
                  :max="30"
                  suffix="px"
                  aria-label="编辑背景模糊度"
                  @change="setBgEffectField('blur', $event)"
                />
              </div>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>背景亮度</strong>
                <span>调暗或提亮背景图片。</span>
              </div>
              <div class="range-pill">
                <span>亮度</span>
                <input
                  class="range-input"
                  type="range"
                  min="50"
                  max="120"
                  :value="settings.cardAppearance.background[cardAppearanceTab].brightness"
                  @input="
                    setBgEffectField(
                      'brightness',
                      Number(($event.target as HTMLInputElement).value)
                    )
                  "
                />
                <EditableRangeValue
                  :value="settings.cardAppearance.background[cardAppearanceTab].brightness"
                  :min="50"
                  :max="120"
                  suffix="%"
                  aria-label="编辑背景亮度"
                  @change="setBgEffectField('brightness', $event)"
                />
              </div>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>背景暗化遮罩</strong>
                <span>叠加黑色遮罩使前景更突出。</span>
              </div>
              <div class="range-pill">
                <span>暗化</span>
                <input
                  class="range-input"
                  type="range"
                  min="0"
                  max="80"
                  :value="settings.cardAppearance.background[cardAppearanceTab].dim"
                  @input="
                    setBgEffectField('dim', Number(($event.target as HTMLInputElement).value))
                  "
                />
                <EditableRangeValue
                  :value="settings.cardAppearance.background[cardAppearanceTab].dim"
                  :min="0"
                  :max="80"
                  suffix="%"
                  aria-label="编辑背景暗化遮罩"
                  @change="setBgEffectField('dim', $event)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
  <Teleport to="body">
    <LyricsAppearanceCustomizer
      :open="lyricsCustomizerOpen"
      @close="lyricsCustomizerOpen = false"
    />
  </Teleport>
</template>
