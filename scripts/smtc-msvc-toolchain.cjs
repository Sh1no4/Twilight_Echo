const { existsSync, readdirSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { spawnSync: childProcessSpawnSync } = require('node:child_process')

const PERSISTED_SMTC_VARIABLES = ['TAE_SMTC_MSVC_INSTALL_ROOT', 'TAE_SMTC_MSVC_BUILD_DIR']

function resolveSmtcMsvcEnvironment({ env = process.env, spawnSync = childProcessSpawnSync } = {}) {
  const resolved = { ...env }
  if (process.platform !== 'win32') return resolved
  for (const name of PERSISTED_SMTC_VARIABLES) {
    if (resolved[name]) continue
    const result = spawnSync('reg.exe', ['query', 'HKCU\\Environment', '/v', name], {
      encoding: 'utf8',
      windowsHide: true
    })
    if (result?.status !== 0 || result.error) continue
    const expression = new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+?)\\s*$`, 'im')
    const match = expression.exec(result.stdout ?? '')
    if (match?.[1]) resolved[name] = match[1].trim()
  }
  return resolved
}

function resolveSmtcMsvcBuildDirectory(env = process.env, root = process.cwd()) {
  return env.TAE_SMTC_MSVC_BUILD_DIR
    ? resolve(env.TAE_SMTC_MSVC_BUILD_DIR)
    : join(resolve(root), 'audio-engine', 'build', 'smtc-msvc-x64')
}

function validateSmtcMsvcToolchain({
  env = process.env,
  exists = existsSync,
  readDirectories = readdirSync
} = {}) {
  const installRoot = env.TAE_SMTC_MSVC_INSTALL_ROOT
    ? resolve(env.TAE_SMTC_MSVC_INSTALL_ROOT)
    : env.TAE_VST3_MSVC_INSTALL_ROOT
      ? resolve(env.TAE_VST3_MSVC_INSTALL_ROOT)
      : ''
  const missing = []

  if (!installRoot || !exists(join(installRoot, 'Common7', 'Tools', 'VsDevCmd.bat'))) {
    missing.push(
      'TAE_SMTC_MSVC_INSTALL_ROOT must point to a VS 2022 Build Tools installation (TAE_VST3_MSVC_INSTALL_ROOT is accepted as a fallback)'
    )
  } else {
    const msvcRoot = join(installRoot, 'VC', 'Tools', 'MSVC')
    const hasMsvc =
      exists(msvcRoot) &&
      readDirectories(msvcRoot, { withFileTypes: true }).some((entry) => entry.isDirectory())
    if (!hasMsvc) missing.push(`No MSVC toolset found under ${msvcRoot}.`)
  }

  return missing.length === 0
    ? { ok: true, message: '', installRoot }
    : {
        ok: false,
        message: `SMTC MSVC toolchain preflight failed:\n- ${missing.join('\n- ')}`,
        installRoot
      }
}

module.exports = {
  resolveSmtcMsvcBuildDirectory,
  resolveSmtcMsvcEnvironment,
  validateSmtcMsvcToolchain
}
