import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createThemePreviewScheduler,
  type ThemePreviewFrameClock
} from './themePreviewScheduler.ts'

function createFrameClock(): ThemePreviewFrameClock & {
  callbacks: Map<number, (timestamp: number) => void>
  runNext(): void
} {
  let nextHandle = 1
  const callbacks = new Map<number, (timestamp: number) => void>()
  return {
    callbacks,
    request(callback) {
      const handle = nextHandle++
      callbacks.set(handle, callback)
      return handle
    },
    cancel(handle) {
      callbacks.delete(handle)
    },
    runNext() {
      const entry = callbacks.entries().next().value as
        | [number, (timestamp: number) => void]
        | undefined
      assert.ok(entry)
      callbacks.delete(entry[0])
      entry[1](16.67)
    }
  }
}

test('theme preview scheduler applies only the latest value in an animation frame', async () => {
  const clock = createFrameClock()
  const applied: number[] = []
  const scheduler = createThemePreviewScheduler<number>(async (value) => {
    applied.push(value)
  }, clock)

  scheduler.schedule(1)
  scheduler.schedule(2)
  scheduler.schedule(3)

  assert.equal(clock.callbacks.size, 1)
  assert.equal(scheduler.hasPending(), true)
  clock.runNext()
  await scheduler.flush()
  assert.deepEqual(applied, [3])
  assert.equal(scheduler.hasPending(), false)
})

test('theme preview scheduler flushes the latest value before Apply', async () => {
  const clock = createFrameClock()
  const applied: string[] = []
  const scheduler = createThemePreviewScheduler<string>((value) => {
    applied.push(value)
  }, clock)

  scheduler.schedule('first')
  scheduler.schedule('latest')
  await scheduler.flush()

  assert.deepEqual(applied, ['latest'])
  assert.equal(clock.callbacks.size, 0)
})

test('theme preview scheduler cancels an unmounted pending preview', async () => {
  const clock = createFrameClock()
  const applied: string[] = []
  const scheduler = createThemePreviewScheduler<string>((value) => {
    applied.push(value)
  }, clock)

  scheduler.schedule('discarded')
  scheduler.cancel()
  await scheduler.flush()

  assert.deepEqual(applied, [])
  assert.equal(clock.callbacks.size, 0)
})
