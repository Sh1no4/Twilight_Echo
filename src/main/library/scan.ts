import { readdirSync, statSync, readFileSync, existsSync } from 'fs'
import { stat } from 'fs/promises'
import { join, extname, basename, dirname, resolve } from 'path'
import { randomUUID } from 'crypto'
import { parseFile } from 'music-metadata'
import { runtime } from '../core/runtime'
import { cacheCoverFromBuffer, findCoverInDir } from './coverCache'

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
  '.mqa',
  '.iso'
]

export function encodeAudioFileUrlPath(filePath: string): string {
  return Buffer.from(filePath, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

export function decodeAudioFileUrlPath(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='), 'base64').toString(
    'utf-8'
  )
}

export async function resolvePlayableAudioFile(filePath: string): Promise<string> {
  const resolvedPath = resolve(filePath)
  const fileStat = await stat(resolvedPath)
  if (!fileStat.isFile()) {
    throw new Error('音频路径不是文件')
  }
  if (!SUPPORTED_EXTENSIONS.includes(extname(resolvedPath).toLowerCase())) {
    throw new Error('不支持的音频文件类型')
  }
  return resolvedPath
}

export function findLyricsInDir(dir: string, musicFileName: string): string | null {
  const baseName = basename(musicFileName, extname(musicFileName))
  const lrcPath = join(dir, baseName + '.lrc')
  if (!existsSync(lrcPath)) return null
  try {
    return readFileSync(lrcPath, 'utf-8')
  } catch {
    return null
  }
}

export function getNameFromFile(filePath: string): { artist: string; title: string } {
  const ext = extname(filePath)
  const nameWithoutExt = basename(filePath, ext)
  const dashIndex = nameWithoutExt.indexOf(' - ')
  if (dashIndex > 0) {
    return {
      artist: nameWithoutExt.substring(0, dashIndex).trim(),
      title: nameWithoutExt.substring(dashIndex + 3).trim()
    }
  }
  return { artist: '未知艺术家', title: nameWithoutExt }
}

function normalizeBpm(value: unknown): number | undefined {
  const numeric = typeof value === 'string' ? Number(value.trim()) : Number(value)
  if (!Number.isFinite(numeric) || numeric < 30 || numeric > 300) return undefined
  return Math.round(numeric * 10) / 10
}

function normalizeGainDb(value: unknown): number | undefined {
  if (value == null) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100) / 100
  }
  if (typeof value === 'object' && value !== null && 'dB' in value) {
    const db = Number((value as { dB?: unknown }).dB)
    if (Number.isFinite(db)) return Math.round(db * 100) / 100
  }
  if (typeof value === 'string') {
    const match = value.trim().match(/(-?\d+(?:\.\d+)?)/)
    if (!match) return undefined
    const db = Number(match[1])
    if (!Number.isFinite(db)) return undefined
    return Math.round(db * 100) / 100
  }
  return undefined
}

function normalizePeak(value: unknown): number | undefined {
  if (value == null) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 1_000_000) / 1_000_000
  }
  if (typeof value === 'object' && value !== null && 'ratio' in value) {
    const ratio = Number((value as { ratio?: unknown }).ratio)
    if (Number.isFinite(ratio)) return Math.round(ratio * 1_000_000) / 1_000_000
  }
  if (typeof value === 'string') {
    const match = value.trim().match(/(-?\d+(?:\.\d+)?)/)
    if (!match) return undefined
    const peak = Number(match[1])
    if (!Number.isFinite(peak)) return undefined
    return Math.round(peak * 1_000_000) / 1_000_000
  }
  return undefined
}

/** R128_*_GAIN is often stored as Q7.8 integer (1/256 dB). Detect and convert. */
function normalizeR128GainDb(value: unknown): number | undefined {
  if (value == null) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Heuristic: |value| > 64 likely Q7.8 integer
    const db = Math.abs(value) > 64 ? value / 256 : value
    return Math.round(db * 100) / 100
  }
  if (typeof value === 'string') {
    const match = value.trim().match(/(-?\d+(?:\.\d+)?)/)
    if (!match) return undefined
    const raw = Number(match[1])
    if (!Number.isFinite(raw)) return undefined
    const db = Math.abs(raw) > 64 ? raw / 256 : raw
    return Math.round(db * 100) / 100
  }
  return undefined
}

