import { createHash, randomUUID } from 'crypto'
import type { Dirent } from 'fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, join, resolve } from 'path'
import { parseFile } from 'music-metadata'
import {
  type LocalLibraryFileIdentity,
  type LocalLibraryScanWorkerMessage,
  type LocalLibraryScanWorkerRequest,
  type LocalLibraryWorkerScanRequest,
  type LocalLibraryWorkerScanResult
} from '../../shared/localLibraryScan.ts'
import { SUPPORTED_EXTENSIONS } from './libraryFiles.ts'
import { deriveCueTracks } from './cueLibrary.ts'
import { createLocalLibraryScanPlan } from './scanPlanner.ts'

type ParentPort = {
  postMessage: (message: LocalLibraryScanWorkerMessage) => void
  on: (event: 'message', listener: (message: LocalLibraryScanWorkerRequest) => void) => void
}

type ElectronParentPort = {
  postMessage: ParentPort['postMessage']
  on: (event: 'message', listener: (event: { data: LocalLibraryScanWorkerRequest }) => void) => void
}

type NodeIpcProcess = {
  send?: ParentPort['postMessage']
  on?: (event: 'message', listener: (message: LocalLibraryScanWorkerRequest) => void) => void
}

type ScanControl = {
  paused: boolean
  cancelled: boolean
  resume: (() => void) | null
}

const workerParentPort = (process as unknown as { parentPort?: ElectronParentPort }).parentPort
const nodeIpc = process as unknown as NodeIpcProcess
const parentPort: ParentPort | null = workerParentPort
  ? {
      postMessage: (message) => workerParentPort.postMessage(message),
      on: (_event, listener) => workerParentPort.on('message', (event) => listener(event.data))
    }
  : typeof nodeIpc.send === 'function' && typeof nodeIpc.on === 'function'
    ? {
        postMessage: (message) => nodeIpc.send?.(message),
        on: (_event, listener) => nodeIpc.on?.('message', listener)
      }
    : null

if (!parentPort) {
  throw new Error('Twilight local library scan service requires an Electron or Node parent port')
}

const servicePort = parentPort
const activeScans = new Map<string, ScanControl>()
const coverHandlesByDirectory = new Map<string, string | null>()
const MAX_COVER_BYTES = 20 * 1024 * 1024

servicePort.postMessage({ kind: 'ready' })
servicePort.on('message', (message) => {
  if (message.kind === 'scan') {
    void handleScan(message.requestId, message.request)
    return
  }
  const control = activeScans.get(message.requestId)
  if (!control) return
  if (message.kind === 'pause') {
    control.paused = true
    return
  }
  if (message.kind === 'resume') {
    control.paused = false
    control.resume?.()
    control.resume = null
    return
  }
  control.cancelled = true
  control.paused = false
  control.resume?.()
  control.resume = null
})

