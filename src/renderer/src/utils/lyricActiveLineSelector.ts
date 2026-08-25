import { clamp, springSettleTime } from './lyricMotion.ts'
import type { LyricTimelineEntry } from './lyricTimeline.ts'

/**
 * Active-line selector (report section 2.6). The active line is not "the line
 * whose span contains the playhead": a candidate line is promoted *early*, by
 * an anticipation window derived from the line spring's settle time, into a
 * small queue that lets the outgoing line coexist with the incoming one.
 *
 * Queue mechanics per the report:
 * - The queue cap is 2 on Windows; public configuration clamps it to 0..3.
 * - An ordinary line stays in the queue until 0.5s after its end (end-overlap
 *   protection); special lines get 0.
 * - A candidate is promoted once its start is within the anticipation window.
 *   Into an empty queue it is added; into a non-empty queue it appends (both
 *   lines sing) only when both are ordinary, the queue has room, order is
 *   forward and the candidate has already started — otherwise it replaces the
 *   outgoing line.
 * - When the oldest entry is within 0.8s of losing its protection
 *   (end - now - 0.5 < 0.3, strict) and the successor keeps forward order,
 *   the queue rotates early.
 */

/** Epsilon used by the anticipation settle-time estimate. */
export const LYRIC_ANTICIPATION_EPSILON = 0.00073

/** Fixed-mode spring identity: zeta 0.9 over period 0.62831853071795862. */
export const LYRIC_ANTICIPATION_FIXED_ZETA = 0.9
export const LYRIC_ANTICIPATION_FIXED_PERIOD = 0.62831853071795862
export const LYRIC_ANTICIPATION_FIXED_SECONDS = 0.71023338004566794

/** Adaptive-mode interpolation window over the gap between lines. */
export const LYRIC_ANTICIPATION_GAP_MIN = 0.2
export const LYRIC_ANTICIPATION_GAP_SPAN = 0.55

/** Queue limits. */
export const LYRIC_MAX_ACTIVE_LINES_DEFAULT = 2
export const LYRIC_MAX_ACTIVE_LINES_LIMIT = 3

/** End-overlap protection, in seconds. */
export const LYRIC_END_OVERLAP_PROTECT_SECONDS = 0.5
/** Early-rotation window: rotate when end - now - protect < 0.3 (strict). */
export const LYRIC_END_ROTATE_WINDOW_SECONDS = 0.3

/** Transition budgets, in seconds. */
export const LYRIC_TRANSITION_ENTER_BASE_SECONDS = 0.5
export const LYRIC_TRANSITION_QUEUE_SECONDS = 0.6

export interface LyricActiveLineState {
  /** Ordered queue of active line indices; the tail is the current line. */
  queue: number[]
  /** The line waiting to be promoted. */
  candidateIndex: number
}

export interface LyricActiveLineReading extends LyricActiveLineState {
  /** Tail of the queue, or -1 when nothing is active. */
  currentIndex: number
  /** Start time of the line after the current one, when known. */
  nextLineStart: number | null
  /** Start time of the next candidate. */
  candidateStart: number | null
  /** Whether the active set changed this tick. */
  changed: boolean
  /** True on the tick a line entered the queue. */
  promoted: boolean
  /** True on the tick a line left the queue. */
  demoted: boolean
}

export interface LyricActiveLineSelectorOptions {
  /** Queue cap; clamped to 0..3. Windows default is 2. */
  maxActiveLines?: number
  /**
   * Adaptive anticipation grows with the gap between the previous active
   * line's end and the candidate's start. Disable for the fixed mode.
   */
  adaptive?: boolean
}

interface LineFacts {
  start: number | null
  end: number | null
  special: boolean
}

function lineFacts(entry: LyricTimelineEntry | undefined): LineFacts {
  if (!entry || !entry.timed || entry.time == null) return { start: null, end: null, special: true }
  return { start: entry.time, end: entry.endTime ?? entry.time, special: false }
}

/**
 * Anticipation seconds from the gap between the previous active line's end and
 * the candidate's start.
 *
 *   x = clamp((max(gap, 0.2) - 0.2) / 0.55, 0, 1)
 *   zeta = 0.90 - 0.12 * x
 *   period = 0.48 + 0.27 * x
 */
export function anticipationSeconds(gap: number | null): number {
  if (gap == null) {
    return springSettleTime(
      LYRIC_ANTICIPATION_FIXED_ZETA,
      LYRIC_ANTICIPATION_FIXED_PERIOD,
      LYRIC_ANTICIPATION_EPSILON
    )
  }
  const x = clamp(
    (Math.max(gap, LYRIC_ANTICIPATION_GAP_MIN) - LYRIC_ANTICIPATION_GAP_MIN) /
      LYRIC_ANTICIPATION_GAP_SPAN,
    0,
    1
  )
  const zeta = 0.9 - 0.12 * x
  const period = 0.48 + 0.27 * x
  return springSettleTime(zeta, period, LYRIC_ANTICIPATION_EPSILON)
}

function nextTimedIndex(timeline: readonly LyricTimelineEntry[], fromIndex: number): number {
  for (let index = Math.max(0, fromIndex) + 1; index < timeline.length; index += 1) {
    if (lineFacts(timeline[index]).start != null) return index
  }
  return -1
}