function extractNativeTagValue(
  native: Record<string, Array<{ id?: string; value?: unknown }> | undefined> | undefined,
  ids: string[]
): unknown {
  if (!native) return undefined
  const wanted = new Set(ids.map((id) => id.toUpperCase()))
  for (const tags of Object.values(native)) {
    if (!Array.isArray(tags)) continue
    for (const tag of tags) {
      const id = typeof tag?.id === 'string' ? tag.id.toUpperCase() : ''
      if (wanted.has(id)) return tag.value
    }
  }
  return undefined
}

export function extractReplayGainTags(meta: {
  common?: Record<string, unknown>
  format?: Record<string, unknown>
  native?: Record<string, Array<{ id?: string; value?: unknown }> | undefined>
}): {
  replayGainTrackGainDb?: number
  replayGainAlbumGainDb?: number
  replayGainTrackPeak?: number
  replayGainAlbumPeak?: number
  r128TrackGainDb?: number
  r128AlbumGainDb?: number
} {
  const common = meta.common ?? {}
  const format = meta.format ?? {}
  const result: {
    replayGainTrackGainDb?: number
    replayGainAlbumGainDb?: number
    replayGainTrackPeak?: number
    replayGainAlbumPeak?: number
    r128TrackGainDb?: number
    r128AlbumGainDb?: number
  } = {}

  const trackGain =
    normalizeGainDb(common.replaygain_track_gain) ??
    normalizeGainDb(format.trackGain) ??
    normalizeGainDb(
      extractNativeTagValue(meta.native, ['REPLAYGAIN_TRACK_GAIN', 'replaygain_track_gain'])
    )
  const albumGain =
    normalizeGainDb(common.replaygain_album_gain) ??
    normalizeGainDb(format.albumGain) ??
    normalizeGainDb(
      extractNativeTagValue(meta.native, ['REPLAYGAIN_ALBUM_GAIN', 'replaygain_album_gain'])
    )
  const trackPeak =
    normalizePeak(common.replaygain_track_peak) ??
    normalizePeak(format.trackPeakLevel) ??
    normalizePeak(
      extractNativeTagValue(meta.native, ['REPLAYGAIN_TRACK_PEAK', 'replaygain_track_peak'])
    )
  const albumPeak =
    normalizePeak(common.replaygain_album_peak) ??
    normalizePeak(
      extractNativeTagValue(meta.native, ['REPLAYGAIN_ALBUM_PEAK', 'replaygain_album_peak'])
    )
  const r128Track =
    normalizeR128GainDb(extractNativeTagValue(meta.native, ['R128_TRACK_GAIN', 'r128_track_gain']))
  const r128Album =
    normalizeR128GainDb(extractNativeTagValue(meta.native, ['R128_ALBUM_GAIN', 'r128_album_gain']))

  if (trackGain !== undefined) result.replayGainTrackGainDb = trackGain
  if (albumGain !== undefined) result.replayGainAlbumGainDb = albumGain
  if (trackPeak !== undefined) result.replayGainTrackPeak = trackPeak
  if (albumPeak !== undefined) result.replayGainAlbumPeak = albumPeak
  if (r128Track !== undefined) result.r128TrackGainDb = r128Track
  if (r128Album !== undefined) result.r128AlbumGainDb = r128Album
  return result
}

export interface FileEntry {
  fullPath: string
  fileName: string
  dir: string
  size: number
}

export async function collectFilesAsync(dirPath: string): Promise<FileEntry[]> {
  const results: FileEntry[] = []
  const queue: string[] = [dirPath]

  while (queue.length > 0) {
    const currentDir = queue.shift()!
    try {
      const entries = readdirSync(currentDir)
      for (const entry of entries) {
        const fullPath = join(currentDir, entry)
        try {
          const st = statSync(fullPath)
          if (st.isDirectory()) {
            queue.push(fullPath)
          } else if (st.isFile()) {
            const ext = extname(entry).toLowerCase()
            if (SUPPORTED_EXTENSIONS.includes(ext)) {
              results.push({
                fullPath,
                fileName: entry,
                dir: dirname(fullPath),
                size: st.size
              })
            }
          }
        } catch {
          /* skip */
        }
        // Yield to event loop every few files
        if (results.length % 100 === 0) {
          await new Promise((resolve) => setImmediate(resolve))
        }
      }
    } catch {
      /* skip */
    }
  }
  return results
}

