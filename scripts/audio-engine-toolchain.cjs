const {
  accessSync: fileAccessSync,
  constants: fileSystemConstants,
  existsSync: fileExistsSync,
  mkdirSync: makeDirectorySync
} = require('node:fs')
const { delimiter, dirname, join, resolve } = require('node:path')
const { spawnSync: childProcessSpawnSync } = require('node:child_process')

function normalizePath(value) {
  return String(value).replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
}

function validateMingwToolchain({ env = process.env, existsSync = fileExistsSync } = {}) {
  const vcpkgRoot = env.VCPKG_ROOT ? resolve(env.VCPKG_ROOT) : ''
  const devkitRoot = env.W64DEVKIT_ROOT ? resolve(env.W64DEVKIT_ROOT) : ''
  const missing = []

  if (!vcpkgRoot) {
    missing.push('VCPKG_ROOT is required and must point to a vcpkg checkout')
  } else if (!existsSync(join(vcpkgRoot, 'scripts', 'buildsystems', 'vcpkg.cmake'))) {
    missing.push(`VCPKG_ROOT does not contain scripts/buildsystems/vcpkg.cmake: ${vcpkgRoot}`)
  }

  if (!devkitRoot) {
    missing.push('W64DEVKIT_ROOT is required and must point to a w64devkit installation')
  } else {
    const requiredBinaries = [
      'gcc.exe',
      'g++.exe',
      'x86_64-w64-mingw32-gcc.exe',
      'x86_64-w64-mingw32-g++.exe',
      'ninja.exe'
    ]
    for (const binary of requiredBinaries) {
      if (!existsSync(join(devkitRoot, 'bin', binary))) {
        missing.push(`W64DEVKIT_ROOT is missing bin/${binary}: ${devkitRoot}`)
      }
    }
  }

  return missing.length === 0
    ? { ok: true, message: '' }
    : { ok: false, message: `MinGW audio toolchain preflight failed:\n- ${missing.join('\n- ')}` }
}

function resolveMingwBuildLayout({ root, env = process.env } = {}) {
  const defaultBuildDir = join(resolve(root ?? '.'), 'audio-engine', 'build', 'mingw-static')
  const buildDir = env.TAE_MINGW_BUILD_DIR ? resolve(env.TAE_MINGW_BUILD_DIR) : defaultBuildDir
  if (/\s/.test(buildDir)) {
    return {
      ok: false,
      message:
        'MinGW audio toolchain preflight failed:\n' +
        '- MinGW build directory cannot contain whitespace because vcpkg FFmpeg passes it to MSYS2. Set TAE_MINGW_BUILD_DIR to a writable path without whitespace'
    }
  }
  return { ok: true, buildDir, tempDir: join(buildDir, 'tmp') }
}

function prepareMingwBuildLayout({
  root,
  env = process.env,
  mkdirSync = makeDirectorySync,
  accessSync = fileAccessSync,
  constants = fileSystemConstants
} = {}) {
  const layout = resolveMingwBuildLayout({ root, env })
  if (!layout.ok) return layout

  try {
    mkdirSync(layout.buildDir, { recursive: true })
    mkdirSync(layout.tempDir, { recursive: true })
    accessSync(layout.buildDir, constants.W_OK)
    accessSync(layout.tempDir, constants.W_OK)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      message:
        'MinGW audio toolchain preflight failed:\n' +
        `- MinGW build directory is not writable: ${layout.buildDir} (${reason})`
    }
  }

  return layout
}

