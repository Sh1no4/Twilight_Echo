export interface LyricWord {
  time: number
  endTime: number | null
  text: string
}

export interface ParsedTimedLyricLine {
  time: number
  text: string
  words?: LyricWord[]
}

export interface LyricLine {
  time: number | null
  text: string
  translation: string | null
  romanization: string | null
  timed: boolean
  words?: LyricWord[]
}

const LINE_TIMESTAMP_RE = /\[(\d{1,3}):(\d{2})(?:[.:](\d{2,3}))?\]/g
const WORD_TIMESTAMP_RE = /<(\d{1,3}):(\d{2})(?:[.:](\d{2,3}))?>/g
const YRC_LINE_RE =
  /^\[(\d+),(\d+)\](.*)$/
const YRC_WORD_RE = /\((\d+),(\d+),\d+\)([^()\[\]]*)/g

function parseTimestampParts(min: string, sec: string, frac?: string): number {
  let ms = 0
  if (frac) {
    ms = Number.parseInt(frac, 10)
    if (frac.length === 2) ms *= 10
  }
  return Number.parseInt(min, 10) * 60 + Number.parseInt(sec, 10) + ms / 1000
}

function parseEnhancedWords(rawLine: string): { text: string; words: LyricWord[] } | null {
  WORD_TIMESTAMP_RE.lastIndex = 0
  if (!WORD_TIMESTAMP_RE.test(rawLine)) return null

  const timestamps: Array<{ time: number; index: number; end: number }> = []
  let match: RegExpExecArray | null
  WORD_TIMESTAMP_RE.lastIndex = 0
  while ((match = WORD_TIMESTAMP_RE.exec(rawLine)) !== null) {
    timestamps.push({
      time: parseTimestampParts(match[1], match[2], match[3]),
      index: match.index,
      end: match.index + match[0].length
    })
  }
  if (timestamps.length === 0) return null

  const words: LyricWord[] = []
  let plain = ''
  for (let i = 0; i < timestamps.length; i++) {
    const current = timestamps[i]
    const next = timestamps[i + 1]
    const text = rawLine.slice(current.end, next?.index ?? rawLine.length)
    if (!text) continue
    words.push({
      time: current.time,
      endTime: next?.time ?? null,
      text
    })
    plain += text
  }
  const cleaned = plain.replace(LINE_TIMESTAMP_RE, '').trim()
  if (!cleaned || words.length === 0) return null
  return { text: cleaned, words }
}

/** NetEase YRC: [startMs,durationMs](wordStart,wordDur,0)word... */
export function parseYrc(yrc: string | null | undefined): ParsedTimedLyricLine[] {
  if (!yrc) return []
  const lines: ParsedTimedLyricLine[] = []
  for (const raw of yrc.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const lineMatch = YRC_LINE_RE.exec(trimmed)
    if (!lineMatch) continue
    const lineStartMs = Number.parseInt(lineMatch[1], 10)
    const body = lineMatch[3] ?? ''
    const words: LyricWord[] = []
    let plain = ''
    let wordMatch: RegExpExecArray | null
    YRC_WORD_RE.lastIndex = 0
    while ((wordMatch = YRC_WORD_RE.exec(body)) !== null) {
      const startMs = Number.parseInt(wordMatch[1], 10)
      const durMs = Number.parseInt(wordMatch[2], 10)
      const text = wordMatch[3] ?? ''
      if (!text) continue
      words.push({
        time: startMs / 1000,
        endTime: (startMs + durMs) / 1000,
        text
      })
      plain += text
    }
    if (!plain.trim()) continue
    lines.push({
      time: lineStartMs / 1000,
      text: plain,
      words: words.length > 0 ? words : undefined
    })
  }
  lines.sort((a, b) => a.time - b.time)
  return lines
}