export function createLyricActiveLineSelector(options: LyricActiveLineSelectorOptions = {}) {
  const maxActiveLines = clamp(
    options.maxActiveLines ?? LYRIC_MAX_ACTIVE_LINES_DEFAULT,
    0,
    LYRIC_MAX_ACTIVE_LINES_LIMIT
  )
  const adaptive = options.adaptive ?? true

  let queue: number[] = []
  let candidateIndex = -1
  let lastPlaybackTime: number | null = null

  function reading(
    timeline: readonly LyricTimelineEntry[],
    changed: boolean,
    promoted: boolean,
    demoted: boolean
  ): LyricActiveLineReading {
    const currentIndex = queue.length > 0 ? queue[queue.length - 1] : -1
    // With an empty queue the upcoming line is the candidate itself; with an
    // active line it is the next timed line after it.
    const upcomingIndex =
      currentIndex >= 0 ? nextTimedIndex(timeline, currentIndex) : candidateIndex
    const candidate = lineFacts(timeline[candidateIndex])
    return {
      queue: [...queue],
      candidateIndex,
      currentIndex,
      nextLineStart: upcomingIndex >= 0 ? (timeline[upcomingIndex].time ?? null) : null,
      candidateStart: candidate.start,
      changed,
      promoted,
      demoted
    }
  }

  /** Reset the queue and rebuild it around `time` (seek, rewind, track change). */
  function reset(timeline: readonly LyricTimelineEntry[], time: number): LyricActiveLineReading {
    queue = []
    candidateIndex = -1

    // Seed with lines still singing or inside their end-overlap protection,
    // keeping the newest when the cap truncates the set.
    for (let index = 0; index < timeline.length; index += 1) {
      const facts = lineFacts(timeline[index])
      if (facts.start == null || facts.end == null) continue
      const protect = facts.special ? 0 : LYRIC_END_OVERLAP_PROTECT_SECONDS
      if (facts.start <= time && facts.end + protect > time) {
        queue.push(index)
        if (queue.length > Math.max(1, maxActiveLines)) queue.shift()
      }
    }

    candidateIndex =
      queue.length > 0
        ? nextTimedIndex(timeline, queue[queue.length - 1])
        : nextTimedIndex(timeline, -1)
    lastPlaybackTime = time
    return reading(timeline, true, queue.length > 0, false)
  }

  /**
   * Advance the selector to `time` (seconds). Returns the reading; `changed`
   * is true when the queue gained or lost a line.
   */
  function advance(timeline: readonly LyricTimelineEntry[], time: number): LyricActiveLineReading {
    // A first touch or backwards playback rebuilds the state.
    if (lastPlaybackTime == null || time < lastPlaybackTime - 1e-9) {
      return reset(timeline, time)
    }

    let changed = false
    let promoted = false
    let demoted = false

    // Drop lines whose end-overlap protection has expired.
    if (queue.length > 0) {
      const survivors: number[] = []
      for (const index of queue) {
        const facts = lineFacts(timeline[index])
        const protect = facts.special ? 0 : LYRIC_END_OVERLAP_PROTECT_SECONDS
        if (facts.end == null || facts.end + protect > time) survivors.push(index)
      }
      if (survivors.length !== queue.length) {
        demoted = true
        changed = true
        queue = survivors
      }
    }

    // Promote every candidate whose start is within the anticipation window.
    if (maxActiveLines > 0) {
      for (let guard = 0; guard < timeline.length + 1; guard += 1) {
        if (candidateIndex < 0) break
        const candidate = lineFacts(timeline[candidateIndex])
        if (candidate.start == null || candidate.special) {
          candidateIndex = nextTimedIndex(timeline, candidateIndex)
          continue
        }

        const tailIndex = queue.length > 0 ? queue[queue.length - 1] : -1
        const tail = lineFacts(timeline[tailIndex])
        const gap = tail.end != null && candidate.start != null ? candidate.start - tail.end : null
        const anticipation = adaptive ? anticipationSeconds(gap) : anticipationSeconds(null)

        if (candidate.start > time + anticipation) break

        if (queue.length === 0) {
          queue.push(candidateIndex)
        } else {
          const appendable =
            !tail.special &&
            queue.length < maxActiveLines &&
            tailIndex < candidateIndex &&
            candidate.start < time
          if (appendable) {
            queue.push(candidateIndex)
          } else {
            // Replace: the incoming line takes the outgoing line's slot.
            queue.shift()
            queue.push(candidateIndex)
            demoted = true
          }
        }
        candidateIndex = nextTimedIndex(timeline, candidateIndex)
        changed = true
        promoted = true
      }
    }

    // Early rotation: the oldest entry is within 0.8s of losing its
    // protection and the successor keeps forward order.
    if (queue.length >= maxActiveLines && maxActiveLines > 0 && candidateIndex >= 0) {
      const oldestIndex = queue[0]
      const oldest = lineFacts(timeline[oldestIndex])
      const candidate = lineFacts(timeline[candidateIndex])
      if (
        !oldest.special &&
        !candidate.special &&
        oldest.end != null &&
        oldest.end - time - LYRIC_END_OVERLAP_PROTECT_SECONDS < LYRIC_END_ROTATE_WINDOW_SECONDS &&
        oldestIndex < candidateIndex
      ) {
        queue.shift()
        changed = true
        demoted = true
      }
    }

    lastPlaybackTime = time
    return reading(timeline, changed, promoted, demoted)
  }

  function getState(): LyricActiveLineState {
    return { queue: [...queue], candidateIndex }
  }

  return { advance, reset, getState, anticipationSeconds, maxActiveLines }
}

export type LyricActiveLineSelector = ReturnType<typeof createLyricActiveLineSelector>
