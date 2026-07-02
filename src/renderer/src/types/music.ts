import type { PlaybackResumeMode, PlayMode } from './settings'

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
  format?: string
  sampleRate?: number
  bitrate?: number
  bitDepth?: number
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
