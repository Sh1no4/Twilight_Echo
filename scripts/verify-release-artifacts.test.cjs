const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  REQUIRED_NATIVE_BINARIES,
  assertBudget,
  listNativeBinaries,
  listShippedBinaries,
  parseArgs,
  readPeHeader
} = require('./verify-release-artifacts.cjs')

function makeMinimalPe(options = {}) {
  const peOffset = 0x80
  const buffer = Buffer.alloc(0x200)
  buffer.write('MZ')
  buffer.writeUInt32LE(peOffset, 0x3c)
  buffer.write('PE\0\0', peOffset)
  const coff = peOffset + 4
  buffer.writeUInt16LE(0x8664, coff)
  buffer.writeUInt16LE(0, coff + 2)
  buffer.writeUInt32LE(options.symbolTableOffset || 0, coff + 8)
  buffer.writeUInt32LE(options.symbolCount || 0, coff + 12)
  buffer.writeUInt16LE(0xf0, coff + 16)
  const optional = coff + 20
  buffer.writeUInt16LE(0x20b, optional)
  buffer.writeUInt32LE(options.debugDirectoryRva || 0, optional + 112 + 8 * 6)
  buffer.writeUInt32LE(options.debugDirectorySize || 0, optional + 112 + 8 * 6 + 4)
  return buffer
}

test('release artifact arguments require a native directory and installer target', () => {
  assert.throws(() => parseArgs([]), /--native-dir is required/)
  assert.throws(() => parseArgs(['--native-dir', 'native']), /--installer or --artifact-dir/)
  assert.deepEqual(parseArgs(['--native-dir', 'native', '--artifact-dir', 'dist']), {
    nativeDir: 'native',
    artifactDir: 'dist',
    installer: ''
  })
})

test('PE inspection finds stripped and retained debug metadata', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twilight-pe-'))
  try {
    const clean = path.join(dir, 'clean.dll')
    const debug = path.join(dir, 'debug.dll')
    fs.writeFileSync(clean, makeMinimalPe())
    fs.writeFileSync(debug, makeMinimalPe({ debugDirectoryRva: 1, debugDirectorySize: 28 }))
    assert.equal(readPeHeader(clean).symbolCount, 0)
    assert.throws(() => require('./verify-release-artifacts.cjs').assertStrippedPe(debug), /debug directory/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('size checks reject unsafe release inputs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twilight-release-'))
  try {
    const file = path.join(dir, 'item.exe')
    fs.writeFileSync(file, Buffer.alloc(11))
    assert.equal(assertBudget(file, 11), 11)
    assert.throws(() => assertBudget(file, 10), /budget/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('all shipped native DLL/EXE/NODE files receive a size budget while strip checks remain product-only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twilight-shipped-binaries-'))
  try {
    fs.writeFileSync(path.join(dir, 'twilight-audio-engine.dll'), makeMinimalPe())
    fs.writeFileSync(path.join(dir, 'msvcp140.dll'), Buffer.alloc(32))
    fs.writeFileSync(path.join(dir, 'notice.txt'), 'not a binary')
    assert.deepEqual(
      listShippedBinaries(dir).map((filePath) => path.basename(filePath)).sort(),
      ['msvcp140.dll', 'twilight-audio-engine.dll']
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('native binary verification requires the core runtime and verifies optional VST3 helpers when staged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twilight-native-binaries-'))
  try {
    for (const name of REQUIRED_NATIVE_BINARIES) {
      fs.writeFileSync(path.join(dir, name), makeMinimalPe())
    }
    assert.deepEqual(
      listNativeBinaries(dir).map((filePath) => path.basename(filePath)).sort(),
      [...REQUIRED_NATIVE_BINARIES].sort()
    )
    fs.writeFileSync(path.join(dir, 'twilight-vst3-host.exe'), makeMinimalPe())
    fs.writeFileSync(path.join(dir, 'twilight-vst3-scanner.exe'), makeMinimalPe())
    assert.equal(listNativeBinaries(dir).length, REQUIRED_NATIVE_BINARIES.length + 2)
    fs.rmSync(path.join(dir, 'twilight-audio-engine.dll'))
    assert.throws(() => listNativeBinaries(dir), /Missing required native binary/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
