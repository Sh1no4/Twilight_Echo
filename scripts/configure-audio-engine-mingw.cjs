const { existsSync, readFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const {
  MINGW_EXPECTED_CTESTS,
  findStaleCTestRegistrations,
  prepareMingwCmakeEnvironment,
  prepareMingwBuildLayout,
  resolveMingwEnvironment,
  validateMingwCTestRegistration,
  validateMingwBuildCommands
} = require('./audio-engine-toolchain.cjs')

const root = resolve(__dirname, '..')
const toolchainEnvironment = resolveMingwEnvironment()
const buildLayout = prepareMingwBuildLayout({ root, env: toolchainEnvironment })
if (!buildLayout.ok) {
  console.error(buildLayout.message)
  process.exit(1)
}
const { buildDir } = buildLayout

const preflight = prepareMingwCmakeEnvironment({ buildDir, env: toolchainEnvironment })
if (!preflight.ok) {
  console.error(preflight.message)
  process.exit(1)
}

const cmakeEnvironment = preflight.environment
const buildToolPreflight = validateMingwBuildCommands({ env: cmakeEnvironment })
if (!buildToolPreflight.ok) {
  console.error(buildToolPreflight.message)
  process.exit(1)
}
function runCmake() {
  return (
    spawnSync('cmake', ['-S', 'audio-engine', '--preset', 'windows-mingw-static', '-B', buildDir], {
      cwd: root,
      stdio: 'inherit',
      env: cmakeEnvironment
    }).status ?? 1
  )
}

function cleanCmakeConfigureState() {
  const cache = join(buildDir, 'CMakeCache.txt')
  const files = join(buildDir, 'CMakeFiles')
  const ctestFile = join(buildDir, 'CTestTestfile.cmake')
  if (existsSync(cache)) rmSync(cache, { force: true })
  if (existsSync(files)) rmSync(files, { recursive: true, force: true })
  if (existsSync(ctestFile)) rmSync(ctestFile, { force: true })
  console.warn('MinGW CTest 目标缺失，已清理 CMake 配置缓存并重试 configure。')
}

function cleanStaleCTestRegistration() {
  const ctestFile = join(buildDir, 'CTestTestfile.cmake')
  if (!existsSync(ctestFile)) return false
  const stale = findStaleCTestRegistrations(readFileSync(ctestFile, 'utf8'), buildDir)
  if (stale.length === 0) return false
  console.warn(`Detected stale CTest registrations:\n${stale.join('\n')}`)
  cleanCmakeConfigureState()
  return true
}

function verifyCTestTargets() {
  const check = validateMingwCTestRegistration({
    buildDir,
    expectedTests: MINGW_EXPECTED_CTESTS,
    env: cmakeEnvironment,
    cwd: root
  })
  if (!check.ok) {
    console.error(check.message)
    console.error(check.output)
    console.error(`MinGW CTest 目标不完整，缺少：${check.missing.join(', ')}`)
    process.exit(check.status || 1)
  }
  process.stdout.write(check.output)
}

cleanStaleCTestRegistration()
const status = runCmake()
if (status !== 0) process.exit(status)
verifyCTestTargets()
