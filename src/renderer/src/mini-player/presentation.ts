import type {
  MiniPlayerLayoutPreference,
  MiniPlayerThemeProfile,
  MiniPlayerVisibilitySettings
} from '../../../shared/miniPlayer.ts'

export type MiniPlayerResolvedLayout = 'compact' | 'standard' | 'wide'
export type MiniPlayerCssVariables = Record<`--mini-${string}`, string>

export const MINI_PLAYER_STANDARD_MIN_WIDTH = 460
export const MINI_PLAYER_STANDARD_MIN_HEIGHT = 170
export const MINI_PLAYER_WIDE_MIN_WIDTH = 680
export const MINI_PLAYER_WIDE_MIN_HEIGHT = 240

export function resolveMiniPlayerLayout(
  width: number,
  height: number,
  preference: MiniPlayerLayoutPreference
): MiniPlayerResolvedLayout {
  const canUseStandard =
    width >= MINI_PLAYER_STANDARD_MIN_WIDTH && height >= MINI_PLAYER_STANDARD_MIN_HEIGHT
  const canUseWide = width >= MINI_PLAYER_WIDE_MIN_WIDTH && height >= MINI_PLAYER_WIDE_MIN_HEIGHT

  if (preference === 'compact') return 'compact'
  if (preference === 'standard') return canUseStandard ? 'standard' : 'compact'
  if (preference === 'wide') return canUseWide ? 'wide' : canUseStandard ? 'standard' : 'compact'
  return canUseWide ? 'wide' : canUseStandard ? 'standard' : 'compact'
}

export function resolveMiniPlayerVisibility(
  visibility: MiniPlayerVisibilitySettings,
  layout: MiniPlayerResolvedLayout
): MiniPlayerVisibilitySettings {
  const responsiveMask: MiniPlayerVisibilitySettings =
    layout === 'compact'
      ? {
          artwork: true,
          album: false,
          playbackState: false,
          equalizer: false,
          time: false,
          volume: false,
          playMode: true,
          queuePosition: false
        }
      : layout === 'standard'
        ? {
            artwork: true,
            album: true,
            playbackState: true,
            equalizer: true,
            time: true,
            volume: true,
            playMode: true,
            queuePosition: false
          }
        : {
            artwork: true,
            album: true,
            playbackState: true,
            equalizer: true,
            time: true,
            volume: true,
            playMode: true,
            queuePosition: true
          }

  return {
    artwork: visibility.artwork && responsiveMask.artwork,
    album: visibility.album && responsiveMask.album,
    playbackState: visibility.playbackState && responsiveMask.playbackState,
    equalizer: visibility.equalizer && responsiveMask.equalizer,
    time: visibility.time && responsiveMask.time,
    volume: visibility.volume && responsiveMask.volume,
    playMode: visibility.playMode && responsiveMask.playMode,
    queuePosition: visibility.queuePosition && responsiveMask.queuePosition
  }
}

export function readableTextColors(surfaceColor: string): { primary: string; muted: string } {
  const normalizedSurface = normalizeHexColor(surfaceColor, '#11121d')
  const light = '#ffffff'
  const dark = '#1b2034'
  const primary =
    contrastRatio(light, normalizedSurface) >= contrastRatio(dark, normalizedSurface) ? light : dark
  const mixedMuted = mixHexColors(primary, normalizedSurface, 0.34)
  const muted = contrastRatio(mixedMuted, normalizedSurface) >= 4.5 ? mixedMuted : primary
  return { primary, muted }
}

export function buildMiniPlayerCssVariables(
  profile: MiniPlayerThemeProfile,
  dominantColor: string,
  progress: number,
  volume: number
): MiniPlayerCssVariables {
  const accent =
    profile.appearance.accentMode === 'track'
      ? normalizeHexColor(dominantColor, profile.appearance.accentColor)
      : profile.appearance.accentColor
  const automaticText = readableTextColors(profile.background.fallbackColor)
  const primaryText =
    profile.appearance.textMode === 'custom'
      ? profile.appearance.primaryTextColor
      : automaticText.primary
  const mutedText =
    profile.appearance.textMode === 'custom'
      ? profile.appearance.mutedTextColor
      : automaticText.muted

  return {
    '--mini-track-accent': accent,
    '--mini-text': primaryText,
    '--mini-muted': mutedText,
    '--mini-window-radius': `${profile.appearance.cornerRadius}px`,
    '--mini-surface-opacity': `${profile.appearance.surfaceOpacity / 100}`,
    '--mini-glass-blur': `${profile.appearance.glassBlur}px`,
    '--mini-border-width': `${profile.appearance.borderWidth}px`,
    '--mini-border-color': profile.appearance.borderColor,
    '--mini-shadow-strength': `${profile.appearance.shadowStrength / 100}`,
    '--mini-background-opacity': `${profile.background.opacity / 100}`,
    '--mini-background-blur': `${profile.background.blur}px`,
    '--mini-background-brightness': `${profile.background.brightness}%`,
    '--mini-background-saturation': `${profile.background.saturation}%`,
    '--mini-background-overlay': hexToRgba(
      profile.background.overlayColor,
      profile.background.overlayOpacity / 100
    ),
    '--mini-background-fallback': profile.background.fallbackColor,
    '--mini-background-solid': profile.background.solidColor,
    '--mini-background-fit': profile.background.imageFit,
    '--mini-gradient-angle': `${profile.background.gradientAngle}deg`,
    '--mini-gradient-start': profile.background.gradientStart,
    '--mini-gradient-end': profile.background.gradientEnd,
    '--mini-progress': `${clampPercent(progress)}%`,
    '--mini-volume': `${clampPercent(volume)}%`
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value * 100) / 100))
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance(color: string): number {
  const [red, green, blue] = hexChannels(normalizeHexColor(color, '#000000')).map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function mixHexColors(foreground: string, background: string, backgroundWeight: number): string {
  const foregroundChannels = hexChannels(normalizeHexColor(foreground, '#ffffff'))
  const backgroundChannels = hexChannels(normalizeHexColor(background, '#000000'))
  const channels = foregroundChannels.map((channel, index) =>
    Math.round(channel * (1 - backgroundWeight) + backgroundChannels[index]! * backgroundWeight)
  )
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function hexToRgba(color: string, alpha: number): string {
  const [red, green, blue] = hexChannels(normalizeHexColor(color, '#000000'))
  return `rgba(${red}, ${green}, ${blue}, ${Math.min(1, Math.max(0, alpha))})`
}

function hexChannels(color: string): [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16)
  ]
}

function normalizeHexColor(value: string, fallback: string): string {
  return /^#[\da-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : fallback
}
