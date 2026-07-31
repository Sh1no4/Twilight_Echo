const { existsSync, readdirSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { spawnSync: childProcessSpawnSync } = require('node:child_process')

const PERSISTED_ASIO_MSVC_VARIABLES = ['TAE_ASIO_MSVC_INSTALL_ROOT', 'TAE_ASIO_MSVC_BUILD_DIR']

function resolveAsioMsvcEnvironment({ env = process.env, spawnSync = childProcessSpawnSync } = {}) {
  const resolved = { ...env }
  if (process.platform !== 'win32') return resolved
  for (const name of PERSISTED_ASIO_MSVC_VARIABLES) {
    if (resolved[name]) continue
    const result = spawnSync('reg.exe', ['query', 'HKCU\\Environment', '/v', name], {
      encoding: 'utf8',
      windowsHide: true
    })
    if (result?.status !== 0 || result.error) continue
    const match = new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+?)\\s*$`, 'im').exec(
      result.stdout ?? ''
    )
    if (match?.[1]) resolved[name] = match[1].trim()
  }
  if (!resolved.TAE_ASIO_MSVC_INSTALL_ROOT && resolved.TAE_VST3_MSVC_INSTALL_ROOT) {
    resolved.TAE_ASIO_MSVC_INSTALL_ROOT = resolved.TAE_VST3_MSVC_INSTALL_ROOT
  }
  return resolved
}

function resolveAsioMsvcBuildDirectory(env = process.env, root = process.cwd()) {
  return env.TAE_ASIO_MSVC_BUILD_DIR
    ? resolve(env.TAE_ASIO_MSVC_BUILD_DIR)
    : join(resolve(root), 'audio-engine', 'build', 'asio-msvc-x64')
}

function validateAsioMsvcToolchain({
  env = process.env,
  exists = existsSync,
  readDirectories = readdirSync
} = {}) {
  const installRoot = env.TAE_ASIO_MSVC_INSTALL_ROOT ? resolve(env.TAE_ASIO_MSVC_INSTALL_ROOT) : ''
  const missing = []
  if (!installRoot || !exists(join(installRoot, 'Common7', 'Tools', 'VsDevCmd.bat'))) {
    missing.push('TAE_ASIO_MSVC_INSTALL_ROOT must point to a VS 2022 Build Tools installation')
  } else {
    const toolsetRoot = join(installRoot, 'VC', 'Tools', 'MSVC')
    const hasToolset =
      exists(toolsetRoot) &&
      readDirectories(toolsetRoot, { withFileTypes: true }).some((entry) => entry.isDirectory())
    if (!hasToolset) missing.push(`No MSVC toolset found under ${toolsetRoot}.`)
  }
  return missing.length === 0
    ? { ok: true, message: '', installRoot }
    : {
        ok: false,
        message: `ASIO MSVC toolchain preflight failed:\n- ${missing.join('\n- ')}`,
        installRoot
      }
}

module.exports = {
  resolveAsioMsvcBuildDirectory,
  resolveAsioMsvcEnvironment,
  validateAsioMsvcToolchain
}
