import type { SleepTimerState } from '../shared/sleepTimer.ts'

export interface SleepTimerIpcEventSource {
  on: (channel: string, listener: (event: unknown, state: SleepTimerState | null) => void) => void
}

export interface SleepTimerEventBridge {
  bind: (ipc: SleepTimerIpcEventSource) => void
  onState: (callback: (state: SleepTimerState | null) => void) => () => void
  onTrigger: (callback: (state: SleepTimerState) => void) => () => void
}

/** Keeps snapshots separate from one-shot trigger commands. */
export function createSleepTimerEventBridge(): SleepTimerEventBridge {
  const stateCallbacks = new Set<(state: SleepTimerState | null) => void>()
  const triggerCallbacks = new Set<(state: SleepTimerState) => void>()

  return {
    bind(ipc) {
      ipc.on('sleepTimer:status', (_event, state) => {
        for (const callback of stateCallbacks) callback(state)
      })
      ipc.on('sleepTimer:trigger', (_event, state) => {
        if (!state) return
        for (const callback of triggerCallbacks) callback(state)
      })
    },
    onState(callback) {
      stateCallbacks.add(callback)
      return () => stateCallbacks.delete(callback)
    },
    onTrigger(callback) {
      triggerCallbacks.add(callback)
      return () => triggerCallbacks.delete(callback)
    }
  }
}
