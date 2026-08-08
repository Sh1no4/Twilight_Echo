import assert from 'node:assert/strict'
import test from 'node:test'
import { createLyricViewportController } from './lyricViewportController.ts'

interface FakeViewport {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

interface FakeRow {
  offsetTop: number
  offsetHeight: number
  offsetParent: FakeViewport | null
}

function createViewport(): FakeViewport {
  return { scrollTop: 0, clientHeight: 180, scrollHeight: 1_200 }
}

function createRow(viewport: FakeViewport, index: number): FakeRow {
  return { offsetTop: index * 120, offsetHeight: 72, offsetParent: viewport }
}

test('centers a later YRC line after switching away and back to its track', async () => {
  const viewport = createViewport()
  const manualBrowseStates: boolean[] = []
  const controller = createLyricViewportController({
    afterLayout: async () => {},
    onManualBrowseChange: (active) => manualBrowseStates.push(active)
  })

  controller.attach(viewport)
  controller.activate('yrc-a')
  controller.registerRow(5, createRow(viewport, 5))
  await controller.follow(5, { durationMs: 0 })
  assert.ok(viewport.scrollTop > 0, 'later YRC line was not centered for track A')

  controller.activate('yrc-b')
  controller.registerRow(0, createRow(viewport, 0))
  await controller.follow(0, { durationMs: 0 })
  assert.equal(viewport.scrollTop, 0, 'track B inherited track A scroll position')

  controller.activate('yrc-a')
  controller.registerRow(5, createRow(viewport, 5))
  await controller.follow(5, { durationMs: 0 })
  assert.ok(viewport.scrollTop > 0, 'returning to YRC track A did not center its later line')
  assert.ok(manualBrowseStates.every((active) => !active), 'automatic scrolling entered manual mode')
})

test('ignores a layout pass that belongs to a previous track activation', async () => {
  const viewport = createViewport()
  let releaseLayout: (() => void) | null = null
  const firstLayout = new Promise<void>((resolve) => {
    releaseLayout = resolve
  })
  let layoutCalls = 0
  const controller = createLyricViewportController({
    afterLayout: async () => {
      layoutCalls += 1
      if (layoutCalls === 1) await firstLayout
    },
    onManualBrowseChange: () => {}
  })

  controller.attach(viewport)
  controller.activate('yrc-a')
  controller.registerRow(5, createRow(viewport, 5))
  const staleFollow = controller.follow(5, { durationMs: 0 })

  controller.activate('yrc-b')
  controller.registerRow(3, createRow(viewport, 3))
  const currentFollow = controller.follow(3, { durationMs: 0 })
  releaseLayout?.()
  await Promise.all([staleFollow, currentFollow])

  assert.ok(viewport.scrollTop > 0, 'current track did not center after the stale layout pass completed')
  assert.equal(controller.trackId(), 'yrc-b')
})

test('a newer active line cancels an older follow that is waiting for layout', async () => {
  const viewport = createViewport()
  let releaseFirstLayout: (() => void) | null = null
  const firstLayout = new Promise<void>((resolve) => {
    releaseFirstLayout = resolve
  })
  let layoutCalls = 0
  const controller = createLyricViewportController({
    afterLayout: async () => {
      layoutCalls += 1
      if (layoutCalls === 1) await firstLayout
    },
    onManualBrowseChange: () => {}
  })

  controller.attach(viewport)
  controller.activate('yrc-a')
  controller.registerRow(0, createRow(viewport, 0))
  controller.registerRow(5, createRow(viewport, 5))
  const staleFollow = controller.follow(0, { durationMs: 0 })

  await controller.follow(5, { durationMs: 0 })
  releaseFirstLayout?.()
  await staleFollow

  assert.ok(viewport.scrollTop > 0, 'a stale layout follow reset the newer active line to the top')
})

test('retains the newly registered row when a reused Vue ref clears an older row', async () => {
  const viewport = createViewport()
  const currentRow = { ...createRow(viewport, 5), isConnected: true }
  const controller = createLyricViewportController({
    afterLayout: async () => {},
    onManualBrowseChange: () => {}
  })

  controller.attach(viewport)
  controller.activate('yrc-a')
  controller.registerRow(5, currentRow)
  // Vue may call the previous ref callback with null after the replacement row
  // has already claimed the same index during A -> B -> A.
  controller.registerRow(5, null)
  await controller.follow(5, { durationMs: 0 })

  assert.ok(viewport.scrollTop > 0, 'a stale ref cleanup removed the current active row')
})

test('uses rendered geometry when a positioned ancestor owns the row offset parent', async () => {
  const viewport = {
    ...createViewport(),
    getBoundingClientRect: () => ({ top: 100 })
  }
  const positionedAncestor = {
    offsetTop: 0,
    offsetHeight: 0,
    offsetParent: null
  }
  const row = {
    offsetTop: 960,
    offsetHeight: 72,
    offsetParent: positionedAncestor,
    getBoundingClientRect: () => ({ top: 100 + 960 - viewport.scrollTop })
  }
  const controller = createLyricViewportController({
    afterLayout: async () => {},
    onManualBrowseChange: () => {}
  })

  controller.attach(viewport)
  controller.activate('yrc-a')
  controller.registerRow(8, row)
  await controller.follow(8, { durationMs: 0 })

  assert.ok(
    viewport.scrollTop > 0,
    'a positioned ancestor outside the scroll viewport prevented lyric following'
  )
})

test('anchors the active line inside the area above a reserved bottom overlay', async () => {
  const viewport = createViewport()
  const reservedController = createLyricViewportController({
    afterLayout: async () => {},
    onManualBrowseChange: () => {},
    anchorRatio: 0.5,
    getBottomReservedPx: () => 48
  })

  reservedController.attach(viewport)
  reservedController.activate('yrc-a')
  reservedController.registerRow(5, createRow(viewport, 5))
  await reservedController.follow(5, { durationMs: 0 })

  // Row 5 top = 600, visible height = 180 - 48 = 132, row height = 72,
  // anchor = (132 - 72) * 0.5 = 30 => scrollTop = 570. The raw viewport center
  // would place it at 546, i.e. 24px lower and behind the overlay.
  assert.equal(viewport.scrollTop, 570, 'reserved bottom space was not subtracted from the anchor')

  const unreservedViewport = createViewport()
  const unreservedController = createLyricViewportController({
    afterLayout: async () => {},
    onManualBrowseChange: () => {},
    anchorRatio: 0.5
  })
  unreservedController.attach(unreservedViewport)
  unreservedController.activate('yrc-a')
  unreservedController.registerRow(5, createRow(unreservedViewport, 5))
  await unreservedController.follow(5, { durationMs: 0 })

  assert.equal(unreservedViewport.scrollTop, 546, 'baseline anchor without a reserved overlay moved')
})
