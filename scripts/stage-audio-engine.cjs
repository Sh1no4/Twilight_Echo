const { copyFileSync, existsSync, mkdirSync, statSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const outputDir = join(root, 'resources', 'audio-engine')
const buildDirs = [
  join(root, 'audio-engine', 'build', 'mingw-static'),
  join(root, 'audio-engine', 'build', 'windows-msvc'),
  join(root, 'audio-engine', 'build', 'default')
]
const runtimeFiles = ['twilight-audio-engine.dll', 'twilight_audio_node.node']

function findBuildDir() {
  return buildDirs.find((dir) => runtimeFiles.every((file) => existsSync(join(dir, file))))
}

const buildDir = findBuildDir()
if (!buildDir) {
  console.error(
    '[audio-engine] No built native runtime found. Run npm run build:audio-engine:mingw first.'
  )
  process.exit(1)
}

mkdirSync(outputDir, { recursive: true })

for (const file of runtimeFiles) {
  const source = join(buildDir, file)
  const target = join(outputDir, file)
  copyFileSync(source, target)
  const sizeMiB = (statSync(target).size / 1024 / 1024).toFixed(1)
  console.log(`[audio-engine] staged ${file} (${sizeMiB} MiB)`)
}
