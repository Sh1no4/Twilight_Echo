import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createLyricViewportController,
  LYRIC_MANUAL_BROWSE_RESET_MS,
  type LyricRowElement
} from './lyricViewportController.ts'
import { buildLyricTimeline, type LyricInterlude } from './lyricTimeline.ts'
import type { LyricLine } from './lyrics.ts'
import {
  criticalRetune,
  LYRIC_SPRING_INIT_ONCE,
  LYRIC_SPRING_LINE,
  LYRIC_SPRING_PRESS,
  LYRIC_SPRING_SEEK_SHORT
} from './lyricMotion.ts'

const ROW_HEIGHT = 72
const STAGE_HEIGHT = 360
const FRAME = 1 / 60

function line(partial: Partial<LyricLine> & { time: number }): LyricLine {
  return {
    text: partial.text ?? 'line',
    translation: null,
    romanization: null,
    timed: true,
    words: [{ text: partial.text ?? 'x', time: partial.time, endTime: partial.time + 2 }],
    voices: undefined,
    rowKey: undefined,
    time: partial.time
  }
}

/** Six lines at 4s spacing: 0-2, 4-6, ..., 20-22. */
const LINES: LyricLine[] = [0, 4, 8, 12, 16, 20].map((time) => line({ time }))

interface FakeRow extends LyricRowElement {
  properties: Map<string, string>
}

function createRow(height = ROW_HEIGHT): FakeRow {
  const properties = new Map<string, string>()
  return {
    offsetHeight: height,
    scrollHeight: height,
    isConnected: true,
    properties,
    style: {
      setProperty: (property, value) => properties.set(property, value),
      removeProperty: (property) => properties.delete(property)
    }
  }
}

function createManualScheduler() {
  const frames = new Map<number, FrameRequestCallback>()
  const timeouts = new Map<number, () => void>()
  let handle = 0
  let now = 1000

  return {
    scheduler: {
      request: (callback) => {
        handle += 1
        frames.set(handle, callback)
        return handle
      },
      cancel: (target) => frames.delete(target),
      scheduleTimeout: (callback) => {
        handle += 1
        timeouts.set(handle, callback)
        return handle
      },
      clearTimeout: (target) => timeouts.delete(target),
      now: () => now
    },
    runFrame: () => {
      const next = frames.entries().next().value as [number, FrameRequestCallback] | undefined
      if (!next) return
      frames.delete(next[0])
      now += FRAME * 1000
      next[1](now)
    },
    runFrames: (count: number) => {
      for (let index = 0; index < count; index += 1) {
        const next = frames.entries().next().value as [number, FrameRequestCallback] | undefined
        if (!next) return
        frames.delete(next[0])
        now += FRAME * 1000
        next[1](now)
      }
    },
    pendingFrames: () => frames.size,
    runTimeouts: () => {
      const pending = [...timeouts.values()]
      timeouts.clear()
      for (const callback of pending) callback()
    }
  }
}

interface Harness {
  controller: ReturnType<typeof createLyricViewportController>
  rows: FakeRow[]
  manual: ReturnType<typeof createManualScheduler>
  playhead: { value: number }
  playing: { value: boolean }
  queues: number[][]
  interludes: (LyricInterlude | null)[]
  dotsTops: (number | null)[]
}

function harness(
  options: {
    lines?: LyricLine[]
    rowCount?: number
    backgroundRows?: number[]
    playing?: boolean
    stageHeight?: number
  } = {}
): Harness {
  const lines = options.lines ?? LINES
  const timeline = buildLyricTimeline(lines)
  const manual = createManualScheduler()
  const playhead = { value: 1 }
  const playing = { value: options.playing ?? true }
  const queues: number[][] = []
  const interludes: (LyricInterlude | null)[] = []
  const dotsTops: (number | null)[] = []
  const rowCount = options.rowCount ?? lines.length
  const rows = Array.from({ length: rowCount }, () => createRow())
  const backgroundRows = new Set(options.backgroundRows ?? [])

  const controller = createLyricViewportController({
    afterLayout: async () => {},
    onManualBrowseChange: () => {},
    getTimeline: () => timeline,
    getPlaybackTime: () => playhead.value,
    isPlaying: () => playing.value,
    onActiveLinesChange: (queue) => queues.push([...queue]),
    onInterlude: (interlude) => interludes.push(interlude),
    onInterludeDotsTop: (top) => dotsTops.push(top),
    alignPosition: 0.5,
    getDeviceScale: () => 1,
    frameScheduler: manual.scheduler
  })

  controller.attach({ clientHeight: options.stageHeight ?? STAGE_HEIGHT, clientWidth: 800 })
  controller.activate('track-a')
  rows.forEach((row, index) => controller.registerRow(index, row, backgroundRows.has(index)))

  return { controller, rows, manual, playhead, playing, queues, interludes, dotsTops }
}

