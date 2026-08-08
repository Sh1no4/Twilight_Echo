import assert from 'node:assert/strict'
import test from 'node:test'
import {
  requestAnimationFrameWithFallback,
  type AnimationFrameFallbackScheduler
} from './animationFrameFallback.ts'

function createScheduler(): {
  scheduler: AnimationFrameFallbackScheduler
  fireFrame: (now: number) => void
  fireTimeout: () => void
  cancelledFrames: number[]
  clearedTimeouts: number[]
} {
  let frame: FrameRequestCallback | null = null
  let timeout: (() => void) | null = null
  let timeoutCleared = false
  const cancelledFrames: number[] = []
  const clearedTimeouts: number[] = []
  return {
    scheduler: {
      request: (callback) => {
        frame = callback
        return 7
      },
      cancel: (handle) => cancelledFrames.push(handle),
      scheduleTimeout: (callback) => {
        timeout = callback
        return 11
      },
      clearTimeout: (handle) => {
        timeoutCleared = true
        clearedTimeouts.push(handle)
      },
      now: () => 123
    },
    fireFrame: (now) => frame?.(now),
    fireTimeout: () => {
      if (!timeoutCleared) timeout?.()
    },
    cancelledFrames,
    clearedTimeouts
  }
}

test('uses requestAnimationFrame when a frame arrives promptly', () => {
  const fake = createScheduler()
  const observed: number[] = []
  requestAnimationFrameWithFallback((now) => observed.push(now), 120, fake.scheduler)

  fake.fireFrame(45)
  fake.fireTimeout()

  assert.deepEqual(observed, [45])
  assert.deepEqual(fake.clearedTimeouts, [11])
})

test('uses the timer fallback when requestAnimationFrame is paused', () => {
  const fake = createScheduler()
  const observed: number[] = []
  requestAnimationFrameWithFallback((now) => observed.push(now), 120, fake.scheduler)

  fake.fireTimeout()
  fake.fireFrame(45)

  assert.deepEqual(observed, [123])
  assert.deepEqual(fake.cancelledFrames, [7])
})

test('cancelling prevents both the frame and fallback from committing', () => {
  const fake = createScheduler()
  const observed: number[] = []
  const cancel = requestAnimationFrameWithFallback((now) => observed.push(now), 120, fake.scheduler)

  cancel()
  fake.fireFrame(45)
  fake.fireTimeout()

  assert.deepEqual(observed, [])
  assert.deepEqual(fake.cancelledFrames, [7])
  assert.deepEqual(fake.clearedTimeouts, [11])
})