export function parseTimedLrc(lrc: string | null | undefined): ParsedTimedLyricLine[] {
  if (!lrc) return []

  // Prefer YRC when the payload looks like NetEase word lyrics.
  if (/^\[\d+,\d+\]/m.test(lrc) && /\(\d+,\d+,\d+\)/.test(lrc)) {
    const yrc = parseYrc(lrc)
    if (yrc.length > 0) return yrc
  }

  const lines: ParsedTimedLyricLine[] = []
  const lineRe = LINE_TIMESTAMP_RE

  for (const raw of lrc.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    const timestamps: Array<{ time: number; index: number; end: number }> = []
    let match: RegExpExecArray | null
    lineRe.lastIndex = 0

    while ((match = lineRe.exec(trimmed)) !== null) {
      timestamps.push({
        time: parseTimestampParts(match[1], match[2], match[3]),
        index: match.index,
        end: match.index + match[0].length
      })
    }

    const enhanced = parseEnhancedWords(trimmed)
    if (enhanced) {
      const lineTime = timestamps[0]?.time ?? enhanced.words[0]?.time ?? 0
      lines.push({ time: lineTime, text: enhanced.text, words: enhanced.words })
      continue
    }

    const text = trimmed.replace(lineRe, '').trim()
    if (!text || timestamps.length === 0) continue

    const hasInlineTimestamps = timestamps.some((timestamp, index) => {
      if (index === 0) return timestamp.index > 0
      const previous = timestamps[index - 1]
      return trimmed.slice(previous.end, timestamp.index).trim().length > 0
    })

    if (hasInlineTimestamps) {
      // Legacy multi-tag-with-text mid-line without Enhanced markers: keep line-level only.
      lines.push({ time: timestamps[0].time, text })
      continue
    }

    for (const ts of timestamps) {
      lines.push({ time: ts.time, text })
    }
  }

  lines.sort((a, b) => a.time - b.time)
  return lines
}

export function parsePlainLyrics(lyrics: string | null | undefined): string[] {
  if (!lyrics) return []

  const timeTagRe = /\[\d{1,3}:\d{2}(?:[.:]\d{2,3})?\]/g
  const wordTagRe = /<\d{1,3}:\d{2}(?:[.:]\d{2,3})?>/g
  const metadataTagRe = /^\[[a-zA-Z]+:.*\]$/

  return lyrics
    .split('\n')
    .map((line) => line.replace(timeTagRe, '').replace(wordTagRe, '').trim())
    .filter((line) => line.length > 0 && !metadataTagRe.test(line))
}

export function buildLyricLines(
  lyrics: string | null | undefined,
  translatedLyrics: string | null | undefined,
  romanizedLyrics?: string | null | undefined
): LyricLine[] {
  const originalLines = parseTimedLrc(lyrics)
  const translatedLines = parseTimedLrc(translatedLyrics)
  const romanizedLines = parseTimedLrc(romanizedLyrics)

  if (originalLines.length > 0) {
    const translatedMap = new Map<number, string>()
    for (const line of translatedLines) {
      translatedMap.set(Math.round(line.time * 1000), line.text)
    }
    const romanizedMap = new Map<number, string>()
    for (const line of romanizedLines) {
      romanizedMap.set(Math.round(line.time * 1000), line.text)
    }

    return originalLines.map((line) => ({
      time: line.time,
      text: line.text,
      translation: translatedMap.get(Math.round(line.time * 1000)) ?? null,
      romanization: romanizedMap.get(Math.round(line.time * 1000)) ?? null,
      timed: true,
      words: line.words
    }))
  }

  if (translatedLines.length > 0) {
    return translatedLines.map((line) => ({
      time: line.time,
      text: line.text,
      translation: null,
      romanization: null,
      timed: true,
      words: line.words
    }))
  }

  const plainLines = parsePlainLyrics(lyrics)
  const plainTranslatedLines = parsePlainLyrics(translatedLyrics)
  const plainRomanizedLines = parsePlainLyrics(romanizedLyrics)
  const sourceLines = plainLines.length > 0 ? plainLines : plainTranslatedLines

  return sourceLines.map((line, index) => ({
    time: null,
    text: line,
    translation: plainLines.length > 0 ? (plainTranslatedLines[index] ?? null) : null,
    romanization: plainRomanizedLines[index] ?? null,
    timed: false
  }))
}

export function findActiveLyricIndex(lines: readonly LyricLine[], currentTime: number): number {
  if (lines.length === 0 || !Number.isFinite(currentTime)) return -1

  let low = 0
  let high = lines.length - 1
  let activeIndex = -1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const lineTime = lines[mid].time

    if (lineTime == null) {
      high = mid - 1
      continue
    }

    if (lineTime <= currentTime) {
      activeIndex = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return activeIndex
}

export function findActiveWordIndex(words: readonly LyricWord[], currentTime: number): number {
  if (!words.length || !Number.isFinite(currentTime)) return -1
  let activeIndex = -1
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    if (word.time <= currentTime) activeIndex = i
    else break
  }
  return activeIndex
}
