import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readCoverDataUrl } from './networkCover.ts'

const ENTRY_ID = 'a'.repeat(64)
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

test('readCoverDataUrl returns a data url for jpg and png covers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'network-cover-'))
  try {
    await writeFile(join(dir, `${ENTRY_ID}.jpg`), TINY_PNG)
    const jpg = await readCoverDataUrl(ENTRY_ID, dir)
    assert.ok(jpg?.startsWith('data:image/jpeg;base64,'))

    const pngId = 'b'.repeat(64)
    await writeFile(join(dir, `${pngId}.png`), TINY_PNG)
    const png = await readCoverDataUrl(pngId, dir)
    assert.ok(png?.startsWith('data:image/png;base64,'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('readCoverDataUrl returns null for missing covers and rejects invalid ids', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'network-cover-'))
  try {
    assert.equal(await readCoverDataUrl('f'.repeat(64), dir), null)
    assert.equal(await readCoverDataUrl('../evil', dir), null)
    assert.equal(await readCoverDataUrl('not-hex', dir), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
