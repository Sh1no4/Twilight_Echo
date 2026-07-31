import type { VersionedDataEnvelope } from './versionedPersistence.ts'
import {
  normalizeThemeShellLayout,
  THEME_SHELL_MANAGED_DATA_ATTRIBUTES,
  type ThemeShellLayout
} from './themeLayout.ts'

export {
  findInvalidThemeShellLayoutFields,
  themeShellLayoutToCssVariables,
  themeShellLayoutToDataAttributes,
  THEME_SHELL_MANAGED_DATA_ATTRIBUTES,
  THEME_SHELL_SLOT_IDS,
  THEME_SHELL_TRACK_IDS,
  type ThemeShellGrid,
  type ThemeShellGridArea,
  type ThemeShellLayout,
  type ThemeShellNavigationMode,
  type ThemeShellSlotId,
  type ThemeShellTrackId
} from './themeLayout.ts'

export const TWILIGHT_DEFAULT_THEME_ID = 'builtin:twilight-echo-default'
export const BUILT_IN_THEME_PRESET_IDS = [
  TWILIGHT_DEFAULT_THEME_ID,
  'builtin:aurora-reference',
  'builtin:obsidian-glass',
  'builtin:paper-light',
  'builtin:neon-gradient',
  'builtin:studio-split',
  'builtin:zen-minimal'
] as const
export const THEME_DOCUMENT_SCHEMA_VERSION = 1
export const STRUCTURED_PLUGIN_THEME_MODE_SCHEMA_VERSION = 2
export const STRUCTURED_PLUGIN_THEME_SCHEMA_VERSION = 3
export const THEME_PROFILE_SCHEMA_VERSION = 2
export const THEME_ARCHIVE_SCHEMA_VERSION = 2
export const THEME_LIBRARY_SCHEMA_VERSION = 1
export const MAX_USER_THEME_PROFILES = 32
export const MAX_THEME_PROFILE_HISTORY_ENTRIES = 8
export const MAX_THEME_PROFILE_HISTORY_BYTES = 256 * 1024

export type BuiltInThemePresetId = (typeof BUILT_IN_THEME_PRESET_IDS)[number]

export type ThemeTone = 'pureWhite' | 'dark'
export type ThemeTokenKind =
  | 'color'
  | 'length'
  | 'number'
  | 'font'
  | 'shadow'
  | 'filter'
  | 'gradient'
  | 'easing'
  | 'enum'
  | 'raw'

export type ThemeTokenGroup =
  | 'colors'
  | 'typography'
  | 'materials'
  | 'shape'
  | 'layout'
  | 'motion'
  | 'playback'

export interface ThemeTokenDefinition {
  id: string
  cssVariable: `--te-${string}`
  label: string
  group: ThemeTokenGroup
  surface: string
  kind: ThemeTokenKind
  defaults: Record<ThemeTone, string>
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: string[]
  adaptive?: 'cover-accent'
}

export interface ThemeVariant {
  tokens: Record<string, string>
}

export interface ThemeMiniPlayerDefaults {
  surfaceColor?: string
  accentColor?: string
  primaryTextColor?: string
  mutedTextColor?: string
  fontFamily?: string
  surfaceOpacity?: number
  glassBlur?: number
  cornerRadius?: number
  borderWidth?: number
  borderColor?: string
  shadowStrength?: number
  shadowColor?: string
}

export interface ThemeDesktopLyricsDefaults {
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  color?: string
  highlightColor?: string
  backgroundColor?: string
  backgroundOpacity?: number
  shadow?: boolean
  shadowBlur?: number
  shadowColor?: string
}

export interface ThemeWindowDefaults {
  miniPlayer?: ThemeMiniPlayerDefaults
  desktopLyrics?: ThemeDesktopLyricsDefaults
}

export type ThemeAssetType = 'image' | 'font'

export interface ThemeAssetReference {
  id: string
  path: string
  type: ThemeAssetType
}

export interface ThemeAssetBindings {
  appBackground?: string
  localBackground?: string
  settingsBackground?: string
  streamingBackground?: string
  playerBackground?: string
  sansFont?: string
  displayFont?: string
  roundedFont?: string
}

export interface ThemeDocumentV1 {
  schemaVersion: 1
  id: string
  name: string
  description: string
  variants: Record<ThemeTone, ThemeVariant>
  windowDefaults?: ThemeWindowDefaults
}

export interface ThemeProfileV1 {
  schemaVersion: 1
  id: string
  name: string
  description: string
  baseThemeId: string
  createdAt: string
  updatedAt: string
  overrides: Record<ThemeTone, Record<string, string>>
  windowDefaults?: ThemeWindowDefaults
  assets?: ThemeAssetReference[]
  assetBindings?: ThemeAssetBindings
}

export type ThemeAppearanceAccentSource = 'fixed' | 'cover'
export type ThemeBackgroundTreatment = 'solid' | 'gradient' | 'cover-blur' | 'image'
export type ThemeToneScheduling = 'manual' | 'system' | 'timed'
export type ThemeContrastGuard = 'off' | 'warn' | 'enforce'
export type ThemeNavigationStyle = 'expanded' | 'compact' | 'rail'
export type ThemeIconScale = 'sm' | 'md' | 'lg'
export type ThemeNavigationLogo = 'show' | 'hide'
export type ThemeLibraryDensity = 'comfortable' | 'compact'
export type ThemeLibrarySelection = 'fill' | 'stroke'
export type ThemeLibraryTitleOverlay = 'off' | 'on'
export type ThemePlayerLayout = 'standard' | 'full-cover' | 'lyrics-focus' | 'split' | 'minimal'
export type ThemePlayerControls = 'standard' | 'pro'
export type ThemePlayerTitleAlign = 'left' | 'center'
export type ThemePlayerProgressStyle = 'line' | 'ring' | 'solid' | 'spectrum'
export type ThemeArtworkTransition = 'fade' | 'slide' | 'none'
export type ThemeArtworkShadow = 'on' | 'off'
export type ThemeEqualizerPanelStyle = 'neutral' | 'tinted' | 'glass'
export type ThemeEqualizerSliderStyle = 'ring' | 'solid'
export type ThemeEqualizerKnobIndicator = 'line' | 'dot'
export type ThemeEqualizerSpectrumStyle = 'bars' | 'line' | 'area'
export type ThemeEqualizerButtonStyle = 'soft' | 'outline' | 'solid'
export type ThemeIconFamily = 'outline' | 'rounded' | 'filled'
export type ThemeTitleCase = 'preserve' | 'uppercase'
export type ThemeLyricAccent = 'off' | 'accent'
export type ThemeTitleColorStyle = 'off' | 'track' | 'artist-album'
export type ThemeEffectsMode = 'full' | 'reduced'

export interface ThemeToneSchedule {
  lightStartMinutes: number
  darkStartMinutes: number
}

export type ThemeVisibilitySlotId =
  | 'playerAlbumArtist'
  | 'playerArtwork'
  | 'playerTrackMenu'
  | 'playerMiscIcons'
  | 'playerDuration'
  | 'playerWaveform'
  | 'playerTrackInfo'
  | 'equalizerGrid'
  | 'equalizerFrequencyGuides'
  | 'equalizerSpectrum'
  | 'previousButton'
  | 'nextButton'
  | 'miniPlayerArtwork'

export interface ThemeModes {
  appearance?: {
    accentSource?: ThemeAppearanceAccentSource
    backgroundTreatment?: ThemeBackgroundTreatment
    toneScheduling?: ThemeToneScheduling
    contrastGuard?: ThemeContrastGuard
    effectsMode?: ThemeEffectsMode
  }
  navigation?: {
    style?: ThemeNavigationStyle
    iconScale?: ThemeIconScale
    logo?: ThemeNavigationLogo
  }
  library?: {
    density?: ThemeLibraryDensity
    selection?: ThemeLibrarySelection
    titleOverlay?: ThemeLibraryTitleOverlay
  }
  player?: {
    layout?: ThemePlayerLayout
    controls?: ThemePlayerControls
    titleAlign?: ThemePlayerTitleAlign
    progress?: ThemePlayerProgressStyle
  }
  artwork?: {
    transition?: ThemeArtworkTransition
    shadow?: ThemeArtworkShadow
  }
  equalizer?: {
    panel?: ThemeEqualizerPanelStyle
    slider?: ThemeEqualizerSliderStyle
    knob?: ThemeEqualizerKnobIndicator
    spectrum?: ThemeEqualizerSpectrumStyle
    button?: ThemeEqualizerButtonStyle
  }
  icons?: {
    family?: ThemeIconFamily
  }
  typography?: {
    titleCase?: ThemeTitleCase
    lyricAccent?: ThemeLyricAccent
    titleColor?: ThemeTitleColorStyle
  }
  visibility?: Partial<Record<ThemeVisibilitySlotId, boolean>>
}

export interface ThemeProfileV2 extends Omit<ThemeProfileV1, 'schemaVersion'> {
  schemaVersion: 2
  modes: ThemeModes
  toneSchedule?: ThemeToneSchedule
  source?: ThemeProfileSource
}

export interface ThemeProfileSource {
  kind: 'builtin-preset'
  presetId: BuiltInThemePresetId
}

export type ThemeIconDomain = 'navigation' | 'library'

export interface ThemeIconSlotDefinition {
  domain: ThemeIconDomain
  classes: Readonly<Record<ThemeIconFamily, string>>
}

function themeIconSlot(domain: ThemeIconDomain, glyph: string): ThemeIconSlotDefinition {
  return Object.freeze({
    domain,
    classes: Object.freeze({
      outline: `ph ph-${glyph}`,
      rounded: `ph-bold ph-${glyph}`,
      filled: `ph-fill ph-${glyph}`
    })
  })
}

export const THEME_ICON_SLOT_REGISTRY = Object.freeze({
  'navigation.home': themeIconSlot('navigation', 'house'),
  'navigation.songs': themeIconSlot('navigation', 'music-notes-simple'),
  'navigation.artists': themeIconSlot('navigation', 'microphone-stage'),
  'navigation.albums': themeIconSlot('navigation', 'disc'),
  'navigation.genres': themeIconSlot('navigation', 'tag'),
  'navigation.playlists': themeIconSlot('navigation', 'playlist'),
  'navigation.folders': themeIconSlot('navigation', 'folder-open'),
  'navigation.recent': themeIconSlot('navigation', 'clock-counter-clockwise'),
  'navigation.streaming': themeIconSlot('navigation', 'globe'),
  'navigation.radio': themeIconSlot('navigation', 'radio'),
  'navigation.import': themeIconSlot('navigation', 'plus'),
  'navigation.plugin': themeIconSlot('navigation', 'puzzle-piece'),
  'library.search': themeIconSlot('library', 'magnifying-glass'),
  'library.clear': themeIconSlot('library', 'x'),
  'library.artist': themeIconSlot('library', 'microphone-stage'),
  'library.album': themeIconSlot('library', 'disc'),
  'library.genre': themeIconSlot('library', 'tag'),
  'library.playlist': themeIconSlot('library', 'playlist'),
  'library.folder': themeIconSlot('library', 'folder-open'),
  'library.add': themeIconSlot('library', 'plus'),
  'library.play': themeIconSlot('library', 'play'),
  'library.empty': themeIconSlot('library', 'waveform'),
  'library.selected': themeIconSlot('library', 'check'),
  'library.playing': themeIconSlot('library', 'speaker-high'),
  'library.filter': themeIconSlot('library', 'funnel')
})

export type ThemeIconSlot = keyof typeof THEME_ICON_SLOT_REGISTRY

export function resolveThemeIconClasses(slot: ThemeIconSlot, family: ThemeIconFamily): string {
  return THEME_ICON_SLOT_REGISTRY[slot].classes[family]
}

export type ThemeProfile = ThemeProfileV1 | ThemeProfileV2

export interface ThemeModeDefinition {
  id: string
  dataAttribute: `data-te-${string}`
  label: string
  options: readonly string[]
  defaultValue: string
}

export type ThemeSelection =
  | { kind: 'builtin'; id: BuiltInThemePresetId }
  | { kind: 'user'; id: string }
  | { kind: 'plugin'; pluginId: string; themeId: string }

export interface ThemeWindowInheritance {
  miniPlayer: boolean
  desktopLyrics: boolean
}

export interface ThemeLibraryDocument {
  schemaVersion: 1
  activeTheme: ThemeSelection
  profiles: ThemeProfileV2[]
  windowInheritance: ThemeWindowInheritance
  profileHistory: Record<string, ThemeProfileHistoryEntry[]>
}

export interface ThemeProfileHistoryEntry {
  savedAt: string
  profile: ThemeProfileV2
}

export type ThemeLibrarySnapshot = VersionedDataEnvelope<ThemeLibraryDocument>

export interface ThemeBootstrap {
  library: ThemeLibrarySnapshot
  defaultTheme: ThemeDocumentV1
}

export interface ThemeArchiveDocumentV1 {
  schemaVersion: 1
  profile: ThemeProfileV1
  assets: ThemeAssetReference[]
}

export interface ThemeArchiveDocumentV2 {
  schemaVersion: 2
  profile: ThemeProfileV2
  assets: ThemeAssetReference[]
}

export type ThemeArchiveDocument = ThemeArchiveDocumentV1 | ThemeArchiveDocumentV2

export interface StructuredPluginThemeV1 {
  schemaVersion: 1
  variants: Partial<Record<ThemeTone, { tokens?: Record<string, string> }>>
  windowDefaults?: ThemeWindowDefaults
}

export interface StructuredPluginThemeV2 {
  schemaVersion: 2
  variants: Partial<Record<ThemeTone, { tokens?: Record<string, string> }>>
  modes?: ThemeModes
  windowDefaults?: ThemeWindowDefaults
}

export interface StructuredPluginThemeV3 extends Omit<StructuredPluginThemeV2, 'schemaVersion'> {
  schemaVersion: 3
  layout?: ThemeShellLayout
}

export type StructuredPluginTheme =
  | StructuredPluginThemeV1
  | StructuredPluginThemeV2
  | StructuredPluginThemeV3

const lightFont =
  "'Inter', 'Plus Jakarta Sans', 'MiSans Full', 'MiSans', 'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

export interface ThemePaletteEntry {
  id: string
  label: string
  value: string
}

export interface BuiltInThemeFont {
  id: string
  label: string
  category: 'system' | 'sans' | 'serif' | 'mono' | 'display'
  value: string
}

export const DEFAULT_THEME_TONE_SCHEDULE: Readonly<ThemeToneSchedule> = Object.freeze({
  lightStartMinutes: 7 * 60,
  darkStartMinutes: 19 * 60
})

export const BUILT_IN_THEME_FONTS: readonly BuiltInThemeFont[] = Object.freeze([
  { id: 'system', label: '系统与 MiSans', category: 'system', value: lightFont },
  {
    id: 'inter',
    label: 'Inter',
    category: 'sans',
    value: "'Inter', 'MiSans Full', 'MiSans', 'Microsoft YaHei UI', system-ui, sans-serif"
  },
  {
    id: 'jakarta',
    label: 'Plus Jakarta Sans',
    category: 'sans',
    value:
      "'Plus Jakarta Sans', 'MiSans Full', 'MiSans', 'Microsoft YaHei UI', system-ui, sans-serif"
  },
  {
    id: 'lora',
    label: 'Lora Serif',
    category: 'serif',
    value: "'Lora', 'MiSans Full', 'MiSans', 'Microsoft YaHei UI', Georgia, serif"
  },
  {
    id: 'jetbrains',
    label: 'JetBrains Mono',
    category: 'mono',
    value: "'JetBrains Mono', 'MiSans Full', 'MiSans', Consolas, monospace"
  },
  {
    id: 'space',
    label: 'Space Grotesk',
    category: 'display',
    value: "'Space Grotesk', 'MiSans Full', 'MiSans', 'Microsoft YaHei UI', system-ui, sans-serif"
  }
])

export const THEME_ACCENT_PALETTES: Readonly<Record<ThemeTone, readonly ThemePaletteEntry[]>> =
  Object.freeze({
    pureWhite: Object.freeze([
      { id: 'blue', label: '湖蓝', value: '#2563eb' },
      { id: 'indigo', label: '靛青', value: '#4f46e5' },
      { id: 'violet', label: '紫罗兰', value: '#7c3aed' },
      { id: 'fuchsia', label: '品红', value: '#c026d3' },
      { id: 'rose', label: '玫瑰', value: '#e11d48' },
      { id: 'red', label: '朱红', value: '#dc2626' },
      { id: 'orange', label: '橙色', value: '#ea580c' },
      { id: 'amber', label: '琥珀', value: '#d97706' },
      { id: 'lime', label: '青柠', value: '#65a30d' },
      { id: 'green', label: '翠绿', value: '#16a34a' },
      { id: 'emerald', label: '祖母绿', value: '#059669' },
      { id: 'teal', label: '蓝绿', value: '#0d9488' },
      { id: 'cyan', label: '青色', value: '#0891b2' },
      { id: 'sky', label: '天蓝', value: '#0284c7' },
      { id: 'slate', label: '石板', value: '#475569' },
      { id: 'graphite', label: '石墨', value: '#374151' }
    ]),
    dark: Object.freeze([
      { id: 'amber', label: '琥珀', value: '#f59e0b' },
      { id: 'gold', label: '金色', value: '#eab308' },
      { id: 'orange', label: '橙色', value: '#fb923c' },
      { id: 'coral', label: '珊瑚', value: '#fb7185' },
      { id: 'rose', label: '玫瑰', value: '#f43f5e' },
      { id: 'pink', label: '粉色', value: '#ec4899' },
      { id: 'fuchsia', label: '品红', value: '#d946ef' },
      { id: 'violet', label: '紫罗兰', value: '#a78bfa' },
      { id: 'indigo', label: '靛青', value: '#818cf8' },
      { id: 'blue', label: '亮蓝', value: '#60a5fa' },
      { id: 'sky', label: '天蓝', value: '#38bdf8' },
      { id: 'cyan', label: '青色', value: '#22d3ee' },
      { id: 'teal', label: '蓝绿', value: '#2dd4bf' },
      { id: 'emerald', label: '祖母绿', value: '#34d399' },
      { id: 'green', label: '翠绿', value: '#4ade80' },
      { id: 'lime', label: '青柠', value: '#a3e635' }
    ])
  })

export const THEME_BACKGROUND_PALETTES: Readonly<Record<ThemeTone, readonly ThemePaletteEntry[]>> =
  Object.freeze({
    pureWhite: Object.freeze([
      { id: 'paper', label: '纸白', value: '#f4f4f7' },
      { id: 'snow', label: '雪白', value: '#f8fafc' },
      { id: 'mist', label: '雾灰', value: '#f1f5f9' },
      { id: 'blue-mist', label: '蓝雾', value: '#eff6ff' },
      { id: 'indigo-mist', label: '靛雾', value: '#eef2ff' },
      { id: 'violet-mist', label: '紫雾', value: '#f5f3ff' },
      { id: 'rose-mist', label: '玫瑰雾', value: '#fff1f2' },
      { id: 'amber-mist', label: '暖雾', value: '#fffbeb' },
      { id: 'green-mist', label: '绿雾', value: '#f0fdf4' },
      { id: 'teal-mist', label: '青雾', value: '#f0fdfa' },
      { id: 'cyan-mist', label: '天青雾', value: '#ecfeff' },
      { id: 'warm-gray', label: '暖灰', value: '#fafaf9' },
      { id: 'pearl', label: '珍珠', value: '#f5f5f4' },
      { id: 'lavender', label: '薰衣草', value: '#faf5ff' },
      { id: 'blush', label: '浅绯', value: '#fdf2f8' },
      { id: 'mint', label: '薄荷', value: '#ecfdf5' }
    ]),
    dark: Object.freeze([
      { id: 'charcoal', label: '炭黑', value: '#17181a' },
      { id: 'ink', label: '墨黑', value: '#111214' },
      { id: 'black', label: '纯黑', value: '#09090b' },
      { id: 'slate', label: '深石板', value: '#0f172a' },
      { id: 'navy', label: '深海', value: '#111827' },
      { id: 'indigo', label: '夜靛', value: '#17172a' },
      { id: 'violet', label: '夜紫', value: '#1d1728' },
      { id: 'plum', label: '暗梅', value: '#24161f' },
      { id: 'wine', label: '酒红', value: '#281719' },
      { id: 'umber', label: '暗褐', value: '#241c16' },
      { id: 'olive', label: '暗橄榄', value: '#1d2117' },
      { id: 'forest', label: '暗林', value: '#14211a' },
      { id: 'teal', label: '暗青', value: '#122322' },
      { id: 'cyan', label: '暗天青', value: '#102129' },
      { id: 'steel', label: '钢蓝', value: '#17202a' },
      { id: 'graphite', label: '石墨', value: '#1c1c1f' }
    ])
  })

