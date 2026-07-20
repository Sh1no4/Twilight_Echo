import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSleepTimerState,
  isSleepTimerState,
  remainingSleepTimerSeconds,
  shouldTriggerSleepTimer
} from './sleepTimer.ts'

const settings = { defaultMinutes: 10, fadeSeconds: 8 }

test('minute sleep timer triggers only after its requested duration', () => {
  const state = createSleepTimerState('minutes', 1_000, settings, 2)
  assert.equal(remainingSleepTimerSeconds(state, 1_000), 120)
  assert.equal(shouldTriggerSleepTimer(state, 120_999, 'tick'), false)
  assert.equal(shouldTriggerSleepTimer(state, 121_000, 'tick'), true)
})

test('runtime state guard rejects malformed IPC and session timer payloads', () => {
  const valid = createSleepTimerState('minutes', 1_000, settings, 2)
  assert.equal(isSleepTimerState(valid), true)
  assert.equal(isSleepTimerState({ ...valid, endsAt: null }), false)
  assert.equal(isSleepTimerState({ ...valid, fadeSeconds: 121 }), false)
  assert.equal(isSleepTimerState({ ...valid, mode: 'later' }), false)
  assert.equal(isSleepTimerState({ mode: 'queueEnd', endsAt: 5, fadeSeconds: 1 }), false)
  assert.equal(isSleepTimerState({ ...valid, active: true, triggered: true }), false)
  assert.equal(isSleepTimerState({ ...valid, active: false, triggered: false }), false)
})

test('track and queue sleep modes only trigger for their matching playback boundary', () => {
  const track = createSleepTimerState('trackEnd', 0, settings)
  const queue = createSleepTimerState('queueEnd', 0, settings)
  assert.equal(shouldTriggerSleepTimer(track, 0, 'queueEnd'), false)
  assert.equal(shouldTriggerSleepTimer(track, 0, 'trackEnd'), true)
  assert.equal(shouldTriggerSleepTimer(queue, 0, 'trackEnd'), false)
  assert.equal(shouldTriggerSleepTimer(queue, 0, 'queueEnd'), true)
})
