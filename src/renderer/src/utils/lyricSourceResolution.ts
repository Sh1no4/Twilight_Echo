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
    const localLyrics = normalizeLyricValue(await options.loadLocalLyrics())
    if (localLyrics) {
      lyrics = localLyrics
      lyricsSource = 'local'
    }
  }

  if ((!lyrics || !translatedLyrics) && options.loadProviderLyrics) {
    const providerLyrics = await options.loadProviderLyrics()
    if (!lyrics) {
      const providerOriginal = normalizeLyricValue(providerLyrics.lyrics)
      if (providerOriginal) {
        lyrics = providerOriginal
        lyricsSource = 'provider'
      }
    }
    if (!translatedLyrics) {
      const providerTranslation = normalizeLyricValue(providerLyrics.translatedLyrics)
      if (providerTranslation) {
        translatedLyrics = providerTranslation
        translatedLyricsSource = 'provider'
      }
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

