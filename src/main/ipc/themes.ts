import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { basename, extname } from 'node:path'
import {
  TWILIGHT_DEFAULT_THEME,
  TWILIGHT_DEFAULT_THEME_ID,
  type ThemeAssetType,
  type ThemeLibrarySnapshot,
  type ThemeProfileV1,
  type ThemeSelection,
  type ThemeWindowInheritance
} from '../../shared/theme.ts'
import {
  PersistentDataRevisionConflictError,
  createPersistentDataRevisionConflictResponse
} from '../../shared/versionedPersistence.ts'
import { assertTrustedIpcSender } from '../security/electronSecurity.ts'
import { stringifyJsonForIpcStorage } from '../security/ipcValidation.ts'
import { updateAppSettings } from '../audio/state.ts'
import { runtime } from '../core/runtime.ts'
import {
  copyThemeAssets,
  deleteThemeAssets,
  exportThemeArchive,
  importThemeAsset,
  importThemeArchive
} from '../themes/themeArchive.ts'
import {
  deleteThemeProfile,
  loadThemeLibrary,
  saveThemeProfile,
  setActiveTheme,
  setThemeWindowInheritance
} from '../themes/themeLibrary.ts'
import { createInheritedThemeSettingsPatch } from '../themes/windowInheritance.ts'

const MAX_THEME_IPC_BYTES = 2 * 1024 * 1024