async function handleScan(
  requestId: string,
  request: LocalLibraryWorkerScanRequest
): Promise<void> {
  const control: ScanControl = { paused: false, cancelled: false, resume: null }
  activeScans.set(requestId, control)
  try {
    const value = await runScan(requestId, request, control)
    servicePort.postMessage({ kind: 'response', requestId, ok: true, value })
  } catch (error) {
    servicePort.postMessage({
      kind: 'response',
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  } finally {
    activeScans.delete(requestId)
  }
}

async function runScan(
  requestId: string,
  request: LocalLibraryWorkerScanRequest,
  control: ScanControl
): Promise<LocalLibraryWorkerScanResult> {
  const collected = await collectIdentities(requestId, request, control)
  if (control.cancelled) return cancelledResult(request.mode, collected.completeIdentitySnapshot)

  const plan = createLocalLibraryScanPlan({
    mode: request.mode,
    identities: collected.identities,
    knownIdentities: request.knownIdentities,
    knownTrackPaths: request.knownTrackPaths,
    excludedPaths: request.excludedPaths,
    forceParse: request.forceParse,
    changes: request.changes,
    completeIdentitySnapshot: collected.completeIdentitySnapshot
  })
  const parsedTracks: unknown[] = []
  let parsedFileCount = 0
  const total = plan.parseFilePaths.length

  for (let index = 0; index < plan.parseFilePaths.length; index += 1) {
    await waitUntilRunnable(control)
    if (control.cancelled) return cancelledResult(request.mode, collected.completeIdentitySnapshot)
    const filePath = plan.parseFilePaths[index]
    const identity = collected.byPath.get(normalizePath(filePath))
    if (identity) {
      parsedTracks.push(...(await parseTrack(identity, request.coverCacheDir)))
      parsedFileCount += 1
    }
    servicePort.postMessage({
      kind: 'progress',
      requestId,
      progress: {
        phase: 'parsing',
        current: index + 1,
        total,
        parsedFileCount,
        skippedUnchanged: plan.skippedUnchanged
      }
    })
  }

  return {
    mode: request.mode,
    completeIdentitySnapshot: collected.completeIdentitySnapshot,
    identities: collected.identities,
    parsedTracks,
    parsedFilePaths: plan.parseFilePaths,
    removedFilePaths: Array.from(
      new Set([...plan.removedFilePaths, ...collected.disappearedFilePaths])
    ),
    skippedUnchanged: plan.skippedUnchanged,
    parsedFileCount,
    cancelled: false
  }
}

async function collectIdentities(
  requestId: string,
  request: LocalLibraryWorkerScanRequest,
  control: ScanControl
): Promise<{
  identities: LocalLibraryFileIdentity[]
  byPath: Map<string, LocalLibraryFileIdentity>
  completeIdentitySnapshot: boolean
  disappearedFilePaths: string[]
}> {
  const byPath = new Map<string, LocalLibraryFileIdentity>()
  const cueSignatureCache = new Map<string, Promise<string | undefined>>()
  const hasReconcileChange = (request.changes ?? []).some((change) => change.kind === 'reconcile')
  const completeIdentitySnapshot =
    request.mode !== 'watch' || !request.changes?.length || hasReconcileChange
  let unreadableCount = 0
  const report = (current: number): void => {
    servicePort.postMessage({
      kind: 'progress',
      requestId,
      progress: {
        phase: 'enumerating',
        current,
        total: 0,
        parsedFileCount: 0,
        skippedUnchanged: 0
      }
    })
  }

  if (!completeIdentitySnapshot) {
    let current = 0
    const disappearedFilePaths: string[] = []
    for (const change of request.changes ?? []) {
      await waitUntilRunnable(control)
      if (control.cancelled) break
      if (change.kind === 'remove' && extname(change.path).toLowerCase() !== '.cue') {
        current += 1
        report(current)
        continue
      }
      try {
        if (extname(change.path).toLowerCase() === '.cue') {
          const directory = dirname(resolve(change.path))
          cueSignatureCache.delete(normalizePath(directory))
          const entries = await readdir(directory, { withFileTypes: true })
          for (const entry of entries) {
            if (
              !entry.isFile() ||
              !SUPPORTED_EXTENSIONS.includes(extname(entry.name).toLowerCase())
            ) {
              continue
            }
            const identity = await readSupportedFileIdentity(
              join(directory, entry.name),
              cueSignatureCache
            )
            if (identity) byPath.set(normalizePath(identity.filePath), identity)
          }
        } else {
          const identity = await readSupportedFileIdentity(change.path, cueSignatureCache)
          if (identity) byPath.set(normalizePath(identity.filePath), identity)
        }
      } catch (error) {
        if (isMissingPathError(error)) disappearedFilePaths.push(change.path)
        else unreadableCount += 1
      }
      current += 1
      report(current)
    }
    if (unreadableCount > 0) {
      throw new Error(`Local library watcher could not inspect ${unreadableCount} changed path(s)`)
    }
    return {
      identities: Array.from(byPath.values()),
      byPath,
      completeIdentitySnapshot,
      disappearedFilePaths
    }
  }

  const queue = Array.from(new Set(request.roots.map((root) => resolve(root))))
  let current = 0
  while (queue.length > 0) {
    await waitUntilRunnable(control)
    if (control.cancelled) break
    const directory = queue.shift()!
    let entries: Dirent[]
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      unreadableCount += 1
      continue
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      await waitUntilRunnable(control)
      if (control.cancelled) break
      const fullPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        queue.push(fullPath)
      } else if (entry.isFile()) {
        try {
          const identity = await readSupportedFileIdentity(fullPath, cueSignatureCache)
          if (identity) byPath.set(normalizePath(identity.filePath), identity)
        } catch {
          unreadableCount += 1
        }
      }
      current += 1
      if (current % 32 === 0) report(current)
    }
  }
  report(current)
  if (unreadableCount > 0) {
    throw new Error(
      `Local library enumeration was incomplete (${unreadableCount} unreadable path(s))`
    )
  }
  return {
    identities: Array.from(byPath.values()),
    byPath,
    completeIdentitySnapshot,
    disappearedFilePaths: []
  }
}

