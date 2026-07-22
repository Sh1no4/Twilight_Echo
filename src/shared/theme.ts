import type { VersionedDataEnvelope } from './versionedPersistence.ts'

export const TWILIGHT_DEFAULT_THEME_ID = 'builtin:twilight-echo-default'
export const THEME_DOCUMENT_SCHEMA_VERSION = 1
export const THEME_LIBRARY_SCHEMA_VERSION = 1
export const MAX_USER_THEME_PROFILES = 32

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
  accentColor?: string
  primaryTextColor?: string
  mutedTextColor?: string
  surfaceOpacity?: number
  glassBlur?: number
  cornerRadius?: number
  borderWidth?: number
  borderColor?: string
  shadowStrength?: number
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

export type ThemeSelection =
  | { kind: 'builtin'; id: typeof TWILIGHT_DEFAULT_THEME_ID }
  | { kind: 'user'; id: string }
  | { kind: 'plugin'; pluginId: string; themeId: string }

export interface ThemeWindowInheritance {
  miniPlayer: boolean
  desktopLyrics: boolean
}

export interface ThemeLibraryDocument {
  schemaVersion: 1
  activeTheme: ThemeSelection
  profiles: ThemeProfileV1[]
  windowInheritance: ThemeWindowInheritance
}

export type ThemeLibrarySnapshot = VersionedDataEnvelope<ThemeLibraryDocument>

export interface ThemeBootstrap {
  library: ThemeLibrarySnapshot
  defaultTheme: ThemeDocumentV1
}

export interface ThemeArchiveDocument {
  schemaVersion: 1
  profile: ThemeProfileV1
  assets: ThemeAssetReference[]
}

export interface StructuredPluginThemeV1 {
  schemaVersion: 1
  variants: Partial<Record<ThemeTone, { tokens?: Record<string, string> }>>
  windowDefaults?: ThemeWindowDefaults
}

const lightFont =
  "'Inter', 'Plus Jakarta Sans', 'MiSans', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

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
    '#f59e0b',
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
    '#fbbf24',
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
    '#fde68a',
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
    '245, 158, 11',
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
    '#f4f4f7',
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
      accentColor: '#7c4dff',
      primaryTextColor: '#ffffff',
      mutedTextColor: '#b8b7c2',
      surfaceOpacity: 94,
      glassBlur: 18,
      cornerRadius: 25,
      borderWidth: 1,
      borderColor: '#353542',
      shadowStrength: 80
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

export function createDefaultThemeLibraryDocument(
  activeTheme: ThemeSelection = { kind: 'builtin', id: TWILIGHT_DEFAULT_THEME_ID },
  windowInheritance: ThemeWindowInheritance = { miniPlayer: true, desktopLyrics: true }
): ThemeLibraryDocument {
  return {
    schemaVersion: THEME_LIBRARY_SCHEMA_VERSION,
    activeTheme,
    profiles: [],
    windowInheritance
  }
}

export function isThemeLibraryDocument(value: unknown): value is ThemeLibraryDocument {
  if (!isRecord(value) || value.schemaVersion !== THEME_LIBRARY_SCHEMA_VERSION) return false
  if (!Array.isArray(value.profiles) || !isRecord(value.windowInheritance)) return false
  return isThemeSelection(value.activeTheme)
}

export function normalizeThemeLibraryDocument(value: unknown): ThemeLibraryDocument {
  const fallback = createDefaultThemeLibraryDocument()
  if (!isRecord(value)) return fallback
  const profiles = Array.isArray(value.profiles)
    ? value.profiles
        .map((profile) => normalizeThemeProfile(profile))
        .filter((profile): profile is ThemeProfileV1 => profile !== null)
        .slice(0, MAX_USER_THEME_PROFILES)
    : []
  const selection = isThemeSelection(value.activeTheme) ? value.activeTheme : fallback.activeTheme
  const activeTheme =
    selection.kind !== 'user' || profiles.some((profile) => profile.id === selection.id)
      ? selection
      : fallback.activeTheme
  const inheritance = isRecord(value.windowInheritance) ? value.windowInheritance : {}
  return {
    schemaVersion: THEME_LIBRARY_SCHEMA_VERSION,
    activeTheme,
    profiles,
    windowInheritance: {
      miniPlayer: inheritance.miniPlayer !== false,
      desktopLyrics: inheritance.desktopLyrics !== false
    }
  }
}

