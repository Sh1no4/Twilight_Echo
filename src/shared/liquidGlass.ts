/**
 * Liquid glass surface material — shared contract.
 *
 * The material is a switchable alternative to the standard card/playbar surface.
 * Its refraction comes from an SVG filter chain (feImage displacement map ->
 * per-channel feDisplacementMap -> screen blend -> edge mask), applied to a
 * dedicated warp layer that also carries backdrop-filter. Content is a sibling
 * of that layer so it stays sharp.
 *
 * `feDisplacementMap scale` and `feImage href` are SVG attributes and cannot read
 * CSS variables, so the renderer reads the resolved `--te-lg-*` values back out of
 * computed style and binds them as attributes.
 */

export type SurfaceMaterial = 'standard' | 'liquidGlass'

export const SURFACE_MATERIALS: readonly SurfaceMaterial[] = ['standard', 'liquidGlass']

/** Filter ids referenced from CSS. Cards and the playbar differ in aspect ratio. */
export const LIQUID_GLASS_CARD_FILTER_ID = 'te-lg-card'
export const LIQUID_GLASS_PLAYBAR_FILTER_ID = 'te-lg-playbar'
export const LIQUID_GLASS_TUNING_CHANGED_EVENT = 'twilight:liquid-glass-tuning-changed'

/**
 * Class names that receive the liquid glass card surface. Kept in sync with the
 * selector list in `base.css`; the surfaces test asserts parity so the pointer
 * tracker and the stylesheet can never drift apart.
 */
export const LIQUID_GLASS_CARD_CLASSES = [
  'artist-card',
  'album-card',
  'playlist-card',
  'glass-card',
  'feature-card',
  'playlist-grid-card',
  'playlist-tile',
  'favorites-card',
  'streaming-placeholder',
  'empty-recommend',
  'detail-playlist-header',
  'track-table-wrapper',
  'profile-panel',
  'liked-panel',
  'playlist-list-item',
  'profile-card',
  'recent-card',
  'ranking-card',
  'create-playlist-card',
  'folder-card',
  'empty-list-card',
  'filter-card',
  'sponsor-card',
  'update-card',
  'dsp-module-card',
  'device-card',
  'card',
  'account-card',
  'plugin-card',
  'market-card',
  'plugin-extension-card',
  'bili-qr-card',
  'chart-card',
  'parameter-card',
  'square-card',
  'opra-panel',
  'opra-result-item',
  'device-panel',
  'plugin-panel',
  'output-diagnostic-panel',
  'background-accordion-panel'
] as const

/** Selector used by the pointer tracker to resolve the hovered card surface. */
export const LIQUID_GLASS_CARD_SELECTOR = LIQUID_GLASS_CARD_CLASSES.map(
  (className) => `.${className}`
).join(',')

export interface LiquidGlassTheme {
  /** Displacement magnitude in px fed to feDisplacementMap. */
  displacementScale: number
  /** Backdrop blur radius in px. */
  blurAmount: number
  /** Backdrop saturation in percent. */
  saturation: number
  /** Chromatic aberration strength; drives per-channel scale falloff. */
  aberrationIntensity: number
  /** How strongly the surface reaches toward the cursor (percent). */
  elasticity: number
  /** Specular rim/highlight opacity in percent. */
  specularOpacity: number
  /** Surface tint opacity in percent. */
  tintOpacity: number
}

export interface LiquidGlassSettings {
  /** Highlight gradient angle follows the pointer (rAF-throttled). */
  followPointer: boolean
  /** Tint the glass dark on light backgrounds for visibility ("Over Light"). */
  overLight: boolean
  light: LiquidGlassTheme
  dark: LiquidGlassTheme
}

interface Bound {
  min: number
  max: number
}

export const LIQUID_GLASS_BOUNDS: Readonly<Record<keyof LiquidGlassTheme, Bound>> = {
  displacementScale: { min: 0, max: 140 },
  blurAmount: { min: 0, max: 40 },
  saturation: { min: 80, max: 200 },
  aberrationIntensity: { min: 0, max: 8 },
  elasticity: { min: 0, max: 100 },
  specularOpacity: { min: 0, max: 100 },
  tintOpacity: { min: 0, max: 100 }
}

