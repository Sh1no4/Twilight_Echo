import { createHash, randomUUID } from 'crypto'
import { createWriteStream } from 'fs'
import { access, lstat, mkdir, open, readFile, readdir, rename, rm, stat } from 'fs/promises'
import { dirname, extname, join, resolve } from 'path'
import { VersionedDataStore } from '../persistence/versionedDataStore.ts'
import {
  isOfflineDownloadDocument,
  offlineTrackKey,
  type OfflineDownloadDocument,
  type OfflinePlayablePathRequest,
  type OfflineDownloadRecord,
  type OfflineDownloadRequest,
  type OfflineStorageSummary
} from '../../shared/offlineDownloads.ts'

const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024
const MAX_CONCURRENT_DOWNLOADS = 2
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i
const SAFE_TRACK_ID = /^[^\0]{1,512}$/
const DOWNLOAD_ID = /^[a-f0-9]{64}$/
const SHA256 = /^[a-f0-9]{64}$/
const PUBLISH_JOURNAL_NAME = /^\.([a-f0-9]{64})\.publish\.json$/
const MAX_PUBLISH_JOURNAL_BYTES = 16 * 1024

export type OfflinePublishFaultPoint = 'beforeOldMove' | 'afterOldMove' | 'afterNewPublish'

export interface OfflinePublishFaultContext {
  id: string
  finalPath: string
  backupPath: string
  journalPath: string
}

interface OfflinePublishPrior {
  fileName: string
  sha256: string
  bytesDownloaded: number
  totalBytes: number | null
  downloadedAt: string | null
  expiresAt: string | null
  quality: string
}

interface OfflinePublishTransaction {
  version: 1
  id: string
  finalFileName: string
  newSha256: string
  newBytes: number
  completedAt: string
  prior: OfflinePublishPrior | null
}

export interface OfflineDownloadServiceOptions {
  rootPath: string
  now?: () => string
  fetch?: typeof fetch
  emit?: (record: OfflineDownloadRecord) => void
  /** Test-only crash injection. A thrown error simulates immediate process loss without rollback. */
  testPublishFault?: (
    point: OfflinePublishFaultPoint,
    context: OfflinePublishFaultContext
  ) => void | Promise<void>
}

/**
 * Main-process ownership boundary for downloadable media.  Renderer input can
 * choose a provider URL but can neither choose a filesystem path nor write
 * bytes.  Records are serialised through VersionedDataStore and interrupted
 * downloads are made retryable on the next process start.
 */
export class OfflineDownloadService {
  private readonly rootPath: string
  private readonly pinnedPath: string
  private readonly store: VersionedDataStore<OfflineDownloadDocument>
  private readonly now: () => string
  private readonly fetchImpl: typeof fetch
  private readonly emit: (record: OfflineDownloadRecord) => void
  private readonly testPublishFault: OfflineDownloadServiceOptions['testPublishFault']
  private readonly running = new Map<string, AbortController>()
  private readonly queued = new Map<string, OfflineDownloadRequest>()
  private readonly refreshFallbacks = new Map<string, OfflineDownloadRecord>()
  private activeCount = 0
  private tail: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(options: OfflineDownloadServiceOptions) {
    this.rootPath = resolve(options.rootPath)
    this.pinnedPath = join(this.rootPath, 'offline-pinned')
    this.now = options.now ?? (() => new Date().toISOString())
    this.fetchImpl = options.fetch ?? fetch
    this.emit = options.emit ?? (() => undefined)
    this.testPublishFault = options.testPublishFault
    this.store = new VersionedDataStore({
      filePath: join(this.pinnedPath, 'offline-downloads.json'),
      label: 'offline download state',
      maxBytes: 8 * 1024 * 1024,
      isData: isOfflineDownloadDocument,
      isLegacy: isOfflineDownloadDocument,
      now: this.now
    })
  }