export const THEME_VISIBILITY_SLOT_IDS: readonly ThemeVisibilitySlotId[] = Object.freeze([
  'playerAlbumArtist',
  'playerArtwork',
  'playerTrackMenu',
  'playerMiscIcons',
  'playerDuration',
  'playerWaveform',
  'playerTrackInfo',
  'equalizerGrid',
  'equalizerFrequencyGuides',
  'equalizerSpectrum',
  'previousButton',
  'nextButton',
  'miniPlayerArtwork'
])

export const THEME_MODE_DEFINITIONS: readonly ThemeModeDefinition[] = Object.freeze([
  {
    id: 'appearance.accentSource',
    dataAttribute: 'data-te-accent-source',
    label: '强调色来源',
    options: ['fixed', 'cover'],
    defaultValue: 'fixed'
  },
  {
    id: 'appearance.backgroundTreatment',
    dataAttribute: 'data-te-background-treatment',
    label: '背景处理',
    options: ['solid', 'gradient', 'cover-blur', 'image'],
    defaultValue: 'solid'
  },
  {
    id: 'appearance.toneScheduling',
    dataAttribute: 'data-te-tone-scheduling',
    label: '明暗调度',
    options: ['manual', 'system', 'timed'],
    defaultValue: 'manual'
  },
  {
    id: 'appearance.contrastGuard',
    dataAttribute: 'data-te-contrast-guard',
    label: '对比度保护',
    options: ['off', 'warn', 'enforce'],
    defaultValue: 'warn'
  },
  {
    id: 'appearance.effectsMode',
    dataAttribute: 'data-te-effects-mode',
    label: '特效模式',
    options: ['full', 'reduced'],
    defaultValue: 'full'
  },
  {
    id: 'navigation.style',
    dataAttribute: 'data-te-navigation-style',
    label: '导航样式',
    options: ['expanded', 'compact', 'rail'],
    defaultValue: 'expanded'
  },
  {
    id: 'navigation.iconScale',
    dataAttribute: 'data-te-navigation-icon-scale',
    label: '导航图标大小',
    options: ['sm', 'md', 'lg'],
    defaultValue: 'md'
  },
  {
    id: 'navigation.logo',
    dataAttribute: 'data-te-navigation-logo',
    label: '导航品牌标识',
    options: ['show', 'hide'],
    defaultValue: 'hide'
  },
  {
    id: 'library.density',
    dataAttribute: 'data-te-library-density',
    label: '媒体库密度',
    options: ['comfortable', 'compact'],
    defaultValue: 'comfortable'
  },
  {
    id: 'library.selection',
    dataAttribute: 'data-te-library-selection',
    label: '媒体库选中样式',
    options: ['fill', 'stroke'],
    defaultValue: 'fill'
  },
  {
    id: 'library.titleOverlay',
    dataAttribute: 'data-te-library-title-overlay',
    label: '媒体库标题叠层',
    options: ['off', 'on'],
    defaultValue: 'off'
  },
  {
    id: 'player.layout',
    dataAttribute: 'data-te-player-layout',
    label: '播放器布局',
    options: ['standard', 'full-cover', 'lyrics-focus', 'split', 'minimal'],
    defaultValue: 'standard'
  },
  {
    id: 'player.controls',
    dataAttribute: 'data-te-player-controls',
    label: '播放器控制区',
    options: ['standard', 'pro'],
    defaultValue: 'standard'
  },
  {
    id: 'player.titleAlign',
    dataAttribute: 'data-te-player-title-align',
    label: '播放器标题对齐',
    options: ['left', 'center'],
    defaultValue: 'left'
  },
  {
    id: 'player.progress',
    dataAttribute: 'data-te-player-progress',
    label: '播放器进度样式',
    options: ['line', 'ring', 'solid', 'spectrum'],
    defaultValue: 'line'
  },
  {
    id: 'artwork.transition',
    dataAttribute: 'data-te-artwork-transition',
    label: '封面过渡',
    options: ['fade', 'slide', 'none'],
    defaultValue: 'fade'
  },
  {
    id: 'artwork.shadow',
    dataAttribute: 'data-te-artwork-shadow',
    label: '封面阴影',
    options: ['on', 'off'],
    defaultValue: 'on'
  },
  {
    id: 'equalizer.panel',
    dataAttribute: 'data-te-equalizer-panel',
    label: '均衡器面板',
    options: ['neutral', 'tinted', 'glass'],
    defaultValue: 'neutral'
  },
  {
    id: 'equalizer.slider',
    dataAttribute: 'data-te-equalizer-slider',
    label: '均衡器滑块',
    options: ['ring', 'solid'],
    defaultValue: 'ring'
  },
  {
    id: 'equalizer.knob',
    dataAttribute: 'data-te-equalizer-knob',
    label: '均衡器旋钮指示',
    options: ['line', 'dot'],
    defaultValue: 'line'
  },
  {
    id: 'equalizer.spectrum',
    dataAttribute: 'data-te-equalizer-spectrum',
    label: '均衡器频谱',
    options: ['bars', 'line', 'area'],
    defaultValue: 'line'
  },
  {
    id: 'equalizer.button',
    dataAttribute: 'data-te-equalizer-button',
    label: '均衡器按钮',
    options: ['soft', 'outline', 'solid'],
    defaultValue: 'soft'
  },
  {
    id: 'icons.family',
    dataAttribute: 'data-te-icon-family',
    label: '图标族',
    options: ['outline', 'rounded', 'filled'],
    defaultValue: 'outline'
  },
  {
    id: 'typography.titleCase',
    dataAttribute: 'data-te-title-case',
    label: '标题字形',
    options: ['preserve', 'uppercase'],
    defaultValue: 'preserve'
  },
  {
    id: 'typography.lyricAccent',
    dataAttribute: 'data-te-lyric-accent',
    label: '歌词强调高亮',
    options: ['off', 'accent'],
    defaultValue: 'off'
  },
  {
    id: 'typography.titleColor',
    dataAttribute: 'data-te-title-color',
    label: '自适应标题颜色',
    options: ['off', 'track', 'artist-album'],
    defaultValue: 'off'
  }
])

export const DEFAULT_THEME_MODES: Readonly<ThemeModes> = Object.freeze({
  appearance: Object.freeze({
    accentSource: 'fixed',
    backgroundTreatment: 'solid',
    toneScheduling: 'manual',
    contrastGuard: 'warn',
    effectsMode: 'full'
  }),
  navigation: Object.freeze({ style: 'expanded', iconScale: 'md', logo: 'hide' }),
  library: Object.freeze({ density: 'comfortable', selection: 'fill', titleOverlay: 'off' }),
  player: Object.freeze({
    layout: 'standard',
    controls: 'standard',
    titleAlign: 'left',
    progress: 'line'
  }),
  artwork: Object.freeze({ transition: 'fade', shadow: 'on' }),
  equalizer: Object.freeze({
    panel: 'neutral',
    slider: 'ring',
    knob: 'line',
    spectrum: 'line',
    button: 'soft'
  }),
  icons: Object.freeze({ family: 'outline' }),
  typography: Object.freeze({
    titleCase: 'preserve',
    lyricAccent: 'off',
    titleColor: 'off'
  }),
  visibility: Object.freeze({})
})

function token(
  id: string,
  cssVariable: `--te-${string}`,
  label: string,
  group: ThemeTokenGroup,
  surface: string,
  kind: ThemeTokenKind,
  pureWhite: string,
  dark: string,
  control: Partial<
    Pick<ThemeTokenDefinition, 'min' | 'max' | 'step' | 'unit' | 'options' | 'adaptive'>
  > = {}
): ThemeTokenDefinition {
  return {
    id,
    cssVariable,
    label,
    group,
    surface,
    kind,
    defaults: { pureWhite, dark },
    ...control
  }
}

