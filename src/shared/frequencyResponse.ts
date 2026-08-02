export interface FrequencyResponsePoint {
  frequency: number
  db: number
}

export type AutoEqSourceColumn = 'smoothed' | 'raw'

export interface ImportedFrequencyResponse {
  sourceName: string
  sourceColumn: AutoEqSourceColumn
  sourceCurve: FrequencyResponsePoint[]
  targetCurve: FrequencyResponsePoint[]
}

export interface TargetRelativeFrequencyResponse {
  sourceDeviation: FrequencyResponsePoint[]
  target: FrequencyResponsePoint[]
  correctedDeviation: FrequencyResponsePoint[]
}

const MAX_CSV_ROWS = 100_000
const MIN_CURVE_POINTS = 2

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index++
        } else {
          quoted = false
        }
      } else {
        field += character
      }
      continue
    }

    if (character === '"') {
      if (field.length > 0) throw new Error('AutoEq CSV contains an invalid quoted field')
      quoted = true
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index++
      row.push(field)
      field = ''
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      if (rows.length > MAX_CSV_ROWS + 1) {
        throw new Error(`AutoEq CSV exceeds the ${MAX_CSV_ROWS.toLocaleString()} row limit`)
      }
    } else {
      field += character
    }
  }

  if (quoted) throw new Error('AutoEq CSV contains an unterminated quoted field')
  row.push(field)
  if (row.some((value) => value.trim())) rows.push(row)
  if (rows.length > MAX_CSV_ROWS + 1) {
    throw new Error(`AutoEq CSV exceeds the ${MAX_CSV_ROWS.toLocaleString()} row limit`)
  }
  return rows
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function findColumn(headers: string[], aliases: readonly string[]): number {
  return headers.findIndex((header) => aliases.includes(header))
}

function parseFiniteNumber(value: string | undefined, label: string, rowNumber: number): number {
  if (value === undefined || !value.trim()) {
    throw new Error(`AutoEq CSV row ${rowNumber} is missing ${label}`)
  }
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed)) {
    throw new Error(`AutoEq CSV row ${rowNumber} has an invalid ${label}`)
  }
  return parsed
}

function mergeDuplicateFrequencies(
  points: Array<{ frequency: number; sourceDb: number; targetDb: number }>
): Array<{ frequency: number; sourceDb: number; targetDb: number }> {
  const grouped = new Map<number, { sourceTotal: number; targetTotal: number; count: number }>()
  for (const point of points) {
    const current = grouped.get(point.frequency)
    if (current) {
      current.sourceTotal += point.sourceDb
      current.targetTotal += point.targetDb
      current.count++
    } else {
      grouped.set(point.frequency, {
        sourceTotal: point.sourceDb,
        targetTotal: point.targetDb,
        count: 1
      })
    }
  }
  return [...grouped.entries()]
    .map(([frequency, group]) => ({
      frequency,
      sourceDb: group.sourceTotal / group.count,
      targetDb: group.targetTotal / group.count
    }))
    .sort((left, right) => left.frequency - right.frequency)
}

export function parseAutoEqCsv(
  text: string,
  sourceName = 'Imported AutoEq CSV'
): ImportedFrequencyResponse {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('AutoEq CSV must be non-empty text')
  }
  if (/\0/.test(text) || text.includes('\uFFFD')) {
    throw new Error('AutoEq CSV must be valid UTF-8 text')
  }

  const rows = parseCsvRows(text)
  if (rows.length < 2) throw new Error('AutoEq CSV must contain a header and data rows')
  const headers = rows[0].map(normalizeHeader)
  const frequencyIndex = findColumn(headers, ['frequency', 'frequency_hz', 'freq', 'hz'])
  const smoothedIndex = findColumn(headers, ['smoothed', 'smoothed_response'])
  const rawIndex = findColumn(headers, ['raw', 'raw_response'])
  const targetIndex = findColumn(headers, ['target', 'target_response'])

  if (frequencyIndex < 0) throw new Error('AutoEq CSV is missing the frequency column')
  if (targetIndex < 0) throw new Error('AutoEq CSV is missing the target column')
  if (smoothedIndex < 0 && rawIndex < 0) {
    throw new Error('AutoEq CSV must contain a smoothed or raw source response column')
  }

  const sourceColumn: AutoEqSourceColumn = smoothedIndex >= 0 ? 'smoothed' : 'raw'
  const sourceIndex = sourceColumn === 'smoothed' ? smoothedIndex : rawIndex
  const points = rows.slice(1).map((row, index) => {
    const rowNumber = index + 2
    const frequency = parseFiniteNumber(row[frequencyIndex], 'frequency', rowNumber)
    if (frequency <= 0) throw new Error(`AutoEq CSV row ${rowNumber} has a non-positive frequency`)
    return {
      frequency,
      sourceDb: parseFiniteNumber(row[sourceIndex], sourceColumn, rowNumber),
      targetDb: parseFiniteNumber(row[targetIndex], 'target', rowNumber)
    }
  })

  const merged = mergeDuplicateFrequencies(points)
  if (merged.length < MIN_CURVE_POINTS) {
    throw new Error(`AutoEq CSV must contain at least ${MIN_CURVE_POINTS} unique frequencies`)
  }

  return {
    sourceName: sourceName.trim() || 'Imported AutoEq CSV',
    sourceColumn,
    sourceCurve: merged.map((point) => ({ frequency: point.frequency, db: point.sourceDb })),
    targetCurve: merged.map((point) => ({ frequency: point.frequency, db: point.targetDb }))
  }
}

export function sampleFrequencyCurveAt(
  curve: readonly FrequencyResponsePoint[],
  frequency: number
): number | null {
  if (curve.length === 0 || !Number.isFinite(frequency) || frequency <= 0) return null
  if (frequency < curve[0].frequency || frequency > curve[curve.length - 1].frequency) return null

  let low = 0
  let high = curve.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const point = curve[middle]
    if (point.frequency === frequency) return point.db
    if (point.frequency < frequency) low = middle + 1
    else high = middle - 1
  }

  const right = curve[low]
  const left = curve[low - 1]
  if (!left || !right || left.frequency <= 0 || right.frequency <= left.frequency) return null
  const ratio =
    (Math.log10(frequency) - Math.log10(left.frequency)) /
    (Math.log10(right.frequency) - Math.log10(left.frequency))
  return left.db + ratio * (right.db - left.db)
}

export function computeTargetRelativeFrequencyResponse(
  imported: ImportedFrequencyResponse,
  dspResponse: readonly FrequencyResponsePoint[],
  frequencies: readonly number[]
): TargetRelativeFrequencyResponse {
  const sourceDeviation: FrequencyResponsePoint[] = []
  const target: FrequencyResponsePoint[] = []
  const correctedDeviation: FrequencyResponsePoint[] = []

  for (const frequency of frequencies) {
    const sourceDb = sampleFrequencyCurveAt(imported.sourceCurve, frequency)
    const targetDb = sampleFrequencyCurveAt(imported.targetCurve, frequency)
    const dspDb = sampleFrequencyCurveAt(dspResponse, frequency)
    if (sourceDb === null || targetDb === null || dspDb === null) continue
    const deviation = sourceDb - targetDb
    sourceDeviation.push({ frequency, db: deviation })
    target.push({ frequency, db: 0 })
    correctedDeviation.push({ frequency, db: deviation + dspDb })
  }

  return { sourceDeviation, target, correctedDeviation }
}