  async initialize(): Promise<void> {
    await mkdir(this.pinnedPath, { recursive: true })
    await this.recoverPublishTransactions()
    const removedPartialFiles = await this.cleanupPartialDownloads()
    const persisted = await this.read()
    const recoveredPins = new Map<string, number>()
    for (const record of persisted.records) {
      if (
        (record.status === 'downloading' || record.status === 'queued') &&
        isUnexpiredCompletedRecord({ ...record, status: 'completed' }) &&
        record.fileName &&
        record.sha256
      ) {
        const path = join(this.pinnedPath, record.fileName)
        if (!(await isInsideAndPresent(this.pinnedPath, path))) continue
        try {
          if ((await sha256File(path)) === record.sha256) {
            recoveredPins.set(record.id, (await stat(path)).size)
          }
        } catch {
          // A missing or unreadable prior pin is not recovered as playable.
        }
      }
    }
    await this.mutate((document) => {
      for (const record of document.records) {
        if (record.status === 'downloading' || record.status === 'queued') {
          const recoveredSize = recoveredPins.get(record.id)
          record.status = recoveredSize === undefined ? 'failed' : 'completed'
          if (recoveredSize !== undefined) {
            record.bytesDownloaded = recoveredSize
            record.totalBytes = recoveredSize
          }
          record.error = `Download interrupted by restart. ${
            recoveredSize === undefined
              ? 'Retry to obtain a fresh provider URL.'
              : 'The previous complete verified pin was kept.'
          }${
            removedPartialFiles > 0
              ? ` Removed ${removedPartialFiles} incomplete temporary file${removedPartialFiles === 1 ? '' : 's'}.`
              : ''
          }`
          record.updatedAt = this.now()
        }
      }
    })
  }

  shutdown(): void {
    this.disposed = true
    this.queued.clear()
    for (const controller of this.running.values()) {
      controller.abort(new Error('Offline download service stopped'))
    }
  }

  async list(): Promise<OfflineStorageSummary> {
    const document = await this.read()
    const records = document.records.map((record) => this.withExpiry({ ...record }))
    const pinnedBytes = await this.pinnedBytes(records)
    return { pinnedBytes, availableBytes: await freeSpace(this.pinnedPath), records }
  }

  async queue(request: OfflineDownloadRequest): Promise<OfflineDownloadRecord> {
    return (await this.queueMany([request]))[0]
  }

  async queueMany(requests: OfflineDownloadRequest[]): Promise<OfflineDownloadRecord[]> {
    if (this.disposed) throw new Error('Offline download service is stopped')
    if (requests.length === 0 || requests.length > 10_000) {
      throw new Error('Offline download batch must contain 1 to 10000 tracks')
    }
    const requestIds = new Set<string>()
    for (const request of requests) {
      validateRequest(request)
      const id = stableId(request.providerId, request.trackId)
      if (requestIds.has(id)) throw new Error('Offline download batch contains duplicate tracks')
      requestIds.add(id)
    }
    await this.waitForCompletedPublishCleanup(requestIds)
    for (const id of requestIds) {
      if (this.running.has(id) || this.queued.has(id)) {
        throw new Error('An offline download for this track is already in progress')
      }
    }
    const records = await this.mutate((document) => {
      for (const id of requestIds) {
        if (this.running.has(id) || this.queued.has(id)) {
          throw new Error('An offline download for this track is already in progress')
        }
      }
      return requests.map((request) => {
        const id = stableId(request.providerId, request.trackId)
        const existing = document.records.find((item) => item.id === id)
        if (existing && hasCompletedArtifact(existing)) {
          this.refreshFallbacks.set(id, { ...existing })
        }
        const next: OfflineDownloadRecord = {
          id,
          providerId: request.providerId.trim().toLowerCase(),
          trackId: request.trackId.trim(),
          title: truncate(request.title, 256),
          quality: truncate(request.quality, 80) || 'auto',
          pinned: true,
          status: 'queued',
          bytesDownloaded: 0,
          totalBytes: null,
          sha256: existing?.sha256 ?? null,
          fileName: existing?.fileName ?? null,
          downloadedAt: existing?.downloadedAt ?? null,
          expiresAt: normalizeDate(request.expiresAt),
          error: null,
          retryCount: (existing?.retryCount ?? 0) + (existing ? 1 : 0),
          updatedAt: this.now()
        }
        if (existing) Object.assign(existing, next)
        else document.records.push(next)
        this.queued.set(id, request)
        return next
      })
    })
    for (const record of records) this.emit(record)
    this.pump()
    return records
  }

  async cancel(id: string): Promise<OfflineDownloadRecord | null> {
    this.running.get(id)?.abort(new Error('Cancelled by user'))
    this.queued.delete(id)
    return this.mutate((document) => {
      const record = document.records.find((item) => item.id === id)
      if (!record || record.status === 'completed') return null
      const fallback = this.refreshFallbacks.get(id)
      if (fallback) {
        const retryCount = record.retryCount
        Object.assign(record, fallback)
        record.retryCount = retryCount
        record.error = 'Refresh cancelled; the previous complete offline pin was kept.'
        record.updatedAt = this.now()
        if (!this.running.has(id)) this.refreshFallbacks.delete(id)
        return { ...record }
      }
      record.status = 'cancelled'
      record.error = null
      record.updatedAt = this.now()
      return { ...record }
    })
  }