async function readSupportedFileIdentity(
  filePath: string,
  cueSignatureCache: Map<string, Promise<string | undefined>>
): Promise<LocalLibraryFileIdentity | null> {
  if (!SUPPORTED_EXTENSIONS.includes(extname(filePath).toLowerCase())) return null
  const info = await stat(filePath)
  if (!info.isFile()) return null
  const resolvedPath = resolve(filePath)
  const identity: LocalLibraryFileIdentity = {
    filePath: resolvedPath,
    size: info.size,
    mtimeMs: info.mtimeMs
  }
  const directory = dirname(resolvedPath)
  const cacheKey = normalizePath(directory)
  let pendingSignature = cueSignatureCache.get(cacheKey)
  if (!pendingSignature) {
    pendingSignature = readCueDependencySignature(directory)
    cueSignatureCache.set(cacheKey, pendingSignature)
  }
  const cueSignature = await pendingSignature
  if (cueSignature) identity.cueSignature = cueSignature
  return identity
}

async function readCueDependencySignature(directory: string): Promise<string | undefined> {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.cue')
    .sort((left, right) => left.name.localeCompare(right.name))
  if (entries.length === 0) return undefined

  const hash = createHash('sha256')
  let retained = 0
  for (const entry of entries) {
    try {
      const info = await stat(join(directory, entry.name))
      if (!info.isFile()) continue
      retained += 1
      hash.update(entry.name)
      hash.update('\0')
      hash.update(String(info.size))
      hash.update('\0')
      hash.update(String(info.mtimeMs))
      hash.update('\0')
    } catch (error) {
      if (!isMissingPathError(error)) throw error
    }
  }
  return retained > 0 ? hash.digest('hex') : undefined
}

function isMissingPathError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

async function parseTrack(
  file: LocalLibraryFileIdentity,
  coverCacheDir: string
): Promise<Record<string, unknown>[]> {
  const filePath = file.filePath
  const fileName = basename(filePath)
  const dir = dirname(filePath)
  const fallback = getNameFromFile(filePath)
  const baseTrack: Record<string, unknown> = {
    id: randomUUID(),
    title: fallback.title,
    artist: fallback.artist,
    album: 'Unknown Album',
    filePath,
    fileName,
    dir,
    duration: 0,
    size: file.size,
    addedAt: Date.now(),
    cover: await findCoverInDir(dir, coverCacheDir),
    lyrics: null
  }

  try {
    const metadata = await parseFile(filePath, { skipCovers: false })
    const picture = metadata.common.picture?.[0]
    const embeddedCover = picture
      ? await cacheCoverFromBuffer(Buffer.from(picture.data), coverCacheDir)
      : null
    const replayGainTags = extractReplayGainTags({
      common: {
        replaygain_track_gain: metadata.common.replaygain_track_gain,
        replaygain_album_gain: metadata.common.replaygain_album_gain,
        replaygain_track_peak: metadata.common.replaygain_track_peak,
        replaygain_album_peak: metadata.common.replaygain_album_peak
      },
      format: {
        trackGain: metadata.format.trackGain,
        albumGain: metadata.format.albumGain,
        trackPeakLevel: metadata.format.trackPeakLevel
      },
      native: metadata.native
    })
    const audioFingerprint = extractAcousticFingerprint(metadata.native)
    const bpm = normalizeBpm(metadata.common.bpm)
    const track: Record<string, unknown> = {
      ...baseTrack,
      title: metadata.common.title || fallback.title,
      artist: metadata.common.artist || metadata.common.albumartist || fallback.artist,
      album: metadata.common.album || 'Unknown Album',
      albumArtist: metadata.common.albumartist || metadata.common.artist || fallback.artist,
      genre: extractGenre(metadata.common.genre),
      duration: Math.round(metadata.format.duration || 0),
      cover: embeddedCover ?? baseTrack.cover,
      format: metadata.format.container,
      sampleRate: metadata.format.sampleRate,
      bitrate: metadata.format.bitrate,
      bitDepth: metadata.format.bitsPerSample,
      ...replayGainTags
    }
    if (bpm !== undefined) track.bpm = bpm
    if (audioFingerprint) track.audioFingerprint = audioFingerprint
    const cueTracks = deriveCueTracks(
      filePath,
      Number(metadata.format.duration ?? 0),
      track,
      SUPPORTED_EXTENSIONS
    )
    if (cueTracks) return cueTracks
    return [track]
  } catch {
    return [baseTrack]
  }
}

