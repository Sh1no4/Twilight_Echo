import assert from 'node:assert/strict'
import test from 'node:test'
import { validateThemeArchiveBuffer } from './themeArchiveValidation.ts'

test('theme archive preflight accepts bounded file shapes', () => {
  const archive = createArchive([
    { name: 'theme.json', size: 128 },
    { name: 'assets/cover.png', size: 1024 }
  ])
  assert.doesNotThrow(() => validateThemeArchiveBuffer(archive))
})

test('theme archive preflight rejects traversal, remote-code formats, and encryption', () => {
  assert.throws(
    () => validateThemeArchiveBuffer(createArchive([{ name: '../theme.json', size: 1 }])),
    /路径越界/
  )
  assert.throws(
    () =>
      validateThemeArchiveBuffer(
        createArchive([
          { name: 'theme.json', size: 1 },
          { name: 'assets/theme.svg', size: 1 }
        ])
      ),
    /只能包含/
  )
  assert.throws(
    () => validateThemeArchiveBuffer(createArchive([{ name: 'theme.json', size: 1, flags: 1 }])),
    /不受支持/
  )
})

test('theme archive preflight rejects declared zip bombs before extraction', () => {
  assert.throws(
    () =>
      validateThemeArchiveBuffer(
        createArchive([{ name: 'theme.json', size: 2 * 1024 * 1024 + 1 }])
      ),
    /theme\.json 过大/
  )
  assert.throws(
    () =>
      validateThemeArchiveBuffer(
        createArchive([
          { name: 'theme.json', size: 1 },
          { name: 'assets/huge.webp', size: 40 * 1024 * 1024 + 1 }
        ])
      ),
    /解压规模/
  )
})

interface ArchiveEntry {
  name: string
  size: number
  flags?: number
}

function createArchive(entries: ArchiveEntry[]): Buffer {
  const central: Buffer[] = []
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(entry.flags ?? 0x0800, 8)
    header.writeUInt16LE(0, 10)
    header.writeUInt32LE(Math.min(entry.size, 1024), 20)
    header.writeUInt32LE(entry.size, 24)
    header.writeUInt16LE(name.length, 28)
    central.push(header, name)
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(0, 16)
  return Buffer.concat([directory, end])
}