  async unpin(id: string): Promise<boolean> {
    this.running.get(id)?.abort(new Error('Unpinned by user'))
    this.queued.delete(id)
    this.refreshFallbacks.delete(id)
    const record = await this.mutate((document) => {
      const index = document.records.findIndex((item) => item.id === id)
      if (index < 0) return null
      return document.records.splice(index, 1)[0]
    })
    if (!record) return false
    if (record.fileName) await rm(join(this.pinnedPath, record.fileName), { force: true })
    return true
  }

  async getPlayablePath(providerId: string, trackId: string): Promise<string | null> {
    return (await this.getPlayablePaths([{ providerId, trackId }]))[0] ?? null
  }

  /**
   * Resolve a whole renderer queue in one main-process request. Every returned
   * path is derived from persisted identity, confined to the pin directory,
   * expiry-checked, and SHA-256 verified immediately before use.
   */
  async getPlayablePaths(requests: OfflinePlayablePathRequest[]): Promise<(string | null)[]> {
    if (!Array.isArray(requests) || requests.length > 10_000) {
      throw new Error('Offline playable path batch must contain at most 10000 tracks')
    }
    for (const request of requests) validatePlayablePathRequest(request)
    if (requests.length === 0) return []

    const document = await this.read()
    const byId = new Map(document.records.map((record) => [record.id, record]))
    const results: (string | null)[] = new Array(requests.length).fill(null)
    const integrityFailures = new Set<string>()
    let cursor = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor++
        if (index >= requests.length) return
        const request = requests[index]
        const id = stableId(request.providerId, request.trackId)
        const record = byId.get(id)
        if (
          !record ||
          this.withExpiry(record).status !== 'completed' ||
          !record.fileName ||
          !record.sha256
        ) {
          continue
        }
        const path = join(this.pinnedPath, record.fileName)
        if (!(await isInsideAndPresent(this.pinnedPath, path))) {
          integrityFailures.add(id)
          continue
        }
        const actual = await sha256File(path)
        if (actual !== record.sha256) {
          integrityFailures.add(id)
          continue
        }
        results[index] = path
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, requests.length) }, () => worker()))
    for (const id of integrityFailures) {
      await this.fail(id, 'Pinned file integrity verification failed')
    }
    return results
  }

  private pump(): void {
    while (!this.disposed && this.activeCount < MAX_CONCURRENT_DOWNLOADS && this.queued.size > 0) {
      const [id, request] = this.queued.entries().next().value as [string, OfflineDownloadRequest]
      this.queued.delete(id)
      this.activeCount += 1
      void this.download(id, request).finally(() => {
        this.activeCount -= 1
        this.pump()
      })
    }
  }

  private async waitForCompletedPublishCleanup(ids: ReadonlySet<string>): Promise<void> {
    const activeIds = [...ids].filter((id) => this.running.has(id))
    if (activeIds.length === 0) return
    const document = await this.read()
    const byId = new Map(document.records.map((record) => [record.id, record]))
    if (activeIds.some((id) => byId.get(id)?.status !== 'completed')) return
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (activeIds.every((id) => !this.running.has(id))) return
      await new Promise((resolveTick) => setTimeout(resolveTick, 0))
    }
  }

  private async download(id: string, request: OfflineDownloadRequest): Promise<void> {
    const controller = new AbortController()
    this.running.set(id, controller)
    const timeout = setTimeout(
      () => controller.abort(new Error('Download timed out')),
      DOWNLOAD_TIMEOUT_MS
    )
    timeout.unref?.()
    let tempPath: string | null = null
    let output: ReturnType<typeof createWriteStream> | null = null
    let publishContext: OfflinePublishFaultContext | null = null
    try {
      await this.update(id, (record) => {
        record.status = 'downloading'
        record.error = null
        record.bytesDownloaded = 0
        record.totalBytes = null
      })
      const response = await this.fetchImpl(request.url, {
        signal: controller.signal,
        redirect: 'error'
      })
      if (!response.ok || !response.body)
        throw new Error(`Download failed: HTTP ${response.status}`)
      const contentLength = parseContentLength(response.headers.get('content-length'))
      if (contentLength !== null && contentLength > MAX_DOWNLOAD_BYTES) {
        throw new Error('Download exceeds the 2 GiB offline limit')
      }
      const extension = safeExtension(request.url, response.headers.get('content-type'))
      const finalName = `${id}${extension}`
      const finalPath = join(this.pinnedPath, finalName)
      tempPath = join(this.pinnedPath, `.${id}.${randomUUID()}.part`)
      output = createWriteStream(tempPath, { flags: 'wx' })
      const reader = response.body.getReader()
      const hash = createHash('sha256')
      let received = 0
      for (;;) {
        throwIfAborted(controller.signal)
        const chunk = await reader.read()
        throwIfAborted(controller.signal)
        if (chunk.done) break
        received += chunk.value.byteLength
        if (received > MAX_DOWNLOAD_BYTES) {
          await reader.cancel('Download exceeded size limit')
          throw new Error('Download exceeds the 2 GiB offline limit')
        }
        hash.update(chunk.value)
        if (!output.write(chunk.value)) await onceDrain(output)
        await this.update(id, (record) => {
          record.bytesDownloaded = received
          record.totalBytes = contentLength
        })
      }
      await closeStream(output)
      output = null
      if (contentLength !== null && received !== contentLength) {
        throw new Error(
          `Download ended after ${received} bytes but Content-Length declared ${contentLength} bytes`
        )
      }
      const digest = hash.digest('hex')
      if (request.expectedSha256 && digest !== request.expectedSha256.toLowerCase()) {
        throw new Error('Download integrity hash does not match provider expectation')
      }
      await syncFile(tempPath)
      const prior = await this.verifiedPublishPrior(id)
      const transaction: OfflinePublishTransaction = {
        version: 1,
        id,
        finalFileName: finalName,
        newSha256: digest,
        newBytes: received,
        completedAt: this.now(),
        prior
      }
      const context = publishFaultContext(this.pinnedPath, id, finalName)
      publishContext = context

      // The journal is durable before either visible media path changes. All
      // recovery paths are derived again from its validated download id; the
      // JSON is never allowed to supply an arbitrary destination.
      await writePublishJournal(context.journalPath, transaction)
      await this.runPublishFault('beforeOldMove', context)
      if (prior) {
        if (await pathExists(context.backupPath)) {
          throw new Error('A previous offline publish transaction still requires recovery')
        }
        await rename(join(this.pinnedPath, prior.fileName), context.backupPath)
        await syncDirectory(this.pinnedPath)
      }
      await this.runPublishFault('afterOldMove', context)
      await rename(tempPath, finalPath)
      tempPath = null
      await syncFile(finalPath)
      await syncDirectory(this.pinnedPath)
      await this.runPublishFault('afterNewPublish', context)

      if ((await safeFileHash(this.pinnedPath, finalPath)) !== digest) {
        throw new Error('Published offline file failed final integrity verification')
      }
      tempPath = null
      await this.update(id, (record) => {
        record.status = 'completed'
        record.bytesDownloaded = received
        record.totalBytes = contentLength ?? received
        record.sha256 = digest
        record.fileName = finalName
        record.downloadedAt = this.now()
        record.error = null
      })
      // A verified final path and its completed state are durable before the
      // rollback copy is cleared. A crash before either removal is idempotent.
      await rm(context.backupPath, { force: true })
      await rm(context.journalPath, { force: true })
      await syncDirectory(this.pinnedPath)
      publishContext = null
      this.refreshFallbacks.delete(id)
    } catch (error) {
      if (error instanceof SimulatedOfflinePublishCrashError) return
      if (output) await destroyStream(output)
      if (tempPath) await rm(tempPath, { force: true }).catch(() => undefined)
      if (publishContext) {
        const recovered = await this.recoverPublishTransaction(publishContext.journalPath).catch(
          () => false
        )
        if (recovered) {
          this.refreshFallbacks.delete(id)
          return
        }
      }
      const aborted = controller.signal.aborted
      await this.update(id, (record) => {
        const fallback = this.refreshFallbacks.get(id)
        if (fallback) {
          const retryCount = record.retryCount
          Object.assign(record, fallback)
          record.retryCount = retryCount
          record.error = `${
            aborted ? 'Offline refresh cancelled' : 'Offline refresh failed'
          }; the previous complete pin was kept. ${redactError(error)}`
        } else {
          record.status = aborted ? 'cancelled' : 'failed'
          record.error = redactError(error)
        }
      }).catch(() => undefined)
      this.refreshFallbacks.delete(id)
    } finally {
      clearTimeout(timeout)
      this.running.delete(id)
    }
  }

  private async runPublishFault(
    point: OfflinePublishFaultPoint,
    context: OfflinePublishFaultContext
  ): Promise<void> {
    if (!this.testPublishFault) return
    try {
      await this.testPublishFault(point, context)
    } catch (cause) {
      throw new SimulatedOfflinePublishCrashError(point, cause)
    }
  }

  private async verifiedPublishPrior(id: string): Promise<OfflinePublishPrior | null> {
    const fallback = this.refreshFallbacks.get(id)
    if (
      !fallback ||
      fallback.id !== id ||
      stableId(fallback.providerId, fallback.trackId) !== id ||
      !fallback.fileName ||
      !fallback.sha256 ||
      !isMediaFileNameForId(id, fallback.fileName)
    ) {
      return null
    }
    const filePath = join(this.pinnedPath, fallback.fileName)
    if ((await safeFileHash(this.pinnedPath, filePath)) !== fallback.sha256) {
      this.refreshFallbacks.delete(id)
      await rm(filePath, { force: true }).catch(() => undefined)
      return null
    }
    return {
      fileName: fallback.fileName,
      sha256: fallback.sha256,
      bytesDownloaded: fallback.bytesDownloaded,
      totalBytes: fallback.totalBytes,
      downloadedAt: fallback.downloadedAt,
      expiresAt: fallback.expiresAt,
      quality: fallback.quality
    }
  }

  private async recoverPublishTransactions(): Promise<void> {
    const entries = await readdir(this.pinnedPath, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !PUBLISH_JOURNAL_NAME.test(entry.name)) continue
      const journalPath = join(this.pinnedPath, entry.name)
      if (!isImmediateChild(this.pinnedPath, journalPath)) continue
      await this.recoverPublishTransaction(journalPath).catch(() => undefined)
    }
  }

  private async recoverPublishTransaction(journalPath: string): Promise<boolean> {
    const transaction = await readPublishJournal(this.pinnedPath, journalPath)
    if (!transaction) return false
    const expectedJournalPath = publishJournalPath(this.pinnedPath, transaction.id)
    if (resolve(expectedJournalPath) !== resolve(journalPath)) return false

    const document = await this.read()
    const record = document.records.find((candidate) => candidate.id === transaction.id)
    if (
      !record ||
      stableId(record.providerId, record.trackId) !== transaction.id ||
      !isMediaFileNameForId(transaction.id, transaction.finalFileName)
    ) {
      return false
    }

    const context = publishFaultContext(this.pinnedPath, transaction.id, transaction.finalFileName)
    const finalHash = await safeFileHash(this.pinnedPath, context.finalPath)
    if (finalHash === transaction.newSha256) {
      await this.update(transaction.id, (candidate) => {
        candidate.status = 'completed'
        candidate.fileName = transaction.finalFileName
        candidate.sha256 = transaction.newSha256
        candidate.bytesDownloaded = transaction.newBytes
        candidate.totalBytes = transaction.newBytes
        candidate.downloadedAt = transaction.completedAt
        candidate.error = 'Recovered a verified offline publish after an interrupted process.'
      })
      // Never discard rollback material until both the final bytes and their
      // completed record have been verified and committed.
      await rm(context.backupPath, { force: true })
      await rm(context.journalPath, { force: true })
      await syncDirectory(this.pinnedPath)
      return true
    }

    if (!transaction.prior) {
      if (finalHash !== null) await rm(context.finalPath, { force: true })
      await rm(context.journalPath, { force: true })
      await syncDirectory(this.pinnedPath)
      return false
    }

    const priorPath = join(this.pinnedPath, transaction.prior.fileName)
    const priorHash = await safeFileHash(this.pinnedPath, priorPath)
    const backupHash = await safeFileHash(this.pinnedPath, context.backupPath)
    if (priorHash !== transaction.prior.sha256 && backupHash === transaction.prior.sha256) {
      if (await pathExists(priorPath)) await rm(priorPath, { force: true })
      if (
        resolve(context.finalPath) !== resolve(priorPath) &&
        (await pathExists(context.finalPath))
      ) {
        await rm(context.finalPath, { force: true })
      }
      await rename(context.backupPath, priorPath)
      await syncFile(priorPath)
      await syncDirectory(this.pinnedPath)
    } else if (
      resolve(context.finalPath) !== resolve(priorPath) &&
      finalHash !== null &&
      finalHash !== transaction.newSha256
    ) {
      await rm(context.finalPath, { force: true })
    }

    if ((await safeFileHash(this.pinnedPath, priorPath)) !== transaction.prior.sha256) {
      await this.update(transaction.id, (candidate) => {
        candidate.status = 'failed'
        candidate.error = 'Offline publish recovery could not verify either the new or prior pin.'
      })
      return false
    }

    const restoredSize = (await stat(priorPath)).size
    await this.update(transaction.id, (candidate) => {
      candidate.status = 'completed'
      candidate.fileName = transaction.prior!.fileName
      candidate.sha256 = transaction.prior!.sha256
      candidate.bytesDownloaded = restoredSize
      candidate.totalBytes = restoredSize
      candidate.downloadedAt = transaction.prior!.downloadedAt
      candidate.expiresAt = transaction.prior!.expiresAt
      candidate.quality = transaction.prior!.quality
      candidate.error =
        'Offline publish was interrupted; the previous complete verified pin was restored.'
    })
    if ((await safeFileHash(this.pinnedPath, context.backupPath)) === transaction.prior.sha256) {
      await rm(context.backupPath, { force: true })
    }
    await rm(context.journalPath, { force: true })
    await syncDirectory(this.pinnedPath)
    return true
  }

  private async fail(id: string, message: string): Promise<void> {
    await this.update(id, (record) => {
      record.status = 'failed'
      record.error = message
    })
  }

  private async update(id: string, update: (record: OfflineDownloadRecord) => void): Promise<void> {
    const record = await this.mutate((document) => {
      const item = document.records.find((candidate) => candidate.id === id)
      if (!item) return null
      update(item)
      item.updatedAt = this.now()
      return { ...item }
    })
    if (record) this.emit(record)
  }

  private async read(): Promise<OfflineDownloadDocument> {
    const loaded = await this.store.load()
    return loaded?.data ?? { version: 1, records: [] }
  }

  private async mutate<T>(mutation: (document: OfflineDownloadDocument) => T): Promise<T> {
    const operation = this.tail.then(async () => {
      const loaded = await this.store.load()
      const current = loaded?.data ?? { version: 1, records: [] }
      const document: OfflineDownloadDocument = {
        version: 1,
        records: current.records.map((record) => ({ ...record }))
      }
      const result = mutation(document)
      await this.store.save(document, loaded?.revision ?? 0)
      return result
    })
    this.tail = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  private async pinnedBytes(records: OfflineDownloadRecord[]): Promise<number> {
    const sizes = await Promise.all(
      records
        .filter((record) => record.status === 'completed' && record.fileName)
        .map(async (record) => {
          try {
            return (await stat(join(this.pinnedPath, record.fileName!))).size
          } catch {
            return 0
          }
        })
    )
    return sizes.reduce((total, value) => total + value, 0)
  }

  private withExpiry(record: OfflineDownloadRecord): OfflineDownloadRecord {
    if (
      record.status !== 'completed' ||
      !record.expiresAt ||
      Date.parse(record.expiresAt) > Date.now()
    )
      return record
    return {
      ...record,
      status: 'expired',
      error: 'Offline license/source expiry reached. Retry to refresh it.'
    }
  }

  private async cleanupPartialDownloads(): Promise<number> {
    const entries = await readdir(this.pinnedPath, { withFileTypes: true })
    let removed = 0
    for (const entry of entries) {
      // Download temporary files are immediate hidden children only. Never
      // recurse into a directory or derive a path from persisted renderer data.
      const isMediaPart = /^\.[a-f0-9]{64}\.[0-9a-f-]{36}\.part$/i.test(entry.name)
      const isLegacyMediaPart = /^\.[^.]+\.part$/i.test(entry.name)
      const isJournalTemp = /^\.[a-f0-9]{64}\.publish\.json\.[0-9a-f-]{36}\.tmp$/i.test(entry.name)
      if (
        (!isMediaPart && !isLegacyMediaPart && !isJournalTemp) ||
        entry.isDirectory() ||
        entry.isSymbolicLink()
      ) {
        continue
      }
      const candidate = join(this.pinnedPath, entry.name)
      if (!isImmediateChild(this.pinnedPath, candidate)) continue
      await rm(candidate, { force: true })
      removed += 1
    }
    return removed
  }
}