async function findCoverInDir(dir: string, coverCacheDir: string): Promise<string | null> {
  const cached = coverHandlesByDirectory.get(dir)
  if (cached !== undefined) return cached
  for (const name of COVER_NAMES) {
    try {
      const handle = await cacheCoverFromBuffer(await readFile(join(dir, name)), coverCacheDir)
      if (handle) {
        coverHandlesByDirectory.set(dir, handle)
        return handle
      }
    } catch {
      // Try the next conventional folder cover name.
    }
  }
  coverHandlesByDirectory.set(dir, null)
  return null
}

async function cacheCoverFromBuffer(data: Buffer, coverCacheDir: string): Promise<string | null> {
  try {
    if (data.byteLength === 0 || data.byteLength > MAX_COVER_BYTES) return null
    const extension = detectCoverExtension(data)
    if (!extension) return null
    const hash = createHash('sha256').update(data).digest('hex').slice(0, 24)
    const fileName = `${hash}.${extension}`
    await mkdir(coverCacheDir, { recursive: true })
    await writeIfMissing(join(coverCacheDir, fileName), data)
    return `cover://${fileName}`
  } catch {
    return null
  }
}

function detectCoverExtension(data: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg'
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png'
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}

async function writeIfMissing(filePath: string, data: Buffer): Promise<void> {
  try {
    await stat(filePath)
  } catch {
    await writeFile(filePath, data)
  }
}

async function waitUntilRunnable(control: ScanControl): Promise<void> {
  while (control.paused && !control.cancelled) {
    await new Promise<void>((resolve) => {
      control.resume = resolve
    })
  }
}

function cancelledResult(
  mode: LocalLibraryWorkerScanRequest['mode'],
  completeIdentitySnapshot: boolean
): LocalLibraryWorkerScanResult {
  return {
    mode,
    completeIdentitySnapshot,
    identities: [],
    parsedTracks: [],
    parsedFilePaths: [],
    removedFilePaths: [],
    skippedUnchanged: 0,
    parsedFileCount: 0,
    cancelled: true
  }
}

function normalizePath(filePath: string): string {
  const normalized = resolve(filePath)
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

function getNameFromFile(filePath: string): { artist: string; title: string } {
  const name = basename(filePath, extname(filePath))
  const divider = name.indexOf(' - ')
  if (divider > 0) {
    return {
      artist: name.slice(0, divider).trim(),
      title: name.slice(divider + 3).trim()
    }
  }
  return { artist: 'Unknown Artist', title: name }
}

function normalizeBpm(value: unknown): number | undefined {
  const numeric = typeof value === 'string' ? Number(value.trim()) : Number(value)
  if (!Number.isFinite(numeric) || numeric < 30 || numeric > 300) return undefined
  return Math.round(numeric * 10) / 10
}

/** music-metadata exposes genre as string | string[]; keep the first non-empty value. */
function extractGenre(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== 'string') continue
      const trimmed = entry.trim()
      if (trimmed) return trimmed
    }
  }
  return null
}

