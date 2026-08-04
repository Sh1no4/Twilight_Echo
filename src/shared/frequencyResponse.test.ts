import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  computeFrequencyResponseComparison,
  computeTargetRelativeFrequencyResponse,
  parseAutoEqCsv,
  sampleFrequencyCurveAt
} from './frequencyResponse.ts'

test('parses AutoEq CSV, prefers smoothed response, sorts rows, and averages duplicates', () => {
  const imported = parseAutoEqCsv(
    '\uFEFFfrequency,raw,smoothed,target,equalization\r\n' +
      '1000,-3,-2,1,3\r\n' +
      '100,-6,-5,-1,4\r\n' +
      '1000,-1,0,3,2\r\n',
    'headphone.csv'
  )

  assert.equal(imported.sourceName, 'headphone.csv')
  assert.equal(imported.sourceColumn, 'smoothed')
  assert.deepEqual(imported.sourceCurve, [
    { frequency: 100, db: -5 },
    { frequency: 1000, db: -1 }
  ])
  assert.deepEqual(imported.targetCurve, [
    { frequency: 100, db: -1 },
    { frequency: 1000, db: 2 }
  ])
})

test('falls back to raw response and supports quoted fields', () => {
  const imported = parseAutoEqCsv(
    '"frequency","raw","target"\n"20","-4.5","-1"\n"20000","2.5","3"\n'
  )
  assert.equal(imported.sourceColumn, 'raw')
  assert.equal(imported.sourceCurve[0].db, -4.5)
  assert.equal(imported.targetCurve[1].db, 3)
})

test('rejects missing required columns and invalid rows', () => {
  assert.throws(
    () => parseAutoEqCsv('frequency,raw\n20,-1\n20000,1\n'),
    /missing the target column/
  )
  assert.throws(() => parseAutoEqCsv('frequency,target\n20,-1\n20000,1\n'), /smoothed or raw/)
  assert.throws(
    () => parseAutoEqCsv('frequency,raw,target\n0,-1,0\n20000,1,0\n'),
    /non-positive frequency/
  )
  assert.throws(() => parseAutoEqCsv('frequency,raw,target\n20,nope,0\n20000,1,0\n'), /invalid raw/)
  assert.throws(
    () => parseAutoEqCsv('frequency,raw,target\n20,-1,0\n20,1,0\n'),
    /at least 2 unique frequencies/
  )
})

test('interpolates response linearly in logarithmic frequency space', () => {
  const curve = [
    { frequency: 100, db: -6 },
    { frequency: 1000, db: 6 }
  ]
  assert.ok(Math.abs((sampleFrequencyCurveAt(curve, Math.sqrt(100 * 1000)) ?? 99) - 0) < 1e-9)
  assert.equal(sampleFrequencyCurveAt(curve, 100), -6)
  assert.equal(sampleFrequencyCurveAt(curve, 50), null)
  assert.equal(sampleFrequencyCurveAt(curve, 2000), null)
})

test('computes absolute source, target, combined filter, and corrected response curves', () => {
  const imported = parseAutoEqCsv(
    'frequency,raw,target\n100,-5,-2\n1000,4,1\n10000,2,3\n',
    'measurement.csv'
  )
  const filterResponse = [
    { frequency: 100, db: 2 },
    { frequency: 1000, db: -4 },
    { frequency: 10000, db: 0.5 }
  ]
  const result = computeFrequencyResponseComparison(imported, filterResponse, [100, 1000, 10000])

  assert.deepEqual(result.source, [
    { frequency: 100, db: -5 },
    { frequency: 1000, db: 4 },
    { frequency: 10000, db: 2 }
  ])
  assert.deepEqual(result.target, [
    { frequency: 100, db: -2 },
    { frequency: 1000, db: 1 },
    { frequency: 10000, db: 3 }
  ])
  assert.deepEqual(result.combinedFilter, filterResponse)
  assert.deepEqual(result.corrected, [
    { frequency: 100, db: -3 },
    { frequency: 1000, db: 0 },
    { frequency: 10000, db: 2.5 }
  ])
})

test('computes measured source and DSP-corrected curves relative to a zero dB target', () => {
  const imported = parseAutoEqCsv(
    'frequency,smoothed,target\n100,-5,-2\n1000,4,1\n10000,2,3\n',
    'measurement.csv'
  )
  const dspResponse = [
    { frequency: 100, db: 2 },
    { frequency: 1000, db: -4 },
    { frequency: 10000, db: 0.5 }
  ]
  const result = computeTargetRelativeFrequencyResponse(imported, dspResponse, [100, 1000, 10000])

  assert.deepEqual(result.target, [
    { frequency: 100, db: 0 },
    { frequency: 1000, db: 0 },
    { frequency: 10000, db: 0 }
  ])
  assert.deepEqual(result.sourceDeviation, [
    { frequency: 100, db: -3 },
    { frequency: 1000, db: 3 },
    { frequency: 10000, db: -1 }
  ])
  assert.deepEqual(result.correctedDeviation, [
    { frequency: 100, db: -1 },
    { frequency: 1000, db: -1 },
    { frequency: 10000, db: -0.5 }
  ])
})

test('omits frequencies outside any imported or DSP curve range', () => {
  const imported = parseAutoEqCsv('frequency,raw,target\n100,-1,0\n1000,1,0\n')
  const dspResponse = [
    { frequency: 200, db: 0 },
    { frequency: 800, db: 0 }
  ]
  const result = computeTargetRelativeFrequencyResponse(
    imported,
    dspResponse,
    [100, 200, 500, 800, 1000]
  )
  assert.deepEqual(
    result.target.map((point) => point.frequency),
    [200, 500, 800]
  )
})