export async function parseTrack(file: FileEntry): Promise<unknown[]> {
  const ext = file.fileName.toLowerCase()
  if (ext.endsWith('.iso')) {
    try {
      const meta = await runtime.audioEngineManager?.getMetadataAsync(file.fullPath)
      if (meta && meta.isoTracks && meta.isoTracks.length > 0) {
        return meta.isoTracks.filter(isoTrack => isoTrack.playable !== false).map(isoTrack => {
          return {
            id: randomUUID(),
            title: isoTrack.title || 'Unknown Track',
            artist: isoTrack.artist || 'Unknown Artist',
            album: isoTrack.album || 'Unknown Album',
            filePath: file.fullPath,
            fileName: file.fileName,
            dir: file.dir,
            duration: Math.round(isoTrack.duration || 0),
            size: file.size,
            cover: findCoverInDir(file.dir),
            lyrics: findLyricsInDir(file.dir, file.fileName),
            format: isoTrack.container || 'SACD ISO',
            sampleRate: isoTrack.sampleRate,
            bitDepth: isoTrack.bitDepth || 1,
            subTrack: isoTrack.source
          }
        })
      }
    } catch {
      /* fallback below */
    }
  }

  const id = randomUUID()
  try {
    const meta = await parseFile(file.fullPath, { skipCovers: false })
    const common = meta.common

    let cover: string | null = null

    if (common.picture && common.picture.length > 0) {
      const pic = common.picture[0]
      cover = cacheCoverFromBuffer(Buffer.from(pic.data))
    }

    if (!cover) {
      cover = findCoverInDir(file.dir)
    }

    const artist = common.artist || common.albumartist
    const title = common.title
    const album = common.album
    const bpm = normalizeBpm(common.bpm)
    const replayGainTags = extractReplayGainTags({
      common: common as Record<string, unknown>,
      format: meta.format as Record<string, unknown>,
      native: meta.native as
        | Record<string, Array<{ id?: string; value?: unknown }> | undefined>
        | undefined
    })

    const fileName = getNameFromFile(file.fullPath)

    // Lyrics are NOT loaded during scan — they're lazy-loaded on playback
    // to avoid keeping hundreds of MB of LRC text in memory permanently.

    const track: Record<string, unknown> = {
      id,
      title: title || fileName.title,
      artist: artist || fileName.artist,
      album: album || '未知专辑',
      filePath: file.fullPath,
      fileName: file.fileName,
      dir: file.dir,
      duration: Math.round(meta.format.duration || 0),
      size: file.size,
      cover,
      lyrics: null,
      format: meta.format.container,
      sampleRate: meta.format.sampleRate,
      bitrate: meta.format.bitrate,
      bitDepth: meta.format.bitsPerSample,
      ...replayGainTags
    }
    if (bpm !== undefined) track.bpm = bpm
    return [track]
  } catch {
    const fileName = getNameFromFile(file.fullPath)
    return [{
      id,
      title: fileName.title,
      artist: fileName.artist,
      album: '未知专辑',
      filePath: file.fullPath,
      fileName: file.fileName,
      dir: file.dir,
      duration: 0,
      size: file.size,
      cover: findCoverInDir(file.dir),
      lyrics: null
    }]
  }
}

export async function scanDirectory(
  dirPath: string,
  onProgress?: (current: number, total: number) => void
): Promise<unknown[]> {
  const files = await collectFilesAsync(dirPath)
  const total = files.length
  const results: unknown[] = []
  const batchSize = 10

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map(parseTrack))
    results.push(...batchResults.flat())

    if (onProgress) {
      onProgress(results.length, total)
    }

    // Small delay to keep UI responsive
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return results
}

export function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  const mime: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.wave': 'audio/wav',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.wma': 'audio/x-ms-wma',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
    '.aiff': 'audio/aiff',
    '.aif': 'audio/aiff',
    '.opus': 'audio/opus',
    '.webm': 'audio/webm',
    '.alac': 'audio/mp4',
    '.ape': 'audio/ape',
    '.wv': 'audio/wavpack',
    '.dsf': 'audio/dsf',
    '.dff': 'audio/dsf',
    '.mqa': 'audio/flac'
  }
  return mime[ext] || 'application/octet-stream'
}