export const THEME_TOKEN_DEFINITIONS: readonly ThemeTokenDefinition[] = Object.freeze([
  token(
    'color.primary.500',
    '--te-primary-500',
    '主强调色',
    'colors',
    'global',
    'color',
    '#2563eb',
    '#2563eb',
    {
      adaptive: 'cover-accent'
    }
  ),
  token(
    'color.primary.400',
    '--te-primary-400',
    '主强调色悬浮',
    'colors',
    'global',
    'color',
    '#3b82f6',
    '#3b82f6',
    {
      adaptive: 'cover-accent'
    }
  ),
  token(
    'color.primary.300',
    '--te-primary-300',
    '主强调色柔和',
    'colors',
    'global',
    'color',
    '#93c5fd',
    '#93c5fd',
    {
      adaptive: 'cover-accent'
    }
  ),
  token(
    'color.primary.rgb',
    '--te-primary-rgb',
    '主强调色 RGB',
    'colors',
    'global',
    'raw',
    '37, 99, 235',
    '37, 99, 235',
    {
      adaptive: 'cover-accent'
    }
  ),
  token(
    'color.favorite',
    '--te-favorite-500',
    '收藏色',
    'colors',
    'global',
    'color',
    '#db2777',
    '#d94f7d'
  ),
  token(
    'color.success',
    '--te-success-500',
    '成功色',
    'colors',
    'global',
    'color',
    '#16a34a',
    '#14b881'
  ),
  token(
    'color.warning',
    '--te-warning-500',
    '警告色',
    'colors',
    'global',
    'color',
    '#d97706',
    '#f59e0b'
  ),
  token('color.info', '--te-info-500', '信息色', 'colors', 'global', 'color', '#2563eb', '#38bdf8'),
  token(
    'color.accentCyan',
    '--te-accent-cyan',
    '青色辅助色',
    'colors',
    'global',
    'color',
    '#0891b2',
    '#2dd4bf'
  ),
  token(
    'color.neutral.50',
    '--te-neutral-50',
    '最低层背景',
    'colors',
    'global',
    'color',
    '#ffffff',
    '#050505'
  ),
  token(
    'color.neutral.100',
    '--te-neutral-100',
    '柔和背景',
    'colors',
    'global',
    'color',
    '#f8fafc',
    '#111111'
  ),
  token(
    'color.neutral.200',
    '--te-neutral-200',
    '浅边界',
    'colors',
    'global',
    'color',
    '#e5e7eb',
    '#1f1f1f'
  ),
  token(
    'color.neutral.300',
    '--te-neutral-300',
    '中边界',
    'colors',
    'global',
    'color',
    '#d1d5db',
    '#343434'
  ),
  token(
    'color.neutral.500',
    '--te-neutral-500',
    '次要文字',
    'colors',
    'global',
    'color',
    '#64748b',
    '#9b9b9b'
  ),
  token(
    'color.neutral.700',
    '--te-neutral-700',
    '正文辅助',
    'colors',
    'global',
    'color',
    '#334155',
    '#d8d8d8'
  ),
  token(
    'color.neutral.900',
    '--te-neutral-900',
    '主要文字',
    'colors',
    'global',
    'color',
    '#0f172a',
    '#f7f7f2'
  ),
  token('surface.app', '--te-app-bg', '应用背景', 'colors', 'app', 'color', '#f4f4f7', '#17181a'),
  token(
    'surface.local',
    '--te-local-bg',
    '本地音乐背景',
    'colors',
    'local',
    'color',
    '#f4f4f7',
    '#17181a'
  ),
  token(
    'surface.settings',
    '--te-settings-bg',
    '设置背景',
    'colors',
    'settings',
    'color',
    '#f5f6f8',
    '#17181a'
  ),
  token(
    'surface.streaming',
    '--te-streaming-bg',
    '流媒体背景',
    'colors',
    'streaming',
    'color',
    '#f4f4f7',
    '#17181a'
  ),
  token(
    'surface.player',
    '--te-player-bg',
    '播放页背景',
    'colors',
    'player',
    'color',
    '#f4f4f7',
    '#17181a'
  ),
  token(
    'background.gradientStart',
    '--te-background-gradient-start',
    '渐变起始色',
    'colors',
    'app-background',
    'color',
    '#eff6ff',
    '#111827'
  ),
  token(
    'background.gradientEnd',
    '--te-background-gradient-end',
    '渐变结束色',
    'colors',
    'app-background',
    'color',
    '#f5f3ff',
    '#1d1728'
  ),
  token(
    'background.gradientAngle',
    '--te-background-gradient-angle',
    '渐变角度',
    'materials',
    'app-background',
    'number',
    '135deg',
    '135deg',
    { min: 0, max: 360, step: 1, unit: 'deg' }
  ),
  token(
    'background.coverBlur',
    '--te-background-cover-blur',
    '封面背景模糊',
    'materials',
    'app-background',
    'length',
    '28px',
    '36px',
    { min: 0, max: 64, step: 1, unit: 'px' }
  ),
  token(
    'background.overlayOpacity',
    '--te-background-overlay-opacity',
    '背景叠层强度',
    'materials',
    'app-background',
    'number',
    '12%',
    '38%',
    { min: 0, max: 80, step: 1, unit: '%' }
  ),
  token(
    'shell.control.text',
    '--te-shell-control-text',
    '应用壳控制文字',
    'colors',
    'app-shell',
    'color',
    '#0f172a',
    '#f7f7f2'
  ),
  token(
    'shell.control.hoverSurface',
    '--te-shell-control-hover',
    '应用壳控制悬浮',
    'materials',
    'app-shell',
    'color',
    'rgba(37, 99, 235, 0.08)',
    'rgba(245, 158, 11, 0.12)'
  ),
  token(
    'settings.text.primary',
    '--te-settings-text',
    '设置主要文字',
    'colors',
    'settings',
    'color',
    '#1a1a1a',
    '#f7f7f2'
  ),
  token(
    'settings.text.muted',
    '--te-settings-text-muted',
    '设置辅助文字',
    'colors',
    'settings',
    'color',
    '#8a8f98',
    '#9b9b9b'
  ),
  token(
    'settings.control.surface',
    '--te-settings-control-bg',
    '设置控件表面',
    'materials',
    'settings',
    'color',
    '#ffffff',
    '#181818'
  ),
  token(
    'settings.control.border',
    '--te-settings-control-border',
    '设置控件边框',
    'materials',
    'settings',
    'color',
    'rgba(15, 23, 42, 0.06)',
    'rgba(255, 255, 255, 0.1)'
  ),
  token(
    'settings.panel.border',
    '--te-settings-panel-border',
    '设置面板边框',
    'materials',
    'settings',
    'color',
    'transparent',
    'transparent'
  ),
  token(
    'settings.navigation.text',
    '--te-settings-nav-text',
    '设置导航文字',
    'colors',
    'settings-navigation',
    'color',
    '#5c6370',
    '#d8d8d8'
  ),
  token(
    'settings.navigation.hoverSurface',
    '--te-settings-nav-hover',
    '设置导航悬浮',
    'materials',
    'settings-navigation',
    'color',
    'rgba(15, 23, 42, 0.04)',
    'rgba(255, 255, 255, 0.065)'
  ),
  token(
    'settings.navigation.activeSurface',
    '--te-settings-nav-active',
    '设置导航选中',
    'materials',
    'settings-navigation',
    'color',
    '#ffffff',
    'rgba(255, 255, 255, 0.1)'
  ),
  token(
    'navigation.surface',
    '--te-navigation-bg',
    '导航表面',
    'materials',
    'navigation',
    'color',
    'rgba(255, 255, 255, 0.94)',
    '#17181a'
  ),
  token(
    'navigation.border',
    '--te-navigation-border',
    '导航边框',
    'materials',
    'navigation',
    'color',
    'rgba(0, 0, 0, 0.05)',
    'transparent'
  ),
  token(
    'navigation.shadow',
    '--te-navigation-shadow',
    '导航阴影',
    'materials',
    'navigation',
    'shadow',
    '4px 0 24px rgba(15, 23, 42, 0.03)',
    'none'
  ),
  token(
    'navigation.text',
    '--te-navigation-text',
    '导航文字',
    'colors',
    'navigation',
    'color',
    '#475569',
    '#d8d8d8'
  ),
  token(
    'navigation.icon',
    '--te-navigation-icon',
    '导航图标',
    'colors',
    'navigation',
    'color',
    '#64748b',
    '#9b9b9b'
  ),
  token(
    'navigation.hoverSurface',
    '--te-navigation-hover',
    '导航悬浮表面',
    'materials',
    'navigation',
    'color',
    'rgba(15, 23, 42, 0.04)',
    'rgba(255, 255, 255, 0.065)'
  ),
  token(
    'navigation.hoverText',
    '--te-navigation-hover-text',
    '导航悬浮文字',
    'colors',
    'navigation',
    'color',
    '#0f172a',
    '#f7f7f2'
  ),
  token(
    'navigation.activeSurface',
    '--te-navigation-active',
    '导航选中表面',
    'materials',
    'navigation',
    'color',
    'rgba(37, 99, 235, 0.08)',
    'rgba(245, 158, 11, 0.16)'
  ),
  token(
    'navigation.activeText',
    '--te-navigation-active-text',
    '导航选中文字',
    'colors',
    'navigation',
    'color',
    '#2563eb',
    '#f59e0b'
  ),
  token(
    'navigation.indicator',
    '--te-navigation-indicator',
    '导航指示器',
    'colors',
    'navigation',
    'color',
    '#2563eb',
    '#f59e0b'
  ),
  token(
    'navigation.opacity',
    '--te-navigation-opacity',
    '导航表面透明度',
    'materials',
    'navigation',
    'number',
    '94%',
    '100%',
    { min: 35, max: 100, step: 1, unit: '%' }
  ),
  token(
    'navigation.radius',
    '--te-navigation-radius',
    '导航外框圆角',
    'shape',
    'navigation',
    'length',
    '0px',
    '0px',
    { min: 0, max: 28, step: 1, unit: 'px' }
  ),
  token(
    'library.page.surface',
    '--te-library-bg',
    '媒体库页面表面',
    'materials',
    'library',
    'gradient',
    'linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(255, 255, 255, 0.9))',
    'linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(255, 255, 255, 0.9))'
  ),
  token(
    'library.table.surface',
    '--te-library-table-bg',
    '媒体库列表表面',
    'materials',
    'library',
    'color',
    'rgba(255, 255, 255, 0.16)',
    'rgba(255, 255, 255, 0.16)'
  ),
  token(
    'library.table.border',
    '--te-library-table-border',
    '媒体库列表边框',
    'materials',
    'library',
    'color',
    'rgba(255, 255, 255, 0.52)',
    'rgba(255, 255, 255, 0.52)'
  ),
  token(
    'library.table.shadow',
    '--te-library-table-shadow',
    '媒体库列表阴影',
    'materials',
    'library',
    'shadow',
    '0 26px 78px rgba(86, 70, 160, 0.1)',
    '0 26px 78px rgba(86, 70, 160, 0.1)'
  ),
  token(
    'library.row.text',
    '--te-library-row-text',
    '媒体库行文字',
    'colors',
    'library',
    'color',
    '#334155',
    '#d8d8d8'
  ),
  token(
    'library.row.hoverSurface',
    '--te-library-row-hover',
    '媒体库行悬浮',
    'materials',
    'library',
    'color',
    'rgba(255, 255, 255, 0.22)',
    'rgba(255, 255, 255, 0.065)'
  ),
  token(
    'library.selection.surface',
    '--te-library-selection-bg',
    '媒体库选中表面',
    'materials',
    'library',
    'color',
    'rgba(15, 23, 42, 0.045)',
    'rgba(255, 255, 255, 0.06)'
  ),
  token(
    'library.selection.hoverSurface',
    '--te-library-selection-hover',
    '媒体库选中悬浮',
    'materials',
    'library',
    'color',
    'rgba(15, 23, 42, 0.07)',
    'rgba(255, 255, 255, 0.09)'
  ),
  token(
    'library.selection.indicator',
    '--te-library-selection-indicator',
    '媒体库选中指示器',
    'colors',
    'library',
    'color',
    'rgba(15, 23, 42, 0.55)',
    'rgba(255, 255, 255, 0.72)'
  ),
  token(
    'library.icon',
    '--te-library-icon',
    '媒体库图标颜色',
    'colors',
    'library',
    'color',
    '#64748b',
    '#b8b8b2'
  ),
  token(
    'library.iconSize',
    '--te-library-icon-size',
    '媒体库图标大小',
    'shape',
    'library',
    'length',
    '18px',
    '18px',
    { min: 14, max: 32, step: 1, unit: 'px' }
  ),
  token(
    'library.selection.radius',
    '--te-library-selection-radius',
    '选中曲目圆角',
    'shape',
    'library-selection',
    'length',
    '10px',
    '10px',
    { min: 0, max: 24, step: 1, unit: 'px' }
  ),
  token(
    'library.selection.inlineInset',
    '--te-library-selection-inline-inset',
    '选中曲目左右边距',
    'shape',
    'library-selection',
    'length',
    '0px',
    '0px',
    { min: 0, max: 18, step: 1, unit: 'px' }
  ),
  token(
    'library.coverRadius',
    '--te-library-cover-radius',
    '媒体库封面圆角',
    'shape',
    'library-cover',
    'length',
    '8px',
    '8px',
    { min: 0, max: 28, step: 1, unit: 'px' }
  ),
  token(
    'library.titleOverlayOpacity',
    '--te-library-title-overlay-opacity',
    '标题区叠层强度',
    'materials',
    'library-header',
    'number',
    '72%',
    '72%',
    { min: 0, max: 100, step: 1, unit: '%' }
  ),
  token(
    'library.actionSurface',
    '--te-library-action-bg',
    '底部操作区背景',
    'materials',
    'library-actions',
    'color',
    'rgba(37, 99, 235, 0.08)',
    'rgba(56, 189, 248, 0.12)'
  ),
  token(
    'library.actionRadius',
    '--te-library-action-radius',
    '底部操作区圆角',
    'shape',
    'library-actions',
    'length',
    '12px',
    '12px',
    { min: 0, max: 24, step: 1, unit: 'px' }
  ),
  token(
    'surface.card',
    '--te-card-bg',
    '卡片背景',
    'materials',
    'card',
    'color',
    '#ffffff',
    '#181818'
  ),
  token(
    'surface.cardBorder',
    '--te-card-border',
    '卡片边框',
    'materials',
    'card',
    'color',
    'rgba(15, 23, 42, 0.08)',
    'rgba(255, 255, 255, 0.1)'
  ),
  token(
    'surface.subtle',
    '--te-subtle-bg',
    '次级表面',
    'materials',
    'global',
    'color',
    '#f8fafc',
    '#121212'
  ),
  token(
    'surface.hover',
    '--te-hover-bg',
    '悬浮表面',
    'materials',
    'global',
    'color',
    '#f3f4f6',
    'rgba(255, 255, 255, 0.065)'
  ),
  token(
    'surface.active',
    '--te-active-bg',
    '选中表面',
    'materials',
    'global',
    'color',
    '#e8e8e8',
    'rgba(245, 158, 11, 0.16)'
  ),
  token(
    'material.glass',
    '--te-glass-bg',
    '玻璃表面',
    'materials',
    'global',
    'color',
    'rgba(255, 255, 255, 0.94)',
    'rgba(24, 24, 24, 0.82)'
  ),
  token(
    'material.glassStrong',
    '--te-glass-bg-strong',
    '强化玻璃表面',
    'materials',
    'global',
    'color',
    'rgba(255, 255, 255, 0.98)',
    'rgba(29, 29, 29, 0.94)'
  ),
  token(
    'material.glassBorder',
    '--te-glass-border',
    '玻璃边框',
    'materials',
    'global',
    'color',
    'rgba(15, 23, 42, 0.1)',
    'rgba(255, 255, 255, 0.09)'
  ),
  token(
    'material.glassShadow',
    '--te-glass-shadow',
    '玻璃阴影',
    'materials',
    'global',
    'shadow',
    '0 16px 42px rgba(15, 23, 42, 0.08)',
    '0 18px 54px rgba(0, 0, 0, 0.34)'
  ),
  token(
    'material.surfaceOpacity',
    '--te-surface-opacity',
    '全局表面透明度',
    'materials',
    'global',
    'number',
    '100%',
    '100%',
    {
      min: 40,
      max: 100,
      step: 1,
      unit: '%'
    }
  ),
  token(
    'material.glowMain',
    '--te-glow-main',
    '主色光晕',
    'materials',
    'global',
    'color',
    'rgba(37, 99, 235, 0.12)',
    'rgba(245, 158, 11, 0.18)',
    {
      adaptive: 'cover-accent'
    }
  ),
  token(
    'material.glowSoft',
    '--te-glow-soft',
    '柔和光晕',
    'materials',
    'global',
    'color',
    'rgba(59, 130, 246, 0.08)',
    'rgba(217, 79, 125, 0.12)'
  ),
  token(
    'material.glowCyan',
    '--te-glow-cyan',
    '青色光晕',
    'materials',
    'global',
    'color',
    'rgba(8, 145, 178, 0.08)',
    'rgba(45, 212, 191, 0.1)'
  ),
  token(
    'typography.sans',
    '--te-font-sans',
    '界面字体',
    'typography',
    'global',
    'font',
    lightFont,
    lightFont
  ),
  token(
    'typography.display',
    '--te-font-display',
    '标题字体',
    'typography',
    'global',
    'font',
    lightFont,
    lightFont
  ),
  token(
    'typography.rounded',
    '--te-font-rounded',
    '圆体字体',
    'typography',
    'global',
    'font',
    lightFont,
    lightFont
  ),
  token(
    'typography.titleWeight',
    '--te-text-title',
    '标题字重',
    'typography',
    'global',
    'number',
    '700',
    '700',
    {
      min: 400,
      max: 900,
      step: 100
    }
  ),
  token(
    'typography.bodyWeight',
    '--te-text-body',
    '正文字重',
    'typography',
    'global',
    'number',
    '500',
    '500',
    {
      min: 300,
      max: 700,
      step: 100
    }
  ),
  token(
    'typography.metaWeight',
    '--te-text-meta',
    '辅助字重',
    'typography',
    'global',
    'number',
    '400',
    '400',
    {
      min: 300,
      max: 700,
      step: 100
    }
  ),
  token(
    'typography.bodySize',
    '--te-font-size-body',
    '界面字号',
    'typography',
    'global',
    'length',
    '14px',
    '14px',
    { min: 12, max: 20, step: 1, unit: 'px' }
  ),
  token(
    'typography.chromeText',
    '--te-chrome-text',
    '导航与底栏文字',
    'typography',
    'app-chrome',
    'color',
    '#475569',
    '#d8d8d8'
  ),
  token(
    'shape.cardRadius',
    '--te-card-radius',
    '卡片圆角',
    'shape',
    'card',
    'length',
    '16px',
    '16px',
    {
      min: 0,
      max: 24,
      step: 1,
      unit: 'px'
    }
  ),
  token(
    'shape.globalRadius',
    '--te-radius-global',
    '全局圆角',
    'shape',
    'global',
    'length',
    '10px',
    '10px',
    {
      min: 0,
      max: 24,
      step: 1,
      unit: 'px'
    }
  ),
  token(
    'shape.dialogRadius',
    '--te-dialog-radius',
    '对话框圆角',
    'shape',
    'dialog',
    'length',
    '8px',
    '8px',
    { min: 0, max: 24, step: 1, unit: 'px' }
  ),
  token(
    'shape.searchRadius',
    '--te-search-radius',
    '搜索框圆角',
    'shape',
    'search',
    'length',
    '10px',
    '10px',
    { min: 0, max: 24, step: 1, unit: 'px' }
  ),
  token(
    'shape.toastRadius',
    '--te-toast-radius',
    '提示圆角',
    'shape',
    'toast',
    'length',
    '8px',
    '8px',
    { min: 0, max: 24, step: 1, unit: 'px' }
  ),
  token(
    'shape.trackTitleRadius',
    '--te-track-title-radius',
    '曲目标题背景圆角',
    'shape',
    'track-title',
    'length',
    '6px',
    '6px',
    { min: 0, max: 24, step: 1, unit: 'px' }
  ),
  token(
    'material.trackTitleOpacity',
    '--te-track-title-opacity',
    '曲目标题背景透明度',
    'materials',
    'track-title',
    'number',
    '0%',
    '0%',
    { min: 0, max: 100, step: 1, unit: '%' }
  ),
  token(
    'shape.cardBorderWidth',
    '--te-card-border-width',
    '卡片边框宽度',
    'shape',
    'card',
    'length',
    '1px',
    '1px',
    {
      min: 0,
      max: 3,
      step: 0.5,
      unit: 'px'
    }
  ),
  token(
    'material.cardBlur',
    '--te-card-blur',
    '卡片模糊',
    'materials',
    'card',
    'length',
    '20px',
    '20px',
    {
      min: 0,
      max: 40,
      step: 1,
      unit: 'px'
    }
  ),
  token(
    'material.cardSaturation',
    '--te-card-saturate',
    '卡片饱和度',
    'materials',
    'card',
    'number',
    '150%',
    '150%',
    {
      min: 80,
      max: 180,
      step: 1,
      unit: '%'
    }
  ),
  token(
    'layout.uiScale',
    '--te-ui-scale',
    '界面缩放',
    'layout',
    'global',
    'number',
    '0.94',
    '0.94',
    {
      min: 0.85,
      max: 1.1,
      step: 0.01
    }
  ),
  token(
    'layout.menuWidth',
    '--te-menu-width',
    '侧边栏宽度',
    'layout',
    'sidebar',
    'length',
    'clamp(132px, 18vw, 216px)',
    'clamp(132px, 18vw, 216px)'
  ),
  token(
    'playback.text.page',
    '--te-playback-page-text',
    '播放页正文',
    'playback',
    'player',
    'color',
    '#f4f7fb',
    '#f4f7fb'
  ),
  token(
    'playback.accent',
    '--te-playback-accent',
    '播放强调色',
    'playback',
    'player',
    'color',
    '#7c4dff',
    '#7c4dff',
    { adaptive: 'cover-accent' }
  ),
  token(
    'playback.backdrop.filter',
    '--te-playback-backdrop-filter',
    '封面背景滤镜',
    'playback',
    'player',
    'filter',
    'blur(58px) saturate(1.22) brightness(0.52)',
    'blur(58px) saturate(1.32) brightness(0.36)'
  ),
  token(
    'playback.backdrop.scrim',
    '--te-playback-backdrop-scrim',
    '播放背景遮罩',
    'playback',
    'player',
    'gradient',
    'linear-gradient(180deg, rgba(5, 7, 11, 0.72) 0%, rgba(5, 7, 11, 0.74) 52%, rgba(5, 7, 11, 0.78) 100%)',
    'linear-gradient(180deg, rgba(5, 7, 11, 0.72) 0%, rgba(5, 7, 11, 0.74) 52%, rgba(5, 7, 11, 0.78) 100%)'
  ),
  token(
    'playback.backdrop.highlight',
    '--te-playback-backdrop-highlight',
    '播放背景高光',
    'playback',
    'player',
    'color',
    'rgba(255, 255, 255, 0.12)',
    'rgba(255, 255, 255, 0.12)'
  ),
  token(
    'playback.backdrop.fluid',
    '--te-playback-fluid-bg',
    '动态背景渐变',
    'playback',
    'player',
    'gradient',
    'linear-gradient(135deg, #0f172a, #1e3a5f, #312e81, #1e3a5f, #0f172a)',
    'linear-gradient(135deg, #0f172a, #1e3a5f, #312e81, #1e3a5f, #0f172a)'
  ),
  token(
    'playback.cover.surface',
    '--te-playback-cover-surface',
    '封面底材',
    'playback',
    'player',
    'color',
    'rgba(15, 23, 42, 0.08)',
    'rgba(15, 23, 42, 0.45)'
  ),
  token(
    'playback.cover.shadow',
    '--te-playback-cover-shadow',
    '封面阴影',
    'playback',
    'player',
    'shadow',
    '0 26px 70px rgba(15, 23, 42, 0.28)',
    '0 26px 70px rgba(0, 0, 0, 0.55), inset 0 0 0 1px rgba(255, 255, 255, 0.06)'
  ),
  token(
    'playback.cover.radius',
    '--te-playback-cover-radius',
    '封面圆角',
    'playback',
    'player',
    'length',
    '26px',
    '26px',
    { min: 0, max: 40, step: 1, unit: 'px' }
  ),
  token(
    'playback.cover.placeholderText',
    '--te-playback-cover-placeholder-text',
    '空封面图标',
    'playback',
    'player',
    'color',
    'rgba(255, 255, 255, 0.34)',
    'rgba(148, 163, 184, 0.55)'
  ),
  token(
    'playback.track.title',
    '--te-playback-track-title',
    '曲目标题',
    'playback',
    'player',
    'color',
    '#ffffff',
    '#ffffff'
  ),
  token(
    'playback.track.artist',
    '--te-playback-track-artist',
    '曲目艺人',
    'playback',
    'player',
    'color',
    'rgba(255, 255, 255, 0.78)',
    'rgba(255, 255, 255, 0.78)'
  ),
  token(
    'playback.track.album',
    '--te-playback-track-album',
    '曲目专辑',
    'playback',
    'player',
    'color',
    'rgba(255, 255, 255, 0.48)',
    'rgba(255, 255, 255, 0.48)'
  ),
  token(
    'playback.lyrics.text',
    '--te-playback-lyric-text',
    '歌词正文',
    'playback',
    'lyrics',
    'color',
    'rgba(255, 255, 255, 0.42)',
    'rgba(255, 255, 255, 0.42)'
  ),
  token(
    'playback.lyrics.hoverText',
    '--te-playback-lyric-hover-text',
    '歌词悬浮文字',
    'playback',
    'lyrics',
    'color',
    'rgba(255, 255, 255, 0.74)',
    'rgba(255, 255, 255, 0.74)'
  ),
  token(
    'playback.lyrics.activeText',
    '--te-playback-lyric-active-text',
    '当前歌词',
    'playback',
    'lyrics',
    'color',
    '#ffffff',
    '#ffffff'
  ),
  token(
    'playback.lyrics.activeSurface',
    '--te-playback-lyric-active-surface',
    '当前歌词表面',
    'playback',
    'lyrics',
    'color',
    'rgba(255, 255, 255, 0.08)',
    'rgba(255, 255, 255, 0.08)'
  ),
  token(
    'playback.lyrics.activeBorder',
    '--te-playback-lyric-active-border',
    '当前歌词边框',
    'playback',
    'lyrics',
    'color',
    'rgba(255, 255, 255, 0.1)',
    'rgba(255, 255, 255, 0.1)'
  ),
  token(
    'playback.lyrics.activeShadow',
    '--te-playback-lyric-active-shadow',
    '当前歌词阴影',
    'playback',
    'lyrics',
    'shadow',
    '0 14px 28px rgba(0, 0, 0, 0.18)',
    '0 14px 28px rgba(0, 0, 0, 0.18)'
  ),
  token(
    'playback.lyrics.translation',
    '--te-playback-lyric-translation',
    '歌词翻译',
    'playback',
    'lyrics',
    'color',
    'rgba(255, 255, 255, 0.58)',
    'rgba(255, 255, 255, 0.58)'
  ),
  token(
    'playback.lyrics.translationActive',
    '--te-playback-lyric-translation-active',
    '当前歌词翻译',
    'playback',
    'lyrics',
    'color',
    'rgba(255, 255, 255, 0.82)',
    'rgba(255, 255, 255, 0.82)'
  ),
  token(
    'playback.lyrics.romanization',
    '--te-playback-lyric-romanization',
    '歌词音译',
    'playback',
    'lyrics',
    'color',
    'rgba(255, 255, 255, 0.46)',
    'rgba(255, 255, 255, 0.46)'
  ),
  token(
    'playback.lyrics.romanizationActive',
    '--te-playback-lyric-romanization-active',
    '当前歌词音译',
    'playback',
    'lyrics',
    'color',
    'rgba(255, 255, 255, 0.72)',
    'rgba(255, 255, 255, 0.72)'
  ),
  token(
    'playback.control.surface',
    '--te-playback-control-surface',
    '播放控制表面',
    'playback',
    'player',
    'color',
    'rgba(255, 255, 255, 0.08)',
    'rgba(255, 255, 255, 0.08)'
  ),
  token(
    'playback.control.border',
    '--te-playback-control-border',
    '播放控制边框',
    'playback',
    'player',
    'color',
    'rgba(255, 255, 255, 0.1)',
    'rgba(255, 255, 255, 0.1)'
  ),
  token(
    'playback.control.text',
    '--te-playback-control-text',
    '播放控制图标',
    'playback',
    'player',
    'color',
    'rgba(255, 255, 255, 0.7)',
    'rgba(255, 255, 255, 0.7)'
  ),
  token(
    'playback.control.hoverSurface',
    '--te-playback-control-hover-surface',
    '播放控制悬浮表面',
    'playback',
    'player',
    'color',
    'rgba(255, 255, 255, 0.14)',
    'rgba(255, 255, 255, 0.14)'
  ),
  token(
    'playback.control.hoverBorder',
    '--te-playback-control-hover-border',
    '播放控制悬浮边框',
    'playback',
    'player',
    'color',
    'rgba(255, 255, 255, 0.16)',
    'rgba(255, 255, 255, 0.16)'
  ),
  token(
    'playback.control.hoverText',
    '--te-playback-control-hover-text',
    '播放控制悬浮图标',
    'playback',
    'player',
    'color',
    'rgba(255, 255, 255, 0.92)',
    'rgba(255, 255, 255, 0.92)'
  ),
  token(
    'playback.control.hoverShadow',
    '--te-playback-control-hover-shadow',
    '播放控制悬浮阴影',
    'playback',
    'player',
    'shadow',
    '0 4px 12px rgba(0, 0, 0, 0.18)',
    '0 4px 12px rgba(0, 0, 0, 0.18)'
  ),
  token(
    'playback.cover.size',
    '--te-playback-cover-size',
    '播放页封面尺寸',
    'playback',
    'artwork-player',
    'number',
    '100%',
    '100%',
    { min: 48, max: 100, step: 1, unit: '%' }
  ),
  token(
    'playback.artwork.listRadius',
    '--te-artwork-list-radius',
    '列表封面圆角',
    'playback',
    'artwork-list',
    'length',
    '12px',
    '12px',
    { min: 0, max: 28, step: 1, unit: 'px' }
  ),
  token(
    'playback.control.size',
    '--te-player-control-size',
    '控制按钮大小',
    'playback',
    'player-controls',
    'length',
    '32px',
    '32px',
    { min: 28, max: 48, step: 1, unit: 'px' }
  ),
  token(
    'playback.control.playSize',
    '--te-player-play-size',
    '播放按钮大小',
    'playback',
    'player-controls',
    'length',
    '44px',
    '44px',
    { min: 36, max: 64, step: 1, unit: 'px' }
  ),
  token(
    'playback.control.gap',
    '--te-player-control-gap',
    '控制按钮间距',
    'playback',
    'player-controls',
    'length',
    '12px',
    '12px',
    { min: 4, max: 24, step: 1, unit: 'px' }
  ),
  token(
    'playback.control.radius',
    '--te-player-control-radius',
    '控制按钮圆角',
    'playback',
    'player-controls',
    'length',
    '999px',
    '999px',
    { min: 0, max: 999, step: 1, unit: 'px' }
  ),
  token(
    'playback.control.borderWidth',
    '--te-player-control-border-width',
    '控制按钮描边',
    'playback',
    'player-controls',
    'length',
    '0px',
    '0px',
    { min: 0, max: 4, step: 1, unit: 'px' }
  ),
  token(
    'playback.progress.track',
    '--te-player-progress-track',
    '进度条轨道',
    'playback',
    'player-progress',
    'color',
    'rgba(37, 99, 235, 0.16)',
    'rgba(255, 255, 255, 0.14)'
  ),
  token(
    'playback.progress.fill',
    '--te-player-progress-fill',
    '进度条已播放',
    'playback',
    'player-progress',
    'gradient',
    'linear-gradient(90deg, #2563eb, #0d9488)',
    'linear-gradient(90deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0.88))'
  ),
  token(
    'playback.progress.height',
    '--te-player-progress-height',
    '进度条高度',
    'playback',
    'player-progress',
    'length',
    '6px',
    '6px',
    { min: 2, max: 14, step: 1, unit: 'px' }
  ),
  token(
    'playback.progress.radius',
    '--te-player-progress-radius',
    '进度条圆角',
    'playback',
    'player-progress',
    'length',
    '999px',
    '999px',
    { min: 0, max: 999, step: 1, unit: 'px' }
  ),
  token(
    'playback.progress.thumbSize',
    '--te-player-progress-thumb-size',
    '进度滑块大小',
    'playback',
    'player-progress',
    'length',
    '12px',
    '12px',
    { min: 6, max: 22, step: 1, unit: 'px' }
  ),
  token(
    'playback.time.surface',
    '--te-player-time-surface',
    '时长背景',
    'playback',
    'player-time',
    'color',
    'rgba(37, 99, 235, 0.08)',
    'rgba(255, 255, 255, 0.08)'
  ),
  token(
    'playback.time.radius',
    '--te-player-time-radius',
    '时长背景圆角',
    'playback',
    'player-time',
    'length',
    '8px',
    '8px',
    { min: 0, max: 24, step: 1, unit: 'px' }
  ),
  token(
    'playback.time.opacity',
    '--te-player-time-opacity',
    '时长背景透明度',
    'playback',
    'player-time',
    'number',
    '0%',
    '0%',
    { min: 0, max: 100, step: 1, unit: '%' }
  ),
  token(
    'playback.equalizer.panelSurface',
    '--te-equalizer-panel-bg',
    '均衡器面板表面',
    'playback',
    'equalizer-panel',
    'color',
    '#ffffff',
    '#181818'
  ),
  token(
    'playback.equalizer.panelBorder',
    '--te-equalizer-panel-border',
    '均衡器面板边框',
    'playback',
    'equalizer-panel',
    'color',
    'rgba(15, 23, 42, 0.08)',
    'rgba(255, 255, 255, 0.1)'
  ),
  token(
    'playback.equalizer.panelRadius',
    '--te-equalizer-panel-radius',
    '均衡器面板圆角',
    'playback',
    'equalizer-panel',
    'length',
    '20px',
    '20px',
    { min: 0, max: 32, step: 1, unit: 'px' }
  ),
  token(
    'playback.equalizer.sliderTrack',
    '--te-equalizer-slider-track',
    '均衡器滑轨',
    'playback',
    'equalizer-slider',
    'color',
    'rgba(15, 23, 42, 0.06)',
    'rgba(255, 255, 255, 0.1)'
  ),
  token(
    'playback.equalizer.sliderFill',
    '--te-equalizer-slider-fill',
    '均衡器滑轨填充',
    'playback',
    'equalizer-slider',
    'gradient',
    'linear-gradient(to top, #2563eb, #14b8a6)',
    'linear-gradient(to top, #38bdf8, #a78bfa)'
  ),
  token(
    'playback.equalizer.sliderThumb',
    '--te-equalizer-slider-thumb',
    '均衡器滑块颜色',
    'playback',
    'equalizer-slider',
    'color',
    '#ffffff',
    '#f8fafc'
  ),
  token(
    'playback.equalizer.sliderThumbSize',
    '--te-equalizer-slider-thumb-size',
    '均衡器滑块大小',
    'playback',
    'equalizer-slider',
    'length',
    '20px',
    '20px',
    { min: 12, max: 30, step: 1, unit: 'px' }
  ),
  token(
    'playback.equalizer.grid',
    '--te-equalizer-grid',
    '均衡器辅助线',
    'playback',
    'equalizer-spectrum',
    'color',
    'rgba(15, 23, 42, 0.07)',
    'rgba(255, 255, 255, 0.1)'
  ),
  token(
    'playback.equalizer.guide',
    '--te-equalizer-guide',
    '均衡器频率准线',
    'playback',
    'equalizer-spectrum',
    'color',
    'rgba(37, 99, 235, 0.45)',
    'rgba(56, 189, 248, 0.55)'
  ),
  token(
    'playback.equalizer.spectrum',
    '--te-equalizer-spectrum',
    '均衡器频谱颜色',
    'playback',
    'equalizer-spectrum',
    'color',
    '#2563eb',
    '#38bdf8'
  ),
  token(
    'playback.equalizer.buttonSurface',
    '--te-equalizer-button-bg',
    '均衡器按钮表面',
    'playback',
    'equalizer-controls',
    'color',
    'rgba(37, 99, 235, 0.08)',
    'rgba(56, 189, 248, 0.12)'
  ),
  token(
    'playback.equalizer.buttonRadius',
    '--te-equalizer-button-radius',
    '均衡器按钮圆角',
    'playback',
    'equalizer-controls',
    'length',
    '10px',
    '10px',
    { min: 0, max: 24, step: 1, unit: 'px' }
  ),
  token(
    'playback.equalizer.knobSize',
    '--te-equalizer-knob-size',
    '音量面板旋钮大小',
    'playback',
    'equalizer-controls',
    'length',
    '18px',
    '18px',
    { min: 12, max: 30, step: 1, unit: 'px' }
  ),
  token(
    'motion.enter',
    '--te-ease-enter',
    '进入缓动',
    'motion',
    'global',
    'easing',
    'cubic-bezier(0.4, 0, 0.2, 1)',
    'cubic-bezier(0.4, 0, 0.2, 1)'
  ),
  token(
    'motion.soft',
    '--te-ease-soft',
    '柔和缓动',
    'motion',
    'global',
    'easing',
    'cubic-bezier(0.2, 0.8, 0.2, 1)',
    'cubic-bezier(0.2, 0.8, 0.2, 1)'
  )
])

