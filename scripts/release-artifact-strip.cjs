const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const NATIVE_RUNTIME_FILES = Object.freeze([
  'twilight-audio-engine.dll',
  'twilight_audio_node.node',
  'twilight-vst3-host.exe',
  'twilight-vst3-scanner.exe'
])

function executableCandidates(environment = process.env) {
  const candidates = []
  if (environment.TWILIGHT_RELEASE_STRIP) candidates.push(environment.TWILIGHT_RELEASE_STRIP)
  for (const root of [environment.TAE_W64DEVKIT_ROOT, environment.W64DEVKIT_ROOT]) {
    if (root) candidates.push(path.join(root, 'bin', process.platform === 'win32' ? 'strip.exe' : 'strip'))
  }
  candidates.push(process.platform === 'win32' ? 'strip.exe' : 'strip')
  return candidates
}

function resolveStripCommand(environment = process.env, exists = fs.existsSync) {
  for (const candidate of executableCandidates(environment)) {
    if (path.isAbsolute(candidate) && exists(candidate)) return candidate
    if (!path.isAbsolute(candidate)) return candidate
  }
  throw new Error('No release strip tool was found; set TWILIGHT_RELEASE_STRIP to a GNU/LLVM strip executable')
}

function stripNativeArtifacts(nativeDir, dependencies = {}) {
  const exists = dependencies.exists || fs.existsSync
  const run = dependencies.run || spawnSync
  const stripCommand = dependencies.stripCommand || resolveStripCommand(dependencies.environment, exists)
  const stripped = []
  for (const name of NATIVE_RUNTIME_FILES) {
    const filePath = path.join(nativeDir, name)
    assert.ok(exists(filePath), `Missing packaged native runtime binary: ${filePath}`)
    const result = run(stripCommand, ['--strip-unneeded', filePath], {
      encoding: 'utf8',
      windowsHide: true
    })
    if ((result.status ?? 1) !== 0) {
      throw new Error(
        [`Failed to strip ${filePath}`, result.stdout, result.stderr].filter(Boolean).join('\n')
      )
    }
    stripped.push(filePath)
  }
  return stripped
}

module.exports = { NATIVE_RUNTIME_FILES, executableCandidates, resolveStripCommand, stripNativeArtifacts }