export const DEFAULT_LIQUID_GLASS_LIGHT: LiquidGlassTheme = {
  displacementScale: 58,
  blurAmount: 14,
  saturation: 132,
  aberrationIntensity: 1.1,
  elasticity: 8,
  specularOpacity: 56,
  tintOpacity: 6
}

export const DEFAULT_LIQUID_GLASS_DARK: LiquidGlassTheme = {
  displacementScale: 62,
  blurAmount: 18,
  saturation: 136,
  aberrationIntensity: 1.35,
  elasticity: 7,
  specularOpacity: 48,
  tintOpacity: 17
}

export const DEFAULT_LIQUID_GLASS: LiquidGlassSettings = {
  followPointer: true,
  overLight: false,
  light: DEFAULT_LIQUID_GLASS_LIGHT,
  dark: DEFAULT_LIQUID_GLASS_DARK
}

function clamp(value: unknown, bound: Bound, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(bound.max, Math.max(bound.min, value))
}

export function normalizeSurfaceMaterial(value: unknown): SurfaceMaterial {
  return value === 'liquidGlass' ? 'liquidGlass' : 'standard'
}

export function normalizeLiquidGlassTheme(
  raw: unknown,
  defaults: LiquidGlassTheme
): LiquidGlassTheme {
  const t = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    displacementScale: clamp(
      t.displacementScale,
      LIQUID_GLASS_BOUNDS.displacementScale,
      defaults.displacementScale
    ),
    blurAmount: clamp(t.blurAmount, LIQUID_GLASS_BOUNDS.blurAmount, defaults.blurAmount),
    saturation: clamp(t.saturation, LIQUID_GLASS_BOUNDS.saturation, defaults.saturation),
    aberrationIntensity: clamp(
      t.aberrationIntensity,
      LIQUID_GLASS_BOUNDS.aberrationIntensity,
      defaults.aberrationIntensity
    ),
    elasticity: clamp(t.elasticity, LIQUID_GLASS_BOUNDS.elasticity, defaults.elasticity),
    specularOpacity: clamp(
      t.specularOpacity,
      LIQUID_GLASS_BOUNDS.specularOpacity,
      defaults.specularOpacity
    ),
    tintOpacity: clamp(t.tintOpacity, LIQUID_GLASS_BOUNDS.tintOpacity, defaults.tintOpacity)
  }
}

export function normalizeLiquidGlass(raw: unknown): LiquidGlassSettings {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    followPointer: value.followPointer !== false,
    overLight: value.overLight === true,
    light: normalizeLiquidGlassTheme(value.light, DEFAULT_LIQUID_GLASS_LIGHT),
    dark: normalizeLiquidGlassTheme(value.dark, DEFAULT_LIQUID_GLASS_DARK)
  }
}

export interface LiquidGlassChannelScales {
  red: number
  green: number
  blue: number
}

/**
 * Per-channel displacement scales. The red channel carries the base displacement
 * and green/blue trail behind it, which is what separates into chromatic fringing
 * at the refracted edge. Scales stay non-negative so a high aberration value at a
 * low displacement cannot flip the channel direction.
 */
export function resolveChannelScales(
  displacementScale: number,
  aberrationIntensity: number
): LiquidGlassChannelScales {
  const base = Math.max(0, displacementScale)
  const step = Math.max(0, aberrationIntensity) * 0.05
  return {
    red: base,
    green: Math.max(0, base * (1 - step)),
    blue: Math.max(0, base * (1 - step * 2))
  }
}

/** Softening applied after the channel blend; mirrors the reference falloff. */
export function resolveAberrationBlur(aberrationIntensity: number): number {
  return Math.max(0.1, 0.5 - Math.max(0, aberrationIntensity) * 0.1)
}

export function liquidGlassCssVariables(theme: LiquidGlassTheme): Record<string, string> {
  return {
    '--te-lg-displacement': String(theme.displacementScale),
    '--te-lg-blur': `${theme.blurAmount}px`,
    '--te-lg-saturate': `${theme.saturation}%`,
    '--te-lg-aberration': String(theme.aberrationIntensity),
    '--te-lg-elasticity': String(theme.elasticity),
    '--te-lg-specular': (theme.specularOpacity / 100).toFixed(3),
    '--te-lg-tint': (theme.tintOpacity / 100).toFixed(3)
  }
}