const tokenDefinitionById = new Map(
  THEME_TOKEN_DEFINITIONS.map((definition) => [definition.id, definition])
)

function variantFromDefaults(tone: ThemeTone): ThemeVariant {
  return {
    tokens: Object.fromEntries(
      THEME_TOKEN_DEFINITIONS.map((definition) => [definition.id, definition.defaults[tone]])
    )
  }
}

export const TWILIGHT_DEFAULT_THEME: ThemeDocumentV1 = Object.freeze({
  schemaVersion: THEME_DOCUMENT_SCHEMA_VERSION,
  id: TWILIGHT_DEFAULT_THEME_ID,
  name: 'Twilight Echo 默认主题',
  description: '播放器升级前的原始视觉，所有未覆盖令牌均继承这里的值。',
  variants: {
    pureWhite: variantFromDefaults('pureWhite'),
    dark: variantFromDefaults('dark')
  },
  windowDefaults: {
    miniPlayer: {
      surfaceColor: '#11121d',
      accentColor: '#7c4dff',
      primaryTextColor: '#ffffff',
      mutedTextColor: '#b8b7c2',
      fontFamily: lightFont,
      surfaceOpacity: 94,
      glassBlur: 18,
      cornerRadius: 25,
      borderWidth: 1,
      borderColor: '#353542',
      shadowStrength: 80,
      shadowColor: '#000000'
    },
    desktopLyrics: {
      fontFamily: 'system',
      fontSize: 32,
      fontWeight: 700,
      color: '#ffffff',
      highlightColor: '#FFD700',
      backgroundColor: '#000000',
      backgroundOpacity: 30,
      shadow: true,
      shadowBlur: 8,
      shadowColor: '#000000'
    }
  }
})

const allThemeVisibilitySlots = Object.freeze(
  Object.fromEntries(THEME_VISIBILITY_SLOT_IDS.map((id) => [id, true])) as Record<
    ThemeVisibilitySlotId,
    boolean
  >
)

function builtInThemePreset(
  id: BuiltInThemePresetId,
  name: string,
  description: string,
  overrides: ThemeProfileV2['overrides'],
  modes: ThemeModes,
  windowDefaults: ThemeWindowDefaults = {}
): ThemeProfileV2 {
  return Object.freeze({
    schemaVersion: THEME_PROFILE_SCHEMA_VERSION,
    id,
    name,
    description,
    baseThemeId: TWILIGHT_DEFAULT_THEME_ID,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    overrides,
    modes,
    windowDefaults
  })
}