class SimulatedOfflinePublishCrashError extends Error {
  constructor(point: OfflinePublishFaultPoint, cause: unknown) {
    super(`Simulated offline publish crash at ${point}`, { cause })
    this.name = 'SimulatedOfflinePublishCrashError'
  }
}

function publishFaultContext(
  pinnedPath: string,
  id: string,
  finalFileName: string
): OfflinePublishFaultContext {
  if (!DOWNLOAD_ID.test(id) || !isMediaFileNameForId(id, finalFileName)) {
    throw new Error('Offline publish identity is invalid')
  }
  return {
    id,
    finalPath: join(pinnedPath, finalFileName),
    backupPath: join(pinnedPath, `.${id}.replaced`),
    journalPath: publishJournalPath(pinnedPath, id)
  }
}

function publishJournalPath(pinnedPath: string, id: string): string {
  if (!DOWNLOAD_ID.test(id)) throw new Error('Offline publish identity is invalid')
  return join(pinnedPath, `.${id}.publish.json`)
}

function isMediaFileNameForId(id: string, fileName: string): boolean {
  if (!DOWNLOAD_ID.test(id) || typeof fileName !== 'string') return false
  const [candidateId, extension, extra] = fileName.split('.')
  return (
    extra === undefined &&
    candidateId === id &&
    typeof extension === 'string' &&
    /^[a-z0-9]{1,8}$/.test(extension)
  )
}

