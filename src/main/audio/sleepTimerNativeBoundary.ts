import type { EventEmitter } from 'node:events'
import type { SleepTimerService } from '../sleepTimerCore.ts'

interface NativeBoundaryEmitter extends EventEmitter {
  on(
    event: 'sleep-timer-boundary',
    listener: (event: { boundary: 'trackEnd' | 'queueEnd' }) => void
  ): this
}

/** Bridges native delegated-queue boundaries into the main timer authority. */
export function registerNativeSleepTimerBoundaries(
  audioEngine: NativeBoundaryEmitter,
  sleepTimer: Pick<SleepTimerService, 'boundary'>
): void {
  audioEngine.on('sleep-timer-boundary', ({ boundary }) => {
    sleepTimer.boundary(boundary)
  })
}