export const BUILT_IN_THEME_PRESETS: readonly ThemeProfileV2[] = Object.freeze([
  builtInThemePreset(
    TWILIGHT_DEFAULT_THEME_ID,
    'Twilight Default',
    'Twilight Echo 的基准外观与完整功能可见性。',
    { pureWhite: {}, dark: {} },
    { visibility: { ...allThemeVisibilitySlots } },
    TWILIGHT_DEFAULT_THEME.windowDefaults
  ),
  builtInThemePreset(
    'builtin:aurora-reference',
    'Aurora 参考',
    '晨雾薄荷与极夜绿紫交织的光之幕，歌词悬浮在流动的极光辉光里呼吸。',
    {
      pureWhite: {
        'color.primary.500': '#0e9373',
        'color.primary.400': '#2fb392',
        'color.primary.300': '#9fe6cf',
        'color.primary.rgb': '14, 147, 115',
        'color.neutral.300': '#d9d5ee',
        'color.neutral.500': '#5d5c86',
        'color.neutral.700': '#403f68',
        'color.neutral.900': '#211f42',
        'surface.app': '#f3f1fc',
        'surface.local': '#f3f1fc',
        'surface.settings': '#f3f1fc',
        'surface.streaming': '#f3f1fc',
        'surface.player': '#eef1fa',
        'surface.card': 'rgba(255, 255, 255, 0.82)',
        'surface.cardBorder': 'rgba(255, 255, 255, 0.95)',
        'surface.hover': 'rgba(124, 138, 255, 0.09)',
        'surface.active': 'rgba(14, 147, 115, 0.14)',
        'background.gradientStart': '#e9e5fb',
        'background.gradientEnd': '#ddf5eb',
        'background.gradientAngle': '160deg',
        'background.coverBlur': '44px',
        'background.overlayOpacity': '20%',
        'material.glass': 'rgba(255, 255, 255, 0.72)',
        'material.glassStrong': 'rgba(255, 255, 255, 0.92)',
        'material.glassBorder': 'rgba(255, 255, 255, 0.88)',
        'material.glassShadow':
          '0 24px 70px rgba(122, 108, 228, 0.16), 0 0 44px rgba(64, 201, 162, 0.12)',
        'material.glowMain': 'rgba(64, 201, 162, 0.2)',
        'material.glowSoft': 'rgba(150, 132, 255, 0.16)',
        'material.glowCyan': 'rgba(94, 234, 212, 0.18)',
        'material.cardBlur': '28px',
        'typography.display':
          "'Space Grotesk', 'MiSans Full', 'MiSans', 'Microsoft YaHei UI', system-ui, sans-serif",
        'typography.titleWeight': '600',
        'typography.bodyWeight': '400',
        'shape.globalRadius': '18px',
        'shape.cardRadius': '22px',
        'navigation.surface': 'rgba(255, 255, 255, 0.58)',
        'navigation.activeSurface': 'rgba(14, 147, 115, 0.12)',
        'navigation.activeText': '#0b7a60',
        'navigation.indicator': '#0e9373',
        'navigation.radius': '22px',
        'navigation.opacity': '70%',
        'library.page.surface':
          'linear-gradient(180deg, rgba(255, 255, 255, 0.68), rgba(243, 241, 252, 0.52))',
        'library.table.surface': 'rgba(255, 255, 255, 0.42)',
        'library.row.text': '#403f68',
        'library.actionSurface': 'rgba(14, 147, 115, 0.1)',
        'library.coverRadius': '14px',
        'playback.accent': '#2fb392',
        'playback.backdrop.filter': 'blur(64px) saturate(1.4) brightness(0.55)',
        'playback.backdrop.scrim':
          'linear-gradient(180deg, rgba(24, 28, 56, 0.52) 0%, rgba(14, 34, 40, 0.6) 55%, rgba(9, 14, 32, 0.7) 100%)',
        'playback.cover.radius': '26px',
        'playback.cover.shadow':
          '0 30px 90px rgba(15, 20, 48, 0.42), 0 0 64px rgba(94, 234, 212, 0.28)',
        'playback.lyrics.activeSurface': 'rgba(94, 234, 212, 0.12)',
        'playback.lyrics.activeBorder': 'rgba(94, 234, 212, 0.3)',
        'playback.lyrics.activeShadow': '0 0 36px rgba(94, 234, 212, 0.32)',
        'playback.progress.track': 'rgba(255, 255, 255, 0.2)',
        'playback.progress.fill': 'linear-gradient(90deg, #5eead4, #a78bfa)',
        'playback.equalizer.sliderFill': 'linear-gradient(to top, #0e9373, #7c6cf0)',
        'playback.equalizer.spectrum': '#0e9373',
        'motion.enter': 'cubic-bezier(0.22, 1, 0.36, 1)',
        'motion.soft': 'cubic-bezier(0.16, 1, 0.3, 1)'
      },
      dark: {
        'color.primary.500': '#6ee7b7',
        'color.primary.400': '#9df0d0',
        'color.primary.300': '#c9f8e6',
        'color.primary.rgb': '110, 231, 183',
        'color.neutral.300': '#2d3157',
        'color.neutral.500': '#8f95c1',
        'color.neutral.700': '#c9cff2',
        'color.neutral.900': '#f1f4ff',
        'surface.app': '#0a0c1e',
        'surface.local': '#0a0c1e',
        'surface.settings': '#0a0c1e',
        'surface.streaming': '#0a0c1e',
        'surface.player': '#070812',
        'surface.card': 'rgba(22, 26, 52, 0.76)',
        'surface.cardBorder': 'rgba(110, 231, 183, 0.16)',
        'surface.hover': 'rgba(148, 163, 255, 0.08)',
        'surface.active': 'rgba(110, 231, 183, 0.14)',
        'background.gradientStart': '#111739',
        'background.gradientEnd': '#0a201e',
        'background.gradientAngle': '160deg',
        'background.coverBlur': '52px',
        'background.overlayOpacity': '46%',
        'material.glass': 'rgba(13, 16, 38, 0.7)',
        'material.glassStrong': 'rgba(15, 18, 42, 0.92)',
        'material.glassBorder': 'rgba(148, 163, 255, 0.14)',
        'material.glassShadow':
          '0 28px 80px rgba(2, 4, 16, 0.66), 0 0 52px rgba(110, 231, 183, 0.12)',
        'material.glowMain': 'rgba(110, 231, 183, 0.22)',
        'material.glowSoft': 'rgba(167, 139, 250, 0.18)',
        'material.glowCyan': 'rgba(103, 232, 249, 0.14)',
        'material.cardBlur': '30px',
        'typography.display':
          "'Space Grotesk', 'MiSans Full', 'MiSans', 'Microsoft YaHei UI', system-ui, sans-serif",
        'typography.titleWeight': '600',
        'typography.bodyWeight': '400',
        'shape.globalRadius': '18px',
        'shape.cardRadius': '22px',
        'navigation.surface': 'rgba(9, 12, 30, 0.62)',
        'navigation.activeSurface': 'rgba(110, 231, 183, 0.14)',
        'navigation.activeText': '#6ee7b7',
        'navigation.indicator': '#6ee7b7',
        'navigation.radius': '22px',
        'navigation.opacity': '82%',
        'library.page.surface':
          'linear-gradient(180deg, rgba(17, 21, 46, 0.72), rgba(8, 10, 26, 0.58))',
        'library.table.surface': 'rgba(20, 24, 52, 0.44)',
        'library.row.text': '#c9cff2',
        'library.actionSurface': 'rgba(110, 231, 183, 0.12)',
        'library.coverRadius': '14px',
        'playback.accent': '#6ee7b7',
        'playback.backdrop.filter': 'blur(64px) saturate(1.5) brightness(0.3)',
        'playback.backdrop.scrim':
          'linear-gradient(180deg, rgba(4, 6, 18, 0.66) 0%, rgba(6, 14, 26, 0.72) 55%, rgba(2, 4, 12, 0.8) 100%)',
        'playback.cover.radius': '26px',
        'playback.cover.shadow':
          '0 30px 90px rgba(0, 0, 0, 0.6), 0 0 70px rgba(110, 231, 183, 0.24)',
        'playback.lyrics.activeSurface': 'rgba(110, 231, 183, 0.1)',
        'playback.lyrics.activeBorder': 'rgba(110, 231, 183, 0.26)',
        'playback.lyrics.activeShadow': '0 0 40px rgba(110, 231, 183, 0.3)',
        'playback.progress.track': 'rgba(255, 255, 255, 0.16)',
        'playback.progress.fill': 'linear-gradient(90deg, #6ee7b7, #a78bfa)',
        'playback.equalizer.sliderFill': 'linear-gradient(to top, #6ee7b7, #a78bfa)',
        'playback.equalizer.spectrum': '#6ee7b7',
        'motion.enter': 'cubic-bezier(0.22, 1, 0.36, 1)',
        'motion.soft': 'cubic-bezier(0.16, 1, 0.3, 1)'
      }
    },
    {
      appearance: {
        accentSource: 'cover',
        backgroundTreatment: 'cover-blur',
        toneScheduling: 'timed',
        contrastGuard: 'enforce',
        effectsMode: 'full'
      },
      navigation: { style: 'expanded', iconScale: 'md', logo: 'hide' },
      library: { density: 'comfortable', selection: 'fill', titleOverlay: 'on' },
      player: {
        layout: 'lyrics-focus',
        controls: 'standard',
        titleAlign: 'center',
        progress: 'ring'
      },
      artwork: { transition: 'fade', shadow: 'on' },
      equalizer: { panel: 'glass', slider: 'ring', knob: 'dot', spectrum: 'area', button: 'soft' },
      icons: { family: 'rounded' },
      typography: { titleCase: 'preserve', lyricAccent: 'accent', titleColor: 'track' },
      visibility: { ...allThemeVisibilitySlots, playerWaveform: false, playerMiscIcons: false }
    },
    {
      miniPlayer: {
        surfaceColor: '#0b0e22',
        accentColor: '#6ee7b7',
        primaryTextColor: '#f1f4ff',
        mutedTextColor: '#aab1d6',
        fontFamily: lightFont,
        surfaceOpacity: 78,
        glassBlur: 32,
        cornerRadius: 24,
        borderWidth: 1,
        borderColor: '#2d3157',
        shadowStrength: 78,
        shadowColor: '#020410'
      },
      desktopLyrics: {
        fontFamily:
          "'Space Grotesk', 'MiSans Full', 'MiSans', 'Microsoft YaHei UI', system-ui, sans-serif",
        fontSize: 34,
        fontWeight: 600,
        color: '#e6ebff',
        highlightColor: '#6ee7b7',
        backgroundColor: '#0a0c1e',
        backgroundOpacity: 34,
        shadow: true,
        shadowBlur: 14,
        shadowColor: '#04101c'
      }
    }
  ),
  builtInThemePreset(
    'builtin:obsidian-glass',
    'Obsidian Glass',
    '深渊般的纯黑玻璃与冰青断口微光，在厚重阴影中折射出锋利而克制的奢华。',
    {
      pureWhite: {
        'color.primary.500': '#67e8f9',
        'color.primary.400': '#a5f3fc',
        'color.primary.300': '#cffafe',
        'color.primary.rgb': '103, 232, 249',
        'color.accentCyan': '#67e8f9',
        'color.neutral.50': '#030405',
        'color.neutral.100': '#0b0e10',
        'color.neutral.200': '#181d20',
        'color.neutral.300': '#262d31',
        'color.neutral.500': '#93a1a6',
        'color.neutral.700': '#ccd6da',
        'color.neutral.900': '#f0f5f6',
        'surface.app': '#0b0d10',
        'surface.local': '#0b0d10',
        'surface.settings': '#0b0d10',
        'surface.streaming': '#0b0d10',
        'surface.player': '#07090b',
        'surface.card': '#12161a',
        'surface.cardBorder': 'rgba(148, 220, 233, 0.17)',
        'surface.subtle': '#0e1114',
        'surface.hover': 'rgba(165, 243, 252, 0.06)',
        'surface.active': 'rgba(103, 232, 249, 0.14)',
        'background.gradientStart': '#101418',
        'background.gradientEnd': '#07090b',
        'background.gradientAngle': '168deg',
        'shell.control.text': '#f0f5f6',
        'shell.control.hoverSurface': 'rgba(165, 243, 252, 0.08)',
        'settings.text.primary': '#f0f5f6',
        'settings.text.muted': '#93a1a6',
        'settings.control.surface': '#12161a',
        'settings.control.border': 'rgba(148, 220, 233, 0.14)',
        'settings.navigation.text': '#93a1a6',
        'settings.navigation.hoverSurface': 'rgba(165, 243, 252, 0.06)',
        'settings.navigation.activeSurface': 'rgba(103, 232, 249, 0.14)',
        'navigation.surface': 'rgba(7, 9, 11, 0.92)',
        'navigation.border': 'rgba(148, 220, 233, 0.12)',
        'navigation.shadow': '8px 0 36px rgba(0, 0, 0, 0.6)',
        'navigation.text': '#ccd6da',
        'navigation.icon': '#93a1a6',
        'navigation.hoverSurface': 'rgba(165, 243, 252, 0.07)',
        'navigation.hoverText': '#f0f5f6',
        'navigation.activeSurface': 'rgba(103, 232, 249, 0.14)',
        'navigation.activeText': '#67e8f9',
        'navigation.indicator': '#67e8f9',
        'library.row.text': '#ccd6da',
        'library.row.hoverSurface': 'rgba(165, 243, 252, 0.05)',
        'library.selection.surface': 'rgba(103, 232, 249, 0.1)',
        'library.selection.hoverSurface': 'rgba(103, 232, 249, 0.16)',
        'library.selection.indicator': '#67e8f9',
        'library.icon': '#93a1a6',
        'typography.display': "'Space Grotesk', 'MiSans Full', 'MiSans', system-ui, sans-serif",
        'typography.chromeText': '#ccd6da',
        'shape.globalRadius': '12px',
        'shape.cardRadius': '14px',
        'material.glass': 'rgba(11, 14, 17, 0.78)',
        'material.glassStrong': 'rgba(8, 10, 13, 0.92)',
        'material.glassBorder': 'rgba(148, 220, 233, 0.15)',
        'material.glassShadow': '0 26px 72px rgba(0, 0, 0, 0.64)',
        'material.glowMain': 'rgba(103, 232, 249, 0.16)',
        'material.cardBlur': '28px',
        'playback.accent': '#67e8f9',
        'playback.backdrop.filter': 'blur(72px) saturate(1.04) brightness(0.3)',
        'playback.cover.radius': '14px',
        'playback.cover.shadow':
          '0 34px 90px rgba(0, 0, 0, 0.72), inset 0 0 0 1px rgba(165, 243, 252, 0.14)',
        'playback.control.radius': '12px',
        'playback.progress.height': '3px',
        'playback.progress.track': 'rgba(165, 243, 252, 0.14)',
        'playback.progress.fill': 'linear-gradient(90deg, #22d3ee, #a5f3fc)',
        'playback.equalizer.sliderFill': 'linear-gradient(to top, #0e7490, #67e8f9)',
        'playback.equalizer.spectrum': '#67e8f9',
        'playback.equalizer.guide': 'rgba(103, 232, 249, 0.5)'
      },
      dark: {
        'color.primary.500': '#22d3ee',
        'color.primary.400': '#67e8f9',
        'color.primary.300': '#a5f3fc',
        'color.primary.rgb': '34, 211, 238',
        'color.accentCyan': '#22d3ee',
        'color.neutral.50': '#000000',
        'color.neutral.100': '#070809',
        'color.neutral.200': '#121517',
        'color.neutral.300': '#1f2427',
        'color.neutral.500': '#8a969b',
        'color.neutral.700': '#c6d1d5',
        'color.neutral.900': '#edf3f5',
        'surface.app': '#040506',
        'surface.local': '#040506',
        'surface.settings': '#040506',
        'surface.streaming': '#040506',
        'surface.player': '#020304',
        'surface.card': '#0b0e11',
        'surface.cardBorder': 'rgba(134, 213, 227, 0.15)',
        'surface.subtle': '#080a0c',
        'surface.hover': 'rgba(165, 243, 252, 0.05)',
        'surface.active': 'rgba(34, 211, 238, 0.14)',
        'background.gradientStart': '#0a0d10',
        'background.gradientEnd': '#020304',
        'background.gradientAngle': '168deg',
        'shell.control.text': '#edf3f5',
        'shell.control.hoverSurface': 'rgba(165, 243, 252, 0.07)',
        'settings.text.primary': '#edf3f5',
        'settings.text.muted': '#8a969b',
        'settings.control.surface': '#0b0e11',
        'settings.control.border': 'rgba(134, 213, 227, 0.12)',
        'settings.navigation.text': '#8a969b',
        'settings.navigation.hoverSurface': 'rgba(165, 243, 252, 0.05)',
        'settings.navigation.activeSurface': 'rgba(34, 211, 238, 0.15)',
        'navigation.surface': 'rgba(2, 3, 4, 0.94)',
        'navigation.border': 'rgba(134, 213, 227, 0.1)',
        'navigation.shadow': '8px 0 36px rgba(0, 0, 0, 0.7)',
        'navigation.text': '#c6d1d5',
        'navigation.icon': '#8a969b',
        'navigation.hoverSurface': 'rgba(165, 243, 252, 0.06)',
        'navigation.hoverText': '#edf3f5',
        'navigation.activeSurface': 'rgba(34, 211, 238, 0.15)',
        'navigation.activeText': '#22d3ee',
        'navigation.indicator': '#22d3ee',
        'library.row.text': '#c6d1d5',
        'library.row.hoverSurface': 'rgba(165, 243, 252, 0.045)',
        'library.selection.surface': 'rgba(34, 211, 238, 0.1)',
        'library.selection.hoverSurface': 'rgba(34, 211, 238, 0.16)',
        'library.selection.indicator': '#22d3ee',
        'library.icon': '#8a969b',
        'typography.display': "'Space Grotesk', 'MiSans Full', 'MiSans', system-ui, sans-serif",
        'typography.chromeText': '#c6d1d5',
        'shape.globalRadius': '12px',
        'shape.cardRadius': '14px',
        'material.glass': 'rgba(5, 7, 9, 0.82)',
        'material.glassStrong': 'rgba(3, 4, 5, 0.94)',
        'material.glassBorder': 'rgba(134, 213, 227, 0.13)',
        'material.glassShadow': '0 28px 80px rgba(0, 0, 0, 0.78)',
        'material.glowMain': 'rgba(34, 211, 238, 0.18)',
        'material.cardBlur': '30px',
        'playback.accent': '#22d3ee',
        'playback.backdrop.filter': 'blur(76px) saturate(1.02) brightness(0.24)',
        'playback.cover.radius': '14px',
        'playback.cover.shadow':
          '0 38px 100px rgba(0, 0, 0, 0.82), inset 0 0 0 1px rgba(165, 243, 252, 0.12)',
        'playback.control.radius': '12px',
        'playback.progress.height': '3px',
        'playback.progress.track': 'rgba(165, 243, 252, 0.12)',
        'playback.progress.fill': 'linear-gradient(90deg, #06b6d4, #a5f3fc)',
        'playback.equalizer.sliderFill': 'linear-gradient(to top, #155e75, #22d3ee)',
        'playback.equalizer.spectrum': '#22d3ee',
        'playback.equalizer.guide': 'rgba(34, 211, 238, 0.5)'
      }
    },
    {
      appearance: {
        accentSource: 'fixed',
        backgroundTreatment: 'gradient',
        contrastGuard: 'enforce',
        effectsMode: 'full'
      },
      navigation: { style: 'rail', iconScale: 'md', logo: 'hide' },
      library: { density: 'compact', selection: 'stroke', titleOverlay: 'off' },
      player: { layout: 'full-cover', controls: 'pro', titleAlign: 'left', progress: 'line' },
      artwork: { transition: 'fade', shadow: 'on' },
      equalizer: {
        panel: 'glass',
        slider: 'solid',
        knob: 'dot',
        spectrum: 'area',
        button: 'outline'
      },
      icons: { family: 'filled' },
      typography: { titleCase: 'uppercase', lyricAccent: 'accent', titleColor: 'off' },
      visibility: {
        ...allThemeVisibilitySlots,
        playerAlbumArtist: false,
        playerTrackMenu: false,
        playerMiscIcons: false,
        playerDuration: false,
        playerWaveform: false
      }
    },
    {
      miniPlayer: {
        surfaceColor: '#040506',
        accentColor: '#22d3ee',
        primaryTextColor: '#edf3f5',
        mutedTextColor: '#8a969b',
        fontFamily: lightFont,
        surfaceOpacity: 78,
        glassBlur: 34,
        cornerRadius: 14,
        borderWidth: 1,
        borderColor: '#1c3b42',
        shadowStrength: 96,
        shadowColor: '#000000'
      },
      desktopLyrics: {
        fontFamily: "'Space Grotesk', 'MiSans Full', 'MiSans', system-ui, sans-serif",
        fontSize: 30,
        fontWeight: 600,
        color: '#dfe9eb',
        highlightColor: '#22d3ee',
        backgroundColor: '#020304',
        backgroundOpacity: 56,
        shadow: true,
        shadowBlur: 14,
        shadowColor: '#000000'
      }
    }
  ),
  builtInThemePreset(
    'builtin:paper-light',
    'Paper Light',
    '暖纸底色、衬线标题与朱砂细线的排印之作，以边线代替阴影与光晕，安静克制如一页夜读的杂志。',
    {
      pureWhite: {
        'color.primary.500': '#a8321f',
        'color.primary.400': '#c14e37',
        'color.primary.rgb': '168, 50, 31',
        'color.neutral.200': '#e3dcca',
        'color.neutral.500': '#6d675a',
        'color.neutral.700': '#3b362b',
        'color.neutral.900': '#211d15',
        'surface.app': '#f6f2e9',
        'surface.local': '#f6f2e9',
        'surface.settings': '#f6f2e9',
        'surface.streaming': '#f6f2e9',
        'surface.player': '#f6f2e9',
        'surface.card': '#fcfaf3',
        'surface.cardBorder': '#d9d2c0',
        'surface.hover': '#efe9db',
        'navigation.surface': '#f6f2e9',
        'navigation.border': '#d9d2c0',
        'navigation.activeSurface': 'rgba(168, 50, 31, 0.07)',
        'navigation.activeText': '#a8321f',
        'navigation.indicator': '#a8321f',
        'library.table.surface': '#fcfaf3',
        'library.table.border': '#d9d2c0',
        'library.table.shadow': 'none',
        'library.selection.indicator': '#a8321f',
        'library.selection.radius': '2px',
        'library.coverRadius': '2px',
        'material.glass': '#fcfaf3',
        'material.glassBorder': '#d9d2c0',
        'material.glassShadow': 'none',
        'material.cardBlur': '0px',
        'typography.display': "'Lora', 'Noto Serif SC', 'Source Han Serif SC', Georgia, serif",
        'typography.titleWeight': '600',
        'typography.chromeText': '#4a4436',
        'shape.globalRadius': '3px',
        'shape.cardRadius': '3px',
        'playback.accent': '#a8321f',
        'playback.text.page': '#211d15',
        'playback.backdrop.scrim':
          'linear-gradient(180deg, rgba(246, 242, 233, 0.95) 0%, rgba(246, 242, 233, 0.96) 55%, rgba(242, 237, 225, 0.98) 100%)',
        'playback.cover.radius': '2px',
        'playback.cover.shadow': 'none',
        'playback.track.title': '#211d15',
        'playback.track.artist': 'rgba(33, 29, 21, 0.72)',
        'playback.track.album': 'rgba(33, 29, 21, 0.52)',
        'playback.lyrics.text': 'rgba(33, 29, 21, 0.45)',
        'playback.lyrics.hoverText': 'rgba(33, 29, 21, 0.68)',
        'playback.lyrics.activeText': '#211d15',
        'playback.lyrics.activeSurface': 'transparent',
        'playback.lyrics.activeShadow': 'none',
        'playback.lyrics.translation': 'rgba(33, 29, 21, 0.56)',
        'playback.lyrics.translationActive': 'rgba(33, 29, 21, 0.8)',
        'playback.control.border': 'rgba(33, 29, 21, 0.3)',
        'playback.control.text': 'rgba(33, 29, 21, 0.78)',
        'playback.control.hoverSurface': 'rgba(33, 29, 21, 0.06)',
        'playback.control.hoverText': '#211d15',
        'playback.control.radius': '2px',
        'playback.progress.track': 'rgba(33, 29, 21, 0.16)',
        'playback.progress.fill': 'linear-gradient(90deg, #a8321f, #a8321f)',
        'playback.progress.height': '3px',
        'playback.equalizer.sliderFill': 'linear-gradient(to top, #a8321f, #c14e37)',
        'playback.equalizer.spectrum': '#a8321f'
      },
      dark: {
        'color.primary.500': '#cc8060',
        'color.primary.400': '#d99877',
        'color.primary.rgb': '204, 128, 96',
        'color.neutral.200': '#382f24',
        'color.neutral.500': '#a2967f',
        'color.neutral.700': '#d7cbb2',
        'color.neutral.900': '#efe6d2',
        'surface.app': '#231d16',
        'surface.local': '#231d16',
        'surface.settings': '#231d16',
        'surface.streaming': '#231d16',
        'surface.player': '#231d16',
        'surface.card': '#2b241b',
        'surface.cardBorder': '#463c2d',
        'surface.hover': 'rgba(239, 230, 210, 0.06)',
        'surface.active': 'rgba(204, 128, 96, 0.16)',
        'navigation.surface': '#231d16',
        'navigation.border': '#463c2d',
        'navigation.activeSurface': 'rgba(204, 128, 96, 0.12)',
        'navigation.activeText': '#cc8060',
        'navigation.indicator': '#cc8060',
        'library.table.surface': '#2b241b',
        'library.table.border': '#463c2d',
        'library.table.shadow': 'none',
        'library.selection.indicator': '#cc8060',
        'library.selection.radius': '2px',
        'library.coverRadius': '2px',
        'material.glass': '#2b241b',
        'material.glassBorder': '#463c2d',
        'material.glassShadow': 'none',
        'material.cardBlur': '0px',
        'typography.display': "'Lora', 'Noto Serif SC', 'Source Han Serif SC', Georgia, serif",
        'typography.titleWeight': '600',
        'typography.chromeText': '#cdc0a6',
        'shape.globalRadius': '3px',
        'shape.cardRadius': '3px',
        'playback.accent': '#cc8060',
        'playback.text.page': '#efe6d2',
        'playback.backdrop.scrim':
          'linear-gradient(180deg, rgba(35, 29, 22, 0.95) 0%, rgba(35, 29, 22, 0.96) 55%, rgba(28, 23, 17, 0.98) 100%)',
        'playback.cover.radius': '2px',
        'playback.cover.shadow': 'none',
        'playback.track.title': '#f4ecda',
        'playback.track.artist': 'rgba(239, 230, 210, 0.74)',
        'playback.track.album': 'rgba(239, 230, 210, 0.5)',
        'playback.lyrics.text': 'rgba(239, 230, 210, 0.42)',
        'playback.lyrics.hoverText': 'rgba(239, 230, 210, 0.7)',
        'playback.lyrics.activeText': '#f4ecda',
        'playback.lyrics.activeSurface': 'transparent',
        'playback.lyrics.activeShadow': 'none',
        'playback.lyrics.translation': 'rgba(239, 230, 210, 0.58)',
        'playback.lyrics.translationActive': 'rgba(239, 230, 210, 0.82)',
        'playback.control.border': 'rgba(239, 230, 210, 0.28)',
        'playback.control.text': 'rgba(239, 230, 210, 0.8)',
        'playback.control.hoverText': '#f4ecda',
        'playback.control.radius': '2px',
        'playback.progress.track': 'rgba(239, 230, 210, 0.18)',
        'playback.progress.fill': 'linear-gradient(90deg, #cc8060, #cc8060)',
        'playback.progress.height': '3px',
        'playback.equalizer.sliderFill': 'linear-gradient(to top, #cc8060, #d99877)',
        'playback.equalizer.spectrum': '#cc8060'
      }
    },
    {
      appearance: {
        backgroundTreatment: 'solid',
        contrastGuard: 'enforce',
        effectsMode: 'reduced'
      },
      navigation: { style: 'expanded', iconScale: 'sm', logo: 'show' },
      library: { density: 'comfortable', selection: 'stroke', titleOverlay: 'off' },
      player: { layout: 'standard', controls: 'standard', titleAlign: 'left', progress: 'line' },
      artwork: { transition: 'none', shadow: 'off' },
      equalizer: {
        panel: 'neutral',
        slider: 'solid',
        knob: 'line',
        spectrum: 'line',
        button: 'outline'
      },
      icons: { family: 'outline' },
      typography: { titleCase: 'preserve', lyricAccent: 'accent', titleColor: 'off' },
      visibility: { ...allThemeVisibilitySlots, playerWaveform: false, playerMiscIcons: false }
    },
    {
      miniPlayer: {
        surfaceColor: '#f6f2e9',
        accentColor: '#a8321f',
        primaryTextColor: '#211d15',
        mutedTextColor: '#6d675a',
        fontFamily: "'Lora', 'Noto Serif SC', 'Source Han Serif SC', Georgia, serif",
        surfaceOpacity: 100,
        glassBlur: 0,
        cornerRadius: 3,
        borderWidth: 1,
        borderColor: '#d9d2c0',
        shadowStrength: 0,
        shadowColor: '#000000'
      },
      desktopLyrics: {
        fontFamily: "'Lora', 'Noto Serif SC', 'Source Han Serif SC', Georgia, serif",
        fontSize: 30,
        fontWeight: 500,
        color: '#211d15',
        highlightColor: '#a8321f',
        backgroundColor: '#f6f2e9',
        backgroundOpacity: 96,
        shadow: false,
        shadowBlur: 0,
        shadowColor: '#000000'
      }
    }
  ),
  builtInThemePreset(
    'builtin:neon-gradient',
    'Neon Gradient',
    '霓虹夜城：品红与电青的双色电流点亮近黑紫夜幕，药丸圆角与彩色辉光让整座界面彻夜发光。',
    {
      pureWhite: {
        'color.primary.500': '#db1f8e',
        'color.primary.400': '#ef4aae',
        'color.primary.rgb': '219, 31, 142',
        'color.accentCyan': '#00b3d7',
        'color.neutral.900': '#2b0a45',
        'color.neutral.700': '#54246f',
        'color.neutral.500': '#7d4899',
        'surface.app': '#fdf2fc',
        'surface.local': '#fdf2fc',
        'surface.settings': '#fdf2fc',
        'surface.streaming': '#fdf2fc',
        'surface.player': '#fdf2fc',
        'surface.card': '#ffffff',
        'surface.cardBorder': 'rgba(219, 31, 142, 0.22)',
        'surface.subtle': '#fce8f9',
        'surface.hover': 'rgba(219, 31, 142, 0.07)',
        'surface.active': 'rgba(219, 31, 142, 0.15)',
        'background.gradientStart': '#ffbfe6',
        'background.gradientEnd': '#aaefff',
        'background.gradientAngle': '128deg',
        'shell.control.hoverSurface': 'rgba(219, 31, 142, 0.1)',
        'navigation.surface': 'rgba(255, 255, 255, 0.82)',
        'navigation.border': 'rgba(219, 31, 142, 0.16)',
        'navigation.text': '#6d3f8a',
        'navigation.activeSurface': 'rgba(219, 31, 142, 0.14)',
        'navigation.activeText': '#b3126f',
        'navigation.indicator': '#00b3d7',
        'navigation.radius': '26px',
        'material.glass': 'rgba(255, 255, 255, 0.86)',
        'material.glassStrong': 'rgba(255, 255, 255, 0.96)',
        'material.glassBorder': 'rgba(219, 31, 142, 0.2)',
        'material.glassShadow':
          '0 20px 55px rgba(219, 31, 142, 0.18), 0 8px 28px rgba(0, 179, 215, 0.12)',
        'material.glowMain': 'rgba(219, 31, 142, 0.22)',
        'material.glowSoft': 'rgba(0, 179, 215, 0.16)',
        'material.cardBlur': '24px',
        'typography.display':
          "'Space Grotesk', 'MiSans Full', 'MiSans', 'Microsoft YaHei UI', system-ui, sans-serif",
        'typography.titleWeight': '800',
        'typography.metaWeight': '500',
        'shape.globalRadius': '24px',
        'shape.cardRadius': '24px',
        'shape.searchRadius': '24px',
        'playback.accent': '#ff3fa4',
        'playback.cover.radius': '32px',
        'playback.cover.shadow':
          '0 30px 84px rgba(219, 31, 142, 0.42), 0 12px 40px rgba(0, 179, 215, 0.26)',
        'playback.progress.fill': 'linear-gradient(90deg, #ff2d96, #22e0ff)',
        'playback.progress.track': 'rgba(255, 63, 164, 0.2)',
        'playback.control.playSize': '56px',
        'playback.equalizer.panelBorder': 'rgba(219, 31, 142, 0.22)',
        'playback.equalizer.panelRadius': '28px',
        'playback.equalizer.sliderFill': 'linear-gradient(to top, #db1f8e, #00b3d7)',
        'playback.equalizer.spectrum': '#db1f8e',
        'playback.equalizer.buttonSurface': 'rgba(219, 31, 142, 0.12)',
        'playback.equalizer.buttonRadius': '18px',
        'library.row.text': '#54246f',
        'library.selection.surface': 'rgba(219, 31, 142, 0.12)',
        'library.selection.indicator': '#db1f8e',
        'library.selection.radius': '18px',
        'library.coverRadius': '18px',
        'motion.enter': 'cubic-bezier(0.16, 1, 0.3, 1)'
      },
      dark: {
        'color.primary.500': '#ff3fa4',
        'color.primary.400': '#ff74bf',
        'color.primary.rgb': '255, 63, 164',
        'color.accentCyan': '#22e0ff',
        'color.neutral.900': '#fdeefb',
        'color.neutral.700': '#e6cdef',
        'color.neutral.500': '#b98fd0',
        'surface.app': '#0b0514',
        'surface.local': '#0b0514',
        'surface.settings': '#0b0514',
        'surface.streaming': '#0b0514',
        'surface.player': '#080310',
        'surface.card': '#170b26',
        'surface.cardBorder': 'rgba(255, 63, 164, 0.3)',
        'surface.subtle': '#120820',
        'surface.hover': 'rgba(255, 63, 164, 0.1)',
        'surface.active': 'rgba(255, 63, 164, 0.2)',
        'background.gradientStart': '#4c0a6f',
        'background.gradientEnd': '#043c54',
        'background.gradientAngle': '128deg',
        'shell.control.hoverSurface': 'rgba(255, 63, 164, 0.16)',
        'navigation.surface': 'rgba(17, 7, 30, 0.88)',
        'navigation.border': 'rgba(255, 63, 164, 0.22)',
        'navigation.text': '#cbaed9',
        'navigation.activeSurface': 'rgba(255, 63, 164, 0.22)',
        'navigation.activeText': '#ffa3d8',
        'navigation.indicator': '#22e0ff',
        'navigation.radius': '26px',
        'material.glass': 'rgba(23, 11, 38, 0.82)',
        'material.glassStrong': 'rgba(28, 13, 46, 0.95)',
        'material.glassBorder': 'rgba(255, 63, 164, 0.26)',
        'material.glassShadow':
          '0 24px 64px rgba(255, 45, 150, 0.28), 0 10px 34px rgba(34, 224, 255, 0.16)',
        'material.glowMain': 'rgba(255, 63, 164, 0.38)',
        'material.glowSoft': 'rgba(34, 224, 255, 0.24)',
        'material.cardBlur': '26px',
        'typography.display':
          "'Space Grotesk', 'MiSans Full', 'MiSans', 'Microsoft YaHei UI', system-ui, sans-serif",
        'typography.titleWeight': '800',
        'typography.metaWeight': '500',
        'shape.globalRadius': '24px',
        'shape.cardRadius': '24px',
        'shape.searchRadius': '24px',
        'playback.accent': '#ff3fa4',
        'playback.cover.radius': '32px',
        'playback.cover.shadow':
          '0 32px 90px rgba(255, 45, 150, 0.5), 0 12px 44px rgba(34, 224, 255, 0.32)',
        'playback.progress.fill': 'linear-gradient(90deg, #ff2d96, #22e0ff)',
        'playback.progress.track': 'rgba(255, 63, 164, 0.2)',
        'playback.control.playSize': '56px',
        'playback.equalizer.panelBorder': 'rgba(255, 63, 164, 0.3)',
        'playback.equalizer.panelRadius': '28px',
        'playback.equalizer.sliderFill': 'linear-gradient(to top, #ff2d96, #22e0ff)',
        'playback.equalizer.spectrum': '#22e0ff',
        'playback.equalizer.buttonSurface': 'rgba(255, 63, 164, 0.2)',
        'playback.equalizer.buttonRadius': '18px',
        'library.row.text': '#e6cdef',
        'library.selection.surface': 'rgba(255, 63, 164, 0.2)',
        'library.selection.indicator': '#22e0ff',
        'library.selection.radius': '18px',
        'library.coverRadius': '18px',
        'motion.enter': 'cubic-bezier(0.16, 1, 0.3, 1)'
      }
    },
    {
      appearance: { backgroundTreatment: 'gradient', contrastGuard: 'enforce' },
      navigation: { style: 'compact', iconScale: 'lg', logo: 'hide' },
      library: { density: 'compact', selection: 'fill', titleOverlay: 'on' },
      player: { layout: 'minimal', controls: 'pro', titleAlign: 'center', progress: 'spectrum' },
      artwork: { transition: 'slide', shadow: 'on' },
      equalizer: {
        panel: 'tinted',
        slider: 'solid',
        knob: 'dot',
        spectrum: 'bars',
        button: 'solid'
      },
      icons: { family: 'filled' },
      typography: { titleCase: 'uppercase', lyricAccent: 'accent', titleColor: 'track' },
      visibility: {
        ...allThemeVisibilitySlots,
        playerAlbumArtist: false,
        playerTrackMenu: false,
        playerMiscIcons: false,
        playerDuration: false,
        playerWaveform: false,
        equalizerGrid: false,
        equalizerFrequencyGuides: false
      }
    },
    {
      miniPlayer: {
        surfaceColor: '#12061e',
        accentColor: '#ff3fa4',
        primaryTextColor: '#fdeefb',
        mutedTextColor: '#cbaed9',
        fontFamily:
          "'Space Grotesk', 'MiSans Full', 'MiSans', 'Microsoft YaHei UI', system-ui, sans-serif",
        surfaceOpacity: 84,
        glassBlur: 28,
        cornerRadius: 32,
        borderWidth: 1,
        borderColor: '#ff3fa4',
        shadowStrength: 90,
        shadowColor: '#2b0040'
      },
      desktopLyrics: {
        fontFamily:
          "'Space Grotesk', 'MiSans Full', 'MiSans', 'Microsoft YaHei UI', system-ui, sans-serif",
        fontSize: 34,
        fontWeight: 800,
        color: '#fdeefb',
        highlightColor: '#22e0ff',
        backgroundColor: '#12061e',
        backgroundOpacity: 46,
        shadow: true,
        shadowBlur: 16,
        shadowColor: '#ff2d96'
      }
    }
  ),
  builtInThemePreset(
    'builtin:studio-split',
    'Studio Split',
    '机架灰哑光面板、等宽刻度字与信号色仪表线构成的录音棚控制台。',
    {
      pureWhite: {
        'color.primary.500': '#c2410c',
        'color.primary.400': '#ea580c',
        'color.primary.300': '#fdba74',
        'color.primary.rgb': '194, 65, 12',
        'color.favorite': '#dc2626',
        'color.warning': '#b45309',
        'color.neutral.200': '#d4d8da',
        'color.neutral.300': '#b6bcbf',
        'color.neutral.500': '#5b6467',
        'color.neutral.700': '#333a3d',
        'color.neutral.900': '#14181a',
        'surface.app': '#e9ebec',
        'surface.local': '#e9ebec',
        'surface.settings': '#e9ebec',
        'surface.streaming': '#e9ebec',
        'surface.player': '#e9ebec',
        'surface.card': '#f4f5f6',
        'surface.cardBorder': '#c6cbcd',
        'surface.subtle': '#eef0f1',
        'surface.hover': '#e2e5e6',
        'surface.active': 'rgba(194, 65, 12, 0.1)',
        'material.glass': '#f4f5f6',
        'material.glassStrong': '#fafbfb',
        'material.glassBorder': '#c6cbcd',
        'material.glassShadow': 'none',
        'material.cardBlur': '0px',
        'material.cardSaturation': '100%',
        'material.glowMain': 'transparent',
        'navigation.surface': '#e2e5e6',
        'navigation.border': '#c6cbcd',
        'navigation.shadow': 'none',
        'navigation.activeSurface': 'rgba(194, 65, 12, 0.1)',
        'navigation.activeText': '#c2410c',
        'navigation.indicator': '#c2410c',
        'typography.sans': "'JetBrains Mono', 'Cascadia Code', 'MiSans', Consolas, monospace",
        'typography.display': "'JetBrains Mono', 'Cascadia Code', 'MiSans', Consolas, monospace",
        'typography.titleWeight': '600',
        'typography.bodyWeight': '400',
        'typography.bodySize': '13px',
        'shape.globalRadius': '4px',
        'shape.cardRadius': '6px',
        'motion.enter': 'cubic-bezier(0.2, 0, 0.4, 1)',
        'motion.soft': 'linear',
        'library.table.shadow': 'none',
        'library.selection.indicator': '#c2410c',
        'library.selection.radius': '2px',
        'library.coverRadius': '2px',
        'playback.accent': '#fb923c',
        'playback.backdrop.filter': 'blur(72px) saturate(0.55) brightness(0.4)',
        'playback.backdrop.scrim':
          'linear-gradient(180deg, rgba(12, 14, 15, 0.78), rgba(12, 14, 15, 0.82))',
        'playback.cover.radius': '4px',
        'playback.control.radius': '4px',
        'playback.control.borderWidth': '1px',
        'playback.progress.fill': 'linear-gradient(90deg, #fb923c, #fb923c)',
        'playback.progress.height': '3px',
        'playback.progress.radius': '0px',
        'playback.equalizer.panelRadius': '6px',
        'playback.equalizer.sliderFill': 'linear-gradient(to top, #c2410c, #ea580c)',
        'playback.equalizer.spectrum': '#c2410c',
        'playback.equalizer.guide': 'rgba(194, 65, 12, 0.5)'
      },
      dark: {
        'color.primary.500': '#3ddc97',
        'color.primary.400': '#6fe7b2',
        'color.primary.300': '#a9f0cf',
        'color.primary.rgb': '61, 220, 151',
        'color.favorite': '#f87171',
        'color.warning': '#fbbf24',
        'color.neutral.200': '#262b2d',
        'color.neutral.300': '#3a4144',
        'color.neutral.500': '#8b9591',
        'color.neutral.700': '#c3cbc7',
        'color.neutral.900': '#e8ecea',
        'surface.app': '#121415',
        'surface.local': '#121415',
        'surface.settings': '#121415',
        'surface.streaming': '#121415',
        'surface.player': '#121415',
        'surface.card': '#1a1d1f',
        'surface.cardBorder': '#2e3437',
        'surface.subtle': '#17191b',
        'surface.hover': '#1e2224',
        'surface.active': 'rgba(61, 220, 151, 0.12)',
        'material.glass': '#1a1d1f',
        'material.glassStrong': '#202527',
        'material.glassBorder': '#2e3437',
        'material.glassShadow': 'none',
        'material.cardBlur': '0px',
        'material.cardSaturation': '100%',
        'material.glowMain': 'transparent',
        'navigation.surface': '#0e1011',
        'navigation.border': '#2e3437',
        'navigation.shadow': 'none',
        'navigation.activeSurface': 'rgba(61, 220, 151, 0.12)',
        'navigation.activeText': '#3ddc97',
        'navigation.indicator': '#3ddc97',
        'typography.sans': "'JetBrains Mono', 'Cascadia Code', 'MiSans', Consolas, monospace",
        'typography.display': "'JetBrains Mono', 'Cascadia Code', 'MiSans', Consolas, monospace",
        'typography.titleWeight': '600',
        'typography.bodyWeight': '400',
        'typography.bodySize': '13px',
        'shape.globalRadius': '4px',
        'shape.cardRadius': '6px',
        'motion.enter': 'cubic-bezier(0.2, 0, 0.4, 1)',
        'motion.soft': 'linear',
        'library.table.shadow': 'none',
        'library.selection.indicator': '#3ddc97',
        'library.selection.radius': '2px',
        'library.coverRadius': '2px',
        'playback.accent': '#3ddc97',
        'playback.backdrop.filter': 'blur(72px) saturate(0.5) brightness(0.26)',
        'playback.backdrop.scrim':
          'linear-gradient(180deg, rgba(8, 10, 10, 0.84), rgba(8, 10, 10, 0.88))',
        'playback.cover.radius': '4px',
        'playback.control.radius': '4px',
        'playback.control.borderWidth': '1px',
        'playback.progress.fill': 'linear-gradient(90deg, #3ddc97, #3ddc97)',
        'playback.progress.height': '3px',
        'playback.progress.radius': '0px',
        'playback.equalizer.panelRadius': '6px',
        'playback.equalizer.sliderFill': 'linear-gradient(to top, #10b981, #3ddc97)',
        'playback.equalizer.spectrum': '#3ddc97',
        'playback.equalizer.guide': 'rgba(61, 220, 151, 0.55)'
      }
    },
    {
      appearance: {
        accentSource: 'fixed',
        backgroundTreatment: 'solid',
        contrastGuard: 'enforce',
        effectsMode: 'reduced'
      },
      navigation: { style: 'compact', iconScale: 'sm', logo: 'hide' },
      library: { density: 'compact', selection: 'stroke', titleOverlay: 'off' },
      player: { layout: 'split', controls: 'pro', titleAlign: 'left', progress: 'line' },
      artwork: { transition: 'none', shadow: 'off' },
      equalizer: {
        panel: 'neutral',
        slider: 'solid',
        knob: 'line',
        spectrum: 'line',
        button: 'outline'
      },
      icons: { family: 'outline' },
      typography: { titleCase: 'uppercase', lyricAccent: 'accent', titleColor: 'off' },
      visibility: { ...allThemeVisibilitySlots, miniPlayerArtwork: false }
    },
    {
      miniPlayer: {
        surfaceColor: '#0e1011',
        accentColor: '#3ddc97',
        primaryTextColor: '#e8ecea',
        mutedTextColor: '#8b9591',
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'MiSans', Consolas, monospace",
        surfaceOpacity: 100,
        glassBlur: 0,
        cornerRadius: 6,
        borderWidth: 1,
        borderColor: '#2e3437',
        shadowStrength: 24,
        shadowColor: '#000000'
      },
      desktopLyrics: {
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'MiSans', Consolas, monospace",
        fontSize: 26,
        fontWeight: 500,
        color: '#c3cbc7',
        highlightColor: '#3ddc97',
        backgroundColor: '#0e1011',
        backgroundOpacity: 78,
        shadow: false,
        shadowBlur: 0,
        shadowColor: '#000000'
      }
    }
  ),
  builtInThemePreset(
    'builtin:zen-minimal',
    'Zen Minimal',
    '墨色与留白之间一抹苔绿静落，如茶室般仅以间距与浓淡安放层级。',
    {
      pureWhite: {
        'color.primary.500': '#47614f',
        'color.primary.400': '#5b7663',
        'color.primary.300': '#9db1a3',
        'color.primary.rgb': '71, 97, 79',
        'color.neutral.100': '#f1efe9',
        'color.neutral.200': '#e7e4da',
        'color.neutral.500': '#6b6e66',
        'color.neutral.700': '#3d403c',
        'color.neutral.900': '#26282a',
        'surface.app': '#f6f5f0',
        'surface.local': '#f6f5f0',
        'surface.settings': '#f6f5f0',
        'surface.streaming': '#f6f5f0',
        'surface.player': '#f6f5f0',
        'surface.card': '#fbfaf6',
        'surface.cardBorder': '#e7e4da',
        'surface.subtle': '#f1efe9',
        'surface.hover': '#edebe3',
        'surface.active': 'rgba(71, 97, 79, 0.1)',
        'material.glass': '#f6f5f0',
        'material.glassBorder': '#e7e4da',
        'material.glassShadow': 'none',
        'material.glowMain': 'transparent',
        'material.cardBlur': '0px',
        'material.cardSaturation': '100%',
        'shell.control.text': '#26282a',
        'shell.control.hoverSurface': 'rgba(38, 40, 42, 0.05)',
        'navigation.surface': '#f6f5f0',
        'navigation.border': 'transparent',
        'navigation.shadow': 'none',
        'navigation.text': '#595c55',
        'navigation.hoverSurface': 'rgba(38, 40, 42, 0.04)',
        'navigation.activeSurface': 'rgba(71, 97, 79, 0.09)',
        'navigation.activeText': '#47614f',
        'navigation.indicator': '#47614f',
        'typography.titleWeight': '500',
        'typography.bodyWeight': '400',
        'typography.chromeText': '#595c55',
        'shape.globalRadius': '10px',
        'shape.cardRadius': '12px',
        'library.page.surface': 'linear-gradient(180deg, #f6f5f0, #f6f5f0)',
        'library.row.text': '#3d403c',
        'library.row.hoverSurface': 'rgba(38, 40, 42, 0.035)',
        'library.selection.surface': 'rgba(71, 97, 79, 0.08)',
        'library.selection.indicator': '#47614f',
        'library.coverRadius': '8px',
        'playback.backdrop.filter': 'blur(72px) saturate(0.2) brightness(0.42)',
        'playback.backdrop.scrim':
          'linear-gradient(180deg, rgba(24, 26, 27, 0.62) 0%, rgba(24, 26, 27, 0.68) 50%, rgba(24, 26, 27, 0.76) 100%)',
        'playback.cover.radius': '12px',
        'playback.cover.shadow': 'none',
        'playback.control.radius': '10px',
        'playback.progress.track': 'rgba(255, 255, 255, 0.18)',
        'playback.progress.fill': 'linear-gradient(90deg, #b6c6ba, #b6c6ba)',
        'playback.progress.height': '2px',
        'playback.equalizer.panelSurface': '#fbfaf6',
        'playback.equalizer.panelBorder': '#e7e4da',
        'playback.equalizer.sliderTrack': 'rgba(38, 40, 42, 0.08)',
        'playback.equalizer.sliderFill': 'linear-gradient(to top, #47614f, #47614f)',
        'motion.enter': 'cubic-bezier(0.32, 0, 0.16, 1)',
        'motion.soft': 'cubic-bezier(0.45, 0.05, 0.15, 1)'
      },
      dark: {
        'color.primary.500': '#9eb5a4',
        'color.primary.400': '#b3c7ba',
        'color.primary.300': '#c9d7cd',
        'color.primary.rgb': '158, 181, 164',
        'color.neutral.100': '#1b1d1f',
        'color.neutral.200': '#292c2e',
        'color.neutral.500': '#9a9d97',
        'color.neutral.700': '#c8c8c0',
        'color.neutral.900': '#e9e7df',
        'surface.app': '#17191b',
        'surface.local': '#17191b',
        'surface.settings': '#17191b',
        'surface.streaming': '#17191b',
        'surface.player': '#17191b',
        'surface.card': '#1d2022',
        'surface.cardBorder': '#2c2f31',
        'surface.subtle': '#1a1d1f',
        'surface.hover': 'rgba(255, 255, 255, 0.045)',
        'surface.active': 'rgba(158, 181, 164, 0.12)',
        'material.glass': '#17191b',
        'material.glassBorder': '#2c2f31',
        'material.glassShadow': 'none',
        'material.glowMain': 'transparent',
        'material.cardBlur': '0px',
        'material.cardSaturation': '100%',
        'shell.control.text': '#e9e7df',
        'shell.control.hoverSurface': 'rgba(255, 255, 255, 0.05)',
        'navigation.surface': '#17191b',
        'navigation.border': 'transparent',
        'navigation.shadow': 'none',
        'navigation.text': '#b6b9b1',
        'navigation.hoverSurface': 'rgba(255, 255, 255, 0.04)',
        'navigation.activeSurface': 'rgba(158, 181, 164, 0.1)',
        'navigation.activeText': '#9eb5a4',
        'navigation.indicator': '#9eb5a4',
        'typography.titleWeight': '500',
        'typography.bodyWeight': '400',
        'typography.chromeText': '#b6b9b1',
        'shape.globalRadius': '10px',
        'shape.cardRadius': '12px',
        'library.page.surface': 'linear-gradient(180deg, #17191b, #17191b)',
        'library.row.text': '#c8c8c0',
        'library.row.hoverSurface': 'rgba(255, 255, 255, 0.04)',
        'library.selection.surface': 'rgba(158, 181, 164, 0.1)',
        'library.selection.indicator': '#9eb5a4',
        'library.coverRadius': '8px',
        'playback.backdrop.filter': 'blur(72px) saturate(0.2) brightness(0.3)',
        'playback.backdrop.scrim':
          'linear-gradient(180deg, rgba(24, 26, 27, 0.62) 0%, rgba(24, 26, 27, 0.68) 50%, rgba(24, 26, 27, 0.76) 100%)',
        'playback.cover.radius': '12px',
        'playback.cover.shadow': 'none',
        'playback.control.radius': '10px',
        'playback.progress.track': 'rgba(255, 255, 255, 0.14)',
        'playback.progress.fill': 'linear-gradient(90deg, #9eb5a4, #9eb5a4)',
        'playback.progress.height': '2px',
        'playback.equalizer.panelSurface': '#1d2022',
        'playback.equalizer.panelBorder': '#2c2f31',
        'playback.equalizer.sliderTrack': 'rgba(255, 255, 255, 0.09)',
        'playback.equalizer.sliderFill': 'linear-gradient(to top, #9eb5a4, #9eb5a4)',
        'motion.enter': 'cubic-bezier(0.32, 0, 0.16, 1)',
        'motion.soft': 'cubic-bezier(0.45, 0.05, 0.15, 1)'
      }
    },
    {
      appearance: {
        accentSource: 'fixed',
        backgroundTreatment: 'solid',
        contrastGuard: 'enforce',
        effectsMode: 'reduced'
      },
      navigation: { style: 'rail', iconScale: 'sm', logo: 'hide' },
      library: { density: 'comfortable', selection: 'stroke', titleOverlay: 'off' },
      player: { layout: 'minimal', controls: 'standard', titleAlign: 'center', progress: 'line' },
      artwork: { transition: 'fade', shadow: 'off' },
      equalizer: {
        panel: 'neutral',
        slider: 'solid',
        knob: 'dot',
        spectrum: 'line',
        button: 'outline'
      },
      icons: { family: 'outline' },
      typography: { titleCase: 'preserve', lyricAccent: 'off', titleColor: 'off' },
      visibility: {
        ...allThemeVisibilitySlots,
        playerAlbumArtist: false,
        playerTrackMenu: false,
        playerMiscIcons: false,
        playerDuration: false,
        playerWaveform: false,
        equalizerGrid: false,
        equalizerFrequencyGuides: false,
        equalizerSpectrum: false,
        miniPlayerArtwork: false
      }
    },
    {
      miniPlayer: {
        surfaceColor: '#f6f5f0',
        accentColor: '#47614f',
        primaryTextColor: '#26282a',
        mutedTextColor: '#6b6e66',
        fontFamily: lightFont,
        surfaceOpacity: 98,
        glassBlur: 0,
        cornerRadius: 12,
        borderWidth: 1,
        borderColor: '#e0ddd3',
        shadowStrength: 0,
        shadowColor: '#000000'
      },
      desktopLyrics: {
        fontFamily: lightFont,
        fontSize: 30,
        fontWeight: 400,
        color: '#e9e7df',
        highlightColor: '#b3c7ba',
        backgroundColor: '#17191b',
        backgroundOpacity: 62,
        shadow: false,
        shadowBlur: 0,
        shadowColor: '#000000'
      }
    }
  )
])