/** Bootstrap the layout, then run frames with the playhead advancing. */
async function start(h: Harness, playSeconds = 0.2): Promise<void> {
  await h.controller.recenter('snap')
  for (let t = 0; t < playSeconds - 1e-9; t += FRAME) {
    h.playhead.value += FRAME
    if (h.manual.pendingFrames() > 0) h.manual.runFrame()
    else h.manual.runTimeouts()
  }
}

/**
 * Bootstrap at a fixed playhead and sync the selector once, without letting
 * the playhead drift: classification tests need `oldTime` exactly known.
 */
async function startAt(h: Harness, time: number): Promise<void> {
  h.playhead.value = time
  await h.controller.recenter('snap')
  h.manual.runFrames(2)
}

function playSeconds(h: Harness, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += FRAME) {
    h.playhead.value += FRAME
    if (h.manual.pendingFrames() > 0) h.manual.runFrame()
    else h.manual.runTimeouts()
  }
}

/** Wake an idled loop; leaves it running when the next line is near. */
function wake(h: Harness): void {
  h.manual.runTimeouts()
  h.manual.runFrame()
}

test('the selector promotes the current line and reports the queue', async () => {
  const h = harness()
  await start(h)

  assert.deepEqual(h.controller.getActiveQueue(), [0])
  assert.equal(h.controller.getCurrentIndex(), 0)
  assert.ok(h.queues.some((queue) => queue.length === 1 && queue[0] === 0))
})

test('the one-shot init writes 260/50 before ordinary updates take over', async () => {
  const h = harness()
  await h.controller.recenter('snap')
  assert.deepEqual(h.controller.getRowSpringParams(0), LYRIC_SPRING_INIT_ONCE)

  // A normal (non-seek) layout restores the ordinary line spring.
  await start(h, 0.05)
  playSeconds(h, 3.5)
  assert.deepEqual(h.controller.getRowSpringParams(0), LYRIC_SPRING_LINE)
})

test('explicit short seeks retune every row to the 0.1s critical spring', async () => {
  const h = harness()
  await start(h)

  h.controller.notifySeek(1.9)
  assert.equal(h.controller.getLastSeekKind(), 'short')
  assert.deepEqual(h.controller.getRowSpringParams(0), LYRIC_SPRING_SEEK_SHORT)
  assert.deepEqual(h.controller.getRowSpringParams(3), LYRIC_SPRING_SEEK_SHORT)
  // The 0.1s critical spring settles quickly.
  h.manual.runFrames(12)
  assert.ok(
    Math.abs((h.controller.getRowTop(0) ?? 0) - (h.controller.getRowTargetTop(0) ?? 0)) < 0.01
  )
})

test('a large seek snaps and restores the ordinary spring', async () => {
  const h = harness()
  await start(h)

  h.controller.notifySeek(17)
  assert.equal(h.controller.getLastSeekKind(), 'large')
  assert.deepEqual(h.controller.getRowSpringParams(0), LYRIC_SPRING_LINE)
  assert.deepEqual(h.controller.getActiveQueue(), [4])
  // Snapped: positions equal their targets immediately.
  assert.equal(h.controller.getRowTop(4), h.controller.getRowTargetTop(4))
})

test('seek classification boundaries are strict over line distance', async () => {
  // Lines every 0.7s so line distance and time distance can be isolated.
  const dense = Array.from({ length: 8 }, (_, index) => line({ time: index * 0.7 }))

  // deltaLine = 3 (not > 3) and deltaTime = 2.0 (not > 2): short.
  const h = harness({ lines: dense, stageHeight: 300 })
  await startAt(h, 0.2)
  h.controller.notifySeek(2.2)
  assert.equal(h.controller.getLastSeekKind(), 'short')

  // deltaTime 2.1 > 2.0 with the same line distance: large.
  const h2 = harness({ lines: dense, stageHeight: 300 })
  await startAt(h2, 0.2)
  h2.controller.notifySeek(2.3)
  assert.equal(h2.controller.getLastSeekKind(), 'large')

  // deltaLine = 4 > 3: large regardless of the time budget.
  const h3 = harness({ lines: dense, stageHeight: 300 })
  await startAt(h3, 0.2)
  h3.controller.notifySeek(2.9)
  assert.equal(h3.controller.getLastSeekKind(), 'large')
})

