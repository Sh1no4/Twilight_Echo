export type LyricsAppearanceFontFamily =
  | 'inherit'
  | 'system'
  | 'inter'
  | 'lxgw'
  | 'sarasa'
  | 'comic'
  | 'custom'

export type LyricsAppearanceColorMode = 'theme' | 'custom'
export type LyricsAppearanceAlign = 'center' | 'left' | 'right'
export type LyricsFocusLineCount = 'all' | 1 | 3 | 5
export type LyricsBackgroundStyle = 'none' | 'solid' | 'glass' | 'gradient'
export type LyricsHighlightEffect = 'none' | 'shadow' | 'glow' | 'outline'
export type LyricsStyleTarget = 'normal' | 'active' | 'translation'

export interface LyricsTextStyle {
  fontFamily: LyricsAppearanceFontFamily
  customFontFamily: string
  fontSize: number
  fontWeight: number
  lineHeight: number
  align: LyricsAppearanceAlign
  colorMode: LyricsAppearanceColorMode
  color: string
  opacity: number
  backgroundStyle: LyricsBackgroundStyle
  backgroundColor: string
  backgroundOpacity: number
  highlightEffect: LyricsHighlightEffect
  highlightColor: string
  highlightIntensity: number
}

export interface LyricsAppearanceSettings {
  /** Legacy/global quick controls retained for settings migration and compact controls. */
  fontFamily: LyricsAppearanceFontFamily
  fontSize: number
  fontWeight: number
  lineHeight: number
  align: LyricsAppearanceAlign
  inactiveOpacity: number
  focusLineCount: LyricsFocusLineCount
  colorMode: LyricsAppearanceColorMode
  textColor: string
  activeColor: string
  karaokeColor: string
  karaokeEnabled: boolean
  styles: Record<LyricsStyleTarget, LyricsTextStyle>
}

export const LYRICS_FONT_FAMILIES: readonly LyricsAppearanceFontFamily[] = [
  'inherit',
  'system',
  'inter',
  'lxgw',
  'sarasa',
  'comic',
  'custom'
]

export const LYRICS_FONT_FAMILY_STACKS: Readonly<
  Record<Exclude<LyricsAppearanceFontFamily, 'custom'>, string>
> = {
  inherit: 'inherit',
  system: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif",
  inter: "'Inter', 'MiSans', 'Microsoft YaHei', sans-serif",
  lxgw: "'LXGW WenKai', 'MiSans', 'Microsoft YaHei', sans-serif",
  sarasa: "'Sarasa Gothic SC', 'MiSans', 'Microsoft YaHei', sans-serif",
  comic: "'Comic Sans MS', 'MiSans', 'Microsoft YaHei', sans-serif"
}

export function resolveLyricsFontFamily(
  style: Pick<LyricsTextStyle, 'fontFamily' | 'customFontFamily'>
): string {
  if (style.fontFamily === 'custom') {
    const custom = style.customFontFamily.trim()
    return custom ? `${JSON.stringify(custom)}, 'Microsoft YaHei', sans-serif` : 'inherit'
  }
  return LYRICS_FONT_FAMILY_STACKS[style.fontFamily]
}

export const DEFAULT_LYRICS_TEXT_STYLES: Record<LyricsStyleTarget, LyricsTextStyle> = {
  normal: {
    fontFamily: 'inherit',
    customFontFamily: '',
    fontSize: 18,
    fontWeight: 600,
    lineHeight: 1.85,
    align: 'center',
    colorMode: 'theme',
    color: '#ffffff',
    opacity: 100,
    backgroundStyle: 'none',
    backgroundColor: '#0f172a',
    backgroundOpacity: 0,
    highlightEffect: 'none',
    highlightColor: '#ffffff',
    highlightIntensity: 30
  },
  active: {
    fontFamily: 'inherit',
    customFontFamily: '',
    fontSize: 25,
    fontWeight: 600,
    lineHeight: 1.65,
    align: 'center',
    colorMode: 'theme',
    color: '#ffffff',
    opacity: 100,
    backgroundStyle: 'none',
    backgroundColor: '#0f172a',
    backgroundOpacity: 0,
    highlightEffect: 'glow',
    highlightColor: '#fff8df',
    highlightIntensity: 32
  },
  translation: {
    fontFamily: 'inherit',
    customFontFamily: '',
    fontSize: 16,
    fontWeight: 500,
    lineHeight: 1.45,
    align: 'center',
    colorMode: 'theme',
    color: '#ffffff',
    opacity: 82,
    backgroundStyle: 'none',
    backgroundColor: '#0f172a',
    backgroundOpacity: 0,
    highlightEffect: 'none',
    highlightColor: '#ffffff',
    highlightIntensity: 24
  }
}

