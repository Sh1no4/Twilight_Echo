const { existsSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { join, resolve } = require('node:path')
const {
  resolveSmtcMsvcBuildDirectory,
  resolveSmtcMsvcEnvironment
} = require('./smtc-msvc-toolchain.cjs')

const root = resolve(__dirname, '..')
const environment = resolveSmtcMsvcEnvironment()
const buildDir = resolveSmtcMsvcBuildDirectory(environment, root)
const action = process.argv[2]

if (!existsSync(join(buildDir, 'CMakeCache.txt'))) {
  console.error(`SMTC MSVC build directory is not configured: ${buildDir}`)
  console.error('Run pnpm run configure:smtc-msvc first.')
  process.exit(1)
}

const command =
  action === 'build'
    ? ['cmake', ['--build', buildDir, '--config', 'Release', '--target', 'twilight_smtc_node']]
    : action === 'test'
      ? [
          process.execPath,
          [join(root, 'scripts', 'smtc-native-selftest.cjs'), '--build-dir', buildDir]
        ]
      : action === 'stage'
        ? [
            process.execPath,
            [join(root, 'scripts', 'stage-smtc-msvc.cjs'), '--build-dir', buildDir]
          ]
        : null

if (!command) {
  console.error('Usage: node scripts/run-smtc-msvc.cjs <build|test|stage>')
  process.exit(1)
}

const result = spawnSync(command[0], command[1], { cwd: root, stdio: 'inherit', env: environment })
process.exit(result.status ?? 1)
