const { copyFileSync, existsSync, mkdirSync, statSync } = require('node:fs')
const { join, resolve } = require('node:path')

const root = join(__dirname, '..')
const outputDir = join(root, 'resources', 'audio-engine')
const buildDirOptionIndex = process.argv.indexOf('--build-dir')
const selectedBuildDir =
  buildDirOptionIndex === -1
    ? ''
    : process.argv[buildDirOptionIndex + 1]
      ? resolve(process.argv[buildDirOptionIndex + 1])
      : ''
if (buildDirOptionIndex !== -1 && !selectedBuildDir) {
  console.error('Usage: node scripts/stage-audio-engine.cjs [--build-dir <path>]')
  process.exit(1)
}
const defaultMingwBuildDir = join(root, 'audio-engine', 'build', 'mingw-static')
const configuredMingwBuildDir = process.env.TAE_MINGW_BUILD_DIR
  ? resolve(process.env.TAE_MINGW_BUILD_DIR)
  : defaultMingwBuildDir
const buildDirs = selectedBuildDir
  ? [selectedBuildDir]
  : [
      configuredMingwBuildDir,
      defaultMingwBuildDir,
      join(root, 'audio-engine', 'build', 'windows-msvc'),
      join(root, 'audio-engine', 'build', 'default')
    ].filter((directory, index, directories) => directories.indexOf(directory) === index)
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
  if (selectedBuildDir) {
    console.error(
      `Selected audio-engine build directory does not contain runtime files: ${selectedBuildDir}`
    )
    process.exit(1)
  }
  console.error(
    `No audio-engine runtime files were found in:\n${buildDirs.join('\n')}\n` +
      'Run the matching audio-engine build first, or provide --build-dir for an explicitly selected build.'
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
