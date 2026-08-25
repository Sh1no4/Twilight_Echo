import type { LyricLine } from './lyrics.ts'
import { resolveLyricWordTimings } from './lyricWordChunks.ts'

/**
 * Timeline construction and interlude detection. Line spans come from word
 * timing where available: a held tail that runs past its successor is what
 * produces the hand-off where the finishing line stays lit while the next one
 * begins, so ends are deliberately not clamped to the next start.
 *
 * All times are seconds, matching the parsers in `lyrics.ts`.
 */

/** Interlude records only exist for gaps strictly longer than this. */
export const LYRIC_INTERLUDE_MIN_GAP_SECONDS = 7

/** Dots become visible this long after the previous line ends. */
export const LYRIC_INTERLUDE_LEAD_IN_SECONDS = 0.5

/** Fallback span for a trailing line with no words and no successor. */
export const LYRIC_TRAILING_LINE_SECONDS = 4

/** Sentinel index meaning "the playhead sits before the first line". */
export const LYRIC_INTERLUDE_BEFORE_FIRST = -2

export interface LyricTimelineEntry {
  index: number
  /** Start time. `null` for untimed lines, which never become active. */
  time: number | null
  /** Derived end: last word end, else the next line start, else a fallback. */
  endTime: number | null
  timed: boolean
}

export interface LyricInterlude {
  /** Visible start: previous line end + lead-in. */
  start: number
  /** Interlude end: the next line's start. */
  end: number
  /** Line the gap follows, or `LYRIC_INTERLUDE_BEFORE_FIRST`. */
  afterIndex: number
  /** Raw gap length in seconds; the record only exists when gap > 7. */
  gap: number
}

/** Minimal query state for interlude discovery. */
export interface LyricInterludeQuery {
  scrollToIndex: number
  /** True while the active queue still holds a line. */
  hasActiveLine: boolean
}

/**
 * Derive a concrete span for every line. Word end times win because they are
 * the only source that knows when singing actually stops.
 */
export function buildLyricTimeline(lines: readonly LyricLine[]): LyricTimelineEntry[] {
  const entries: LyricTimelineEntry[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const time = line.time != null && Number.isFinite(line.time) ? line.time : null
    const timed = line.timed && time != null

    let nextTime: number | null = null
    for (let ahead = index + 1; ahead < lines.length; ahead += 1) {
      const candidate = lines[ahead].time
      if (candidate == null || !Number.isFinite(candidate)) continue
      if (time != null && candidate <= time) continue
      nextTime = candidate
      break
    }

    let endTime: number | null = null
    if (time != null) {
      const voiceStarts = line.voices
        ?.map((voice) => voice.time)
        .filter((value): value is number => value != null && Number.isFinite(value))
      const latestVoiceStart = Math.max(time, ...(voiceStarts ?? []))
      const wordLayers = [line.words, ...(line.voices?.map((voice) => voice.words) ?? [])]
      let wordEnd = Number.NEGATIVE_INFINITY
      for (const layer of wordLayers) {
        const words = layer?.length ? resolveLyricWordTimings(layer, nextTime) : []
        for (const word of words) wordEnd = Math.max(wordEnd, word.endTime)
      }
      for (const voice of line.voices ?? []) {
        if (voice.endTime != null && Number.isFinite(voice.endTime)) {
          wordEnd = Math.max(wordEnd, voice.endTime)
        }
      }

      // Deliberately not clamped to the next line's start. A held tail that
      // runs past its successor is what produces the hand-off, where the
      // finishing line stays lit while the next one begins.
      if (wordEnd > time) endTime = wordEnd
      else if (nextTime != null && nextTime > latestVoiceStart) endTime = nextTime
      else endTime = latestVoiceStart + LYRIC_TRAILING_LINE_SECONDS
    }

    entries.push({ index, time, endTime, timed })
  }

  return entries
}

/** True when no line carries word-level timing, i.e. plain or line-only lyrics. */
export function isNonDynamicTimeline(lines: readonly LyricLine[]): boolean {
  return !lines.some((line) => {
    if ((line.words?.length ?? 0) > 1) return true
    return line.voices?.some((voice) => (voice.words?.length ?? 0) > 1) ?? false
  })
}

/**
 * Detect the gap the playhead is sitting in. A record only exists when the raw
 * gap is strictly greater than 7 seconds; nothing is an interlude while the
 * active queue still presents a line.
 */
export function findLyricInterlude(
  timeline: readonly LyricTimelineEntry[],
  query: LyricInterludeQuery,
  time: number
): LyricInterlude | null {
  if (query.hasActiveLine) return null

  const anchor = query.scrollToIndex
  const first = timeline[0]

  if (anchor <= 0 && first?.time != null && first.time > time) {
    const gap = first.time
    if (gap > LYRIC_INTERLUDE_MIN_GAP_SECONDS) {
      return {
        start: Math.min(LYRIC_INTERLUDE_LEAD_IN_SECONDS, first.time),
        end: first.time,
        afterIndex: LYRIC_INTERLUDE_BEFORE_FIRST,
        gap
      }
    }
    return null
  }

  const gapAfter = (index: number): LyricInterlude | null => {
    const current = timeline[index]
    const next = timeline[index + 1]
    if (current?.endTime == null || next?.time == null) return null
    if (next.time > time && current.endTime < time) {
      const gap = next.time - current.endTime
      if (gap > LYRIC_INTERLUDE_MIN_GAP_SECONDS) {
        return {
          start: current.endTime + LYRIC_INTERLUDE_LEAD_IN_SECONDS,
          end: next.time,
          afterIndex: index,
          gap
        }
      }
      return null
    }
    return null
  }

  return gapAfter(Math.max(0, anchor)) ?? gapAfter(Math.max(0, anchor) + 1)
}

export function isDisplayableInterlude(interlude: LyricInterlude | null): boolean {
  return interlude != null && interlude.gap > LYRIC_INTERLUDE_MIN_GAP_SECONDS
}
