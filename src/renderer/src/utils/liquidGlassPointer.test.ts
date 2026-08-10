import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BASE_HIGHLIGHT_ANGLE,
  createFrameCoalescer,
  pointerCssVariables,
  resolveHighlightAngle,
  resolvePointerOffset,
  resolveViewportPointerOffset,
  staticPointerCssVariables
} from './liquidGlassPointer.ts'

const rect = { left: 100, top: 50, width: 200, height: 100 }

test('pointer at the surface center yields no offset', () => {
  assert.deepEqual(resolvePointerOffset(200, 100, rect), { x: 0, y: 0 })
})

test('pointer offset is signed and scaled to percent of surface size', () => {
  // right edge is +50% of width from center
  assert.deepEqual(resolvePointerOffset(300, 100, rect), { x: 50, y: 0 })
  assert.deepEqual(resolvePointerOffset(100, 100, rect), { x: -50, y: 0 })
  // bottom edge is +50% of height
  assert.deepEqual(resolvePointerOffset(200, 150, rect), { x: 0, y: 50 })
  assert.deepEqual(resolvePointerOffset(200, 50, rect), { x: 0, y: -50 })
})

test('pointer offset is clamped so a far pointer cannot swing the highlight wildly', () => {
  const far = resolvePointerOffset(99999, -99999, rect)
  assert.equal(far.x, 100)
  assert.equal(far.y, -100)
})

test('degenerate rects return zero instead of dividing by zero', () => {
  assert.deepEqual(resolvePointerOffset(10, 10, { left: 0, top: 0, width: 0, height: 100 }), {
    x: 0,
    y: 0
  })
  assert.deepEqual(resolvePointerOffset(10, 10, { left: 0, top: 0, width: 100, height: 0 }), {
    x: 0,
    y: 0
  })
})

test('non-finite pointer coordinates degrade to zero', () => {
  const offset = resolvePointerOffset(Number.NaN, Infinity, rect)
  assert.equal(offset.x, 0)
  assert.equal(offset.y, 0)
})

test('viewport offset treats the whole viewport as the surface', () => {
  assert.deepEqual(resolveViewportPointerOffset(960, 540, 1920, 1080), { x: 0, y: 0 })
  assert.deepEqual(resolveViewportPointerOffset(1920, 540, 1920, 1080), { x: 50, y: 0 })
  assert.deepEqual(resolveViewportPointerOffset(0, 0, 1920, 1080), { x: -50, y: -50 })
})

test('highlight angle rotates around the base angle with pointer offset', () => {
  assert.equal(resolveHighlightAngle(0), BASE_HIGHLIGHT_ANGLE)
  assert.ok(resolveHighlightAngle(50) > BASE_HIGHLIGHT_ANGLE, 'right of center rotates one way')
  assert.ok(resolveHighlightAngle(-50) < BASE_HIGHLIGHT_ANGLE, 'left of center rotates the other')
  // symmetric about the base angle
  assert.equal(
    resolveHighlightAngle(30) - BASE_HIGHLIGHT_ANGLE,
    BASE_HIGHLIGHT_ANGLE - resolveHighlightAngle(-30)
  )
})

test('css variables carry deg units and plain offsets', () => {
  const vars = pointerCssVariables({ x: 25, y: -10 })
  assert.match(vars['--te-lg-angle'], /^-?\d+\.\d{2}deg$/)
  assert.equal(vars['--te-lg-pointer-x'], '25.00')
  assert.equal(vars['--te-lg-pointer-y'], '-10.00')
})

test('static variables sit at the neutral base angle', () => {
  const vars = staticPointerCssVariables()
  assert.equal(vars['--te-lg-angle'], `${BASE_HIGHLIGHT_ANGLE.toFixed(2)}deg`)
  assert.equal(vars['--te-lg-pointer-x'], '0.00')
  assert.equal(vars['--te-lg-pointer-y'], '0.00')
})

// --- frame coalescing ---