test('playback-clock discontinuities are detected per frame, strictly', async () => {
  // Detection only runs on live frames, so park the playhead inside the
  // pre-line window where the loop keeps running (candidate at 4s).
  const h = harness()
  await start(h, 0.1)
  playSeconds(h, 1.6)
  assert.ok(h.manual.pendingFrames() > 0, 'the loop should be live inside the window')

  // A gap of exactly 1.5s is not a discontinuity.
  h.playhead.value += 1.5
  h.manual.runFrame()
  assert.equal(h.controller.getLastSeekKind(), 'none')

  // Slightly past 1.5s is.
  h.playhead.value += 1.6
  h.manual.runFrame()
  assert.notEqual(h.controller.getLastSeekKind(), 'none')

  // Backwards past 1.0s is.
  const h2 = harness()
  await start(h2, 0.1)
  playSeconds(h2, 1.6)
  assert.ok(h2.manual.pendingFrames() > 0)
  h2.playhead.value -= 1.1
  h2.manual.runFrame()
  assert.notEqual(h2.controller.getLastSeekKind(), 'none')

  // Returning to under 10% of a >5s clock is.
  const h3 = harness()
  await start(h3, 0.1)
  h3.playhead.value = 14.7
  wake(h3)
  assert.ok(h3.manual.pendingFrames() > 0, 'the loop should be live at 14.7s')
  h3.playhead.value = 1.2
  h3.manual.runFrame()
  assert.notEqual(h3.controller.getLastSeekKind(), 'none')
})

test('the loop idles between lines and wakes before the retune window', async () => {
  const h = harness()
  // 1.2s lets the bootstrap springs settle before the candidate's window.
  await start(h, 1.2)
  // Candidate line 1 starts at 4: well past the idle margin, and the
  // bootstrap springs have settled, so nothing keeps the loop alive.
  assert.equal(h.manual.pendingFrames(), 0, 'the loop should idle with nothing pending')

  // Continuous playback advances through wake-ups; the promotion at
  // ~3.29s re-opens the loop and the queue advances.
  playSeconds(h, 3.1)
  assert.deepEqual(h.controller.getActiveQueue(), [1])
})

test('tier-2 retune pre-tunes the upcoming line with the budget formula', async () => {
  const h = harness()
  await start(h, 0.1)
  // Drive past one line change so every row runs the ordinary line spring
  // (mass 1), then approach line 2 (starts at 8s).
  playSeconds(h, 5.65)
  // Line 1 (4-6) lost its protection at 6.5, so the queue waits on line 2.
  assert.deepEqual(h.controller.getActiveQueue(), [])
  // delta = 8 - 6.75 = 1.25: R = 0.75 < 0.8 and the fresh spring settles
  // too slowly, so T = max(R - 0.4, 0.3) = 0.35.
  h.manual.runFrames(2)
  const params = h.controller.getRowSpringParams(2)
  assert.ok(params, 'line 2 should carry a row spring')
  const expected = criticalRetune(1, 0.35)
  assert.ok(Math.abs(params.stiffness - expected.stiffness) < 1e-6)
  assert.ok(Math.abs(params.damping - expected.damping) < 1e-6)
})

test('tier-1 retune takes over inside 1.1s and settles in 0.3s', async () => {
  const h = harness()
  await start(h, 0.1)
  playSeconds(h, 5.85)
  // delta = 8 - 6.95 = 1.05 < 1.1: T = max(0.3, 0.01) = 0.3.
  h.manual.runFrames(2)
  const params = h.controller.getRowSpringParams(2)
  assert.ok(params, 'line 2 should carry a row spring')
  const expected = criticalRetune(1, 0.3)
  assert.ok(Math.abs(params.stiffness - expected.stiffness) < 1e-6)
  assert.ok(Math.abs(params.damping - expected.damping) < 1e-6)
})