const builtInThemePresetById = new Map(
  BUILT_IN_THEME_PRESETS.map((preset) => [preset.id as BuiltInThemePresetId, preset])
)

export function isBuiltInThemePresetId(value: unknown): value is BuiltInThemePresetId {
  return typeof value === 'string' && builtInThemePresetById.has(value as BuiltInThemePresetId)
}

export function getBuiltInThemePreset(value: unknown): ThemeProfileV2 | null {
  return isBuiltInThemePresetId(value) ? (builtInThemePresetById.get(value) ?? null) : null
}

export function createDefaultThemeLibraryDocument(
  activeTheme: ThemeSelection = { kind: 'builtin', id: TWILIGHT_DEFAULT_THEME_ID },
  windowInheritance: ThemeWindowInheritance = { miniPlayer: true, desktopLyrics: true }
): ThemeLibraryDocument {
  return {
    schemaVersion: THEME_LIBRARY_SCHEMA_VERSION,
    activeTheme,
    profiles: [],
    windowInheritance,
    profileHistory: {}
  }
}

export function isThemeLibraryDocument(value: unknown): value is ThemeLibraryDocument {
  if (!isRecord(value) || value.schemaVersion !== THEME_LIBRARY_SCHEMA_VERSION) return false
  if (!Array.isArray(value.profiles) || !isRecord(value.windowInheritance)) return false
  if (value.profileHistory !== undefined && !isRecord(value.profileHistory)) return false
  return isThemeSelection(value.activeTheme)
}

