/**
 * The on-disk representation used for renderer-owned mutable data.  The
 * payload keeps its own schema version; this envelope protects concurrent
 * writes independently of that schema.
 */
export interface VersionedDataEnvelope<T> {
  version: 2
  revision: number
  savedAt: string
  data: T
}

/**
 * IPC cannot be relied upon to preserve custom Error properties.  Main sends
 * this plain-object representation and preload recreates the typed error for
 * renderer callers.
 */
export interface PersistentDataRevisionConflictResponse<T> {
  code: 'ERR_PERSISTENCE_REVISION_CONFLICT'
  expectedRevision: number
  current: VersionedDataEnvelope<T> | null
}

export class PersistentDataRevisionConflictError<T> extends Error {
  readonly code = 'ERR_PERSISTENCE_REVISION_CONFLICT'
  readonly current: VersionedDataEnvelope<T> | null
  readonly expectedRevision: number

  constructor(current: VersionedDataEnvelope<T> | null, expectedRevision: number) {
    super(
      `Persistent data revision conflict: expected ${expectedRevision}, current ${current?.revision ?? 0}`
    )
    this.name = 'PersistentDataRevisionConflictError'
    this.current = current
    this.expectedRevision = expectedRevision
  }
}

export function createPersistentDataRevisionConflictResponse<T>(
  error: PersistentDataRevisionConflictError<T>
): PersistentDataRevisionConflictResponse<T> {
  return {
    code: error.code,
    expectedRevision: error.expectedRevision,
    current: error.current
  }
}

export function isPersistentDataRevisionConflictResponse<T>(
  value: unknown,
  isData: (value: unknown) => value is T
): value is PersistentDataRevisionConflictResponse<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    record.code === 'ERR_PERSISTENCE_REVISION_CONFLICT' &&
    Number.isSafeInteger(record.expectedRevision) &&
    (record.expectedRevision as number) >= 0 &&
    (record.current === null || isVersionedDataEnvelope(record.current, isData))
  )
}

export function persistentDataRevisionConflictFromResponse<T>(
  response: PersistentDataRevisionConflictResponse<T>
): PersistentDataRevisionConflictError<T> {
  return new PersistentDataRevisionConflictError(response.current, response.expectedRevision)
}

export function isVersionedDataEnvelope<T>(
  value: unknown,
  isData: (value: unknown) => value is T
): value is VersionedDataEnvelope<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    record.version === 2 &&
    typeof record.revision === 'number' &&
    Number.isSafeInteger(record.revision) &&
    record.revision >= 0 &&
    typeof record.savedAt === 'string' &&
    isData(record.data)
  )
}

export function isPersistentDataRevisionConflict(
  error: unknown
): error is PersistentDataRevisionConflictError<unknown> {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'ERR_PERSISTENCE_REVISION_CONFLICT'
  )
}
