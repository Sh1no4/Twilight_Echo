import {
  clamp,
  exponentialFollow,
  LYRIC_SWEEP_SEEK_RATE,
  LYRIC_SWEEP_SEEK_SNAP_PX
} from './lyricMotion.ts'

/**
 * Karaoke sweep (report section 8). The singing edge is a single boundary in
 * "cumulative text width" coordinates: each time group's highlight target is
 * its cumulative width plus a leading allowance of `30 * factor`, and the
 * boundary chases group targets through a linear keyframe whose duration is
 * the group's own span (stretched when the leading allowance is still ahead,
 * capped at 3x). After a seek the boundary follows the instant-correct
 * position through an exact exponential low-pass at 12 s^-1 instead.
 */

/** Leading allowance in px, shared by every group and the line's tail. */
export const SWEEP_LEAD_PX = 30

/** Leading-width factors, applied in priority order (last wins). */
export const SWEEP_FACTOR_SHORT_BYTES = 0.25
export const SWEEP_FACTOR_DEFAULT = 0.12
export const SWEEP_FACTOR_FEW_GROUPS = 0.5
export const SWEEP_FACTOR_LAST_GROUP = 1

/** A group counts as "few characters" under 3 non-space UTF-8 bytes. */
export const SWEEP_SHORT_BYTE_COUNT = 3
export const SWEEP_FEW_GROUP_COUNT = 3

/** Initial-sentinel keyframe duration, in seconds. */
export const SWEEP_SENTINEL_DURATION_SECONDS = 0.25

/** Keyframe duration fallback when the group span is not positive. */
export const SWEEP_DURATION_FALLBACK_SECONDS = 1.0

/** Expandable-keyframe stretch cap. */
export const SWEEP_EXPAND_CAP = 3

/**
 * Floor on the per-frame seek travel, in px. The exponential low-pass keeps
 * the documented 12 s^-1 shape while this floor guarantees the boundary still
 * lands when frames arrive sparse and throttled.
 */
export const SWEEP_SEEK_MIN_STEP_PX = 8

export interface SweepTimingWord {
  time: number
  endTime: number
  text: string
}

export interface SyllableSweepGroup {
  index: number
  start: number
  end: number
  /** Non-space UTF-8 byte count of the group's text. */
  bytes: number
  /** Leading factor after the priority rules. */
  factor: number
  /** Cumulative width before this group, in px. */
  startWidth: number
  /** Cumulative width through this group, in px. */
  endWidth: number
  /** Highlight target: `endWidth + 30 * factor`. */
  target: number
  /** Input word indices belonging to this group, in order. */
  wordIndices: number[]
}

function nonSpaceByteCount(text: string): number {
  return new TextEncoder().encode(text.replace(/ /g, '')).length
}

/**
 * Merge words sharing a time range into groups and accumulate widths. Words
 * with the same `[start, end]` are one group; the leading factor follows the
 * report's priority: last group 1.00, then a whole line under 3 groups 0.50,
 * then the group's own non-space byte count (under 3 bytes 0.25, else 0.12).
 */
export function buildSyllableGroups(
  words: readonly SweepTimingWord[],
  widths: readonly number[]
): SyllableSweepGroup[] {
  const groups: SyllableSweepGroup[] = []
  let cumulative = 0

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    const width = Math.max(0, widths[index] ?? 0)
    const previous = groups[groups.length - 1]
    const sameRange =
      previous != null && previous.start === word.time && previous.end === word.endTime

    if (sameRange) {
      previous.endWidth += width
      previous.target = previous.endWidth + SWEEP_LEAD_PX * previous.factor
      previous.wordIndices.push(index)
    } else {
      groups.push({
        index: groups.length,
        start: word.time,
        end: word.endTime,
        bytes: 0,
        factor: SWEEP_FACTOR_DEFAULT,
        startWidth: cumulative,
        endWidth: cumulative + width,
        target: 0,
        wordIndices: [index]
      })
    }
    cumulative += width
  }

  for (const group of groups) {
    group.bytes = group.wordIndices.reduce(
      (sum, wordIndex) => sum + nonSpaceByteCount(words[wordIndex]?.text ?? ''),
      0
    )
    group.factor =
      group.bytes < SWEEP_SHORT_BYTE_COUNT ? SWEEP_FACTOR_SHORT_BYTES : SWEEP_FACTOR_DEFAULT
    if (groups.length < SWEEP_FEW_GROUP_COUNT) group.factor = SWEEP_FACTOR_FEW_GROUPS
  }
  const last = groups[groups.length - 1]
  if (last) last.factor = SWEEP_FACTOR_LAST_GROUP

  for (const group of groups) {
    group.target = group.endWidth + SWEEP_LEAD_PX * group.factor
  }

  return groups
}

/**
 * One sweep channel: the singing boundary for one text layer. Times are
 * seconds; widths are px in the layer's reading-order coordinate.
 */
