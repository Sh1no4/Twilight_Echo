export type TrackSource = 'local' | 'ncm'

export interface Track {
  id: string
  title: string
  artist: string
  album: string
  filePath: string
  fileName: string
  dir?: string
  duration: number
  size: number
  cover: string | null
  lyrics: string | null
  source?: TrackSource
  ncmSongId?: number
  streamUrl?: string | null
  format?: string
  sampleRate?: number
  bitrate?: number
  bitDepth?: number
}

export const SUPPORTED_EXTENSIONS = [
  '.mp3',
  '.flac',
  '.wav',
  '.aac',
  '.ogg',
  '.wma',
  '.m4a',
  '.aiff',
  '.aif',
  '.opus',
  '.webm',
  '.alac',
  '.ape',
  '.wv',
  '.dsf',
  '.dff'
]
