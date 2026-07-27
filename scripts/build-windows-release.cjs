const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { createReadStream } = require('node:fs')
const { writeFile } = require('node:fs/promises')
const path = require('node:path')
const { findInstaller } = require('./verify-release-artifacts.cjs')

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

async function writeInstallerChecksum(artifactDir = path.join(root, 'dist')) {
  const installer = findInstaller({ artifactDir, installer: '' })
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(installer)) hash.update(chunk)
  const checksumPath = `${installer}.sha256`
  const checksum = `${hash.digest('hex')}  ${path.basename(installer)}\n`
  await writeFile(checksumPath, checksum, 'utf8')
  console.log(`Wrote release checksum: ${checksumPath}`)
  return checksumPath
}

async function main() {
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
  if ((verify.status ?? 1) !== 0) process.exit(verify.status ?? 1)
  await writeInstallerChecksum()
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

module.exports = { electronBuilder, main, run, writeInstallerChecksum }
