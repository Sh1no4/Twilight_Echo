/**
 * Player bar presentation — shared contract.
 *
 * The playbar has two shapes. `standard` is the full bar (cover, inline
 * progress, time labels). `mini` drops the cover and the inline progress row
 * and moves seeking onto a thin rail sitting on the bar's bottom border, so the
 * bar can shrink to roughly the width of its controls.
 *
 * The now-playing page may use a different shape than the rest of the app, and
 * a mini bar there can auto-hide until the pointer approaches the bottom edge.
 * `resolvePlayerBarPresentation` is the single place that decides which shape
 * and which behaviour apply, so the shell only reads the resolved value.
 */

export type PlayerBarMode = 'standard' | 'mini'

/** Playing-page shape; `inherit` follows the global `mode`. */
export type PlayerBarPageMode = PlayerBarMode | 'inherit'

export const PLAYER_BAR_MODES: readonly PlayerBarMode[] = ['standard', 'mini']

export interface PlayerBarSettings {
  /** Shape used everywhere except the now-playing page. */
  mode: PlayerBarMode
  /** Shape used on the now-playing page. */
  playingPageMode: PlayerBarPageMode
  /** Auto-hide the bar on the now-playing page; only applies to the mini shape. */
  autoHideOnPlayingPage: boolean
  /** Pointer must come within this many px of the viewport bottom to reveal. */
  revealThresholdPx: number
  /** Delay before hiding once the pointer leaves the reveal zone. */
  hideDelayMs: number
}

interface Bound {
  min: number
  max: number
}

export const PLAYER_BAR_BOUNDS: Readonly<Record<'revealThresholdPx' | 'hideDelayMs', Bound>> = {
  revealThresholdPx: { min: 24, max: 400 },
  hideDelayMs: { min: 0, max: 5000 }
}

export const DEFAULT_PLAYER_BAR_SETTINGS: PlayerBarSettings = {
  mode: 'standard',
  playingPageMode: 'inherit',
  autoHideOnPlayingPage: false,
  revealThresholdPx: 120,
  hideDelayMs: 900
}

function clamp(value: unknown, bound: Bound, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.round(Math.min(bound.max, Math.max(bound.min, value)))
}

export function normalizePlayerBarMode(value: unknown): PlayerBarMode {
  return value === 'mini' ? 'mini' : 'standard'
}

export function normalizePlayerBarPageMode(value: unknown): PlayerBarPageMode {
  if (value === 'mini' || value === 'standard') return value
  return 'inherit'
}

export function normalizePlayerBarSettings(raw: unknown): PlayerBarSettings {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    mode: normalizePlayerBarMode(value.mode),
    playingPageMode: normalizePlayerBarPageMode(value.playingPageMode),
    autoHideOnPlayingPage: value.autoHideOnPlayingPage === true,
    revealThresholdPx: clamp(
      value.revealThresholdPx,
      PLAYER_BAR_BOUNDS.revealThresholdPx,
      DEFAULT_PLAYER_BAR_SETTINGS.revealThresholdPx
    ),
    hideDelayMs: clamp(
      value.hideDelayMs,
      PLAYER_BAR_BOUNDS.hideDelayMs,
      DEFAULT_PLAYER_BAR_SETTINGS.hideDelayMs
    )
  }
}

export function clonePlayerBarSettings(value: PlayerBarSettings): PlayerBarSettings {
  return { ...value }
}

export interface PlayerBarPresentation {
  mode: PlayerBarMode
  /** Border progress rail is visible; only the mini shape carries one. */
  edgeProgress: boolean
  /** Bar stays hidden until the pointer approaches the bottom edge. */
  autoHide: boolean
}

export interface PlayerBarContext {
  onPlayingPage: boolean
}

/**
 * Auto-hide needs all three: the now-playing page, the mini shape resolved for
 * that page, and the setting itself. A standard bar never hides, because its
 * inline progress row is the only progress readout it has.
 */
export function resolvePlayerBarPresentation(
  settings: PlayerBarSettings,
  context: PlayerBarContext
): PlayerBarPresentation {
  const pageMode = settings.playingPageMode
  const mode: PlayerBarMode = context.onPlayingPage
    ? pageMode === 'inherit'
      ? settings.mode
      : pageMode
    : settings.mode
  return {
    mode,
    edgeProgress: mode === 'mini',
    autoHide: context.onPlayingPage && mode === 'mini' && settings.autoHideOnPlayingPage
  }
}

/**
 * Map a 0..1 rail position to a seek target. Returns null when the timeline has
 * no usable length (live stream, duration not reported yet) so callers skip the
 * seek instead of jumping to 0.
 */
export function resolveSeekTargetSeconds(ratio: number, durationSeconds: number): number | null {
  if (!Number.isFinite(ratio) || !Number.isFinite(durationSeconds)) return null
  if (durationSeconds <= 0) return null
  if (ratio < 0 || ratio > 1) return null
  return Math.min(durationSeconds, Math.max(0, ratio * durationSeconds))
}