export function normalizeThemeLibraryDocument(value: unknown): ThemeLibraryDocument {
  const fallback = createDefaultThemeLibraryDocument()
  if (!isRecord(value)) return fallback
  const profiles = Array.isArray(value.profiles)
    ? value.profiles
        .map((profile) => normalizeThemeProfile(profile))
        .filter((profile): profile is ThemeProfileV2 => profile !== null)
        .slice(0, MAX_USER_THEME_PROFILES)
    : []
  const selection = isThemeSelection(value.activeTheme) ? value.activeTheme : fallback.activeTheme
  const activeTheme =
    selection.kind !== 'user' || profiles.some((profile) => profile.id === selection.id)
      ? selection
      : fallback.activeTheme
  const inheritance = isRecord(value.windowInheritance) ? value.windowInheritance : {}
  const profileHistory = normalizeThemeProfileHistory(value.profileHistory, profiles)
  return {
    schemaVersion: THEME_LIBRARY_SCHEMA_VERSION,
    activeTheme,
    profiles,
    windowInheritance: {
      miniPlayer: inheritance.miniPlayer !== false,
      desktopLyrics: inheritance.desktopLyrics !== false
    },
    profileHistory
  }
}

export function normalizeThemeProfile(value: unknown): ThemeProfileV2 | null {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== THEME_DOCUMENT_SCHEMA_VERSION &&
      value.schemaVersion !== THEME_PROFILE_SCHEMA_VERSION)
  ) {
    return null
  }
  const id = normalizeThemeId(value.id)
  const name = normalizeText(value.name, 80)
  if (!id || !name || isBuiltInThemePresetId(id)) return null
  const createdAt = normalizeIsoDate(value.createdAt)
  const updatedAt = normalizeIsoDate(value.updatedAt)
  const overrides = isRecord(value.overrides) ? value.overrides : {}
  const assets = normalizeThemeAssets(value.assets)
  const source =
    value.schemaVersion === THEME_PROFILE_SCHEMA_VERSION
      ? normalizeThemeProfileSource(value.source)
      : undefined
  const toneSchedule =
    value.schemaVersion === THEME_PROFILE_SCHEMA_VERSION
      ? normalizeThemeToneSchedule(value.toneSchedule)
      : undefined
  return {
    schemaVersion: THEME_PROFILE_SCHEMA_VERSION,
    id,
    name,
    description: normalizeText(value.description, 240),
    baseThemeId: source
      ? source.presetId
      : typeof value.baseThemeId === 'string' && value.baseThemeId.trim()
        ? value.baseThemeId.trim().slice(0, 160)
        : TWILIGHT_DEFAULT_THEME_ID,
    createdAt,
    updatedAt,
    overrides: {
      pureWhite: normalizeThemeTokenOverrides(
        isRecord(overrides.pureWhite) ? overrides.pureWhite : {}
      ),
      dark: normalizeThemeTokenOverrides(isRecord(overrides.dark) ? overrides.dark : {})
    },
    modes:
      value.schemaVersion === THEME_PROFILE_SCHEMA_VERSION ? normalizeThemeModes(value.modes) : {},
    ...(toneSchedule ? { toneSchedule } : {}),
    ...(source ? { source } : {}),
    windowDefaults: normalizeWindowDefaults(value.windowDefaults),
    ...(assets.length > 0 ? { assets } : {}),
    ...normalizeThemeAssetBindings(value.assetBindings, assets)
  }
}

function normalizeThemeProfileSource(value: unknown): ThemeProfileSource | undefined {
  if (!isRecord(value) || value.kind !== 'builtin-preset') return undefined
  return isBuiltInThemePresetId(value.presetId)
    ? { kind: 'builtin-preset', presetId: value.presetId }
    : undefined
}

function normalizeThemeProfileHistory(
  value: unknown,
  profiles: ThemeProfileV2[]
): Record<string, ThemeProfileHistoryEntry[]> {
  if (!isRecord(value)) return {}
  const profileIds = new Set(profiles.map((profile) => profile.id))
  const result: Record<string, ThemeProfileHistoryEntry[]> = {}
  for (const [profileId, rawEntries] of Object.entries(value)) {
    if (!profileIds.has(profileId) || !Array.isArray(rawEntries)) continue
    const entries = rawEntries.flatMap((rawEntry) => {
      if (!isRecord(rawEntry)) return []
      const profile = normalizeThemeProfile(rawEntry.profile)
      if (!profile || profile.id !== profileId) return []
      return [{ savedAt: normalizeIsoDate(rawEntry.savedAt), profile }]
    })
    const limited = limitThemeProfileHistory(entries)
    if (limited.length > 0) result[profileId] = limited
  }
  return result
}

export function limitThemeProfileHistory(
  entries: readonly ThemeProfileHistoryEntry[]
): ThemeProfileHistoryEntry[] {
  const result: ThemeProfileHistoryEntry[] = []
  let byteLength = 2
  for (const entry of entries.slice(0, MAX_THEME_PROFILE_HISTORY_ENTRIES)) {
    const serialized = JSON.stringify(entry)
    const entryBytes = new TextEncoder().encode(serialized).byteLength + (result.length > 0 ? 1 : 0)
    if (byteLength + entryBytes > MAX_THEME_PROFILE_HISTORY_BYTES) break
    result.push(entry)
    byteLength += entryBytes
  }
  return result
}

export function themeProfilesHaveSameEditableState(
  first: ThemeProfileV2,
  second: ThemeProfileV2
): boolean {
  return (
    JSON.stringify(themeProfileEditableState(first)) ===
    JSON.stringify(themeProfileEditableState(second))
  )
}

function themeProfileEditableState(profile: ThemeProfileV2): object {
  return {
    name: profile.name,
    description: profile.description,
    baseThemeId: profile.baseThemeId,
    overrides: profile.overrides,
    modes: profile.modes,
    toneSchedule: profile.toneSchedule,
    source: profile.source,
    windowDefaults: profile.windowDefaults,
    assets: profile.assets,
    assetBindings: profile.assetBindings
  }
}

export function normalizeThemeModes(value: unknown): ThemeModes {
  if (!isRecord(value)) return {}
  const result: ThemeModes = {}
  if (isRecord(value.appearance)) {
    const appearance: NonNullable<ThemeModes['appearance']> = {}
    assignModeOption(appearance, 'accentSource', value.appearance.accentSource, ['fixed', 'cover'])
    assignModeOption(appearance, 'backgroundTreatment', value.appearance.backgroundTreatment, [
      'solid',
      'gradient',
      'cover-blur',
      'image'
    ])
    assignModeOption(appearance, 'toneScheduling', value.appearance.toneScheduling, [
      'manual',
      'system',
      'timed'
    ])
    assignModeOption(appearance, 'contrastGuard', value.appearance.contrastGuard, [
      'off',
      'warn',
      'enforce'
    ])
    assignModeOption(appearance, 'effectsMode', value.appearance.effectsMode, ['full', 'reduced'])
    if (Object.keys(appearance).length > 0) result.appearance = appearance
  }
  if (isRecord(value.navigation)) {
    const navigation: NonNullable<ThemeModes['navigation']> = {}
    assignModeOption(navigation, 'style', value.navigation.style, ['expanded', 'compact', 'rail'])
    assignModeOption(navigation, 'iconScale', value.navigation.iconScale, ['sm', 'md', 'lg'])
    assignModeOption(navigation, 'logo', value.navigation.logo, ['show', 'hide'])
    if (Object.keys(navigation).length > 0) result.navigation = navigation
  }
  if (isRecord(value.library)) {
    const library: NonNullable<ThemeModes['library']> = {}
    assignModeOption(library, 'density', value.library.density, ['comfortable', 'compact'])
    assignModeOption(library, 'selection', value.library.selection, ['fill', 'stroke'])
    assignModeOption(library, 'titleOverlay', value.library.titleOverlay, ['off', 'on'])
    if (Object.keys(library).length > 0) result.library = library
  }
  if (isRecord(value.player)) {
    const player: NonNullable<ThemeModes['player']> = {}
    assignModeOption(player, 'layout', value.player.layout, [
      'standard',
      'full-cover',
      'lyrics-focus',
      'split',
      'minimal'
    ])
    assignModeOption(player, 'controls', value.player.controls, ['standard', 'pro'])
    assignModeOption(player, 'titleAlign', value.player.titleAlign, ['left', 'center'])
    assignModeOption(player, 'progress', value.player.progress, [
      'line',
      'ring',
      'solid',
      'spectrum'
    ])
    if (Object.keys(player).length > 0) result.player = player
  }
  if (isRecord(value.artwork)) {
    const artwork: NonNullable<ThemeModes['artwork']> = {}
    assignModeOption(artwork, 'transition', value.artwork.transition, ['fade', 'slide', 'none'])
    assignModeOption(artwork, 'shadow', value.artwork.shadow, ['on', 'off'])
    if (Object.keys(artwork).length > 0) result.artwork = artwork
  }
  if (isRecord(value.equalizer)) {
    const equalizer: NonNullable<ThemeModes['equalizer']> = {}
    assignModeOption(equalizer, 'panel', value.equalizer.panel, ['neutral', 'tinted', 'glass'])
    assignModeOption(equalizer, 'slider', value.equalizer.slider, ['ring', 'solid'])
    assignModeOption(equalizer, 'knob', value.equalizer.knob, ['line', 'dot'])
    assignModeOption(equalizer, 'spectrum', value.equalizer.spectrum, ['bars', 'line', 'area'])
    assignModeOption(equalizer, 'button', value.equalizer.button, ['soft', 'outline', 'solid'])
    if (Object.keys(equalizer).length > 0) result.equalizer = equalizer
  }
  if (isRecord(value.icons)) {
    const icons: NonNullable<ThemeModes['icons']> = {}
    assignModeOption(icons, 'family', value.icons.family, ['outline', 'rounded', 'filled'])
    if (Object.keys(icons).length > 0) result.icons = icons
  }
  if (isRecord(value.typography)) {
    const typography: NonNullable<ThemeModes['typography']> = {}
    assignModeOption(typography, 'titleCase', value.typography.titleCase, ['preserve', 'uppercase'])
    assignModeOption(typography, 'lyricAccent', value.typography.lyricAccent, ['off', 'accent'])
    assignModeOption(typography, 'titleColor', value.typography.titleColor, [
      'off',
      'track',
      'artist-album'
    ])
    if (Object.keys(typography).length > 0) result.typography = typography
  }
  if (isRecord(value.visibility)) {
    const visibility: Partial<Record<ThemeVisibilitySlotId, boolean>> = {}
    for (const id of THEME_VISIBILITY_SLOT_IDS) {
      if (typeof value.visibility[id] === 'boolean') visibility[id] = value.visibility[id]
    }
    if (Object.keys(visibility).length > 0) result.visibility = visibility
  }
  return result
}

export function findUnsupportedThemeModeIds(value: unknown): string[] {
  if (!isRecord(value)) return []
  const definitions = new Map(
    THEME_MODE_DEFINITIONS.map((definition) => [definition.id, definition])
  )
  const supportedDomains = new Set(
    THEME_MODE_DEFINITIONS.map((definition) => definition.id.split('.')[0])
  )
  const unsupported = new Set<string>()
  for (const [domain, section] of Object.entries(value)) {
    if (domain === 'visibility') {
      if (!isRecord(section)) {
        unsupported.add(domain)
        continue
      }
      for (const [id, visible] of Object.entries(section)) {
        if (
          !THEME_VISIBILITY_SLOT_IDS.includes(id as ThemeVisibilitySlotId) ||
          typeof visible !== 'boolean'
        ) {
          unsupported.add(`${domain}.${id}`)
        }
      }
      continue
    }
    if (!supportedDomains.has(domain) || !isRecord(section)) {
      unsupported.add(domain)
      continue
    }
    for (const [key, modeValue] of Object.entries(section)) {
      const id = `${domain}.${key}`
      const definition = definitions.get(id)
      if (!definition || typeof modeValue !== 'string' || !definition.options.includes(modeValue)) {
        unsupported.add(id)
      }
    }
  }
  return [...unsupported].slice(0, 64)
}

function assignModeOption<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: unknown,
  options: readonly T[K][]
): void {
  if (options.includes(value as T[K])) target[key] = value as T[K]
}

export function normalizeThemeToneSchedule(value: unknown): ThemeToneSchedule | undefined {
  if (!isRecord(value)) return undefined
  const lightStartMinutes = value.lightStartMinutes
  const darkStartMinutes = value.darkStartMinutes
  if (
    !Number.isInteger(lightStartMinutes) ||
    !Number.isInteger(darkStartMinutes) ||
    (lightStartMinutes as number) < 0 ||
    (lightStartMinutes as number) >= 24 * 60 ||
    (darkStartMinutes as number) < 0 ||
    (darkStartMinutes as number) >= 24 * 60 ||
    lightStartMinutes === darkStartMinutes
  ) {
    return undefined
  }
  return {
    lightStartMinutes: lightStartMinutes as number,
    darkStartMinutes: darkStartMinutes as number
  }
}

export function resolveScheduledThemeTone(
  date: Date,
  schedule: ThemeToneSchedule = DEFAULT_THEME_TONE_SCHEDULE
): ThemeTone {
  const normalized = normalizeThemeToneSchedule(schedule) ?? DEFAULT_THEME_TONE_SCHEDULE
  const minutes = date.getHours() * 60 + date.getMinutes()
  const { lightStartMinutes, darkStartMinutes } = normalized
  const isLight =
    lightStartMinutes < darkStartMinutes
      ? minutes >= lightStartMinutes && minutes < darkStartMinutes
      : minutes >= lightStartMinutes || minutes < darkStartMinutes
  return isLight ? 'pureWhite' : 'dark'
}

export function normalizeThemeAssets(value: unknown): ThemeAssetReference[] {
  if (!Array.isArray(value)) return []
  const assets: ThemeAssetReference[] = []
  const ids = new Set<string>()
  const paths = new Set<string>()
  for (const candidate of value.slice(0, 64)) {
    if (!isRecord(candidate)) continue
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    const path = typeof candidate.path === 'string' ? candidate.path.trim().replace(/\\/g, '/') : ''
    const type = candidate.type
    const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
    const pathSegments = path.split('/')
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id) ||
      !path ||
      path.length > 240 ||
      path.startsWith('/') ||
      /^[a-zA-Z]:/.test(path) ||
      pathSegments.some((segment) => !segment || segment === '..') ||
      (type !== 'image' && type !== 'font') ||
      (type === 'font'
        ? extension !== '.woff2'
        : !['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) ||
      ids.has(id) ||
      paths.has(path)
    ) {
      continue
    }
    ids.add(id)
    paths.add(path)
    assets.push({ id, path, type })
  }
  return assets
}

function normalizeThemeAssetBindings(
  value: unknown,
  assets: ThemeAssetReference[]
): { assetBindings?: ThemeAssetBindings } {
  if (!isRecord(value)) return {}
  const byId = new Map(assets.map((asset) => [asset.id, asset]))
  const result: ThemeAssetBindings = {}
  const imageKeys = [
    'appBackground',
    'localBackground',
    'settingsBackground',
    'streamingBackground',
    'playerBackground'
  ] as const
  const fontKeys = ['sansFont', 'displayFont', 'roundedFont'] as const
  for (const key of imageKeys) {
    const id = typeof value[key] === 'string' ? value[key].trim() : ''
    if (byId.get(id)?.type === 'image') result[key] = id
  }
  for (const key of fontKeys) {
    const id = typeof value[key] === 'string' ? value[key].trim() : ''
    if (byId.get(id)?.type === 'font') result[key] = id
  }
  return Object.keys(result).length > 0 ? { assetBindings: result } : {}
}

