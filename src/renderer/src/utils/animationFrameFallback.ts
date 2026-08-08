export interface AnimationFrameFallbackScheduler {
  request(callback: FrameRequestCallback): number
  cancel(handle: number): void
  scheduleTimeout(callback: () => void, delayMs: number): number
  clearTimeout(handle: number): void
  now(): number
}

function browserScheduler(): AnimationFrameFallbackScheduler {
  return {
    request: (callback) => window.requestAnimationFrame(callback),
    cancel: (handle) => window.cancelAnimationFrame(handle),
    scheduleTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle),
    now: () => performance.now()
  }
}

/**
 * Schedules one visual frame, but still completes while Electron has paused
 * requestAnimationFrame for an occluded window or track hand-off.
 */
export function requestAnimationFrameWithFallback(
  callback: FrameRequestCallback,
  fallbackDelayMs: number,
  scheduler: AnimationFrameFallbackScheduler = browserScheduler()
): () => void {
  let settled = false
  let frameHandle = 0
  let timeoutHandle: number | null = null

  const finish = (now: number): void => {
    if (settled) return
    settled = true
    if (timeoutHandle != null) scheduler.clearTimeout(timeoutHandle)
    callback(now)
  }

  frameHandle = scheduler.request(finish)
  if (!settled) {
    timeoutHandle = scheduler.scheduleTimeout(() => {
      scheduler.cancel(frameHandle)
      finish(scheduler.now())
    }, fallbackDelayMs)
  }

  return () => {
    if (settled) return
    settled = true
    scheduler.cancel(frameHandle)
    if (timeoutHandle != null) scheduler.clearTimeout(timeoutHandle)
  }
}

export function waitForAnimationFrameWithFallback(
  fallbackDelayMs: number,
  scheduler?: AnimationFrameFallbackScheduler
): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrameWithFallback(() => resolve(), fallbackDelayMs, scheduler)
  })
}
