const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const electronBuilder = path.join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
)

function run(command, args, environment = process.env) {
  return spawnSync(command, args, { cwd: root, stdio: 'inherit', env: environment })
}

function main() {
  if (!String(process.env.TWILIGHT_RELEASE_SIGNING_THUMBPRINT || '').trim()) {
    throw new Error('TWILIGHT_RELEASE_SIGNING_THUMBPRINT is required before a signed Windows release build')
  }
  const build = run(electronBuilder, ['--win', '--config', 'electron-builder.release-win.yml'], {
    ...process.env,
    TWILIGHT_RELEASE_BUILD: '1'
  })
  if ((build.status ?? 1) !== 0) process.exit(build.status ?? 1)
  const verify = run(process.execPath, [
    path.join(root, 'scripts', 'verify-release-artifacts.cjs'),
    '--native-dir',
    path.join(root, 'dist', 'win-unpacked', 'resources', 'audio-engine'),
    '--artifact-dir',
    path.join(root, 'dist'),
    '--require-signature'
  ])
  process.exit(verify.status ?? 1)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

module.exports = { electronBuilder, main, run }
