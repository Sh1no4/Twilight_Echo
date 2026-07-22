import {
  TWILIGHT_DEFAULT_THEME,
  type ThemeLibrarySnapshot,
  type ThemeWindowDefaults
} from '../../shared/theme.ts'
import { cloneMiniPlayerSettings } from '../../shared/miniPlayer.ts'
import { runtime } from '../core/runtime.ts'
import type { AppSettings } from '../core/types.ts'

export async function createInheritedThemeSettingsPatch(
  snapshot: ThemeLibrarySnapshot
): Promise<Partial<AppSettings>> {
  const defaults = await resolveThemeWindowDefaults(snapshot)
  const patch: Partial<AppSettings> = {}

  if (snapshot.data.windowInheritance.miniPlayer) {
    const miniPlayer = cloneMiniPlayerSettings(runtime.appSettings.miniPlayer)
    const profile = miniPlayer.profiles[miniPlayer.activeStyleId]
    const appearance = defaults.miniPlayer
    if (profile && appearance) {
      miniPlayer.profiles[miniPlayer.activeStyleId] = {
        ...profile,
        appearance: {
          ...profile.appearance,
          ...(appearance.accentColor ? { accentColor: appearance.accentColor } : {}),
          ...(appearance.primaryTextColor ? { primaryTextColor: appearance.primaryTextColor } : {}),
          ...(appearance.mutedTextColor ? { mutedTextColor: appearance.mutedTextColor } : {}),
          ...(appearance.surfaceOpacity != null
            ? { surfaceOpacity: appearance.surfaceOpacity }
            : {}),
          ...(appearance.glassBlur != null ? { glassBlur: appearance.glassBlur } : {}),
          ...(appearance.cornerRadius != null ? { cornerRadius: appearance.cornerRadius } : {}),
          ...(appearance.borderWidth != null ? { borderWidth: appearance.borderWidth } : {}),
          ...(appearance.borderColor ? { borderColor: appearance.borderColor } : {}),
          ...(appearance.shadowStrength != null
            ? { shadowStrength: appearance.shadowStrength }
            : {})
        }
      }
      patch.miniPlayer = miniPlayer
    }
  }

  if (snapshot.data.windowInheritance.desktopLyrics && defaults.desktopLyrics) {
    const lyrics = defaults.desktopLyrics
    patch.desktopLyrics = {
      ...runtime.appSettings.desktopLyrics,
      ...(lyrics.fontFamily ? { fontFamily: lyrics.fontFamily } : {}),
      ...(lyrics.fontSize != null ? { fontSize: lyrics.fontSize } : {}),
      ...(lyrics.fontWeight != null ? { fontWeight: lyrics.fontWeight } : {}),
      ...(lyrics.color ? { color: lyrics.color } : {}),
      ...(lyrics.highlightColor ? { highlightColor: lyrics.highlightColor } : {}),
      ...(lyrics.backgroundColor ? { bgColor: lyrics.backgroundColor } : {}),
      ...(lyrics.backgroundOpacity != null ? { bgOpacity: lyrics.backgroundOpacity } : {}),
      ...(lyrics.shadow != null ? { shadow: lyrics.shadow } : {}),
      ...(lyrics.shadowBlur != null ? { shadowBlur: lyrics.shadowBlur } : {}),
      ...(lyrics.shadowColor ? { shadowColor: lyrics.shadowColor } : {})
    }
  }

  return patch
}

async function resolveThemeWindowDefaults(
  snapshot: ThemeLibrarySnapshot
): Promise<ThemeWindowDefaults> {
  const base = TWILIGHT_DEFAULT_THEME.windowDefaults ?? {}
  const selection = snapshot.data.activeTheme
  let selected: ThemeWindowDefaults | undefined
  if (selection.kind === 'user') {
    selected = snapshot.data.profiles.find((profile) => profile.id === selection.id)?.windowDefaults
  } else if (selection.kind === 'plugin') {
    await runtime.pluginManagerReady
    const extensions = (await runtime.pluginManager?.listExtensions()) ?? []
    selected = extensions
      .find((entry) => entry.pluginId === selection.pluginId)
      ?.themes.find((theme) => theme.id === selection.themeId)?.structured?.windowDefaults
  }
  return {
    miniPlayer: { ...base.miniPlayer, ...selected?.miniPlayer },
    desktopLyrics: { ...base.desktopLyrics, ...selected?.desktopLyrics }
  }
}
