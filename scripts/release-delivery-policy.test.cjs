const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('release configuration does not advertise a placeholder auto-updater and requires Windows signing', () => {
  const builder = read('electron-builder.yml')
  const releaseBuilder = read('electron-builder.release-win.yml')
  assert.doesNotMatch(builder, /example\.com\/auto-updates/)
  assert.doesNotMatch(builder, /^publish:/m)
  assert.match(builder, /^win:\s*$/m)
  assert.doesNotMatch(builder, /^\s+forceCodeSigning:/m)
  assert.match(releaseBuilder, /^\s+forceCodeSigning:\s*true\s*$/m)
  assert.match(builder, /^\s+signAndEditExecutable:\s*false\s*$/m)
  assert.match(releaseBuilder, /^\s+signAndEditExecutable:\s*true\s*$/m)
})

test('Windows packaging strips copied native binaries while signed releases stay fail-closed', () => {
  const afterPack = read('scripts/after-pack-windows.cjs')
  const packageBuild = read('scripts/build-app-package.cjs')
  const releaseBuild = read('scripts/build-windows-release.cjs')
  assert.match(afterPack, /process\.env\.TWILIGHT_RELEASE_BUILD === '1'/)
  assert.match(afterPack, /process\.env\.TWILIGHT_PACKAGE_STRIP === '1'/)
  assert.match(packageBuild, /TWILIGHT_PACKAGE_STRIP: '1'/)
  assert.match(releaseBuild, /TWILIGHT_RELEASE_SIGNING_THUMBPRINT is required/)
  assert.match(releaseBuild, /TWILIGHT_RELEASE_BUILD: '1'/)
  assert.match(releaseBuild, /electron-builder\.release-win\.yml/)
})

test('development packages use maximum compression without a missing NSIS include', () => {
  const builder = read('electron-builder.yml')
  assert.match(builder, /^compression:\s*maximum\s*$/m)
  assert.match(builder, /^electronLanguages:\s*\n\s+- zh-CN\s*\n\s+- zh-TW\s*\n\s+- en-US\s*$/m)
  assert.doesNotMatch(builder, /^\s+- node_modules\/\*\*\s*$/m)
  assert.doesNotMatch(builder, /^\s+include:\s*build\/installer\.nsh\s*$/m)
})

test('update checks download GitHub release installers without electron-updater', () => {
  const projectUrls = read('src/shared/projectUrls.ts')
  const updater = read('src/main/ipc/appIpc.ts')
  const service = read('src/main/app/appUpdateService.ts')
  assert.match(projectUrls, /export const GITHUB_OWNER = 'asenyarzc-cpu'/)
  assert.match(projectUrls, /export const GITHUB_REPO = 'Twilight_Echo'/)
  assert.match(
    projectUrls,
    /GITHUB_API_LATEST_RELEASE_URL = `https:\/\/api\.github\.com\/repos\/\$\{GITHUB_OWNER\}\/\$\{GITHUB_REPO\}\/releases\/latest`/
  )
  assert.match(projectUrls, /RELEASES_URL = `\$\{GITHUB_URL\}\/releases`/)
  assert.match(updater, /checkForAppUpdate/)
  assert.match(updater, /downloadAppUpdate/)
  assert.match(updater, /installDownloadedAppUpdate/)
  assert.doesNotMatch(updater, /autoUpdater/)
  assert.doesNotMatch(service, /electron-updater/)
  assert.doesNotMatch(service, /autoUpdater/)
  assert.match(service, /shell\.openPath/)
  assert.match(service, /createHash\('sha256'\)/)
  const settingsTypes = read('src/renderer/src/components/settings-page/types.ts')
  const about = read('src/renderer/src/components/settings-page/AboutSettingsSection.vue')
  assert.match(settingsTypes, /from '\.\.\/\.\.\/\.\.\/\.\.\/shared\/projectUrls\.ts'/)
  assert.match(settingsTypes, /RELEASES_URL/)
  assert.match(about, /下载更新/)
  assert.match(about, /安装并退出/)
  assert.match(about, /点击检查更新/)
})

test('release docs keep non-Windows audio backends explicitly unverified', () => {
  const readme = read('README.md')
  assert.match(readme, /macOS：走 CoreAudio，原生引擎仍在验证中/)
  assert.match(readme, /Linux：走 ALSA，原生引擎仍在验证中/)
  assert.doesNotMatch(readme, /macOS 与 Linux 的原生音频引擎仍在验证阶段（代码已 release-ready/)
})
