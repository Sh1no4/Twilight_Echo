import type { LyricLine, LyricVoiceLayer } from './lyrics.ts'
import { resolveLyricWordTimings } from './lyricWordChunks.ts'

export interface LyricVoiceWindow {
  start: number
  end: number | null
}

/** Resolve the concrete interval available for a secondary TTML voice. */
export function resolveLyricVoiceWindow(
  voice: LyricVoiceLayer,
  fallbackStart: number | null
): LyricVoiceWindow | null {
  const start = voice.time ?? fallbackStart
  if (start == null || !Number.isFinite(start)) return null

  let end = voice.endTime
  if (end == null || !Number.isFinite(end) || end <= start) end = null
  for (const word of resolveLyricWordTimings(voice.words ?? [], end)) {
    if (word.endTime > start && (end == null || word.endTime > end)) end = word.endTime
  }
  return { start, end }
}

/**
 * Secondary voices stay mounted so the row can animate its height. Their
 * visibility is driven by the voice interval, not by the parent line alone:
 * this is what keeps a later `x-bg` voice hidden until its own entrance.
 */
export function isSupportingVoiceActive(
  voice: LyricVoiceLayer,
  line: LyricLine,
  position: number,
  lineSinging: boolean
): boolean {
  if (voice.role === 'lead' || !lineSinging || !Number.isFinite(position)) return false
  const window = resolveLyricVoiceWindow(voice, line.time)
  if (!window || position < window.start) return false
  return window.end == null || position < window.end
}