function manualFrames(): {
  requestFrame: (cb: () => void) => number
  cancelFrame: (handle: number) => void
  runFrame: () => void
  pendingFrames: () => number
} {
  const queue = new Map<number, () => void>()
  let nextHandle = 1
  return {
    requestFrame(cb) {
      const handle = nextHandle++
      queue.set(handle, cb)
      return handle
    },
    cancelFrame(handle) {
      queue.delete(handle)
    },
    runFrame() {
      const entries = [...queue.entries()]
      queue.clear()
      for (const [, cb] of entries) cb()
    },
    pendingFrames() {
      return queue.size
    }
  }
}

test('coalescer defers the callback until the next frame', () => {
  const frames = manualFrames()
  const seen: number[] = []
  const coalescer = createFrameCoalescer<number>((v) => seen.push(v), frames)

  coalescer.schedule(1)
  assert.deepEqual(seen, [], 'nothing runs synchronously')
  frames.runFrame()
  assert.deepEqual(seen, [1])
})

test('bursts collapse to one callback with the latest payload', () => {
  const frames = manualFrames()
  const seen: number[] = []
  const coalescer = createFrameCoalescer<number>((v) => seen.push(v), frames)

  coalescer.schedule(1)
  coalescer.schedule(2)
  coalescer.schedule(3)
  assert.equal(frames.pendingFrames(), 1, 'only one frame is requested for the burst')

  frames.runFrame()
  assert.deepEqual(seen, [3], 'latest payload wins')
})

test('separate frames each deliver their own payload', () => {
  const frames = manualFrames()
  const seen: number[] = []
  const coalescer = createFrameCoalescer<number>((v) => seen.push(v), frames)

  coalescer.schedule(1)
  frames.runFrame()
  coalescer.schedule(2)
  frames.runFrame()

  assert.deepEqual(seen, [1, 2])
})

test('coalescer reports pending state accurately', () => {
  const frames = manualFrames()
  const coalescer = createFrameCoalescer<number>(() => {}, frames)

  assert.equal(coalescer.hasPending(), false)
  coalescer.schedule(1)
  assert.equal(coalescer.hasPending(), true)
  frames.runFrame()
  assert.equal(coalescer.hasPending(), false)
})

test('cancel drops the pending payload and its frame', () => {
  const frames = manualFrames()
  const seen: number[] = []
  const coalescer = createFrameCoalescer<number>((v) => seen.push(v), frames)

  coalescer.schedule(1)
  coalescer.cancel()

  assert.equal(coalescer.hasPending(), false)
  assert.equal(frames.pendingFrames(), 0, 'the frame is released too')
  frames.runFrame()
  assert.deepEqual(seen, [], 'cancelled payload never flushes')
})

test('scheduling after cancel works again', () => {
  const frames = manualFrames()
  const seen: number[] = []
  const coalescer = createFrameCoalescer<number>((v) => seen.push(v), frames)

  coalescer.schedule(1)
  coalescer.cancel()
  coalescer.schedule(2)
  frames.runFrame()

  assert.deepEqual(seen, [2])
})

test('a frame firing with no payload does not invoke the callback', () => {
  const frames = manualFrames()
  let calls = 0
  const coalescer = createFrameCoalescer<number>(() => {
    calls++
  }, frames)

  coalescer.schedule(1)
  frames.runFrame()
  assert.equal(calls, 1)

  // a stray extra frame must not re-flush the consumed payload
  frames.runFrame()
  assert.equal(calls, 1)
})

test('payloads scheduled from inside a flush land on a later frame', () => {
  const frames = manualFrames()
  const seen: number[] = []
  const coalescer: { current?: ReturnType<typeof createFrameCoalescer<number>> } = {}
  coalescer.current = createFrameCoalescer<number>((v) => {
    seen.push(v)
    if (v < 3) coalescer.current?.schedule(v + 1)
  }, frames)

  coalescer.current.schedule(1)
  frames.runFrame()
  assert.deepEqual(seen, [1])
  frames.runFrame()
  assert.deepEqual(seen, [1, 2])
  frames.runFrame()
  assert.deepEqual(seen, [1, 2, 3])
})
