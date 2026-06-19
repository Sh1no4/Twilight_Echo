import type { PlaybackResumeMode } from './settings'

export type BuiltInTrackSource = 'local' | 'ncm'
export type TrackSource = BuiltInTrackSource | (string & {})

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
