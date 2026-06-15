import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const {
  deletePluginSetting,
  getPluginSetting,
  pluginSettingsPath,
  setPluginSetting
} = (await import(new URL('./settingsStore.ts', import.meta.url).href)) as typeof import('./settingsStore')

test('stores plugin settings inside plugin private data directory', async () => {
  const storagePath = await mkdtemp(join(tmpdir(), 'twilight-plugin-settings-'))

  await setPluginSetting(storagePath, 'launchCount', 2)
  await setPluginSetting(storagePath, 'nested', { ok: true })

  assert.equal(await getPluginSetting(storagePath, 'launchCount'), 2)
  assert.deepEqual(await getPluginSetting(storagePath), {
    launchCount: 2,
    nested: { ok: true }
  })

  await deletePluginSetting(storagePath, 'launchCount')
  assert.equal(await getPluginSetting(storagePath, 'launchCount'), undefined)

  const raw = await readFile(pluginSettingsPath(storagePath), 'utf-8')
  assert.deepEqual(JSON.parse(raw), { nested: { ok: true } })
})

test('rejects blank plugin setting keys', async () => {
  const storagePath = await mkdtemp(join(tmpdir(), 'twilight-plugin-settings-'))
  await assert.rejects(() => setPluginSetting(storagePath, '  ', true), /settings key/)
})
