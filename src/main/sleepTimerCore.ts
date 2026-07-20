import {
  isActiveSleepTimerState,
  shouldTriggerSleepTimer,
  type SleepTimerState
} from '../shared/sleepTimer.ts'

export interface SleepTimerServiceOptions {
  now?: () => number
  publish?: (kind: 'status' | 'trigger', state: SleepTimerState | null) => void
  setInterval?: (callback: () => void, ms: number) => NodeJS.Timeout
  clearInterval?: (timer: NodeJS.Timeout) => void
}

export class SleepTimerService {
  private state: SleepTimerState | null = null
  private timer: NodeJS.Timeout | null = null
  private readonly now: () => number
  private readonly notify: (kind: 'status' | 'trigger', state: SleepTimerState | null) => void
  private readonly schedule: (callback: () => void, ms: number) => NodeJS.Timeout
  private readonly cancelInterval: (timer: NodeJS.Timeout) => void

  constructor(options: SleepTimerServiceOptions = {}) {
    this.now = options.now ?? Date.now
    this.notify = options.publish ?? (() => {})
    this.schedule = options.setInterval ?? setInterval
    this.cancelInterval = options.clearInterval ?? clearInterval
  }

  configure(state: SleepTimerState): SleepTimerState {
    if (!isActiveSleepTimerState(state, this.now())) throw new Error('Invalid sleep timer state')
    this.clearTimer()
    this.state = { ...state }
    if (this.state.active && this.state.mode === 'minutes') {
      this.timer = this.schedule(() => this.triggerIfDue('tick'), 1_000)
    }
    this.publish('status')
    return { ...this.state }
  }

  cancel(): SleepTimerState | null {
    this.clearTimer()
    this.state = null
    this.publish('status')
    return null
  }

  snapshot(): SleepTimerState | null {
    return this.state ? { ...this.state } : null
  }

  boundary(event: 'trackEnd' | 'queueEnd'): SleepTimerState | null {
    this.triggerIfDue(event)
    return this.snapshot()
  }

  private triggerIfDue(event: 'tick' | 'trackEnd' | 'queueEnd'): void {
    if (!this.state || !shouldTriggerSleepTimer(this.state, this.now(), event)) return
    this.clearTimer()
    this.state = { ...this.state, active: false, triggered: true }
    this.publish('trigger')
    this.publish('status')
  }

  private publish(kind: 'status' | 'trigger'): void {
    this.notify(kind, this.snapshot())
  }

  private clearTimer(): void {
    if (this.timer) this.cancelInterval(this.timer)
    this.timer = null
  }
}