async function writePublishJournal(
  journalPath: string,
  transaction: OfflinePublishTransaction
): Promise<void> {
  if (!isOfflinePublishTransaction(transaction)) {
    throw new Error('Offline publish transaction is invalid')
  }
  if (await pathExists(journalPath)) {
    throw new Error('An offline publish transaction already requires recovery')
  }
  const serialized = `${JSON.stringify(transaction)}\n`
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PUBLISH_JOURNAL_BYTES) {
    throw new Error('Offline publish transaction exceeds its size limit')
  }
  const temporaryPath = `${journalPath}.${randomUUID()}.tmp`
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(serialized, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporaryPath, journalPath)
    await syncFile(journalPath)
    await syncDirectory(dirname(journalPath))
  } finally {
    await handle?.close().catch(() => undefined)
    await rm(temporaryPath, { force: true })
  }
}

async function readPublishJournal(
  pinnedPath: string,
  journalPath: string
): Promise<OfflinePublishTransaction | null> {
  if (!isImmediateChild(pinnedPath, journalPath)) return null
  let metadata: Awaited<ReturnType<typeof lstat>>
  try {
    metadata = await lstat(journalPath)
  } catch {
    return null
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size > MAX_PUBLISH_JOURNAL_BYTES
  ) {
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(await readFile(journalPath, 'utf8'))
  } catch {
    return null
  }
  if (!isOfflinePublishTransaction(value)) return null
  return value
}

