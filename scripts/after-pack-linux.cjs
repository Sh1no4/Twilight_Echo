const { copyFileSync, existsSync, mkdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return

  // Ensure native audio engine libraries are in the right place
  const resourcesDir = join(context.appOutDir, 'resources', 'audio-engine')
  const buildDir = join(context.packager.projectDir, 'audio-engine', 'build', 'default')

  const runtimeFiles = ['libtwilight-audio-engine.so', 'twilight_audio_node.node']
  mkdirSync(resourcesDir, { recursive: true })

  const staged = new Set()
  for (const file of runtimeFiles) {
    const source = join(buildDir, file)
    const target = join(resourcesDir, file)
    try {
      copyFileSync(source, target)
      console.log(`  Staged: ${file}`)
      staged.add(file)
    } catch (err) {
      console.warn(`  Could not stage ${file}: ${err.message}`)
    }
  }

  // extraResources 会把 resources/audio-engine 里的 Windows 原生文件也带入 Linux 包，
  // 这里统一清掉：凡是没能成功覆盖为 Linux 版本的文件，都不应留在 Linux 包里，
  // 避免 Linux 包携带无用的 .dll / Windows ABI 的 .node。
  for (const staleFile of ['twilight-audio-engine.dll', 'twilight-audio-engine.pdb']) {
    const target = join(resourcesDir, staleFile)
    if (existsSync(target)) {
      rmSync(target, { force: true })
      console.log(`  Removed Windows-only artifact: ${staleFile}`)
    }
  }
  if (!staged.has('twilight_audio_node.node')) {
    const staleNode = join(resourcesDir, 'twilight_audio_node.node')
    if (existsSync(staleNode)) {
      rmSync(staleNode, { force: true })
      console.log('  Removed Windows-ABI twilight_audio_node.node (Linux build unavailable)')
    }
  }

  console.log('[after-pack-linux] Linux audio engine resources staged.')
}