export function normalizeThemeProfile(value: unknown): ThemeProfileV1 | null {
  if (!isRecord(value) || value.schemaVersion !== THEME_DOCUMENT_SCHEMA_VERSION) return null
  const id = normalizeThemeId(value.id)
  const name = normalizeText(value.name, 80)
  if (!id || !name || id === TWILIGHT_DEFAULT_THEME_ID) return null
  const createdAt = normalizeIsoDate(value.createdAt)
  const updatedAt = normalizeIsoDate(value.updatedAt)
  const overrides = isRecord(value.overrides) ? value.overrides : {}
  const assets = normalizeThemeAssets(value.assets)
  return {
    schemaVersion: THEME_DOCUMENT_SCHEMA_VERSION,
    id,
    name,
    description: normalizeText(value.description, 240),
    baseThemeId:
      typeof value.baseThemeId === 'string' && value.baseThemeId.trim()
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
    windowDefaults: normalizeWindowDefaults(value.windowDefaults),
    ...(assets.length > 0 ? { assets } : {}),
    ...normalizeThemeAssetBindings(value.assetBindings, assets)
  }
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

export function normalizeStructuredPluginTheme(
  value: unknown
): StructuredPluginThemeV1 | undefined {
  if (!isRecord(value) || value.schemaVersion !== THEME_DOCUMENT_SCHEMA_VERSION) return undefined
  const sourceVariants = isRecord(value.variants) ? value.variants : {}
  const variants: StructuredPluginThemeV1['variants'] = {}
  for (const tone of ['pureWhite', 'dark'] as const) {
    const source = isRecord(sourceVariants[tone]) ? sourceVariants[tone] : {}
    const tokens = normalizeThemeTokenOverrides(isRecord(source.tokens) ? source.tokens : {})
    if (Object.keys(tokens).length > 0) variants[tone] = { tokens }
  }
  const windowDefaults = normalizeWindowDefaults(value.windowDefaults)
  if (Object.keys(variants).length === 0 && !windowDefaults) return undefined
  return {
    schemaVersion: THEME_DOCUMENT_SCHEMA_VERSION,
    variants,
    ...(windowDefaults ? { windowDefaults } : {})
  }
}

export function normalizeThemeTokenValue(id: string, value: string): string | null {
  const definition = tokenDefinitionById.get(id)
  if (!definition) return null
  const normalized = value.trim()
  if (!normalized || normalized.length > 240) return null
  if (/[;{}]|url\s*\(|@import|expression\s*\(/i.test(normalized)) return null
  if (definition.kind === 'number' && definition.unit !== '%') {
    const number = Number(normalized)
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

export function resolveThemeProfileTokens(
  profile: ThemeProfileV1 | null,
  tone: ThemeTone
): Record<string, string> {
  return profile
    ? {
        ...TWILIGHT_DEFAULT_THEME.variants[tone].tokens,
        ...profile.overrides[tone]
      }
    : {}
}

export function themeTokensToCssVariables(tokens: Record<string, string>): Record<string, string> {
  const variables: Record<string, string> = {}
  for (const [id, value] of Object.entries(tokens)) {
    const definition = tokenDefinitionById.get(id)
    if (definition) variables[definition.cssVariable] = value
  }
  return variables
}

export function getThemeTokenDefinition(id: string): ThemeTokenDefinition | null {
  return tokenDefinitionById.get(id) ?? null
}

export function isThemeSelection(value: unknown): value is ThemeSelection {
  if (!isRecord(value) || typeof value.kind !== 'string') return false
  if (value.kind === 'builtin') return value.id === TWILIGHT_DEFAULT_THEME_ID
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
    return { kind: 'builtin', id: TWILIGHT_DEFAULT_THEME_ID }
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
      shadowStrength: normalizeOptionalNumber(value.miniPlayer.shadowStrength, 0, 100)
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
