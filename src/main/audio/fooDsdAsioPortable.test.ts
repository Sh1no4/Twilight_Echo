import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { inspectFooDsdAsioPortable } from './fooDsdAsioPortable.ts'

test('matches a nested Foobar2000 portable profile and both DSD components', async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), 'twilight-foobar-portable-'))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  const root = join(fixture, 'foobar2000CN', 'foobar2000')
  const asio = join(root, 'profile', 'user-components-x64', 'foo_out_asio+dsd')
  const sacd = join(root, 'profile', 'user-components-x64', 'foo_input_sacd')
  await Promise.all([mkdir(asio, { recursive: true }), mkdir(sacd, { recursive: true })])
  await Promise.all([
    writeFile(join(root, 'foobar2000.exe'), ''),
    writeFile(join(root, 'portable_mode_enabled'), ''),
    writeFile(join(asio, 'foo_out_asio+dsd.dll'), ''),
    writeFile(join(sacd, 'foo_input_sacd.dll'), '')
  ])

  const status = await inspectFooDsdAsioPortable(fixture)

  assert.equal(status.rootPath, root)
  assert.equal(status.portableModeEnabled, true)
  assert.equal(status.hasAsioDsdComponent, true)
  assert.equal(status.hasSacdComponent, true)
  assert.equal(status.matched, true)
})

test('reports partial and invalid Foobar2000 portable selections', async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), 'twilight-foobar-partial-'))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  const root = join(fixture, 'foobar2000')
  const sacd = join(root, 'components', 'foo_input_sacd')
  await mkdir(sacd, { recursive: true })
  await Promise.all([
    writeFile(join(root, 'foobar2000.exe'), ''),
    writeFile(join(sacd, 'foo_input_sacd.dll'), '')
  ])

  const partial = await inspectFooDsdAsioPortable(root)
  assert.equal(partial.matched, false)
  assert.equal(partial.hasSacdComponent, true)
  assert.equal(partial.hasAsioDsdComponent, false)

  const invalid = await inspectFooDsdAsioPortable(join(fixture, 'missing'))
  assert.equal(invalid.rootPath, '')
  assert.match(invalid.message, /foobar2000\.exe/)
})