export class LyricSweepChannel {
  private readonly groups: readonly SyllableSweepGroup[]
  private boundaryValue = 0
  /** Index of the group driving the current keyframe; -2 is the sentinel. */
  private activeGroup = -2
  private from = 0
  private target = 0
  private elapsed = 0
  private duration = 0
  private seeking = false

  constructor(groups: readonly SyllableSweepGroup[] = []) {
    this.groups = groups
  }

  get boundary(): number {
    return this.boundaryValue
  }

  /** The last group's tail: final cumulative width + 30. */
  get finalTarget(): number {
    const last = this.groups[this.groups.length - 1]
    return last ? last.endWidth + SWEEP_LEAD_PX : 0
  }

  /** The group the playhead has most recently entered; -1 before the first. */
  groupAt(playTime: number): number {
    let found = -1
    for (const group of this.groups) {
      if (group.start <= playTime) found = group.index
      else break
    }
    return found
  }

  /** Instant-correct boundary for the seek path. */
  instantBoundary(playTime: number): number {
    if (this.groups.length === 0) return 0
    const first = this.groups[0]
    const last = this.groups[this.groups.length - 1]
    if (playTime < first.start) return 0
    if (playTime >= last.end) return this.finalTarget
    const index = this.groupAt(playTime)
    const group = this.groups[index]
    if (!group) return 0
    const span = group.end - group.start
    const progress = span > 0 ? clamp((playTime - group.start) / span, 0, 1) : 1
    return group.startWidth + (group.target - group.startWidth) * progress
  }

  /** A seek lands: follow the instant boundary exponentially until the next group. */
  markSeek(playTime: number): void {
    this.seeking = true
    this.activeGroup = this.groupAt(playTime)
    this.elapsed = 0
    this.duration = 0
  }

  private startKeyframe(groupIndex: number): void {
    const group = this.groups[groupIndex]
    if (!group) return
    this.from = this.boundaryValue
    this.target = group.target

    if (this.activeGroup === -2) {
      this.duration = SWEEP_SENTINEL_DURATION_SECONDS
    } else {
      this.duration = group.end - group.start
      const baseDistance = group.endWidth - this.from
      const fullDistance = group.target - this.from
      if (baseDistance > 0 && fullDistance > baseDistance) {
        this.duration *= Math.min(fullDistance / baseDistance, SWEEP_EXPAND_CAP)
      }
      if (this.duration <= 0) this.duration = SWEEP_DURATION_FALLBACK_SECONDS
    }
    if (this.duration <= 0) this.duration = SWEEP_SENTINEL_DURATION_SECONDS

    this.elapsed = 0
    this.activeGroup = groupIndex
  }

  /** Advance to `playTime`; returns the boundary in px. */
  update(playTime: number, dt: number): number {
    if (this.groups.length === 0) return 0

    const last = this.groups[this.groups.length - 1]
    const index = this.groupAt(playTime)

    if (this.seeking) {
      if (index !== this.activeGroup) {
        // Playback has crossed into a new group: resume the keyframe machine.
        this.seeking = false
        if (index >= 0) this.startKeyframe(index)
      } else {
        const instant = this.instantBoundary(playTime)
        if (Math.abs(instant - this.boundaryValue) < LYRIC_SWEEP_SEEK_SNAP_PX) {
          this.boundaryValue = instant
        } else {
          const followed = exponentialFollow(this.boundaryValue, instant, dt, LYRIC_SWEEP_SEEK_RATE)
          const remaining = instant - this.boundaryValue
          const step = Math.sign(remaining) * SWEEP_SEEK_MIN_STEP_PX
          this.boundaryValue +=
            Math.abs(followed - this.boundaryValue) >= SWEEP_SEEK_MIN_STEP_PX
              ? followed - this.boundaryValue
              : Math.sign(remaining) * Math.min(Math.abs(step), Math.abs(remaining))
        }
        return this.boundaryValue
      }
    }

    // Outside the groups: clamp to the line's head and tail.
    if (index < 0) {
      this.boundaryValue = 0
      return this.boundaryValue
    }
    if (playTime >= last.end && this.activeGroup !== last.index) {
      // Past the last group with no keyframe carrying it there: the tail
      // applies directly.
      this.boundaryValue = this.finalTarget
      this.activeGroup = last.index
      this.elapsed = 0
      this.duration = 0
      return this.boundaryValue
    }

    if (index !== this.activeGroup) this.startKeyframe(index)

    if (this.activeGroup >= 0 && this.elapsed < this.duration) {
      this.elapsed += dt
      const progress = clamp(this.elapsed / this.duration, 0, 1)
      this.boundaryValue = this.from + (this.target - this.from) * progress
    }
    return this.boundaryValue
  }

  /** True while an epoch seek is steering the exponential follow. */
  isSeeking(): boolean {
    return this.seeking
  }

  /** True once the playhead is past the last group and the boundary has landed. */
  finished(playTime: number): boolean {
    const last = this.groups[this.groups.length - 1]
    if (!last) return true
    if (playTime < last.end) return false
    return Math.abs(this.finalTarget - this.boundaryValue) < LYRIC_SWEEP_SEEK_SNAP_PX
  }
}
