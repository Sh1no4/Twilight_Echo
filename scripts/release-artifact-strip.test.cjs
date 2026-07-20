const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const { NATIVE_RUNTIME_FILES, executableCandidates, stripNativeArtifacts } = require('./release-artifact-strip.cjs')

test('release strip uses an explicit protected-environment tool before PATH', () => {
  assert.equal(
    executableCandidates({ TWILIGHT_RELEASE_STRIP: 'C:/signing/strip.exe', TAE_W64DEVKIT_ROOT: 'C:/w64' })[0],
    'C:/signing/strip.exe'
  )
})

test('release strip only processes the packaged runtime copy and fails closed', () => {
  const calls = []
  const packagedDir = path.resolve('C:/release/win-unpacked/resources/audio-engine')
  const stripped = stripNativeArtifacts(packagedDir, {
    stripCommand: 'C:/tools/strip.exe',
    exists: (filePath) => filePath.startsWith(packagedDir),
    run: (command, args) => {
      calls.push({ command, args })
      return { status: 0 }
    }
  })
  assert.equal(stripped.length, NATIVE_RUNTIME_FILES.length)
  assert.equal(calls.length, NATIVE_RUNTIME_FILES.length)
  assert.ok(calls.every((call) => call.args[1].startsWith(packagedDir)))
  assert.throws(
    () => stripNativeArtifacts(packagedDir, { stripCommand: 'strip', exists: () => false, run: () => ({ status: 0 }) }),
    /Missing packaged native runtime binary/
  )
})

test('release strip propagates a strip failure instead of shipping debug binaries', () => {
  assert.throws(
    () => stripNativeArtifacts('C:/release', { stripCommand: 'strip', exists: () => true, run: () => ({ status: 1, stderr: 'bad binary' }) }),
    /Failed to strip/
  )
})
