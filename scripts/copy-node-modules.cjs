const fs = require('fs')
const path = require('path')

// Dev-only packages that are never needed at runtime — skip to save space
const SKIP_PACKAGES = new Set([
  'electron',
  'electron-builder',
  'electron-vite',
  'vite',
  'eslint',
  'typescript',
  'prettier',
  'vue-tsc',
  '@electron-toolkit/eslint-config-prettier',
  '@electron-toolkit/eslint-config-ts',
  '@electron-toolkit/tsconfig',
  '7zip-bin',
  'app-builder-bin',
  'app-builder-lib',
  'builder-util',
  'builder-util-runtime',
  'dmg-builder',
  'dmg-license',
  'electron-publish',
  'electron-winstaller',
  '@electron/asar',
  '@electron/fuses',
  '@electron/get',
  '@electron/notarize',
  '@electron/osx-sign',
  '@electron/rebuild',
  '@electron/universal',
  '@eslint',
  '@eslint-community',
  '@humanfs',
  '@humanwhocodes',
  '@pkgr',
  '@rolldown',
  '@rollup',
  '@types',
  '@typescript-eslint',
  '@vitejs',
  '@volar',
  'esbuild',
  'rollup',
  'vue-eslint-parser',
])

/**
 * electron-builder afterPack hook.
 * Replaces electron-builder's pruned node_modules with the complete set.
 */
module.exports = async function (context) {
  const appOutDir = context.appOutDir
  const appDir = path.join(appOutDir, 'resources', 'app')
  const srcNodeModules = path.join(__dirname, '..', 'node_modules')
  const destNodeModules = path.join(appDir, 'node_modules')

  console.log('[copy-node-modules] src :', srcNodeModules)
  console.log('[copy-node-modules] dest:', destNodeModules)

  if (!fs.existsSync(srcNodeModules)) {
    console.error('[copy-node-modules] Source node_modules not found, skipping')
    return
  }

  // Remove electron-builder's pruned node_modules
  if (fs.existsSync(destNodeModules)) {
    console.log('[copy-node-modules] Removing pruned node_modules...')
    fs.rmSync(destNodeModules, { recursive: true, force: true })
  }

  console.log('[copy-node-modules] Copying node_modules...')
  const entries = fs.readdirSync(srcNodeModules)
  for (const entry of entries) {
    const srcPath = path.join(srcNodeModules, entry)

    // Skip dev-only packages
    if (SKIP_PACKAGES.has(entry)) {
      console.log('[copy-node-modules]   skip (dev):', entry)
      continue
    }

    // Skip hidden files and lock files
    if (entry.startsWith('.') || entry === 'lock.yaml') continue

    const destPath = path.join(destNodeModules, entry)
    copyEntry(srcPath, destPath)
  }

  console.log('[copy-node-modules] Done!')
}

function copyEntry(src, dest) {
  try {
    const stat = fs.lstatSync(src)
    if (stat.isSymbolicLink()) {
      const realPath = fs.realpathSync(src)
      const realStat = fs.statSync(realPath)
      if (realStat.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true })
        copyDirContents(realPath, dest)
      } else {
        fs.copyFileSync(realPath, dest)
      }
    } else if (stat.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true })
      copyDirContents(src, dest)
    } else {
      fs.copyFileSync(src, dest)
    }
  } catch (err) {
    console.error('[copy-node-modules] Error copying', src, ':', err.message)
  }
}

function copyDirContents(srcDir, destDir) {
  const entries = fs.readdirSync(srcDir)
  for (const entry of entries) {
    if (entry === '.bin' || entry === '.cache') continue
    const srcPath = path.join(srcDir, entry)
    const destPath = path.join(destDir, entry)
    copyEntry(srcPath, destPath)
  }
}