function extractReplayGainTags(meta: {
  common?: Record<string, unknown>
  format?: Record<string, unknown>
  native?: Record<string, Array<{ id?: string; value?: unknown }> | undefined>
}): Record<string, number> {
  const common = meta.common ?? {}
  const format = meta.format ?? {}
  const result: Record<string, number> = {}
  const native = (ids: string[]): unknown => extractNativeTagValue(meta.native, ids)
  assign(
    result,
    'replayGainTrackGainDb',
    normalizeGainDb(common.replaygain_track_gain) ??
      normalizeGainDb(format.trackGain) ??
      normalizeGainDb(native(['REPLAYGAIN_TRACK_GAIN']))
  )
  assign(
    result,
    'replayGainAlbumGainDb',
    normalizeGainDb(common.replaygain_album_gain) ??
      normalizeGainDb(format.albumGain) ??
      normalizeGainDb(native(['REPLAYGAIN_ALBUM_GAIN']))
  )
  assign(
    result,
    'replayGainTrackPeak',
    normalizePeak(common.replaygain_track_peak) ??
      normalizePeak(format.trackPeakLevel) ??
      normalizePeak(native(['REPLAYGAIN_TRACK_PEAK']))
  )
  assign(
    result,
    'replayGainAlbumPeak',
    normalizePeak(common.replaygain_album_peak) ?? normalizePeak(native(['REPLAYGAIN_ALBUM_PEAK']))
  )
  assign(result, 'r128TrackGainDb', normalizeR128GainDb(native(['R128_TRACK_GAIN'])))
  assign(result, 'r128AlbumGainDb', normalizeR128GainDb(native(['R128_ALBUM_GAIN'])))
  return result
}

function assign(target: Record<string, number>, key: string, value: number | undefined): void {
  if (value !== undefined) target[key] = value
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
      if (typeof tag?.id === 'string' && wanted.has(tag.id.toUpperCase())) return tag.value
    }
  }
  return undefined
}

/**
 * Reads an existing Chromaprint/AcoustID tag. The scanner does not decode samples to validate the
 * tag, so persisted tag data remains a review-only candidate rather than trusted acoustic proof.
 */
function extractAcousticFingerprint(
  native: Record<string, Array<{ id?: string; value?: unknown }> | undefined> | undefined
): { algorithm: 'chromaprint-v1'; value: string; evidence: 'metadataCandidate' } | undefined {
  const value = extractNativeTagValue(native, ['ACOUSTID_FINGERPRINT', 'CHROMAPRINT_FINGERPRINT'])
  if (typeof value !== 'string') return undefined
  const fingerprint = value.trim()
  if (!fingerprint || fingerprint.length > 16_384) return undefined
  return { algorithm: 'chromaprint-v1', value: fingerprint, evidence: 'metadataCandidate' }
}

function normalizeGainDb(value: unknown): number | undefined {
  if (value == null) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100) / 100
  if (typeof value === 'object' && value !== null && 'dB' in value) {
    const db = Number((value as { dB?: unknown }).dB)
    return Number.isFinite(db) ? Math.round(db * 100) / 100 : undefined
  }
  return parseNumericValue(value, (numeric) => Math.round(numeric * 100) / 100)
}

function normalizePeak(value: unknown): number | undefined {
  if (value == null) return undefined
  if (typeof value === 'number' && Number.isFinite(value))
    return Math.round(value * 1_000_000) / 1_000_000
  if (typeof value === 'object' && value !== null && 'ratio' in value) {
    const ratio = Number((value as { ratio?: unknown }).ratio)
    return Number.isFinite(ratio) ? Math.round(ratio * 1_000_000) / 1_000_000 : undefined
  }
  return parseNumericValue(value, (numeric) => Math.round(numeric * 1_000_000) / 1_000_000)
}

function normalizeR128GainDb(value: unknown): number | undefined {
  return parseNumericValue(value, (numeric) => {
    const db = Math.abs(numeric) > 64 ? numeric / 256 : numeric
    return Math.round(db * 100) / 100
  })
}

function parseNumericValue(
  value: unknown,
  normalize: (value: number) => number
): number | undefined {
  if (typeof value !== 'string') return undefined
  const match = value.trim().match(/(-?\d+(?:\.\d+)?)/)
  if (!match) return undefined
  const numeric = Number(match[1])
  return Number.isFinite(numeric) ? normalize(numeric) : undefined
}

const COVER_NAMES = [
  'cover.jpg',
  'cover.png',
  'cover.webp',
  'folder.jpg',
  'folder.png',
  'album.jpg',
  'album.png',
  'front.jpg',
  'front.png',
  'artwork.jpg',
  'artwork.png'
]