function isOfflinePublishTransaction(value: unknown): value is OfflinePublishTransaction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const transaction = value as Record<string, unknown>
  if (
    transaction.version !== 1 ||
    typeof transaction.id !== 'string' ||
    !DOWNLOAD_ID.test(transaction.id) ||
    typeof transaction.finalFileName !== 'string' ||
    !isMediaFileNameForId(transaction.id, transaction.finalFileName) ||
    typeof transaction.newSha256 !== 'string' ||
    !SHA256.test(transaction.newSha256) ||
    !isBoundedByteCount(transaction.newBytes) ||
    typeof transaction.completedAt !== 'string' ||
    !Number.isFinite(Date.parse(transaction.completedAt))
  ) {
    return false
  }
  return transaction.prior === null || isOfflinePublishPrior(transaction.id, transaction.prior)
}

function isOfflinePublishPrior(id: string, value: unknown): value is OfflinePublishPrior {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prior = value as Record<string, unknown>
  return (
    typeof prior.fileName === 'string' &&
    isMediaFileNameForId(id, prior.fileName) &&
    typeof prior.sha256 === 'string' &&
    SHA256.test(prior.sha256) &&
    isBoundedByteCount(prior.bytesDownloaded) &&
    (prior.totalBytes === null || isBoundedByteCount(prior.totalBytes)) &&
    (prior.downloadedAt === null ||
      (typeof prior.downloadedAt === 'string' &&
        Number.isFinite(Date.parse(prior.downloadedAt)))) &&
    (prior.expiresAt === null ||
      (typeof prior.expiresAt === 'string' && Number.isFinite(Date.parse(prior.expiresAt)))) &&
    typeof prior.quality === 'string' &&
    prior.quality.length <= 80
  )
}

function isBoundedByteCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_DOWNLOAD_BYTES
  )
}

async function safeFileHash(root: string, filePath: string): Promise<string | null> {
  if (!isImmediateChild(root, filePath)) return null
  try {
    const metadata = await lstat(filePath)
    if (!metadata.isFile() || metadata.isSymbolicLink()) return null
    return await sha256File(filePath)
  } catch {
    return null
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath)
    return true
  } catch {
    return false
  }
}

async function syncFile(filePath: string): Promise<void> {
  const handle = await open(filePath, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncDirectory(directoryPath: string): Promise<void> {
  if (process.platform === 'win32') return
  try {
    const handle = await open(directoryPath, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch {
    // Some filesystems do not expose directory fsync. File fsync and atomic
    // rename still preserve the recoverable journal ordering on those hosts.
  }
}

function validateRequest(request: OfflineDownloadRequest): void {
  if (!SAFE_ID.test(request.providerId.trim())) throw new Error('Offline provider id is invalid')
  if (!SAFE_TRACK_ID.test(request.trackId.trim())) throw new Error('Offline track id is invalid')
  if (!request.title.trim() || request.title.length > 256)
    throw new Error('Offline title is invalid')
  if (request.quality.length > 80) throw new Error('Offline quality is invalid')
  if (request.expectedSha256 && !/^[a-f0-9]{64}$/i.test(request.expectedSha256)) {
    throw new Error('Offline checksum is invalid')
  }
  const url = new URL(request.url)
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    isPrivateHost(url.hostname)
  ) {
    throw new Error('Offline media URL is not authorized')
  }
}

function validatePlayablePathRequest(request: OfflinePlayablePathRequest): void {
  if (!request || typeof request !== 'object')
    throw new Error('Offline playable path request is invalid')
  if (!SAFE_ID.test(request.providerId.trim())) throw new Error('Offline provider id is invalid')
  if (!SAFE_TRACK_ID.test(request.trackId.trim())) throw new Error('Offline track id is invalid')
}

function isUnexpiredCompletedRecord(record: OfflineDownloadRecord): boolean {
  return (
    record.status === 'completed' &&
    Boolean(record.fileName && record.sha256) &&
    (!record.expiresAt || Date.parse(record.expiresAt) > Date.now())
  )
}

function hasCompletedArtifact(record: OfflineDownloadRecord): boolean {
  return record.status === 'completed' && Boolean(record.fileName && record.sha256)
}

function stableId(providerId: string, trackId: string): string {
  return createHash('sha256').update(offlineTrackKey(providerId, trackId)).digest('hex')
}

function safeExtension(url: string, contentType: string | null): string {
  const byName = extname(new URL(url).pathname).toLowerCase()
  if (/^\.[a-z0-9]{1,8}$/.test(byName)) return byName
  const mime = contentType?.toLowerCase() ?? ''
  if (mime.includes('flac')) return '.flac'
  if (mime.includes('ogg')) return '.ogg'
  if (mime.includes('wav')) return '.wav'
  if (mime.includes('mp4') || mime.includes('m4a')) return '.m4a'
  if (mime.includes('aac')) return '.aac'
  return '.mp3'
}

function parseContentLength(value: string | null): number | null {
  if (value === null) return null
  if (!/^\d+$/.test(value)) throw new Error('Download returned an invalid Content-Length header')
  const number = Number(value)
  if (!Number.isSafeInteger(number))
    throw new Error('Download Content-Length is outside the safe integer range')
  return number
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '[::1]')
    return true
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return false
  const [a, b] = parts
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function truncate(value: string, maximum: number): string {
  return value.trim().slice(0, maximum)
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function redactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/https?:\/\/[^\s]+/gi, '[remote URL]').slice(0, 300)
}

async function onceDrain(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  await new Promise<void>((resolveDrain, reject) => {
    stream.once('drain', resolveDrain)
    stream.once('error', reject)
  })
}

async function closeStream(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  await new Promise<void>((resolveClose, reject) => {
    if (stream.closed) return resolveClose()
    stream.once('error', reject)
    stream.once('close', resolveClose)
    stream.end()
  })
}

async function destroyStream(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  await new Promise<void>((resolveClose) => {
    if (stream.closed) return resolveClose()
    stream.once('error', () => undefined)
    stream.once('close', resolveClose)
    stream.destroy()
  })
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('Download cancelled')
}

async function isInsideAndPresent(root: string, target: string): Promise<boolean> {
  const normalizedRoot = `${resolve(root)}${process.platform === 'win32' ? '\\' : '/'}`
  if (!resolve(target).startsWith(normalizedRoot)) return false
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

function isImmediateChild(root: string, target: string): boolean {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  const separator = process.platform === 'win32' ? '\\' : '/'
  if (!resolvedTarget.startsWith(`${resolvedRoot}${separator}`)) return false
  const relative = resolvedTarget.slice(resolvedRoot.length + 1)
  return relative.length > 0 && !relative.includes('/') && !relative.includes('\\')
}

async function sha256File(path: string): Promise<string> {
  const { createReadStream } = await import('fs')
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const input = createReadStream(path)
    input.on('data', (chunk) => hash.update(chunk))
    input.once('error', reject)
    input.once('end', () => resolveHash(hash.digest('hex')))
  })
}

async function freeSpace(path: string): Promise<number | null> {
  try {
    const fs = await import('fs/promises')
    const result = await fs.statfs(path)
    return Number(result.bavail * result.bsize)
  } catch {
    return null
  }
}
