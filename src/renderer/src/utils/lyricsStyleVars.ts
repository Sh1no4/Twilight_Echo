import {
  resolveLyricsFontFamily,
  type LyricsStyleTarget,
  type LyricsTextStyle
} from '../../../shared/lyricsAppearance.ts'

/**
 * One source of truth for how a `LyricsTextStyle` becomes CSS. The page renders
 * lines through custom properties while the customizer needs plain inline style
 * properties for its preview, so both shapes are built from the same formulas
 * here — previously the two carried separate copies and the `outline` effect had
 * already drifted into two different implementations.
 */

const THEME_COLOR_FALLBACKS: Record<LyricsStyleTarget, string> = {
  normal: 'var(--te-playback-lyric-text, rgba(255, 255, 255, 0.42))',
  active: 'var(--te-playback-lyric-active-text, #fff)',
  harmony: 'var(--te-playback-lyric-harmony, rgba(255, 255, 255, 0.48))',
  translation: 'var(--te-playback-lyric-translation, rgba(255, 255, 255, 0.58))',
  romanization: 'var(--te-playback-lyric-romanization, rgba(255, 255, 255, 0.46))'
}

const THEME_ACTIVE_COLOR_FALLBACKS: Record<LyricsStyleTarget, string> = {
  normal: 'var(--te-playback-lyric-active-text, #fff)',
  active: 'var(--te-playback-lyric-active-text, #fff)',
  harmony: 'var(--te-playback-lyric-harmony-active, rgba(255, 255, 255, 0.62))',
  translation: 'var(--te-playback-lyric-translation-active, rgba(255, 255, 255, 0.82))',
  romanization: 'var(--te-playback-lyric-romanization-active, rgba(255, 255, 255, 0.72))'
}

export function resolveLyricsColor(style: LyricsTextStyle, target: LyricsStyleTarget): string {
  return style.colorMode === 'custom' ? style.color : THEME_COLOR_FALLBACKS[target]
}

export function constrainLyricsAlignment(
  align: LyricsTextStyle['align'],
  isTtml: boolean
): LyricsTextStyle['align'] {
  return isTtml && align === 'right' ? 'center' : align
}

function resolveLyricsActiveColor(style: LyricsTextStyle, target: LyricsStyleTarget): string {
  return style.colorMode === 'custom' ? style.color : THEME_ACTIVE_COLOR_FALLBACKS[target]
}

export function resolveLyricsBackground(style: LyricsTextStyle, target: LyricsStyleTarget): string {
  if (style.backgroundStyle === 'none') {
    return target === 'active'
      ? 'var(--te-playback-lyric-active-surface, transparent)'
      : 'transparent'
  }
  return `color-mix(in srgb, ${style.backgroundColor} ${style.backgroundOpacity}%, transparent)`
}

export function resolveLyricsBackgroundImage(style: LyricsTextStyle): string {
  if (style.backgroundStyle !== 'gradient') return 'none'
  const tint = `color-mix(in srgb, ${style.backgroundColor} ${style.backgroundOpacity}%, transparent)`
  return `linear-gradient(135deg, ${tint}, transparent)`
}

export function resolveLyricsBackdropFilter(style: LyricsTextStyle): string {
  return style.backgroundStyle === 'glass' ? 'blur(16px) saturate(130%)' : 'none'
}

/**
 * `outline` is a stroke rather than a shadow, so it cannot ride on `text-shadow`
 * with the other two. Callers apply `textShadow` and `webkitTextStroke`
 * separately.
 */
export function resolveLyricsTextShadow(style: LyricsTextStyle): string {
  const color = style.highlightColor
  const intensity = style.highlightIntensity
  switch (style.highlightEffect) {
    case 'shadow':
      return `0 3px ${Math.round(6 + intensity * 0.14)}px color-mix(in srgb, ${color} ${Math.round(20 + intensity * 0.45)}%, transparent)`
    case 'glow':
      return `0 0 1px color-mix(in srgb, ${color} 72%, transparent), 0 0 3px color-mix(in srgb, ${color} ${Math.round(18 + intensity * 0.22)}%, transparent)`
    default:
      return 'none'
  }
}

export function resolveLyricsTextStroke(style: LyricsTextStyle): string {
  if (style.highlightEffect !== 'outline') return '0 transparent'
  return `${(0.3 + (style.highlightIntensity / 100) * 1.2).toFixed(2)}px ${style.highlightColor}`
}

/** Custom properties consumed by the lyric row CSS. */
export function lyricsStyleVars(
  style: LyricsTextStyle,
  target: LyricsStyleTarget
): Record<string, string> {
  return {
    '--lyric-style-font-family': resolveLyricsFontFamily(style),
    '--lyric-style-font-size': `${style.fontSize}px`,
    '--lyric-style-font-weight': String(style.fontWeight),
    '--lyric-style-font-style': style.fontStyle,
    '--lyric-style-line-height': String(style.lineHeight),
    '--lyric-style-letter-spacing': `${style.letterSpacing}em`,
    '--lyric-style-align': style.align,
    '--lyric-style-color': resolveLyricsColor(style, target),
    '--lyric-style-active-color': resolveLyricsActiveColor(style, target),
    '--lyric-style-opacity': String(style.opacity / 100),
    '--lyric-style-background': resolveLyricsBackground(style, target),
    '--lyric-style-background-image': resolveLyricsBackgroundImage(style),
    '--lyric-style-backdrop-filter': resolveLyricsBackdropFilter(style),
    '--lyric-style-highlight': resolveLyricsTextShadow(style),
    '--lyric-style-stroke': resolveLyricsTextStroke(style)
  }
}

/**
 * Inline style properties for a standalone preview, where no lyric row CSS is
 * around to consume the custom properties.
 */
export function lyricsPreviewStyle(
  style: LyricsTextStyle,
  target: LyricsStyleTarget
): Record<string, string> {
  const alpha = style.opacity / 100
  const preview: Record<string, string> = {
    fontFamily: resolveLyricsFontFamily(style),
    fontSize: `${style.fontSize}px`,
    fontWeight: String(style.fontWeight),
    fontStyle: style.fontStyle,
    lineHeight: String(style.lineHeight),
    letterSpacing: `${style.letterSpacing}em`,
    textAlign: style.align,
    color:
      style.colorMode === 'custom'
        ? style.color
        : `color-mix(in srgb, var(--te-playback-lyric-active-text, #fff) ${Math.max(22, alpha * 100)}%, transparent)`,
    opacity: style.colorMode === 'custom' ? String(alpha) : '1',
    background: resolveLyricsBackground(style, target),
    backgroundImage: resolveLyricsBackgroundImage(style),
    backdropFilter: resolveLyricsBackdropFilter(style),
    textShadow: resolveLyricsTextShadow(style)
  }
  if (style.highlightEffect === 'outline') {
    preview.webkitTextStroke = resolveLyricsTextStroke(style)
  }
  return preview
}
