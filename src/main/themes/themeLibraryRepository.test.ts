import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  TWILIGHT_DEFAULT_THEME_ID,
  createDefaultThemeLibraryDocument,
  type ThemeProfileV1
} from '../../shared/theme.ts'
import { PersistentDataRevisionConflictError } from '../../shared/versionedPersistence.ts'
import { ThemeLibraryRepository } from './themeLibraryRepository.ts'

test('theme library migrates initial selection and protects every write with revisions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'twilight-theme-library-'))
  try {
    const repository = new ThemeLibraryRepository(join(directory, 'themes.json'), () =>
      createDefaultThemeLibraryDocument(
        { kind: 'plugin', pluginId: 'com.example.theme', themeId: 'midnight' },
        { miniPlayer: false, desktopLyrics: false }
      )
    )
    const initial = await repository.load()
    assert.equal(initial.revision, 0)
    assert.deepEqual(initial.data.activeTheme, {
      kind: 'plugin',
      pluginId: 'com.example.theme',
      themeId: 'midnight'
    })
    assert.deepEqual(initial.data.windowInheritance, {
      miniPlayer: false,
      desktopLyrics: false
    })

    const saved = await repository.saveProfile(createProfile('user:midnight'), 0)
    assert.equal(saved.revision, 1)
    await assert.rejects(
      () => repository.setActive({ kind: 'user', id: 'user:midnight' }, 0),
      PersistentDataRevisionConflictError
    )
    const active = await repository.setActive({ kind: 'user', id: 'user:midnight' }, 1)
    assert.equal(active.revision, 2)
    const deleted = await repository.deleteProfile('user:midnight', 2)
    assert.equal(deleted.revision, 3)
    assert.deepEqual(deleted.data.activeTheme, {
      kind: 'builtin',
      id: TWILIGHT_DEFAULT_THEME_ID
    })
    await assert.rejects(
      () => repository.deleteProfile(TWILIGHT_DEFAULT_THEME_ID, 3),
      /默认主题不能删除/
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createProfile(id: string): ThemeProfileV1 {
  return {
    schemaVersion: 1,
    id,
    name: 'Midnight',
    description: '',
    baseThemeId: TWILIGHT_DEFAULT_THEME_ID,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    overrides: {
      pureWhite: { 'color.primary.500': '#123456' },
      dark: {}
    }
  }
}
