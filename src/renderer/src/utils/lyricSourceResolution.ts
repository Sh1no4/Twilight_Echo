import type { LyricSource, Track } from '../types/music'
import type { MediaProviderLyrics } from '../providers/mediaProvider'

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
  /** Final fallback when embedded/local/provider all miss. */
  loadOnlineLyrics?: () => Promise<string | null>
}

export async function resolveLyricsWithSources(
  options: ResolveLyricsWithSourcesOptions
): Promise<ResolvedLyricsWithSources> {
  const track = options.track
  let lyrics = normalizeLyricValue(track.lyrics)
  let translatedLyrics = normalizeLyricValue(track.translatedLyrics)
  let lyricsSource = lyrics ? (track.lyricsSource ?? 'embedded') : null
  let translatedLyricsSource = translatedLyrics ? (track.translatedLyricsSource ?? 'embedded') : null

  if (!lyrics && options.loadLocalLyrics) {
    const localLyrics = normalizeLyricValue(await loadOptionalLyrics(options.loadLocalLyrics))
    if (localLyrics) {
      lyrics = localLyrics
      lyricsSource = 'local'
    }
  }

  if ((!lyrics || !translatedLyrics) && options.loadProviderLyrics) {
    const providerLyrics = await loadOptionalProviderLyrics(options.loadProviderLyrics)
    if (!lyrics) {
      const providerOriginal = normalizeLyricValue(providerLyrics.lyrics)
      if (providerOriginal) {
        lyrics = providerOriginal
        lyricsSource = 'provider'
      }
    }
    // Prefer word-level timings when they come from the provider path only —
    // never overwrite local/embedded lyrics with provider word lyrics.
    const word = normalizeLyricValue(providerLyrics.wordLyrics)
    if (!lyrics && word) {
      lyrics = word
      lyricsSource = 'provider'
    } else if (lyricsSource === 'provider' && word) {
      lyrics = word
    }
    if (!translatedLyrics) {
      const providerTranslation = normalizeLyricValue(providerLyrics.translatedLyrics)
      if (providerTranslation) {
        translatedLyrics = providerTranslation
        translatedLyricsSource = 'provider'
      }
    }
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
