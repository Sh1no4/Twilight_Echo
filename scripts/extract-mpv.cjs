/**
 * electron-builder beforePack hook
 * 仅在打包时运行，将 resources/mpv.zip 解压到 resources/mpv/
 */
const { execSync } = require('child_process')
const { existsSync, mkdirSync } = require('fs')
const { join } = require('path')

module.exports = async function (context) {
  const RESOURCES = join(__dirname, '..', 'resources')
  const MPV_DIR = join(RESOURCES, 'mpv')
  const MPV_ZIP = join(RESOURCES, 'mpv.zip')

  if (!existsSync(MPV_ZIP)) {
    console.warn('[extract-mpv] 未找到 resources/mpv.zip，跳过解压')
    return
  }

  if (existsSync(MPV_DIR)) {
    const mpvExe = join(MPV_DIR, 'mpv.exe')
    if (existsSync(mpvExe)) {
      console.log('[extract-mpv] resources/mpv/ 已存在，跳过解压')
      return
    }
    console.log('[extract-mpv] mpv/ 目录无 mpv.exe，重新解压...')
  }

  console.log('[extract-mpv] 解压 resources/mpv.zip -> resources/mpv/')
  mkdirSync(MPV_DIR, { recursive: true })

  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -Command "Expand-Archive -Path '${MPV_ZIP}' -DestinationPath '${MPV_DIR}' -Force"`,
        { stdio: 'inherit' }
      )
    } else {
      execSync(`unzip -o "${MPV_ZIP}" -d "${MPV_DIR}"`, { stdio: 'inherit' })
    }
    console.log('[extract-mpv] 解压完成')
  } catch (err) {
    console.error('[extract-mpv] 解压失败:', err.message)
    throw err
  }
}
