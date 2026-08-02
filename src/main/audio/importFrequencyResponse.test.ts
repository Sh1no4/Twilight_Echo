import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_IMPORTED_FREQUENCY_RESPONSE_BYTES,
  importFrequencyResponseFromDialog,
  validateFrequencyResponseImportPath,
  validateFrequencyResponseImportText
} from './importFrequencyResponse.ts'

const validCsv = 'frequency,smoothed,target\n20,-1,0\n20000,1,0\n'

test('frequency response import returns null when selection is cancelled', async () => {
  assert.equal(
    await importFrequencyResponseFromDialog(
      { canceled: true, filePaths: [] },
      async () => validCsv
    ),
    null
  )
})

test('frequency response import validates one CSV and returns structured curves only', async () => {
  const imported = await importFrequencyResponseFromDialog(
    { canceled: false, filePaths: ['C:/measurements/headphone.csv'] },
    async () => validCsv,
    async () => Buffer.byteLength(validCsv)
  )
  assert.equal(imported?.sourceName, 'headphone.csv')
  assert.deepEqual(imported?.sourceCurve, [
    { frequency: 20, db: -1 },
    { frequency: 20000, db: 1 }
  ])
  assert.equal('filePath' in (imported as unknown as Record<string, unknown>), false)
})

test('frequency response import rejects wrong extension and multiple files', async () => {
  assert.throws(() => validateFrequencyResponseImportPath('response.txt'), /must be a \.csv file/)
  await assert.rejects(
    importFrequencyResponseFromDialog(
      { canceled: false, filePaths: ['first.csv', 'second.csv'] },
      async () => validCsv
    ),
    /exactly one/
  )
})

test('frequency response import rejects oversized or invalid UTF-8 text', async () => {
  assert.throws(
    () => validateFrequencyResponseImportText('response.csv', `${'x'.repeat(64)}\0`),
    /valid non-empty UTF-8/
  )
  await assert.rejects(
    importFrequencyResponseFromDialog(
      { canceled: false, filePaths: ['response.csv'] },
      async () => validCsv,
      async () => MAX_IMPORTED_FREQUENCY_RESPONSE_BYTES + 1
    ),
    /5 MiB limit/
  )
})
