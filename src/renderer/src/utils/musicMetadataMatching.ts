import type { Track } from '../types/music'

export type MetadataMatchConfidence = 'high' | 'medium'

export interface MetadataMatch {
  track: Track
  confidence: MetadataMatchConfidence
  score: number
}

interface IndexedMetadataMatch extends MetadataMatch {
  index: number
}

const EXACT_DURATION_TOLERANCE_SECONDS = 8
const LOOSE_DURATION_TOLERANCE_SECONDS = 20

export function findBestMetadataMatch(localTrack: Track, candidates: Track[]): MetadataMatch | null {
  const matches = candidates
    .map((candidate, index) => {
      const match = scoreMetadataMatch(localTrack, candidate)
      return match ? { ...match, index } : null
    })
    .filter((match): match is IndexedMetadataMatch => match !== null)
    .sort((left, right) => right.score - left.score || left.index - right.index)

  return matches[0] ?? null
}

export function enrichLocalTrackMetadata(localTrack: Track, match: MetadataMatch | null): Track {
  if (!match) return localTrack
  const metadata = match.track
  const enriched: Track = {
    ...localTrack,
    album: localTrack.album || metadata.album,
    cover: localTrack.cover ?? metadata.cover ?? null,
    lyrics: localTrack.lyrics ?? metadata.lyrics ?? null,
    translatedLyrics: localTrack.translatedLyrics ?? metadata.translatedLyrics ?? null
  }
  delete enriched.streamUrl
  return enriched
}

function scoreMetadataMatch(localTrack: Track, candidate: Track): MetadataMatch | null {
  const localTitle = normalizeMetadataText(localTrack.title)
  const candidateTitle = normalizeMetadataText(candidate.title)
  const localArtist = normalizeMetadataText(localTrack.artist)
  const candidateArtist = normalizeMetadataText(candidate.artist)
  if (!localTitle || !candidateTitle || localTitle !== candidateTitle) return null
  if (!localArtist || !candidateArtist || localArtist !== candidateArtist) return null

  const durationDelta = durationDeltaSeconds(localTrack, candidate)
  if (durationDelta != null && durationDelta > LOOSE_DURATION_TOLERANCE_SECONDS) return null

  let score = 70
  if (durationDelta == null) {
    score += 5
  } else if (durationDelta <= EXACT_DURATION_TOLERANCE_SECONDS) {
    score += 20
  } else {
    score += 8
  }
  if (metadataAvailable(candidate.cover)) score += 3
  if (metadataAvailable(candidate.lyrics)) score += 2
  if (metadataAvailable(candidate.translatedLyrics)) score += 1

  return {
    track: candidate,
    confidence: score >= 90 ? 'high' : 'medium',
    score
  }
}

function durationDeltaSeconds(left: Track, right: Track): number | null {
  if (!left.duration || !right.duration) return null
  return Math.abs(left.duration - right.duration)
}

function metadataAvailable(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeMetadataText(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}
