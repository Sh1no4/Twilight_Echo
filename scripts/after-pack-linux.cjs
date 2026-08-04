const { existsSync, copyFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return

  // Ensure native audio engine libraries are in the right place
  const resourcesDir = join(context.appOutDir, 'resources', 'audio-engine')
  const buildDir = join(context.packager.projectDir, 'audio-engine', 'build', 'default')

  const runtimeFiles = ['libtwilight-audio-engine.so', 'twilight_audio_node.node']
  mkdirSync(resourcesDir, { recursive: true })

  for (const file of runtimeFiles) {
    const source = join(buildDir, file)
    const target = join(resourcesDir, file)
    try {
      copyFileSync(source, target)
      console.log(`  Staged: ${file}`)
    } catch (err) {
      console.warn(`  Could not stage ${file}: ${err.message}`)
    }
  }

  console.log('[after-pack-linux] Linux audio engine resources staged.')
}