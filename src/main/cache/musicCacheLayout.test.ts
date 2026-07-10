import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const { MANAGED_MUSIC_CACHE_DIRECTORY_NAMES, clearManagedMusicCache, getManagedMusicCacheSize } =
  (await import(
    new URL('./musicCacheLayout.ts', import.meta.url).href
  )) as typeof import('./musicCacheLayout')

test('managed cache clearing preserves the selected root and unrelated user files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'twilight-cache-layout-'))
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const unrelatedFile = join(root, 'keep-me.txt')
  await writeFile(unrelatedFile, 'user-owned')
  for (const name of MANAGED_MUSIC_CACHE_DIRECTORY_NAMES) {
    const directory = join(root, name)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, `${name}.bin`), name)
  }

  assert.ok((await getManagedMusicCacheSize(root)) > 0)
  await clearManagedMusicCache(root)

  assert.equal(await readFile(unrelatedFile, 'utf8'), 'user-owned')
  assert.equal(await getManagedMusicCacheSize(root), 0)
  for (const name of MANAGED_MUSIC_CACHE_DIRECTORY_NAMES) {
    await writeFile(join(root, name, 'recreated.bin'), 'ok')
  }
})

test('managed cache clearing does not follow a symlinked cache directory', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'twilight-cache-symlink-'))
  t.after(async () => {
    await rm(parent, { recursive: true, force: true })
  })
  const root = join(parent, 'cache-root')
  const outside = join(parent, 'outside')
  await mkdir(root)
  await mkdir(outside)
  const sentinel = join(outside, 'keep-me.bin')
  await writeFile(sentinel, 'outside')
  try {
    await symlink(
      outside,
      join(root, 'ncm-cache'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES') {
      t.skip(`symlink creation is unavailable: ${code}`)
      return
    }
    throw error
  }

  await clearManagedMusicCache(root)

  assert.equal(await readFile(sentinel, 'utf8'), 'outside')
  await writeFile(join(root, 'ncm-cache', 'recreated.bin'), 'ok')
})
