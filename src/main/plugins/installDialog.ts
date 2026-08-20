/**
 * Local plugin install dialog options.
 *
 * Electron 的 open dialog 在 Windows 与 Linux 上无法同时充当文件选择器和目录选择器：
 * 一旦 `properties` 同时包含 `openFile` 与 `openDirectory`，这两个平台只会弹出目录
 * 选择器，于是「从本地安装包 (.tep)」按钮实际上在让用户挑文件夹。因此两种来源各自
 * 拥有一个对话框：默认的 `.tep` 包选择器，以及开发者模式下才开放的未打包目录选择器。
 */

const PLUGIN_PACKAGE_EXTENSION = 'tep'

/** `.tep` 包（所有用户）或未打包目录（仅开发者模式）。 */
export type LocalPluginInstallSourceKind = 'package' | 'directory'

/** 渲染进程传来的来源类型只有显式的 'directory' 才放行目录选择器。 */
export function normalizeLocalPluginInstallSourceKind(
  value: unknown
): LocalPluginInstallSourceKind {
  return value === 'directory' ? 'directory' : 'package'
}

/**
 * 目录安装是开发者向能力（未打包目录没有包哈希这类证据），只在设置里开启开发者模式
 * 后才开放；这是功能开关，不是安全边界——两种来源都仍走同一套信任式安装确认。
 */
export function assertLocalPluginInstallSourceAllowed(
  kind: LocalPluginInstallSourceKind,
  developerMode: boolean
): void {
  if (kind === 'directory' && developerMode !== true) {
    throw new Error('安装未打包的插件目录需要先在「设置 → 常规 → 开发者选项」中开启开发者模式')
  }
}

export function buildLocalPluginInstallDialogOptions(
  kind: LocalPluginInstallSourceKind = 'package'
): Electron.OpenDialogOptions {
  if (kind === 'directory') {
    return {
      title: '安装未打包的 Twilight Echo 插件目录',
      properties: ['openDirectory']
    }
  }
  return {
    title: '安装 Twilight Echo 插件',
    properties: ['openFile'],
    filters: [
      { name: 'Twilight Echo Plugin', extensions: [PLUGIN_PACKAGE_EXTENSION] },
      { name: 'All Files', extensions: ['*'] }
    ]
  }
}
