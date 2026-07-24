export interface ThemePreviewFrameClock {
  request(callback: (timestamp: number) => void): number
  cancel(handle: number): void
}

export interface ThemePreviewScheduler<T> {
  schedule(value: T): void
  flush(): Promise<void>
  cancel(): void
  hasPending(): boolean
}

export function createThemePreviewScheduler<T>(
  preview: (value: T) => Promise<void> | void,
  clock: ThemePreviewFrameClock = {
    request: (callback) => window.requestAnimationFrame(callback),
    cancel: (handle) => window.cancelAnimationFrame(handle)
  },
  onError: (cause: unknown) => void = () => undefined
): ThemePreviewScheduler<T> {
  let frameHandle: number | null = null
  let pendingValue: T | undefined
  let pending = false
  let latestPreview = Promise.resolve()

  function runPending(): Promise<void> {
    if (!pending) return latestPreview
    const value = pendingValue as T
    pending = false
    pendingValue = undefined
    latestPreview = Promise.resolve().then(() => preview(value))
    return latestPreview
  }

  function schedule(value: T): void {
    pendingValue = value
    pending = true
    if (frameHandle !== null) return
    frameHandle = clock.request(() => {
      frameHandle = null
      void runPending().catch(onError)
    })
  }

  async function flush(): Promise<void> {
    if (frameHandle !== null) {
      clock.cancel(frameHandle)
      frameHandle = null
    }
    await runPending()
  }

  function cancel(): void {
    if (frameHandle !== null) clock.cancel(frameHandle)
    frameHandle = null
    pendingValue = undefined
    pending = false
  }

  return {
    schedule,
    flush,
    cancel,
    hasPending: () => pending
  }
}
