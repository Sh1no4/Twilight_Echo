import type { LyricSource, Track } from '../types/music'
import type { MediaProviderLyrics } from '../providers/mediaProvider'

export type LyricResolverSource = 'automatic' | 'local' | 'provider'

export interface ResolvedLyricsWithSources {
  lyrics: string | null
  translatedLyrics: string | null
  lyricsSource: LyricSource | null
  translatedLyricsSource: LyricSource | null
  /**
   * A source was requested but could not be reached. This is deliberately
   * distinct from a successful request that found no lyrics, so callers can
   * keep the track eligible for retry instead of permanently caching emptiness.
   */
  failure?: 'local' | 'provider' | 'online'
}

export interface ResolveLyricsWithSourcesOptions {
  track: Track
  loadLocalLyrics?: () => Promise<string | null>
  loadProviderLyrics?: () => Promise<MediaProviderLyrics>
  originalSource?: LyricResolverSource
  translationSource?: LyricResolverSource
  /** Final fallback when embedded/local/provider all miss. */
  loadOnlineLyrics?: () => Promise<string | null>
  /**
   * Companion translation lookup for the online fallback (e.g. NetEase
   * tlyric). Called only when online lyrics were applied and no translation
   * is available yet; a miss keeps the translation layer hidden.
   */
  loadOnlineTranslation?: () => Promise<string | null>
}

export async function resolveLyricsWithSources(
  options: ResolveLyricsWithSourcesOptions
): Promise<ResolvedLyricsWithSources> {
  const track = options.track
  const originalSource = options.originalSource ?? 'automatic'
  const translationSource = options.translationSource ?? 'automatic'
  let lyrics = normalizeLyricValue(track.lyrics)
  let translatedLyrics = normalizeLyricValue(track.translatedLyrics)
  let lyricsSource = lyrics ? (track.lyricsSource ?? 'embedded') : null
  let translatedLyricsSource = translatedLyrics
    ? (track.translatedLyricsSource ?? 'embedded')
    : null

  const shouldLoadLocal = originalSource === 'local' || (originalSource === 'automatic' && !lyrics)
  const shouldLoadProvider =
    originalSource === 'provider' ||
    translationSource === 'provider' ||
    (originalSource === 'automatic' && !lyrics) ||
    (translationSource === 'automatic' && !translatedLyrics)
  const localResult =
    shouldLoadLocal && options.loadLocalLyrics
      ? await loadOptionalLyrics(options.loadLocalLyrics)
      : { value: null, failed: false }
  const providerResult =
    shouldLoadProvider && options.loadProviderLyrics
      ? await loadOptionalProviderLyrics(options.loadProviderLyrics)
      : { value: null, failed: false }
  const localLyrics = normalizeLyricValue(localResult.value)
  const providerLyrics = providerResult.value
  const providerOriginal = normalizeLyricValue(providerLyrics?.lyrics)
  const providerWordLyrics = normalizeLyricValue(providerLyrics?.wordLyrics)
  const providerTranslation = normalizeLyricValue(providerLyrics?.translatedLyrics)

  if (originalSource === 'local') {
    lyrics = localLyrics
    lyricsSource = localLyrics ? 'local' : null
  } else if (originalSource === 'provider') {
    lyrics = providerWordLyrics ?? providerOriginal
    lyricsSource = lyrics ? 'provider' : null
  } else if (!lyrics && localLyrics) {
    lyrics = localLyrics
    lyricsSource = 'local'
  }

  if (originalSource === 'automatic' && providerLyrics) {
    if (!lyrics) {
      if (providerOriginal) {
        lyrics = providerOriginal
        lyricsSource = 'provider'
      }
    }
    // Prefer word-level timings when they come from the provider path only —
    // never overwrite local/embedded lyrics with provider word lyrics.
    if (!lyrics && providerWordLyrics) {
      lyrics = providerWordLyrics
      lyricsSource = 'provider'
    } else if (lyricsSource === 'provider' && providerWordLyrics) {
      lyrics = providerWordLyrics
    }
  }

  if (translationSource === 'provider') {
    translatedLyrics = providerTranslation
    translatedLyricsSource = providerTranslation ? 'provider' : null
  } else if (translationSource === 'local') {
    if (translatedLyricsSource !== 'local') {
      translatedLyrics = null
      translatedLyricsSource = null
    }
  } else if (!translatedLyrics && providerTranslation) {
    translatedLyrics = providerTranslation
    translatedLyricsSource = 'provider'
  }

  if (!lyrics && options.loadOnlineLyrics) {
    const onlineResult = await loadOptionalLyrics(options.loadOnlineLyrics)
    const onlineLyrics = normalizeLyricValue(onlineResult.value)
    if (onlineLyrics) {
      lyrics = onlineLyrics
      lyricsSource = 'online'
      if (!translatedLyrics && options.loadOnlineTranslation) {
        const onlineTranslationResult = await loadOptionalLyrics(options.loadOnlineTranslation)
        const onlineTranslation = normalizeLyricValue(onlineTranslationResult.value)
        if (onlineTranslation) {
          translatedLyrics = onlineTranslation
          translatedLyricsSource = 'online'
        }
      }
    }

    if (!lyrics && onlineResult.failed) {
      return {
        lyrics,
        translatedLyrics,
        lyricsSource,
        translatedLyricsSource,
        failure: 'online'
      }
    }
  }

  const resolved = {
    lyrics,
    translatedLyrics,
    lyricsSource,
    translatedLyricsSource
  }
  if (lyrics || translatedLyrics) return resolved
  if (providerResult.failed) return { ...resolved, failure: 'provider' as const }
  if (localResult.failed) return { ...resolved, failure: 'local' as const }
  return resolved
}

function normalizeLyricValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  return value.length > 0 ? value : null
}

interface OptionalLyricsLoad<T> {
  value: T | null
  failed: boolean
}

async function loadOptionalLyrics(
  loader: () => Promise<string | null>
): Promise<OptionalLyricsLoad<string>> {
  try {
    return { value: await loader(), failed: false }
  } catch {
    return { value: null, failed: true }
  }
}

async function loadOptionalProviderLyrics(
  loader: () => Promise<MediaProviderLyrics>
): Promise<OptionalLyricsLoad<MediaProviderLyrics>> {
  try {
    return { value: await loader(), failed: false }
  } catch {
    return { value: null, failed: true }
  }
}
