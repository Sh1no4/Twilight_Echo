import assert from 'node:assert/strict'
import test from 'node:test'
import { createVisibilityPollingController } from './visibilityPolling.ts'

test('visibility polling controller cancels while hidden and resumes when visible', () => {
  let hidden = true
  let stopped = 0
  let resumed = 0
  const controller = createVisibilityPollingController({
    isHidden: () => hidden,
    stop: () => {
      stopped += 1
    },
    resume: () => {
      resumed += 1
    }
  })
  assert.equal(controller.shouldPoll(), false)
  controller.onVisibilityChange()
  hidden = false
  assert.equal(controller.shouldPoll(), true)
  controller.onVisibilityChange()
  assert.deepEqual({ stopped, resumed }, { stopped: 1, resumed: 1 })
})
