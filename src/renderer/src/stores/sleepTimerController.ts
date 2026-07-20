import {
  createSleepTimerState,
  isActiveSleepTimerState,
  type SleepTimerMode,
  type SleepTimerSettings,
  type SleepTimerState
} from '../../../shared/sleepTimer.ts'

export interface SleepTimerBridge {
  configure: (state: SleepTimerState) => Promise<SleepTimerState | null>
  cancel: () => Promise<null>
  boundary: (boundary: 'trackEnd' | 'queueEnd') => Promise<SleepTimerState | null>
}

export interface SleepTimerControllerOptions {
  bridge: SleepTimerBridge | null | undefined
  getSettings: () => SleepTimerSettings
  getState: () => SleepTimerState | null
  setState: (state: SleepTimerState | null) => void
  persistSession: () => void
  setNotice: (notice: string | null) => void
  onTriggered: (state: SleepTimerState) => void
  now?: () => number
}

export function getRestorableSleepTimerState(
  value: unknown,
  now = Date.now()
): SleepTimerState | null {
  return isActiveSleepTimerState(value, now) ? value : null
}

/**
 * The main process owns trigger decisions. The renderer only mirrors that
 * state, persists user changes, and performs the user-facing fade on trigger.
 */
export function createSleepTimerController(options: SleepTimerControllerOptions) {
  const now = options.now ?? Date.now

  function applyAuthoritativeState(state: SleepTimerState | null): void {
    options.setState(state)
  }

  function applyTrigger(state: SleepTimerState): void {
    // Only the distinct main-process trigger event may begin shutdown. Status
    // snapshots are intentionally passive, including the terminal snapshot.
    options.setState(state)
    // The terminal timer is deliberately excluded from the session payload.
    // Persist immediately so a process exit during the fade cannot revive an
    // already-triggered timer on the next launch.
    options.persistSession()
    if (state.triggered && !state.active) options.onTriggered(state)
  }

  function configure(mode: SleepTimerMode, minutes?: number): void {
    const state = createSleepTimerState(mode, now(), options.getSettings(), minutes)
    options.setState(state)
    options.setNotice(null)
    options.persistSession()
    void options.bridge
      ?.configure(state)
      .then(applyAuthoritativeState)
      .catch(() => {})
  }

  function cancel(): void {
    options.setState(null)
    options.setNotice('已取消睡眠定时器')
    options.persistSession()
    void options.bridge?.cancel().catch(() => {})
  }

  async function reportBoundary(boundary: 'trackEnd' | 'queueEnd'): Promise<boolean> {
    if (!options.getState()?.active || !options.bridge) return false
    try {
      const state = await options.bridge.boundary(boundary)
      applyAuthoritativeState(state)
      return state?.triggered === true
    } catch {
      return false
    }
  }

  return { applyAuthoritativeState, applyTrigger, configure, cancel, reportBoundary }
}
