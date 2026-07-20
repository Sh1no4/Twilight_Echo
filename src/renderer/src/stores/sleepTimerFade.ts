import type { SleepTimerState } from '../../../shared/sleepTimer.ts'

export interface SleepTimerFadeOptions {
  getVolume: () => number
  setVolume: (value: number) => void
  stop: () => void
  now?: () => number
  setInterval?: (callback: () => void, ms: number) => ReturnType<typeof setInterval>
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void
}

export function createSleepTimerFadeController(options: SleepTimerFadeOptions) {
  const now = options.now ?? Date.now
  const schedule = options.setInterval ?? setInterval
  const cancelInterval = options.clearInterval ?? clearInterval
  let timer: ReturnType<typeof setInterval> | null = null
  let shutdownStarted = false

  function clear(): void {
    if (timer !== null) cancelInterval(timer)
    timer = null
    shutdownStarted = false
  }

  function begin(state: SleepTimerState): boolean {
    if (shutdownStarted) return false
    shutdownStarted = true
    const startVolume = options.getVolume()
    if (state.fadeSeconds <= 0 || startVolume <= 0) {
      options.stop()
      return true
    }

    const startedAt = now()
    timer = schedule(() => {
      const ratio = Math.max(0, 1 - (now() - startedAt) / (state.fadeSeconds * 1000))
      options.setVolume(startVolume * ratio)
      if (ratio <= 0) {
        if (timer !== null) cancelInterval(timer)
        timer = null
        options.stop()
        // Fading is temporary; manual playback keeps the user's original level.
        options.setVolume(startVolume)
      }
    }, 250)
    return true
  }

  return { begin, clear, isActive: () => timer !== null }
}
