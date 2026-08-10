import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { DspAssetLibrary } from './dspAssetLibrary.ts'
import { importDspProfileArchive } from './dspProfileArchive.ts'

function deeplyNestedValue(depth = 128): unknown {
  let value: unknown = 'leaf'
  for (let index = 0; index < depth; index += 1) value = [value]
  return value
}

test('rejects a DSP profile archive manifest with excessive unknown nesting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'twilight-dsp-profile-deep-manifest-'))
  try {
    const archivePath = join(root, 'deep-manifest.tedsp')
    const manifest = Buffer.from(
      JSON.stringify({
        kind: 'twilight-echo-dsp-profile',
        schemaVersion: 1,
        profile: {
          schemaVersion: 1,
          id: 'profile-fixture',
          name: 'Fixture profile',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          scenes: [],
          pinnedSceneId: null,
          assetIds: []
        },
        assets: [],
        padding: deeplyNestedValue()
      }),
      'utf8'
    )
    await writeFile(archivePath, createStoredZip('manifest.json', manifest))

    const assets = new DspAssetLibrary(join(root, 'assets'))
    await assert.rejects(
      () => importDspProfileArchive(archivePath, assets),
      /profile archive manifest is invalid/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

function createStoredZip(fileName: string, data: Buffer): Buffer {
  const name = Buffer.from(fileName, 'utf8')
  const crc = crc32(data)
  const localHeader = Buffer.alloc(30)
  localHeader.writeUInt32LE(0x04034b50, 0)
  localHeader.writeUInt16LE(20, 4)
  localHeader.writeUInt16LE(0, 6)
  localHeader.writeUInt16LE(0, 8)
  localHeader.writeUInt16LE(0, 10)
  localHeader.writeUInt16LE(0, 12)
  localHeader.writeUInt32LE(crc, 14)
  localHeader.writeUInt32LE(data.byteLength, 18)
  localHeader.writeUInt32LE(data.byteLength, 22)
  localHeader.writeUInt16LE(name.byteLength, 26)
  localHeader.writeUInt16LE(0, 28)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0, 8)
  central.writeUInt16LE(0, 10)
  central.writeUInt32LE(0, 12)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(data.byteLength, 20)
  central.writeUInt32LE(data.byteLength, 24)
  central.writeUInt16LE(name.byteLength, 28)
  central.writeUInt16LE(0, 30)
  central.writeUInt16LE(0, 32)
  central.writeUInt16LE(0, 34)
  central.writeUInt16LE(0, 36)
  central.writeUInt32LE(0, 38)
  central.writeUInt32LE(0, 42)

  const centralOffset = localHeader.byteLength + name.byteLength + data.byteLength
  const centralSize = central.byteLength + name.byteLength
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(centralOffset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([localHeader, name, data, central, name, end])
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
