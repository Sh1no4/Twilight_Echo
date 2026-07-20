import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { registerNativeSleepTimerBoundaries } from './sleepTimerNativeBoundary.ts'
import { SleepTimerService } from '../sleepTimerCore.ts'
import { createSleepTimerState } from '../../shared/sleepTimer.ts'

test('delegated native queue boundaries are forwarded to the main sleep timer', () => {
  const engine = new EventEmitter()
  const boundaries: string[] = []
  registerNativeSleepTimerBoundaries(engine, {
    boundary: (boundary) => {
      boundaries.push(boundary)
      return null
    }
  })

  engine.emit('sleep-timer-boundary', { boundary: 'trackEnd' })
  engine.emit('sleep-timer-boundary', { boundary: 'queueEnd' })
  assert.deepEqual(boundaries, ['trackEnd', 'queueEnd'])
})

test('the engine-IPC native-boundary registration drives the real main timer once', async () => {
  const { AudioEngineManager } = await import('../audioEngineManager.ts')
  const engine = new AudioEngineManager(
    { exclusiveMode: false },
    {
      nativeBinding: null,
      scheduler: {
        now: () => 1_000,
        setInterval: () => ({}) as NodeJS.Timeout,
        clearInterval: () => {},
        setImmediate: (callback) => callback()
      }
    }
  )
  const timer = new SleepTimerService({ now: () => 1_000 })
  registerNativeSleepTimerBoundaries(engine, timer)
  timer.configure(createSleepTimerState('queueEnd', 1_000, { defaultMinutes: 1, fadeSeconds: 0 }))
  engine.emit('sleep-timer-boundary', { boundary: 'queueEnd' })
  engine.emit('sleep-timer-boundary', { boundary: 'queueEnd' })
  assert.equal(timer.snapshot()?.triggered, true)
})
