import assert from 'node:assert/strict'
import test from 'node:test'
import { createSleepTimerState } from '../shared/sleepTimer.ts'
import { SleepTimerService } from './sleepTimerCore.ts'

test('main sleep timer is the only trigger authority for elapsed and boundary modes', () => {
  let now = 1_000
  const scheduler = { tick: null as (() => void) | null }
  const publications: Array<{ kind: string; triggered: boolean | null }> = []
  const timer = new SleepTimerService({
    now: () => now,
    setInterval: (callback) => {
      scheduler.tick = callback
      return {} as NodeJS.Timeout
    },
    clearInterval: () => {},
    publish: (kind, state) => publications.push({ kind, triggered: state?.triggered ?? null })
  })

  timer.configure(createSleepTimerState('minutes', now, { defaultMinutes: 1, fadeSeconds: 0 }, 1))
  assert.ok(scheduler.tick)
  now += 59_999
  scheduler.tick?.()
  assert.equal(timer.snapshot()?.triggered, false)
  now += 1
  scheduler.tick?.()
  assert.equal(timer.snapshot()?.triggered, true)
  assert.equal(publications.filter((entry) => entry.kind === 'trigger').length, 1)

  timer.configure(createSleepTimerState('queueEnd', now, { defaultMinutes: 1, fadeSeconds: 0 }))
  assert.equal(timer.boundary('trackEnd')?.triggered, false)
  assert.equal(timer.boundary('queueEnd')?.triggered, true)
})

test('main sleep timer rejects malformed configuration before it can schedule work', () => {
  const timer = new SleepTimerService({ publish: () => {}, now: () => 1_000 })
  assert.throws(
    () =>
      timer.configure({
        mode: 'minutes',
        endsAt: null,
        fadeSeconds: 1,
        active: true,
        triggered: false
      }),
    /Invalid sleep timer state/
  )
  assert.throws(
    () =>
      timer.configure({
        mode: 'minutes',
        endsAt: 2_000,
        fadeSeconds: 1,
        active: true,
        triggered: true
      }),
    /Invalid sleep timer state/
  )
  assert.throws(
    () =>
      timer.configure({
        mode: 'minutes',
        endsAt: 1_000,
        fadeSeconds: 1,
        active: true,
        triggered: false
      }),
    /Invalid sleep timer state/
  )
})
