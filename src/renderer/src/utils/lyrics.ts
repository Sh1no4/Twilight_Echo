export interface ParsedTimedLyricLine {
  time: number
  text: string
}

export interface LyricLine {
  time: number | null
  text: string
  translation: string | null
  timed: boolean
}

export function parseTimedLrc(lrc: string | null | undefined): ParsedTimedLyricLine[] {
  if (!lrc) return []

  const lines: ParsedTimedLyricLine[] = []
  const lineRe = /\[(\d{1,3}):(\d{2})(?:[.:](\d{2,3}))?\]/g

  for (const raw of lrc.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    const timestamps: Array<{ time: number; index: number; end: number }> = []
    let match: RegExpExecArray | null
    lineRe.lastIndex = 0

    while ((match = lineRe.exec(trimmed)) !== null) {
      const min = Number.parseInt(match[1], 10)
      const sec = Number.parseInt(match[2], 10)
      let ms = 0

      if (match[3]) {
        ms = Number.parseInt(match[3], 10)
        if (match[3].length === 2) {
          ms *= 10
        }
      }

      timestamps.push({
        time: min * 60 + sec + ms / 1000,
        index: match.index,
        end: match.index + match[0].length
      })
    }

    const text = trimmed.replace(lineRe, '').trim()
    if (!text || timestamps.length === 0) continue

    const hasInlineTimestamps = timestamps.some((timestamp, index) => {
      if (index === 0) return timestamp.index > 0
      const previous = timestamps[index - 1]
      return trimmed.slice(previous.end, timestamp.index).trim().length > 0
    })

    if (hasInlineTimestamps) {
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
  const metadataTagRe = /^\[[a-zA-Z]+:.*\]$/

  return lyrics
    .split('\n')
    .map((line) => line.replace(timeTagRe, '').trim())
    .filter((line) => line.length > 0 && !metadataTagRe.test(line))
}

export function buildLyricLines(
  lyrics: string | null | undefined,
  translatedLyrics: string | null | undefined
): LyricLine[] {
  const originalLines = parseTimedLrc(lyrics)
  const translatedLines = parseTimedLrc(translatedLyrics)

  if (originalLines.length > 0) {
    const translatedMap = new Map<number, string>()
    for (const line of translatedLines) {
      translatedMap.set(Math.round(line.time * 1000), line.text)
    }

    return originalLines.map((line) => ({
      time: line.time,
      text: line.text,
      translation: translatedMap.get(Math.round(line.time * 1000)) ?? null,
      timed: true
    }))
  }

  if (translatedLines.length > 0) {
    return translatedLines.map((line) => ({
      time: line.time,
      text: line.text,
      translation: null,
      timed: true
    }))
  }

  const plainLines = parsePlainLyrics(lyrics)
  const plainTranslatedLines = parsePlainLyrics(translatedLyrics)
  const sourceLines = plainLines.length > 0 ? plainLines : plainTranslatedLines

  return sourceLines.map((line, index) => ({
    time: null,
    text: line,
    translation: plainLines.length > 0 ? (plainTranslatedLines[index] ?? null) : null,
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
