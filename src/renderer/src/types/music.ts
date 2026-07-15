import type { PlaybackResumeMode, PlayMode } from './settings'
import type { NcmPlaybackQuality } from './settings'

export type BuiltInTrackSource = 'local' | 'ncm'
export type TrackSource = BuiltInTrackSource | (string & {})
export type LyricSource = 'embedded' | 'local' | 'provider'
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
  title: string
  artist: string
  album: string
  filePath: string
  fileName: string
  dir?: string
  subTrack?: string
  duration: number
  size: number
  cover: string | null
  lyrics: string | null
  translatedLyrics?: string | null
  lyricsSource?: LyricSource | null
  translatedLyricsSource?: LyricSource | null
  metadataMatch?: TrackMetadataMatch | null
  source?: TrackSource
  ncmSongId?: number
  streamUrl?: string | null
  streamQuality?: NcmPlaybackQuality
  format?: string
  sampleRate?: number
  bitrate?: number
  bitDepth?: number
  bpm?: number
  bpmAnalysis?: BpmAnalysisResult
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