export function normalizeThemeTokenOverrides(
  value: Record<string, unknown>
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [id, raw] of Object.entries(value)) {
    if (!tokenDefinitionById.has(id) || typeof raw !== 'string') continue
    const normalized = normalizeThemeTokenValue(id, raw)
    if (normalized != null) result[id] = normalized
  }
  return result
}

export function normalizeStructuredPluginTheme(value: unknown): StructuredPluginTheme | undefined {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== THEME_DOCUMENT_SCHEMA_VERSION &&
      value.schemaVersion !== STRUCTURED_PLUGIN_THEME_MODE_SCHEMA_VERSION &&
      value.schemaVersion !== STRUCTURED_PLUGIN_THEME_SCHEMA_VERSION)
  ) {
    return undefined
  }
  const schemaVersion = value.schemaVersion
  const sourceVariants = isRecord(value.variants) ? value.variants : {}
  const variants: StructuredPluginTheme['variants'] = {}
  for (const tone of ['pureWhite', 'dark'] as const) {
    const source = isRecord(sourceVariants[tone]) ? sourceVariants[tone] : {}
    const tokens = normalizeThemeTokenOverrides(isRecord(source.tokens) ? source.tokens : {})
    if (Object.keys(tokens).length > 0) variants[tone] = { tokens }
  }
  const windowDefaults = normalizeWindowDefaults(value.windowDefaults)
  const modes =
    schemaVersion === STRUCTURED_PLUGIN_THEME_MODE_SCHEMA_VERSION ||
    schemaVersion === STRUCTURED_PLUGIN_THEME_SCHEMA_VERSION
      ? normalizeThemeModes(value.modes)
      : undefined
  const hasDeclaredModes =
    (schemaVersion === STRUCTURED_PLUGIN_THEME_MODE_SCHEMA_VERSION ||
      schemaVersion === STRUCTURED_PLUGIN_THEME_SCHEMA_VERSION) &&
    isRecord(value.modes)
  const layout =
    schemaVersion === STRUCTURED_PLUGIN_THEME_SCHEMA_VERSION
      ? normalizeThemeShellLayout(value.layout)
      : undefined
  const hasDeclaredLayout =
    schemaVersion === STRUCTURED_PLUGIN_THEME_SCHEMA_VERSION && value.layout !== undefined
  if (
    Object.keys(variants).length === 0 &&
    !windowDefaults &&
    !hasDeclaredModes &&
    (!hasDeclaredLayout || !layout)
  ) {
    return undefined
  }
  if (schemaVersion === THEME_DOCUMENT_SCHEMA_VERSION) {
    return {
      schemaVersion: THEME_DOCUMENT_SCHEMA_VERSION,
      variants,
      ...(windowDefaults ? { windowDefaults } : {})
    }
  }
  if (schemaVersion === STRUCTURED_PLUGIN_THEME_MODE_SCHEMA_VERSION) {
    return {
      schemaVersion: STRUCTURED_PLUGIN_THEME_MODE_SCHEMA_VERSION,
      variants,
      ...(modes && Object.keys(modes).length > 0 ? { modes } : {}),
      ...(windowDefaults ? { windowDefaults } : {})
    }
  }
  return {
    schemaVersion: STRUCTURED_PLUGIN_THEME_SCHEMA_VERSION,
    variants,
    ...(modes && Object.keys(modes).length > 0 ? { modes } : {}),
    ...(layout ? { layout } : {}),
    ...(windowDefaults ? { windowDefaults } : {})
  }
}

export function normalizeThemeTokenValue(id: string, value: string): string | null {
  const definition = tokenDefinitionById.get(id)
  if (!definition) return null
  const normalized = value.trim()
  if (!normalized || normalized.length > 240) return null
  if (/[;{}]|url\s*\(|@import|expression\s*\(/i.test(normalized)) return null
  if (definition.kind === 'color' && !isThemeColor(normalized)) return null
  if (definition.kind === 'enum' && !definition.options?.includes(normalized)) return null
  if (definition.kind === 'number') {
    const numberText = definition.unit
      ? normalized.endsWith(definition.unit)
        ? normalized.slice(0, -definition.unit.length)
        : ''
      : normalized
    const number = Number(numberText)
    if (!Number.isFinite(number)) return null
    if (definition.min != null && number < definition.min) return null
    if (definition.max != null && number > definition.max) return null
  }
  if (definition.kind === 'length' && definition.unit) {
    const match = normalized.match(/^(-?\d+(?:\.\d+)?)([a-z%]+)$/i)
    if (!match || match[2] !== definition.unit) return null
    const number = Number(match[1])
    if (definition.min != null && number < definition.min) return null
    if (definition.max != null && number > definition.max) return null
  }
  return normalized
}

function isThemeColor(value: string): boolean {
  return (
    /^#[0-9a-f]{3,4}(?:[0-9a-f]{3,4})?$/i.test(value) ||
    /^(?:rgb|rgba|hsl|hsla)\([^()]{1,80}\)$/i.test(value) ||
    /^(?:transparent|currentcolor)$/i.test(value)
  )
}

interface ThemeRgbColor {
  r: number
  g: number
  b: number
  a: number
}

export function themeContrastRatio(
  foreground: string,
  background: string,
  canvas = '#ffffff'
): number | null {
  const canvasColor = parseThemeRgb(canvas)
  const foregroundColor = parseThemeRgb(foreground)
  const backgroundColor = parseThemeRgb(background)
  if (!canvasColor || !foregroundColor || !backgroundColor) return null
  const opaqueBackground = compositeThemeColor(backgroundColor, canvasColor)
  const opaqueForeground = compositeThemeColor(foregroundColor, opaqueBackground)
  const light = Math.max(
    themeRelativeLuminance(opaqueForeground),
    themeRelativeLuminance(opaqueBackground)
  )
  const dark = Math.min(
    themeRelativeLuminance(opaqueForeground),
    themeRelativeLuminance(opaqueBackground)
  )
  return (light + 0.05) / (dark + 0.05)
}

export function ensureThemeTextContrast(
  foreground: string,
  background: string,
  minimum = 4.5
): string {
  const ratio = themeContrastRatio(foreground, background)
  if (ratio != null && ratio >= minimum) return foreground
  const dark = '#111827'
  const light = '#f8fafc'
  const darkRatio = themeContrastRatio(dark, background) ?? 0
  const lightRatio = themeContrastRatio(light, background) ?? 0
  return darkRatio >= lightRatio ? dark : light
}

export function createThemeAccentTokenOverrides(
  color: string,
  tone: ThemeTone,
  background: string,
  adaptive = false
): Record<string, string> {
  const fallback = tone === 'dark' ? '#f59e0b' : '#2563eb'
  const source = parseThemeRgb(color)
  const normalized = source
  const muted =
    adaptive && normalized
      ? mixThemeColors(normalized, { r: 128, g: 128, b: 128, a: 1 }, 0.1)
      : (normalized ?? parseThemeRgb(fallback)!)
  let primary = themeRgbToHex(muted)
  if (
    adaptive &&
    (themeContrastRatio(primary, background, tone === 'dark' ? '#17181a' : '#f4f4f7') ?? 0) < 3
  ) {
    primary = fallback
  }
  const base = parseThemeRgb(primary)!
  const white = { r: 255, g: 255, b: 255, a: 1 }
  const primary400 = themeRgbToHex(mixThemeColors(base, white, tone === 'dark' ? 0.18 : 0.12))
  const primary300 = themeRgbToHex(mixThemeColors(base, white, tone === 'dark' ? 0.44 : 0.38))
  const rgb = `${base.r}, ${base.g}, ${base.b}`
  return {
    'color.primary.500': primary,
    'color.primary.400': primary400,
    'color.primary.300': primary300,
    'color.primary.rgb': rgb,
    'material.glowMain': `rgba(${rgb}, ${tone === 'dark' ? '0.2' : '0.14'})`,
    'surface.active': `rgba(${rgb}, ${tone === 'dark' ? '0.16' : '0.1'})`,
    'navigation.activeText': primary,
    'navigation.indicator': primary,
    'playback.accent': primary
  }
}

function parseThemeRgb(value: string): ThemeRgbColor | null {
  const normalized = value.trim()
  const hex = normalized.match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i)
  if (hex) {
    const raw =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((part) => part + part)
            .join('')
        : hex[1]
    return {
      r: Number.parseInt(raw.slice(0, 2), 16),
      g: Number.parseInt(raw.slice(2, 4), 16),
      b: Number.parseInt(raw.slice(4, 6), 16),
      a: raw.length === 8 ? Number.parseInt(raw.slice(6, 8), 16) / 255 : 1
    }
  }
  const rgb = normalized.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d?(?:\.\d+)?))?\s*\)$/i
  )
  if (!rgb) return null
  const channels = rgb.slice(1, 4).map(Number)
  if (channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255)) {
    return null
  }
  const alpha = rgb[4] == null || rgb[4] === '' ? 1 : Number(rgb[4])
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null
  return { r: channels[0], g: channels[1], b: channels[2], a: alpha }
}

function compositeThemeColor(foreground: ThemeRgbColor, background: ThemeRgbColor): ThemeRgbColor {
  const alpha = foreground.a + background.a * (1 - foreground.a)
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 }
  return {
    r: Math.round(
      (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha
    ),
    g: Math.round(
      (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha
    ),
    b: Math.round(
      (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha
    ),
    a: alpha
  }
}

function mixThemeColors(from: ThemeRgbColor, to: ThemeRgbColor, amount: number): ThemeRgbColor {
  const ratio = Math.max(0, Math.min(1, amount))
  return {
    r: Math.round(from.r + (to.r - from.r) * ratio),
    g: Math.round(from.g + (to.g - from.g) * ratio),
    b: Math.round(from.b + (to.b - from.b) * ratio),
    a: from.a + (to.a - from.a) * ratio
  }
}

function themeRgbToHex(color: ThemeRgbColor): string {
  return `#${[color.r, color.g, color.b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`
}

function themeRelativeLuminance(color: ThemeRgbColor): number {
  const [r, g, b] = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function resolveThemeProfileTokens(
  profile: ThemeProfileV2 | null,
  tone: ThemeTone
): Record<string, string> {
  if (!profile) return {}
  const basePreset = resolveThemeProfileBasePreset(profile)
  return {
    ...TWILIGHT_DEFAULT_THEME.variants[tone].tokens,
    ...(basePreset?.overrides[tone] ?? {}),
    ...profile.overrides[tone]
  }
}

export function resolveThemeProfileModes(profile: ThemeProfileV2 | null): ThemeModes {
  const baseModes = resolveThemeProfileBasePreset(profile)?.modes ?? {}
  const modes = profile?.modes ?? {}
  return resolveThemeModes(modes, baseModes)
}

export function resolveThemeModes(value: unknown, baseValue: unknown = {}): ThemeModes {
  const baseModes = normalizeThemeModes(baseValue)
  const modes = normalizeThemeModes(value)
  return {
    appearance: {
      ...DEFAULT_THEME_MODES.appearance,
      ...baseModes.appearance,
      ...modes.appearance
    },
    navigation: {
      ...DEFAULT_THEME_MODES.navigation,
      ...baseModes.navigation,
      ...modes.navigation
    },
    library: { ...DEFAULT_THEME_MODES.library, ...baseModes.library, ...modes.library },
    player: { ...DEFAULT_THEME_MODES.player, ...baseModes.player, ...modes.player },
    artwork: { ...DEFAULT_THEME_MODES.artwork, ...baseModes.artwork, ...modes.artwork },
    equalizer: {
      ...DEFAULT_THEME_MODES.equalizer,
      ...baseModes.equalizer,
      ...modes.equalizer
    },
    icons: { ...DEFAULT_THEME_MODES.icons, ...baseModes.icons, ...modes.icons },
    typography: {
      ...DEFAULT_THEME_MODES.typography,
      ...baseModes.typography,
      ...modes.typography
    },
    visibility: { ...baseModes.visibility, ...modes.visibility }
  }
}

export function resolveThemeProfileWindowDefaults(
  profile: ThemeProfileV2 | null
): ThemeWindowDefaults {
  const base = resolveThemeProfileBasePreset(profile)?.windowDefaults
  return {
    miniPlayer: { ...base?.miniPlayer, ...profile?.windowDefaults?.miniPlayer },
    desktopLyrics: { ...base?.desktopLyrics, ...profile?.windowDefaults?.desktopLyrics }
  }
}

function resolveThemeProfileBasePreset(profile: ThemeProfileV2 | null): ThemeProfileV2 | null {
  if (
    !profile ||
    profile.baseThemeId === profile.id ||
    profile.baseThemeId === TWILIGHT_DEFAULT_THEME_ID
  ) {
    return null
  }
  return getBuiltInThemePreset(profile.baseThemeId)
}

export function themeModesToDataAttributes(value: unknown): Record<`data-te-${string}`, string> {
  const modes = normalizeThemeModes(value)
  const attributes: Record<`data-te-${string}`, string> = {}
  for (const definition of THEME_MODE_DEFINITIONS) {
    const modeValue = readThemeModeValue(modes, definition.id)
    if (typeof modeValue === 'string' && definition.options.includes(modeValue)) {
      attributes[definition.dataAttribute] = modeValue
    }
  }
  for (const id of THEME_VISIBILITY_SLOT_IDS) {
    const visible = modes.visibility?.[id]
    if (typeof visible === 'boolean') attributes[visibilityDataAttribute(id)] = String(visible)
  }
  return attributes
}

function readThemeModeValue(modes: ThemeModes, id: string): string | undefined {
  const [domain, key] = id.split('.')
  const section = modes[domain as keyof ThemeModes]
  return isRecord(section) && typeof section[key] === 'string' ? section[key] : undefined
}

function visibilityDataAttribute(id: ThemeVisibilitySlotId): `data-te-${string}` {
  return `data-te-visible-${id.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
}

export const THEME_MANAGED_DATA_ATTRIBUTES: readonly `data-te-${string}`[] = Object.freeze([
  ...THEME_MODE_DEFINITIONS.map((definition) => definition.dataAttribute),
  ...THEME_VISIBILITY_SLOT_IDS.map(visibilityDataAttribute),
  ...THEME_SHELL_MANAGED_DATA_ATTRIBUTES
])

export function themeTokensToCssVariables(tokens: Record<string, string>): Record<string, string> {
  const variables: Record<string, string> = {}
  for (const [id, value] of Object.entries(tokens)) {
    const definition = tokenDefinitionById.get(id)
    if (definition) variables[definition.cssVariable] = value
  }
  const primary500 = variables['--te-primary-500']
  if (primary500) {
    const primary400 = variables['--te-primary-400'] ?? primary500
    const primary300 = variables['--te-primary-300'] ?? primary500
    variables['--te-accent'] = primary500
    variables['--brand-50'] = primary300
    variables['--brand-100'] = primary300
    variables['--brand-200'] = primary300
    variables['--brand-300'] = primary300
    variables['--brand-400'] = primary400
    variables['--brand-500'] = primary500
    variables['--brand-600'] = primary500
    variables['--brand-700'] = primary500
  }
  const active = variables['--te-active-bg']
  if (active) variables['--te-accent-soft'] = active
  return variables
}

export function getThemeTokenDefinition(id: string): ThemeTokenDefinition | null {
  return tokenDefinitionById.get(id) ?? null
}

export function isThemeSelection(value: unknown): value is ThemeSelection {
  if (!isRecord(value) || typeof value.kind !== 'string') return false
  if (value.kind === 'builtin') return isBuiltInThemePresetId(value.id)
  if (value.kind === 'user') return Boolean(normalizeThemeId(value.id))
  return (
    value.kind === 'plugin' &&
    typeof value.pluginId === 'string' &&
    value.pluginId.trim().length > 0 &&
    typeof value.themeId === 'string' &&
    value.themeId.trim().length > 0
  )
}

export function normalizeThemeSelection(
  value: unknown,
  legacyPluginThemeId: unknown = null
): ThemeSelection {
  if (isThemeSelection(value)) {
    if (value.kind === 'plugin') {
      return {
        kind: 'plugin',
        pluginId: value.pluginId.trim().slice(0, 128),
        themeId: value.themeId.trim().slice(0, 128)
      }
    }
    if (value.kind === 'user') return { kind: 'user', id: normalizeThemeId(value.id) }
    return { kind: 'builtin', id: value.id }
  }
  if (typeof legacyPluginThemeId === 'string') {
    const separator = legacyPluginThemeId.indexOf(':')
    if (separator > 0 && separator < legacyPluginThemeId.length - 1) {
      return {
        kind: 'plugin',
        pluginId: legacyPluginThemeId.slice(0, separator).trim().slice(0, 128),
        themeId: legacyPluginThemeId
          .slice(separator + 1)
          .trim()
          .slice(0, 128)
      }
    }
  }
  return { kind: 'builtin', id: TWILIGHT_DEFAULT_THEME_ID }
}

export function normalizeThemeWindowInheritance(
  value: unknown,
  fallback: ThemeWindowInheritance = { miniPlayer: true, desktopLyrics: true }
): ThemeWindowInheritance {
  const record = isRecord(value) ? value : {}
  return {
    miniPlayer: typeof record.miniPlayer === 'boolean' ? record.miniPlayer : fallback.miniPlayer,
    desktopLyrics:
      typeof record.desktopLyrics === 'boolean' ? record.desktopLyrics : fallback.desktopLyrics
  }
}

function normalizeWindowDefaults(value: unknown): ThemeWindowDefaults | undefined {
  if (!isRecord(value)) return undefined
  const result: ThemeWindowDefaults = {}
  if (isRecord(value.miniPlayer)) {
    result.miniPlayer = {
      accentColor: normalizeOptionalColor(value.miniPlayer.accentColor),
      primaryTextColor: normalizeOptionalColor(value.miniPlayer.primaryTextColor),
      mutedTextColor: normalizeOptionalColor(value.miniPlayer.mutedTextColor),
      surfaceOpacity: normalizeOptionalNumber(value.miniPlayer.surfaceOpacity, 40, 100),
      glassBlur: normalizeOptionalNumber(value.miniPlayer.glassBlur, 0, 40),
      cornerRadius: normalizeOptionalNumber(value.miniPlayer.cornerRadius, 0, 36),
      borderWidth: normalizeOptionalNumber(value.miniPlayer.borderWidth, 0, 3),
      borderColor: normalizeOptionalColor(value.miniPlayer.borderColor),
      shadowStrength: normalizeOptionalNumber(value.miniPlayer.shadowStrength, 0, 100),
      ...(value.miniPlayer.surfaceColor !== undefined
        ? { surfaceColor: normalizeOptionalColor(value.miniPlayer.surfaceColor) }
        : {}),
      ...(value.miniPlayer.fontFamily !== undefined
        ? { fontFamily: normalizeOptionalText(value.miniPlayer.fontFamily, 240) }
        : {}),
      ...(value.miniPlayer.shadowColor !== undefined
        ? { shadowColor: normalizeOptionalColor(value.miniPlayer.shadowColor) }
        : {})
    }
  }
  if (isRecord(value.desktopLyrics)) {
    result.desktopLyrics = {
      fontFamily: normalizeOptionalText(value.desktopLyrics.fontFamily, 64),
      fontSize: normalizeOptionalNumber(value.desktopLyrics.fontSize, 12, 80),
      fontWeight: normalizeOptionalNumber(value.desktopLyrics.fontWeight, 100, 900),
      color: normalizeOptionalColor(value.desktopLyrics.color),
      highlightColor: normalizeOptionalColor(value.desktopLyrics.highlightColor),
      backgroundColor: normalizeOptionalColor(value.desktopLyrics.backgroundColor),
      backgroundOpacity: normalizeOptionalNumber(value.desktopLyrics.backgroundOpacity, 0, 100),
      shadow:
        typeof value.desktopLyrics.shadow === 'boolean' ? value.desktopLyrics.shadow : undefined,
      shadowBlur: normalizeOptionalNumber(value.desktopLyrics.shadowBlur, 0, 30),
      shadowColor: normalizeOptionalColor(value.desktopLyrics.shadowColor)
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function normalizeOptionalColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (
    !normalized ||
    normalized.length > 80 ||
    /[;{}]|url\s*\(|@import|expression\s*\(/i.test(normalized)
  ) {
    return undefined
  }
  return normalized
}

function normalizeOptionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maxLength) : undefined
}

function normalizeOptionalNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : undefined
}

function normalizeThemeId(value: unknown): string {
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(normalized) ? normalized : ''
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function normalizeIsoDate(value: unknown): string {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value
  return new Date(0).toISOString()
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