export const DEFAULT_LYRICS_APPEARANCE: LyricsAppearanceSettings = {
  fontFamily: 'inherit',
  fontSize: 18,
  fontWeight: 600,
  lineHeight: 1.85,
  align: 'center',
  inactiveOpacity: 40,
  focusLineCount: 'all',
  colorMode: 'theme',
  textColor: '#ffffff',
  activeColor: '#ffffff',
  karaokeColor: '#fff8df',
  karaokeEnabled: true,
  styles: {
    normal: { ...DEFAULT_LYRICS_TEXT_STYLES.normal },
    active: { ...DEFAULT_LYRICS_TEXT_STYLES.active },
    translation: { ...DEFAULT_LYRICS_TEXT_STYLES.translation }
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value.toLowerCase()
    : fallback
}

function normalizeFontWeight(value: unknown, fallback: number): number {
  const numeric = clampNumber(value, 300, 900, fallback)
  return Math.round(numeric / 100) * 100
}

function normalizeAlign(value: unknown, fallback: LyricsAppearanceAlign): LyricsAppearanceAlign {
  return value === 'left' || value === 'center' || value === 'right' ? value : fallback
}

function normalizeFontFamily(
  value: unknown,
  fallback: LyricsAppearanceFontFamily
): LyricsAppearanceFontFamily {
  return LYRICS_FONT_FAMILIES.includes(value as LyricsAppearanceFontFamily)
    ? (value as LyricsAppearanceFontFamily)
    : fallback
}

function normalizeTextStyle(raw: unknown, fallback: LyricsTextStyle): LyricsTextStyle {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const backgroundStyles: readonly LyricsBackgroundStyle[] = ['none', 'solid', 'glass', 'gradient']
  const highlightEffects: readonly LyricsHighlightEffect[] = ['none', 'shadow', 'glow', 'outline']
  return {
    fontFamily: normalizeFontFamily(value.fontFamily, fallback.fontFamily),
    customFontFamily:
      typeof value.customFontFamily === 'string'
        ? value.customFontFamily.trim().slice(0, 96)
        : fallback.customFontFamily,
    fontSize: clampNumber(value.fontSize, 12, 48, fallback.fontSize),
    fontWeight: normalizeFontWeight(value.fontWeight, fallback.fontWeight),
    lineHeight: clampNumber(value.lineHeight, 1.1, 2.8, fallback.lineHeight),
    align: normalizeAlign(value.align, fallback.align),
    colorMode: value.colorMode === 'custom' ? 'custom' : 'theme',
    color: normalizeColor(value.color, fallback.color),
    opacity: clampNumber(value.opacity, 10, 100, fallback.opacity),
    backgroundStyle: backgroundStyles.includes(value.backgroundStyle as LyricsBackgroundStyle)
      ? (value.backgroundStyle as LyricsBackgroundStyle)
      : fallback.backgroundStyle,
    backgroundColor: normalizeColor(value.backgroundColor, fallback.backgroundColor),
    backgroundOpacity: clampNumber(value.backgroundOpacity, 0, 100, fallback.backgroundOpacity),
    highlightEffect: highlightEffects.includes(value.highlightEffect as LyricsHighlightEffect)
      ? (value.highlightEffect as LyricsHighlightEffect)
      : fallback.highlightEffect,
    highlightColor: normalizeColor(value.highlightColor, fallback.highlightColor),
    highlightIntensity: clampNumber(value.highlightIntensity, 0, 100, fallback.highlightIntensity)
  }
}

function migrateLegacyStyles(
  value: Record<string, unknown>
): Record<LyricsStyleTarget, LyricsTextStyle> {
  const fontFamily = normalizeFontFamily(value.fontFamily, DEFAULT_LYRICS_APPEARANCE.fontFamily)
  const fontSize = clampNumber(value.fontSize, 14, 32, DEFAULT_LYRICS_APPEARANCE.fontSize)
  const fontWeight = normalizeFontWeight(value.fontWeight, DEFAULT_LYRICS_APPEARANCE.fontWeight)
  const lineHeight = clampNumber(value.lineHeight, 1.2, 2.6, DEFAULT_LYRICS_APPEARANCE.lineHeight)
  const align = normalizeAlign(value.align, DEFAULT_LYRICS_APPEARANCE.align)
  const colorMode = value.colorMode === 'custom' ? 'custom' : 'theme'
  const textColor = normalizeColor(value.textColor, DEFAULT_LYRICS_APPEARANCE.textColor)
  const activeColor = normalizeColor(value.activeColor, DEFAULT_LYRICS_APPEARANCE.activeColor)

  return {
    normal: {
      ...DEFAULT_LYRICS_TEXT_STYLES.normal,
      fontFamily,
      fontSize,
      fontWeight,
      lineHeight,
      align,
      colorMode,
      color: textColor
    },
    active: {
      ...DEFAULT_LYRICS_TEXT_STYLES.active,
      fontFamily,
      fontSize: Math.min(48, fontSize + 7),
      fontWeight,
      align,
      colorMode,
      color: activeColor,
      highlightColor: normalizeColor(value.karaokeColor, DEFAULT_LYRICS_APPEARANCE.karaokeColor)
    },
    translation: {
      ...DEFAULT_LYRICS_TEXT_STYLES.translation,
      fontFamily,
      fontSize: Math.max(12, fontSize - 2),
      align,
      colorMode,
      color: textColor
    }
  }
}

export function cloneLyricsAppearance(value: LyricsAppearanceSettings): LyricsAppearanceSettings {
  return {
    ...value,
    styles: {
      normal: { ...value.styles.normal },
      active: { ...value.styles.active },
      translation: { ...value.styles.translation }
    }
  }
}

export function normalizeLyricsAppearance(
  raw: unknown,
  legacy: Record<string, unknown> = {}
): LyricsAppearanceSettings {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const fontFamily = normalizeFontFamily(value.fontFamily, DEFAULT_LYRICS_APPEARANCE.fontFamily)
  const fontSize = clampNumber(
    value.fontSize,
    14,
    32,
    clampNumber(legacy.lyricFontSize, 14, 28, DEFAULT_LYRICS_APPEARANCE.fontSize)
  )
  const fontWeight = normalizeFontWeight(value.fontWeight, DEFAULT_LYRICS_APPEARANCE.fontWeight)
  const lineHeight = clampNumber(value.lineHeight, 1.2, 2.6, DEFAULT_LYRICS_APPEARANCE.lineHeight)
  const align = normalizeAlign(
    value.align,
    legacy.lyricAlign === 'left' ? 'left' : DEFAULT_LYRICS_APPEARANCE.align
  )
  const colorMode = value.colorMode === 'custom' ? 'custom' : 'theme'
  const textColor = normalizeColor(value.textColor, DEFAULT_LYRICS_APPEARANCE.textColor)
  const activeColor = normalizeColor(value.activeColor, DEFAULT_LYRICS_APPEARANCE.activeColor)
  const karaokeColor = normalizeColor(value.karaokeColor, DEFAULT_LYRICS_APPEARANCE.karaokeColor)
  const migratedStyles = migrateLegacyStyles({
    ...value,
    fontFamily,
    fontSize,
    fontWeight,
    lineHeight,
    align,
    colorMode,
    textColor,
    activeColor,
    karaokeColor
  })
  const stylesValue =
    typeof value.styles === 'object' && value.styles !== null
      ? (value.styles as Record<string, unknown>)
      : {}

  return {
    fontFamily,
    fontSize,
    fontWeight,
    lineHeight,
    align,
    inactiveOpacity: clampNumber(
      value.inactiveOpacity,
      10,
      100,
      clampNumber(legacy.lyricDimOpacity, 10, 100, DEFAULT_LYRICS_APPEARANCE.inactiveOpacity)
    ),
    focusLineCount:
      value.focusLineCount === 'all' ||
      value.focusLineCount === 1 ||
      value.focusLineCount === 3 ||
      value.focusLineCount === 5
        ? value.focusLineCount
        : DEFAULT_LYRICS_APPEARANCE.focusLineCount,
    colorMode,
    textColor,
    activeColor,
    karaokeColor,
    karaokeEnabled: value.karaokeEnabled !== false,
    styles: {
      normal: normalizeTextStyle(stylesValue.normal, migratedStyles.normal),
      active: normalizeTextStyle(stylesValue.active, migratedStyles.active),
      translation: normalizeTextStyle(stylesValue.translation, migratedStyles.translation)
    }
  }
}

export function syncLegacyLyricsAppearance(
  appearance: LyricsAppearanceSettings,
  patch: Partial<
    Pick<
      LyricsAppearanceSettings,
      | 'fontFamily'
      | 'fontSize'
      | 'fontWeight'
      | 'lineHeight'
      | 'align'
      | 'colorMode'
      | 'textColor'
      | 'activeColor'
      | 'karaokeColor'
    >
  >
): LyricsAppearanceSettings {
  const next = cloneLyricsAppearance({ ...appearance, ...patch })
  if (patch.fontFamily !== undefined) {
    next.styles.normal.fontFamily = patch.fontFamily
    next.styles.active.fontFamily = patch.fontFamily
    next.styles.translation.fontFamily = patch.fontFamily
  }
  if (patch.fontSize !== undefined) {
    next.styles.normal.fontSize = patch.fontSize
    next.styles.active.fontSize = Math.min(48, patch.fontSize + 7)
    next.styles.translation.fontSize = Math.max(12, patch.fontSize - 2)
  }
  if (patch.fontWeight !== undefined) {
    next.styles.normal.fontWeight = patch.fontWeight
    next.styles.active.fontWeight = patch.fontWeight
  }
  if (patch.lineHeight !== undefined) next.styles.normal.lineHeight = patch.lineHeight
  if (patch.align !== undefined) {
    next.styles.normal.align = patch.align
    next.styles.active.align = patch.align
    next.styles.translation.align = patch.align
  }
  if (patch.colorMode !== undefined) {
    next.styles.normal.colorMode = patch.colorMode
    next.styles.active.colorMode = patch.colorMode
    next.styles.translation.colorMode = patch.colorMode
  }
  if (patch.textColor !== undefined) {
    next.styles.normal.color = patch.textColor
    next.styles.translation.color = patch.textColor
  }
  if (patch.activeColor !== undefined) next.styles.active.color = patch.activeColor
  if (patch.karaokeColor !== undefined) next.styles.active.highlightColor = patch.karaokeColor
  return next
}
