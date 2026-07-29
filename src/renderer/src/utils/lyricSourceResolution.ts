import type { LyricSource, Track } from '../types/music'
import type { MediaProviderLyrics } from '../providers/mediaProvider'

export type LyricResolverSource = 'automatic' | 'local' | 'provider'

export interface ResolvedLyricsWithSources {
  lyrics: string | null
  translatedLyrics: string | null
  lyricsSource: LyricSource | null
  translatedLyricsSource: LyricSource | null
}

export interface ResolveLyricsWithSourcesOptions {
  track: Track
  loadLocalLyrics?: () => Promise<string | null>
  loadProviderLyrics?: () => Promise<MediaProviderLyrics>
  originalSource?: LyricResolverSource
  translationSource?: LyricResolverSource
  /** Final fallback when embedded/local/provider all miss. */
  loadOnlineLyrics?: () => Promise<string | null>
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
  const localLyrics =
    shouldLoadLocal && options.loadLocalLyrics
      ? normalizeLyricValue(await loadOptionalLyrics(options.loadLocalLyrics))
      : null
  const providerLyrics =
    shouldLoadProvider && options.loadProviderLyrics
      ? await loadOptionalProviderLyrics(options.loadProviderLyrics)
      : null
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
    const onlineLyrics = normalizeLyricValue(await loadOptionalLyrics(options.loadOnlineLyrics))
    if (onlineLyrics) {
      lyrics = onlineLyrics
      lyricsSource = 'online'
    }
  }

  return {
    lyrics,
    translatedLyrics,
    lyricsSource,
    translatedLyricsSource
  }
}

function normalizeLyricValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  return value.length > 0 ? value : null
}

async function loadOptionalLyrics(loader: () => Promise<string | null>): Promise<string | null> {
  try {
    return await loader()
  } catch {
    return null
  }
}

async function loadOptionalProviderLyrics(
  loader: () => Promise<MediaProviderLyrics>
): Promise<MediaProviderLyrics> {
  try {
    return await loader()
  } catch {
    return { lyrics: null, translatedLyrics: null, wordLyrics: null }
  }
}
