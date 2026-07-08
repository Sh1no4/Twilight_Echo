const { copyFileSync, existsSync, mkdirSync, statSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const outputDir = join(root, 'resources', 'audio-engine')
const buildDirs = [
  join(root, 'audio-engine', 'build', 'mingw-static'),
  join(root, 'audio-engine', 'build', 'windows-msvc'),
  join(root, 'audio-engine', 'build', 'default')
]
const nativeLibrary =
  process.platform === 'win32'
    ? 'twilight-audio-engine.dll'
    : process.platform === 'darwin'
      ? 'libtwilight-audio-engine.dylib'
      : 'libtwilight-audio-engine.so'
const runtimeFiles = [nativeLibrary, 'twilight_audio_node.node']

function findBuildDir() {
  return buildDirs.find((dir) => runtimeFiles.every((file) => existsSync(join(dir, file))))
}

const buildDir = findBuildDir()
if (!buildDir) {
  console.error(
    process.platform === 'win32'
      ? '未找到已构建的原生音频运行文件。请先运行 npm run build:audio-engine:mingw。'
      : '未找到已构建的原生音频运行文件。请先使用 -DTAE_BUILD_NAPI=ON 配置并构建 audio-engine。'
  )
  process.exit(1)
}

mkdirSync(outputDir, { recursive: true })

for (const file of runtimeFiles) {
  const source = join(buildDir, file)
  const target = join(outputDir, file)
  try {
    copyFileSync(source, target)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '未知'
    console.error(
      `暂存原生音频文件失败：${file}。请先关闭正在占用旧文件的播放器窗口或后台进程。错误码：${code}`
    )
    process.exit(1)
  }
  const sizeMiB = (statSync(target).size / 1024 / 1024).toFixed(1)
  console.log(`已暂存原生音频文件：${file}（${sizeMiB} MiB）`)
}