export function setupThemeIpc(): void {
  ipcMain.handle('themes:getBootstrap', async (event) => {
    assertTrustedIpcSender(event, 'theme IPC')
    return { library: await loadThemeLibrary(), defaultTheme: TWILIGHT_DEFAULT_THEME }
  })

  ipcMain.handle('themes:list', async (event) => {
    assertTrustedIpcSender(event, 'theme IPC')
    return await loadThemeLibrary()
  })

  ipcMain.handle(
    'themes:save',
    async (event, profile: ThemeProfileV1, expectedRevision: number) => {
      assertTrustedIpcSender(event, 'theme IPC')
      stringifyJsonForIpcStorage(profile, 'theme profile', MAX_THEME_IPC_BYTES)
      return await runMutation(() => saveThemeProfile(profile, expectedRevision))
    }
  )

  ipcMain.handle('themes:delete', async (event, profileId: string, expectedRevision: number) => {
    assertTrustedIpcSender(event, 'theme IPC')
    const result = await runMutation(() =>
      deleteThemeProfile(normalizeShortText(profileId), expectedRevision)
    )
    if ('data' in result) {
      await deleteThemeAssets(normalizeShortText(profileId))
      await synchronizeThemeSettings(result)
    }
    return result
  })

  ipcMain.handle(
    'themes:setActive',
    async (event, selection: ThemeSelection, expectedRevision: number) => {
      assertTrustedIpcSender(event, 'theme IPC')
      stringifyJsonForIpcStorage(selection, 'theme selection', 16 * 1024)
      const result = await runMutation(() => setActiveTheme(selection, expectedRevision))
      if ('data' in result) await synchronizeThemeSettings(result)
      return result
    }
  )

  ipcMain.handle(
    'themes:setWindowInheritance',
    async (event, inheritance: ThemeWindowInheritance, expectedRevision: number) => {
      assertTrustedIpcSender(event, 'theme IPC')
      stringifyJsonForIpcStorage(inheritance, 'theme window inheritance', 16 * 1024)
      const result = await runMutation(() =>
        setThemeWindowInheritance(inheritance, expectedRevision)
      )
      if ('data' in result) await synchronizeThemeSettings(result)
      return result
    }
  )

  ipcMain.handle('themes:export', async (event, profileId: string) => {
    assertTrustedIpcSender(event, 'theme IPC')
    const library = await loadThemeLibrary()
    const profile = library.data.profiles.find(
      (entry) => entry.id === normalizeShortText(profileId)
    )
    if (!profile) throw new Error('主题档案不存在')
    const owner = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    const result = owner
      ? await dialog.showSaveDialog(owner, {
          title: '导出主题',
          defaultPath: `${safeFileName(profile.name)}.tetheme`,
          filters: [{ name: 'Twilight Echo Theme', extensions: ['tetheme'] }]
        })
      : await dialog.showSaveDialog({
          title: '导出主题',
          defaultPath: `${safeFileName(profile.name)}.tetheme`,
          filters: [{ name: 'Twilight Echo Theme', extensions: ['tetheme'] }]
        })
    if (result.canceled || !result.filePath) return null
    const target =
      extname(result.filePath).toLowerCase() === '.tetheme'
        ? result.filePath
        : `${result.filePath}.tetheme`
    await exportThemeArchive(profile, target)
    return target
  })

  ipcMain.handle('themes:import', async (event, expectedRevision: number) => {
    assertTrustedIpcSender(event, 'theme IPC')
    const owner = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    const result = owner
      ? await dialog.showOpenDialog(owner, {
          title: '导入主题',
          properties: ['openFile'],
          filters: [{ name: 'Twilight Echo Theme', extensions: ['tetheme'] }]
        })
      : await dialog.showOpenDialog({
          title: '导入主题',
          properties: ['openFile'],
          filters: [{ name: 'Twilight Echo Theme', extensions: ['tetheme'] }]
        })
    if (result.canceled || result.filePaths.length === 0) return null
    const source = result.filePaths[0]
    if (extname(source).toLowerCase() !== '.tetheme' || basename(source).length > 255) {
      throw new Error('请选择有效的 .tetheme 文件')
    }
    const profile = await importThemeArchive(source)
    try {
      const imported = await runMutation(() => saveThemeProfile(profile, expectedRevision))
      if (!('data' in imported)) await deleteThemeAssets(profile.id)
      return imported
    } catch (error) {
      await deleteThemeAssets(profile.id)
      throw error
    }
  })

  ipcMain.handle('themes:importAsset', async (event, profileId: string, type: ThemeAssetType) => {
    assertTrustedIpcSender(event, 'theme IPC')
    const normalizedType = type === 'font' ? 'font' : 'image'
    const owner = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    const options: OpenDialogOptions = {
      title: normalizedType === 'font' ? '导入主题字体' : '导入主题图片',
      properties: ['openFile'],
      filters:
        normalizedType === 'font'
          ? [{ name: 'WOFF2 Font', extensions: ['woff2'] }]
          : [{ name: 'Theme Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return await importThemeAsset(
      normalizeShortText(profileId),
      result.filePaths[0],
      normalizedType
    )
  })

  ipcMain.handle(
    'themes:copyAssets',
    async (event, sourceProfileId: string, targetProfileId: string) => {
      assertTrustedIpcSender(event, 'theme IPC')
      await copyThemeAssets(
        normalizeShortText(sourceProfileId),
        normalizeShortText(targetProfileId)
      )
    }
  )
}

export async function synchronizeThemeSettings(snapshot: ThemeLibrarySnapshot): Promise<void> {
  const activeTheme = snapshot.data.activeTheme
  await updateAppSettings({
    activeTheme,
    pluginThemeId:
      activeTheme.kind === 'plugin' ? `${activeTheme.pluginId}:${activeTheme.themeId}` : null,
    themeWindowInheritance: snapshot.data.windowInheritance,
    ...(await createInheritedThemeSettingsPatch(snapshot))
  })
}

export async function reconcileThemeAfterPluginChange(): Promise<void> {
  let snapshot = await loadThemeLibrary()
  const active = snapshot.data.activeTheme
  if (active.kind === 'plugin') {
    await runtime.pluginManagerReady
    const extensions = (await runtime.pluginManager?.listExtensions()) ?? []
    const available = extensions.some(
      (extension) =>
        extension.pluginId === active.pluginId &&
        extension.themes.some((theme) => theme.id === active.themeId)
    )
    if (!available) {
      const result = await runMutation(() =>
        setActiveTheme({ kind: 'builtin', id: TWILIGHT_DEFAULT_THEME_ID }, snapshot.revision)
      )
      snapshot = 'data' in result ? result : await loadThemeLibrary()
    }
  }
  await synchronizeThemeSettings(snapshot)
}

async function runMutation(
  mutation: () => Promise<ThemeLibrarySnapshot>
): Promise<ThemeLibrarySnapshot | ReturnType<typeof createPersistentDataRevisionConflictResponse>> {
  try {
    const snapshot = await mutation()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('themes:changed', snapshot)
    }
    return snapshot
  } catch (error) {
    if (error instanceof PersistentDataRevisionConflictError) {
      return createPersistentDataRevisionConflictResponse(error)
    }
    throw error
  }
}

function normalizeShortText(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 160) : ''
}

function safeFileName(value: string): string {
  return (
    Array.from(value, (character) => (character.charCodeAt(0) < 32 ? '_' : character))
      .join('')
      .replace(/[<>:"/\\|?*]/g, '_')
      .trim()
      .slice(0, 80) || 'theme'
  )
}
