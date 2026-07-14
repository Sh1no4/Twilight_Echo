const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')
const {
  prepareMingwCmakeEnvironment,
  prepareMingwBuildLayout,
  resolveMingwEnvironment,
  validateMingwBuildCommands
} = require('./audio-engine-toolchain.cjs')

const root = resolve(__dirname, '..')
const toolchainEnvironment = resolveMingwEnvironment()
const layout = prepareMingwBuildLayout({ root, env: toolchainEnvironment })
if (!layout.ok) {
  console.error(layout.message)
  process.exit(1)
}

const preflight = prepareMingwCmakeEnvironment({ buildDir: layout.buildDir, env: toolchainEnvironment })
if (!preflight.ok) {
  console.error(preflight.message)
  process.exit(1)
}

const action = process.argv[2]
const command =
  action === 'build'
    ? ['cmake', ['--build', layout.buildDir]]
    : action === 'test'
      ? ['ctest', ['--test-dir', layout.buildDir, '--output-on-failure']]
      : null
if (!command) {
  console.error('Usage: node scripts/run-audio-engine-mingw.cjs <build|test>')
  process.exit(1)
}

const buildToolPreflight = validateMingwBuildCommands({
  env: preflight.environment,
  commands: [command[0]]
})
if (!buildToolPreflight.ok) {
  console.error(buildToolPreflight.message)
  process.exit(1)
}

const result = spawnSync(command[0], command[1], {
  cwd: root,
  stdio: 'inherit',
  env: preflight.environment
})
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1)
if (action === 'build') {
  const stage = spawnSync(
    process.execPath,
    [resolve(__dirname, 'stage-audio-engine.cjs'), '--build-dir', layout.buildDir],
    {
      cwd: root,
      stdio: 'inherit'
    }
  )
  process.exit(stage.status ?? 1)
}