function prepareMingwCmakeEnvironment({
  buildDir,
  env = process.env,
  existsSync = fileExistsSync,
  spawnSync = childProcessSpawnSync
} = {}) {
  const validation = validateMingwToolchain({ env, existsSync })
  if (!validation.ok) return validation

  const patch = findGnuPatch(env, existsSync, spawnSync)
  if (!patch) {
    return {
      ok: false,
      message:
        'MinGW audio toolchain preflight failed:\n' +
        '- GNU patch is required before w64devkit/bin. Install Git for Windows or set a valid TWILIGHT_GNU_PATCH GNU patch.exe path'
    }
  }

  const devkitBin = join(resolve(env.W64DEVKIT_ROOT), 'bin')
  const patchBin = dirname(patch)
  const pathEntries = [patchBin, devkitBin, ...(env.PATH ?? '').split(delimiter)]
  const uniquePathEntries = []
  const seen = new Set()
  for (const entry of pathEntries) {
    if (!entry) continue
    const key = normalizePath(entry)
    if (seen.has(key)) continue
    seen.add(key)
    uniquePathEntries.push(entry)
  }

  const environment = {
    ...env,
    PATH: uniquePathEntries.join(delimiter),
    MSYS: withMsysLinkFallback(env.MSYS)
  }
  if (buildDir) {
    const tempDir = join(resolve(buildDir), 'tmp')
    environment.TEMP = tempDir
    environment.TMP = tempDir
    environment.TMPDIR = tempDir
  }

  return {
    ok: true,
    message: '',
    environment
  }
}

function validateMingwBuildCommands({
  env = process.env,
  spawnSync = childProcessSpawnSync,
  commands = ['cmake', 'ctest']
} = {}) {
  const unavailable = []
  for (const command of commands) {
    let result
    try {
      result = spawnSync(command, ['--version'], {
        env,
        encoding: 'utf8',
        windowsHide: true
      })
    } catch {
      result = null
    }
    if (result?.status === 0 && !result.error) continue

    const name = command === 'ctest' ? 'CTest' : 'CMake'
    unavailable.push(
      `${name} executable \"${command}\" is unavailable. Install CMake with CTest and add it to PATH`
    )
  }
  return unavailable.length === 0
    ? { ok: true, message: '' }
    : {
        ok: false,
        message: `MinGW audio toolchain preflight failed:\n- ${unavailable.join('\n- ')}`
      }
}

function withMsysLinkFallback(value) {
  const flags = String(value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  return [...flags.filter((flag) => flag !== 'winsymlinks:lnk'), 'winsymlinks:lnk'].join(' ')
}

function findGnuPatch(env, existsSync, spawnSync) {
  if (env.TWILIGHT_GNU_PATCH) {
    const override = resolve(env.TWILIGHT_GNU_PATCH)
    return existsSync(override) && isGnuPatch(override, spawnSync) ? override : ''
  }

  const candidates = [
    env.ProgramFiles && join(env.ProgramFiles, 'Git', 'usr', 'bin', 'patch.exe'),
    env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'Git', 'usr', 'bin', 'patch.exe')
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    const resolved = resolve(candidate)
    if (existsSync(resolved) && isGnuPatch(resolved, spawnSync)) return resolved
  }
  return ''
}

function isGnuPatch(patch, spawnSync) {
  let result
  try {
    result = spawnSync(patch, ['--version'], {
      encoding: 'utf8',
      windowsHide: true
    })
  } catch {
    return false
  }
  if (result?.status !== 0 || result.error) return false
  return /\bGNU patch\b/i.test(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
}

function findStaleCTestRegistrations(ctestText, buildDir) {
  const normalizedBuildDir = normalizePath(buildDir)
  const quotedPaths = String(ctestText).match(/"([^"\r\n]+)"/g) ?? []
  return quotedPaths
    .map((entry) => entry.slice(1, -1))
    .filter((entry) => /(?:\.exe|\/twilight_[^/]+)$/i.test(entry))
    .filter((entry) => !normalizePath(entry).startsWith(`${normalizedBuildDir}/`))
}

module.exports = {
  findStaleCTestRegistrations,
  prepareMingwCmakeEnvironment,
  prepareMingwBuildLayout,
  resolveMingwBuildLayout,
  validateMingwBuildCommands,
  validateMingwToolchain
}
