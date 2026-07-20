'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const {
  createVisibilityAnimationController
} = require('../resources/audio-visualizer/visibility-animation-controller.js')
test('iframe visibility controller cancels and restarts animation loops', () => {
  let hidden = true
  let stopped = 0
  let resumed = 0
  const controller = createVisibilityAnimationController(
    () => hidden,
    () => {
      stopped += 1
    },
    () => {
      resumed += 1
    }
  )
  controller.onVisibilityChange()
  hidden = false
  controller.onVisibilityChange()
  assert.deepEqual({ stopped, resumed }, { stopped: 1, resumed: 1 })
})
