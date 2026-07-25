import type { PlaybackResumeMode, PlayMode } from './settings'
import type { NcmPlaybackQuality } from './settings'
import type { SleepTimerState } from '../../../shared/sleepTimer.ts'
import type { CueRange, ParsedCueSheet } from '../../../shared/cue.ts'

export type BuiltInTrackSource = 'local' | 'ncm'
export type TrackSource = BuiltInTrackSource | (string & {})
export type LyricSource = 'embedded' | 'local' | 'provider' | 'manual' | 'online'
export type MetadataMatchConfidence = 'high' | 'medium'

export interface TrackMetadataMatch {
  providerId: string
  trackId: string
  confidence: MetadataMatchConfidence
  score: number
}

export interface BpmTempoSegment {
  startMs: number
  endMs: number
  bpm: number
  confidence: number
}

export interface BpmAnalysisResult {
  bpm: number
  confidence: number
  source: 'analyzed'
  analyzedAt: string
  algorithmVersion: number
  variableTempo?: boolean
  bpmRange?: [number, number]
  tempoMap?: BpmTempoSegment[]
}

export interface Track {
  id: string
  /**
   * Stable playback-queue entry identity. A track may occur more than once in
   * a queue, so UI commands must not use the provider track id as a row key.
   */
  queueEntryId?: string
  title: string
  artist: string
  album: string
  /** Primary genre tag; multi-value tags keep the first non-empty entry. */
  genre?: string | null
  /** Stable album owner for grouping compilation and guest-artist tracks. */
  albumArtist?: string
  /** Provider or scanner album identifier when one is available. */
  albumId?: string
  /** Disc index from tags (1-based). Used for album order. */
  discNumber?: number
  /** Track index on the disc from tags (1-based). Used for album order. */
  trackNumber?: number
  filePath: string
  fileName: string
  dir?: string
  subTrack?: string
  /** Explicit file segment for a single-file CUE sheet. Positions are relative to filePath. */
  cueRange?: CueRange
  cueSheetPath?: string
  cueEncoding?: ParsedCueSheet['encoding']
  duration: number
  size: number
  cover: string | null
  /**
   * Durable remote cover origin (http/https). When `cover` is a twilight-media
   * grant that dies after process restart, display code re-grants from this.
   */
  coverSource?: string | null
  lyrics: string | null
  translatedLyrics?: string | null
  romanizedLyrics?: string | null
  lyricsSource?: LyricSource | null
  translatedLyricsSource?: LyricSource | null
  romanizedLyricsSource?: LyricSource | null
  metadataMatch?: TrackMetadataMatch | null
  source?: TrackSource
  ncmSongId?: number
  streamUrl?: string | null
  streamQuality?: NcmPlaybackQuality
  format?: string
  sampleRate?: number
  bitrate?: number
  bitDepth?: number
  /** Versioned acoustic fingerprint extracted from a trusted media tag, when available. */
  audioFingerprint?: { algorithm: string; value: string }
  bpm?: number
  bpmAnalysis?: BpmAnalysisResult
  /** Unix time in milliseconds when this file first entered the local library. */
  addedAt?: number
  /** ReplayGain track gain in dB (from tags; cold-start track mode). */
  replayGainTrackGainDb?: number
  /** ReplayGain album gain in dB. */
  replayGainAlbumGainDb?: number
  /** ReplayGain track peak (linear ratio or dBTP-equivalent tag value). */
  replayGainTrackPeak?: number
  /** ReplayGain album peak. */
  replayGainAlbumPeak?: number
  /** R128 track gain in dB (EBU R128 / Opus style tags). */
  r128TrackGainDb?: number
  /** R128 album gain in dB. */
  r128AlbumGainDb?: number
}

export interface PlaybackSession {
  version: 1
  savedAt: string
  mode: PlaybackResumeMode
  playMode?: PlayMode
  track: Track
  position: number
  queue?: Track[]
  queueIndex?: number
  sleepTimer?: SleepTimerState
}

export const SUPPORTED_EXTENSIONS = [
  '.mp3',
  '.flac',
  '.wav',
  '.wave',
  '.aac',
  '.ogg',
  '.wma',
  '.m4a',
  '.mp4',
  '.aiff',
  '.aif',
  '.opus',
  '.webm',
  '.alac',
  '.ape',
  '.wv',
  '.dsf',
  '.dff',
  '.mqa'
]