test('manual drag follows through the low-pass and de-blurs', async () => {
  const h = harness()
  await start(h, 0.1)

  // Distant row carries blur before the interaction.
  h.controller.browseBy(60)
  assert.ok(h.controller.isManualBrowsing())
  h.manual.runFrames(30)
  // targetOffset = 2 * 1 * 60 = 120, followed within the snap threshold.
  assert.ok(Math.abs(h.controller.getDragOffset() - 120) < 0.51)
  assert.ok(h.controller.getInteractionBlend() > 0.9, 'interaction blend approaches 1')

  // Release folds the offset back and re-follows.
  h.controller.releaseManualBrowse()
  assert.ok(!h.controller.isManualBrowsing())
  h.manual.runFrames(40)
  assert.equal(h.controller.getDragOffset(), 0)
  assert.ok(h.controller.getInteractionBlend() < 0.01)
})

test('the manual browse timer releases after 1.5s of inactivity', async () => {
  const h = harness()
  await start(h, 0.1)
  assert.equal(LYRIC_MANUAL_BROWSE_RESET_MS, 1500)

  h.controller.browseBy(40)
  assert.ok(h.controller.isManualBrowsing())
  h.manual.runTimeouts()
  assert.ok(!h.controller.isManualBrowsing())
})

test('click press and release use their two documented springs', async () => {
  const h = harness()
  await start(h, 0.1)

  h.controller.rowPointerDown(1)
  h.manual.runFrames(6)
  const scaleDuringPress = Number(h.rows[1].properties.get('--lyric-line-scale')?.replace('px', ''))
  assert.ok(scaleDuringPress < 0.98, `pressed scale ${scaleDuringPress} should shrink toward 0.95`)
  assert.ok(
    Number(h.rows[1].properties.get('--lyric-line-press')) > 0,
    'the pressed row gains a white overlay tint'
  )

  h.controller.rowPointerUp(1)
  h.manual.runFrames(30)
  const scaleAfterRelease = Number(h.rows[1].properties.get('--lyric-line-scale'))
  assert.ok(Math.abs(scaleAfterRelease - 0.98) < 0.01, 'release returns the row to full scale')
  assert.equal(Number(h.rows[1].properties.get('--lyric-line-press')), 0)
  void LYRIC_SPRING_PRESS
})

test('auxiliary rows animate their opacity through the activity spring', async () => {
  const h = harness({ backgroundRows: [1] })
  await start(h, 0.1)
  h.manual.runFrames(30)

  // Line 1 is a background row; while line 0 sings it sits at the auxiliary
  // inactive blend (its content hides itself in CSS, the row collapses).
  const collapsedAlpha = Number(h.rows[1].properties.get('--lyric-line-opacity'))
  assert.ok(Math.abs(collapsedAlpha - 0.175) < 0.01, `collapsed alpha ${collapsedAlpha}`)

  // Once line 1 itself becomes active, the activity spring opens it up.
  playSeconds(h, 2.5)
  h.manual.runFrames(20)
  const activeAlpha = Number(h.rows[1].properties.get('--lyric-line-opacity'))
  assert.ok(activeAlpha > 0.2, `active auxiliary alpha ${activeAlpha} should rise toward 0.5`)
})

test('a long gap surfaces an interlude record for the dots', async () => {
  const gapLines = [line({ time: 0 }), line({ time: 20 })]
  const h = harness({ lines: gapLines })
  await start(h, 0.1)
  // Line 0 ends at 2; from 2.5..20 nothing is active and the gap is 18s.
  playSeconds(h, 2)
  h.manual.runFrames(5)

  const record = h.interludes.at(-1)
  assert.ok(record, 'an interlude record should be discovered in the long gap')
  assert.equal(record.afterIndex, 0)
  assert.equal(record.end, 20)
  assert.ok(record.start > 2 && record.start < 3)
})

test('registerRow replacement keeps the previous position', async () => {
  const h = harness()
  await start(h, 0.1)
  const before = h.controller.getRowTop(2)

  const replacement = createRow()
  h.controller.registerRow(2, replacement)
  h.manual.runFrames(2)
  assert.ok(Math.abs((h.controller.getRowTop(2) ?? 0) - (before ?? 0)) < 0.01)
})

test('dispose stops the loop and clears state', async () => {
  const h = harness()
  await start(h, 0.1)
  h.controller.dispose()
  assert.equal(h.manual.pendingFrames(), 0)
  assert.equal(h.controller.trackId(), '')
})
