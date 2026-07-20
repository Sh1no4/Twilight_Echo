export class NativeQueueRevisionFence {
  private revision = 0

  next(): number {
    this.revision += 1
    return this.revision
  }

  isCurrent(revision: number): boolean {
    return revision === this.revision
  }

  async runLatest<T>(
    revision: number,
    operation: () => Promise<T>
  ): Promise<{
    applied: boolean
    value?: T
  }> {
    if (!this.isCurrent(revision)) return { applied: false }
    const value = await operation()
    return this.isCurrent(revision) ? { applied: true, value } : { applied: false }
  }

  get current(): number {
    return this.revision
  }
}

export interface RevisionedNativeQueueSync<T> {
  prepare: () => Promise<T | null>
  loadQueue: (prepared: T) => Promise<void>
  setPlayMode: () => Promise<void>
}

/**
 * Runs the production prepare -> loadQueue -> setPlayMode chain under one
 * revision. Later revisions may not commit stale prepared state or settings.
 */
export async function synchronizeLatestNativeQueue<T>(
  fence: NativeQueueRevisionFence,
  revision: number,
  sync: RevisionedNativeQueueSync<T>
): Promise<{ applied: boolean; prepared: T | null }> {
  const preparedResult = await fence.runLatest(revision, sync.prepare)
  if (!preparedResult.applied) return { applied: false, prepared: null }
  const prepared = preparedResult.value ?? null
  if (!prepared) return { applied: true, prepared: null }

  const loadResult = await fence.runLatest(revision, () => sync.loadQueue(prepared))
  if (!loadResult.applied) return { applied: false, prepared: null }

  const modeResult = await fence.runLatest(revision, sync.setPlayMode)
  return modeResult.applied ? { applied: true, prepared } : { applied: false, prepared: null }
}
