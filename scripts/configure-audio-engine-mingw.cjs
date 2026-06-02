const { existsSync, readFileSync, readdirSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')

const root = resolve(__dirname, '..')
const audioEngineDir = join(root, 'audio-engine')
const buildDir = join(audioEngineDir, 'build', 'mingw-static')
const vcpkgRoot = process.env.VCPKG_ROOT ? resolve(process.env.VCPKG_ROOT) : ''
const expectedTests = [
  'twilight_audio_engine_smoke',
  'twilight_dsp_unit',
  'twilight_metadata_unit',
  'twilight_bitperfect_unit',
  'twilight_queue_unit',
  'twilight_backend_factory_unit',
  'twilight_platform_backend_smoke',
  'twilight_asio_backend_unit',
  'twilight_output_backend_unit'
]

function runCmake() {
  return spawnSync('cmake', ['-S', 'audio-engine', '--preset', 'windows-mingw-static'], {
    cwd: root,
    stdio: 'inherit'
  }).status ?? 1
}

function vcpkgLogText() {
  const log = join(buildDir, 'vcpkg-manifest-install.log')
  return existsSync(log) ? readFileSync(log, 'utf8') : ''
}

function cleanFfmpegExtractTemps() {
  if (!vcpkgRoot) return false
  const srcDir = resolve(vcpkgRoot, 'buildtrees', 'ffmpeg', 'src')
  const allowedRoot = resolve(vcpkgRoot, 'buildtrees', 'ffmpeg')
  if (!srcDir.startsWith(allowedRoot) || !existsSync(srcDir)) return false

  let cleaned = false
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.tmp')) continue
    const target = resolve(srcDir, entry.name)
    if (!target.startsWith(srcDir)) continue
    rmSync(target, { recursive: true, force: true })
    console.log(`已清理 vcpkg FFmpeg 临时源码目录：${target}`)
    cleaned = true
  }
  return cleaned
}

function ctestTargetCheck() {
  const result = spawnSync('ctest', ['--test-dir', buildDir, '-N'], {
    cwd: root,
    encoding: 'utf8'
  })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  const missing = expectedTests.filter((name) => !output.includes(name))
  return { ok: result.status === 0 && missing.length === 0, status: result.status ?? 1, output, missing }
}

function cleanCmakeConfigureState() {
  const cache = join(buildDir, 'CMakeCache.txt')
  const files = join(buildDir, 'CMakeFiles')
  if (existsSync(cache)) rmSync(cache, { force: true })
  if (existsSync(files)) rmSync(files, { recursive: true, force: true })
  console.warn('MinGW CTest 目标缺失，已清理 CMake 配置缓存并重试 configure。')
}

function verifyCTestTargets() {
  let check = ctestTargetCheck()
  if (!check.ok) {
    cleanCmakeConfigureState()
    const status = runCmake()
    if (status !== 0) process.exit(status)
    check = ctestTargetCheck()
  }
  if (!check.ok) {
    console.error(check.output)
    console.error(`MinGW CTest 目标不完整，缺少：${check.missing.join(', ')}`)
    process.exit(check.status || 1)
  }
  process.stdout.write(check.output)
}

let status = runCmake()
if (status !== 0 && /file RENAME failed|拒绝访问|Access is denied/i.test(vcpkgLogText())) {
  console.warn('检测到 vcpkg FFmpeg 解压/重命名残留，清理临时目录后重试 configure。')
  if (cleanFfmpegExtractTemps()) {
    status = runCmake()
  }
}

if (status !== 0) process.exit(status)
verifyCTestTargets()
