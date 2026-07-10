import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MINI_PLAYER_MAX_HEIGHT,
  MINI_PLAYER_MAX_WIDTH,
  MINI_PLAYER_MIN_HEIGHT,
  MINI_PLAYER_MIN_WIDTH,
  clampMiniPlayerBoundsToWorkArea,
  miniPlayerBoundsPatch
} from './miniPlayerWindow.ts'

test('mini player bounds clamp size before position inside a display work area', () => {
  const bounds = clampMiniPlayerBoundsToWorkArea(
    { x: -500, y: -200, width: 1400, height: 50 },
    { x: 0, y: 0, width: 800, height: 600 }
  )
  assert.deepEqual(bounds, {
    x: 0,
    y: 0,
    width: Math.min(MINI_PLAYER_MAX_WIDTH, 800),
    height: MINI_PLAYER_MIN_HEIGHT
  })
})

test('mini player bounds support negative monitor coordinates', () => {
  const bounds = clampMiniPlayerBoundsToWorkArea(
    { x: -3000, y: 90, width: 520, height: 220 },
    { x: -1920, y: 0, width: 1920, height: 1040 }
  )
  assert.deepEqual(bounds, { x: -1920, y: 90, width: 520, height: 220 })
})

test('mini player bounds patch persists position and size together', () => {
  assert.deepEqual(miniPlayerBoundsPatch({ x: 20, y: 30, width: 700, height: 260 }), {
    windowX: 20,
    windowY: 30,
    windowWidth: 700,
    windowHeight: 260
  })
  assert.equal(MINI_PLAYER_MIN_WIDTH, 360)
  assert.equal(MINI_PLAYER_MIN_HEIGHT, 140)
  assert.equal(MINI_PLAYER_MAX_WIDTH, 900)
  assert.equal(MINI_PLAYER_MAX_HEIGHT, 520)
})
