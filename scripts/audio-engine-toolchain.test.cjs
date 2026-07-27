const assert = require('node:assert/strict')
const {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const {
  MINGW_EXPECTED_CTESTS,
  findStaleCTestRegistrations,
  prepareMingwCmakeEnvironment,
  prepareMingwBuildLayout,
  resolveMingwBuildLayout,
  validateMingwBuildCommands,
  validateMingwCTestRegistration,
  validateMingwToolchain
} = require('./audio-engine-toolchain.cjs')

function createExistsSync(paths) {
  const existing = new Set(paths.map((entry) => entry.replaceAll('\\', '/').toLowerCase()))
  return (entry) => existing.has(String(entry).replaceAll('\\', '/').toLowerCase())
}

function createSpawnSync(results) {
  const calls = []
  const spawn = (command, args, options) => {
    calls.push({ command, args, options })
    const result = results[command]
    return typeof result === 'function' ? result(command, args, options) : result
  }
  spawn.calls = calls
  return spawn
}

function createGnuPatchSpawnSync() {
  return createSpawnSync(
    new Proxy(
      {},
      {
        get: () => ({ status: 0, stdout: 'GNU patch 2.7.6', stderr: '' })
      }
    )
  )
}

test('rejects a missing MinGW toolchain environment before CMake configures', () => {
  const result = validateMingwToolchain({
    env: {},
    existsSync: createExistsSync([])
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /VCPKG_ROOT/)
  assert.match(result.message, /W64DEVKIT_ROOT/)
})

test('accepts an installed toolchain and rejects CTest entries from a moved build directory', () => {
  const vcpkgRoot = 'C:/tools/vcpkg'
  const devkitRoot = 'C:/tools/w64devkit'
  const buildDir = 'C:/repo/audio-engine/build/mingw-static'
  const result = validateMingwToolchain({
    env: { VCPKG_ROOT: vcpkgRoot, W64DEVKIT_ROOT: devkitRoot },
    existsSync: createExistsSync([
      `${vcpkgRoot}/scripts/buildsystems/vcpkg.cmake`,
      `${devkitRoot}/bin/gcc.exe`,
      `${devkitRoot}/bin/g++.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-gcc.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-g++.exe`,
      `${devkitRoot}/bin/ninja.exe`
    ])
  })

  assert.deepEqual(result, { ok: true, message: '' })
  assert.deepEqual(
    findStaleCTestRegistrations(
      'add_test([=[engine]=] "T:/audio-engine/build/mingw-static/twilight_audio_tests.exe")',
      buildDir
    ),
    ['T:/audio-engine/build/mingw-static/twilight_audio_tests.exe']
  )
})

function registeredCTestOutput(names = MINGW_EXPECTED_CTESTS) {
  return `${names.map((name, index) => `  Test #${index + 1}: ${name}`).join('\n')}\n\nTotal Tests: ${names.length}`
}

test('fails closed when a MinGW build has no CMake cache or CTest file', () => {
  const buildDir = 'C:/twilight-build/mingw-static'
  const missingCache = validateMingwCTestRegistration({
    buildDir,
    existsSync: createExistsSync([]),
    spawnSync: () => {
      throw new Error('ctest must not run without a cache')
    }
  })
  assert.equal(missingCache.ok, false)
  assert.match(missingCache.message, /CMakeCache\.txt/)

  const missingCTestFile = validateMingwCTestRegistration({
    buildDir,
    existsSync: createExistsSync([`${buildDir}/CMakeCache.txt`]),
    spawnSync: () => {
      throw new Error('ctest must not run without CTestTestfile.cmake')
    }
  })
  assert.equal(missingCTestFile.ok, false)
  assert.match(missingCTestFile.message, /CTestTestfile\.cmake/)
})

test('rejects zero or incomplete MinGW CTest discovery even when ctest exits zero', () => {
  const buildDir = 'C:/twilight-build/mingw-static'
  const base = {
    buildDir,
    existsSync: createExistsSync([`${buildDir}/CMakeCache.txt`, `${buildDir}/CTestTestfile.cmake`]),
    readFileSync: () => 'add_test(NAME local COMMAND "C:/twilight-build/mingw-static/local.exe")'
  }

  const zeroTests = validateMingwCTestRegistration({
    ...base,
    spawnSync: () => ({ status: 0, stdout: 'No tests were found!!!\nTotal Tests: 0', stderr: '' })
  })
  assert.equal(zeroTests.ok, false)
  assert.match(zeroTests.message, /zero tests/)

  const incomplete = validateMingwCTestRegistration({
    ...base,
    spawnSync: () => ({ status: 0, stdout: registeredCTestOutput(MINGW_EXPECTED_CTESTS.slice(1)), stderr: '' })
  })
  assert.equal(incomplete.ok, false)
  assert.deepEqual(incomplete.missing, [MINGW_EXPECTED_CTESTS[0]])
})

test('accepts a configured MinGW build only when every native CTest is registered', () => {
  const buildDir = 'C:/twilight-build/mingw-static'
  const result = validateMingwCTestRegistration({
    buildDir,
    existsSync: createExistsSync([`${buildDir}/CMakeCache.txt`, `${buildDir}/CTestTestfile.cmake`]),
    readFileSync: () =>
      'add_test(NAME local COMMAND "C:/twilight-build/mingw-static/twilight_audio_tests.exe")',
    spawnSync: () => ({ status: 0, stdout: registeredCTestOutput(), stderr: '' })
  })
  assert.equal(result.ok, true)
  assert.equal(result.status, 0)
  assert.deepEqual(result.missing, [])
})

test('prepares a MinGW environment with GNU patch before the w64devkit tools', () => {
  const vcpkgRoot = 'C:/tools/vcpkg'
  const devkitRoot = 'C:/tools/w64devkit'
  const programFiles = 'C:/Program Files'
  const gnuPatch = `${programFiles}/Git/usr/bin/patch.exe`
  const result = prepareMingwCmakeEnvironment({
    env: {
      VCPKG_ROOT: vcpkgRoot,
      W64DEVKIT_ROOT: devkitRoot,
      ProgramFiles: programFiles,
      PATH: 'C:/Windows/System32'
    },
    existsSync: createExistsSync([
      `${vcpkgRoot}/scripts/buildsystems/vcpkg.cmake`,
      `${devkitRoot}/bin/gcc.exe`,
      `${devkitRoot}/bin/g++.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-gcc.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-g++.exe`,
      `${devkitRoot}/bin/ninja.exe`,
      gnuPatch
    ]),
    spawnSync: createSpawnSync({
      'C:\\Program Files\\Git\\usr\\bin\\patch.exe': {
        status: 0,
        stdout: 'GNU patch 2.7.6',
        stderr: ''
      }
    })
  })

  assert.equal(result.ok, true)
  assert.match(
    result.environment.PATH,
    /^C:\\Program Files\\Git\\usr\\bin;C:\\tools\\w64devkit\\bin;/
  )
})

test('preserves a Windows Path environment value when building the MinGW PATH', () => {
  const vcpkgRoot = 'C:/tools/vcpkg'
  const devkitRoot = 'C:/tools/w64devkit'
  const programFiles = 'C:/Program Files'
  const gnuPatch = `${programFiles}/Git/usr/bin/patch.exe`
  const result = prepareMingwCmakeEnvironment({
    env: {
      VCPKG_ROOT: vcpkgRoot,
      W64DEVKIT_ROOT: devkitRoot,
      ProgramFiles: programFiles,
      Path: 'C:/Windows/System32;C:/Windows'
    },
    existsSync: createExistsSync([
      `${vcpkgRoot}/scripts/buildsystems/vcpkg.cmake`,
      `${devkitRoot}/bin/gcc.exe`,
      `${devkitRoot}/bin/g++.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-gcc.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-g++.exe`,
      `${devkitRoot}/bin/ninja.exe`,
      gnuPatch
    ]),
    spawnSync: createGnuPatchSpawnSync()
  })

  assert.equal(result.ok, true)
  assert.equal(result.environment.Path, undefined)
  assert.match(result.environment.PATH, /C:\/Windows\/System32;C:\/Windows$/)
})

test('rejects a TWILIGHT_GNU_PATCH override that is not GNU patch', () => {
  const vcpkgRoot = 'C:/tools/vcpkg'
  const devkitRoot = 'C:/tools/w64devkit'
  const busyboxPatch = `${devkitRoot}/bin/patch.exe`
  const result = prepareMingwCmakeEnvironment({
    env: {
      VCPKG_ROOT: vcpkgRoot,
      W64DEVKIT_ROOT: devkitRoot,
      TWILIGHT_GNU_PATCH: busyboxPatch,
      ProgramFiles: 'C:/Program Files',
      PATH: 'C:/Windows/System32'
    },
    existsSync: createExistsSync([
      `${vcpkgRoot}/scripts/buildsystems/vcpkg.cmake`,
      `${devkitRoot}/bin/gcc.exe`,
      `${devkitRoot}/bin/g++.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-gcc.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-g++.exe`,
      `${devkitRoot}/bin/ninja.exe`,
      busyboxPatch,
      'C:/Program Files/Git/usr/bin/patch.exe'
    ]),
    spawnSync: createSpawnSync({
      'C:\\tools\\w64devkit\\bin\\patch.exe': {
        status: 0,
        stdout: 'BusyBox v1.36.1',
        stderr: ''
      }
    })
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /TWILIGHT_GNU_PATCH/)
  assert.match(result.message, /Git for Windows/)
})

test('rejects an automatic Git patch path that does not identify as GNU patch', () => {
  const vcpkgRoot = 'C:/tools/vcpkg'
  const devkitRoot = 'C:/tools/w64devkit'
  const gnuPatch = 'C:/Program Files/Git/usr/bin/patch.exe'
  const result = prepareMingwCmakeEnvironment({
    env: {
      VCPKG_ROOT: vcpkgRoot,
      W64DEVKIT_ROOT: devkitRoot,
      ProgramFiles: 'C:/Program Files',
      PATH: 'C:/Windows/System32'
    },
    existsSync: createExistsSync([
      `${vcpkgRoot}/scripts/buildsystems/vcpkg.cmake`,
      `${devkitRoot}/bin/gcc.exe`,
      `${devkitRoot}/bin/g++.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-gcc.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-g++.exe`,
      `${devkitRoot}/bin/ninja.exe`,
      gnuPatch
    ]),
    spawnSync: createSpawnSync({
      'C:\\Program Files\\Git\\usr\\bin\\patch.exe': {
        status: 0,
        stdout: 'patch 2.7.6',
        stderr: ''
      }
    })
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /Git for Windows/)
  assert.match(result.message, /valid TWILIGHT_GNU_PATCH/)
})

test('rejects a w64devkit environment without a compatible GNU patch executable', () => {
  const vcpkgRoot = 'C:/tools/vcpkg'
  const devkitRoot = 'C:/tools/w64devkit'
  const result = prepareMingwCmakeEnvironment({
    env: {
      VCPKG_ROOT: vcpkgRoot,
      W64DEVKIT_ROOT: devkitRoot,
      PATH: 'C:/Windows/System32'
    },
    existsSync: createExistsSync([
      `${vcpkgRoot}/scripts/buildsystems/vcpkg.cmake`,
      `${devkitRoot}/bin/gcc.exe`,
      `${devkitRoot}/bin/g++.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-gcc.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-g++.exe`,
      `${devkitRoot}/bin/ninja.exe`
    ])
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /GNU patch/)
  assert.match(result.message, /TWILIGHT_GNU_PATCH/)
})

test('reports missing CMake and CTest before native configuration or test discovery', () => {
  const missingCmake = validateMingwBuildCommands({
    env: { PATH: 'C:/Windows/System32' },
    spawnSync: createSpawnSync({
      cmake: { error: new Error('spawn cmake ENOENT'), status: null, stdout: '', stderr: '' },
      ctest: { status: 0, stdout: 'ctest version 3.30.0', stderr: '' }
    })
  })
  assert.equal(missingCmake.ok, false)
  assert.match(missingCmake.message, /CMake.*cmake/i)
  assert.match(missingCmake.message, /PATH/)

  const missingCtest = validateMingwBuildCommands({
    env: { PATH: 'C:/Windows/System32' },
    spawnSync: createSpawnSync({
      cmake: { status: 0, stdout: 'cmake version 3.30.0', stderr: '' },
      ctest: { error: new Error('spawn ctest ENOENT'), status: null, stdout: '', stderr: '' }
    })
  })
  assert.equal(missingCtest.ok, false)
  assert.match(missingCtest.message, /CTest.*ctest/i)
  assert.match(missingCtest.message, /PATH/)
})

test('requires a no-whitespace MinGW build directory and derives its temporary directory', () => {
  const missingOverride = resolveMingwBuildLayout({
    root: 'C:/Project With Spaces/Twilight Echo',
    env: {}
  })
  assert.equal(missingOverride.ok, false)
  assert.match(missingOverride.message, /TAE_MINGW_BUILD_DIR/)

  const configured = resolveMingwBuildLayout({
    root: 'C:/Project With Spaces/Twilight Echo',
    env: { TAE_MINGW_BUILD_DIR: 'C:/twilight-build/mingw-static' }
  })
  assert.deepEqual(configured, {
    ok: true,
    buildDir: 'C:\\twilight-build\\mingw-static',
    tempDir: 'C:\\twilight-build\\mingw-static\\tmp'
  })
})

test('creates and validates the selected MinGW build layout before CMake runs', () => {
  const created = []
  const checked = []
  const result = prepareMingwBuildLayout({
    root: 'C:/Project With Spaces/Twilight Echo',
    env: { TAE_MINGW_BUILD_DIR: 'C:/twilight-build/mingw-static' },
    mkdirSync: (directory, options) => created.push({ directory, options }),
    accessSync: (directory, mode) => checked.push({ directory, mode }),
    constants: { W_OK: 2 }
  })

  assert.deepEqual(result, {
    ok: true,
    buildDir: 'C:\\twilight-build\\mingw-static',
    tempDir: 'C:\\twilight-build\\mingw-static\\tmp'
  })
  assert.deepEqual(created, [
    { directory: 'C:\\twilight-build\\mingw-static', options: { recursive: true } },
    { directory: 'C:\\twilight-build\\mingw-static\\tmp', options: { recursive: true } }
  ])
  assert.deepEqual(checked, [
    { directory: 'C:\\twilight-build\\mingw-static', mode: 2 },
    { directory: 'C:\\twilight-build\\mingw-static\\tmp', mode: 2 }
  ])
})

test('reports an actionable preflight error for an unwritable selected MinGW layout', () => {
  const result = prepareMingwBuildLayout({
    root: 'C:/Project With Spaces/Twilight Echo',
    env: { TAE_MINGW_BUILD_DIR: 'C:/twilight-build/mingw-static' },
    mkdirSync: () => {},
    accessSync: () => {
      const error = new Error('permission denied')
      error.code = 'EACCES'
      throw error
    },
    constants: { W_OK: 2 }
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /^MinGW audio toolchain preflight failed:/)
  assert.match(result.message, /C:\\twilight-build\\mingw-static/)
  assert.match(result.message, /writable/i)
  assert.doesNotMatch(result.message, /Error:/)
})

test('uses the selected build directory for the CMake temporary environment', () => {
  const vcpkgRoot = 'C:/tools/vcpkg'
  const devkitRoot = 'C:/tools/w64devkit'
  const programFiles = 'C:/Program Files'
  const result = prepareMingwCmakeEnvironment({
    buildDir: 'C:/twilight-build/mingw-static',
    env: {
      VCPKG_ROOT: vcpkgRoot,
      W64DEVKIT_ROOT: devkitRoot,
      ProgramFiles: programFiles,
      PATH: 'C:/Windows/System32'
    },
    existsSync: createExistsSync([
      `${vcpkgRoot}/scripts/buildsystems/vcpkg.cmake`,
      `${devkitRoot}/bin/gcc.exe`,
      `${devkitRoot}/bin/g++.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-gcc.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-g++.exe`,
      `${devkitRoot}/bin/ninja.exe`,
      `${programFiles}/Git/usr/bin/patch.exe`
    ]),
    spawnSync: createGnuPatchSpawnSync()
  })

  assert.equal(result.ok, true)
  assert.equal(result.environment.TEMP, 'C:\\twilight-build\\mingw-static\\tmp')
  assert.equal(result.environment.TMP, result.environment.TEMP)
  assert.equal(result.environment.TMPDIR, result.environment.TEMP)
})

test('enables MSYS .lnk symlinks without replacing unrelated MSYS flags', () => {
  const vcpkgRoot = 'C:/tools/vcpkg'
  const devkitRoot = 'C:/tools/w64devkit'
  const programFiles = 'C:/Program Files'
  const result = prepareMingwCmakeEnvironment({
    buildDir: 'C:/twilight-build/mingw-static',
    env: {
      VCPKG_ROOT: vcpkgRoot,
      W64DEVKIT_ROOT: devkitRoot,
      ProgramFiles: programFiles,
      PATH: 'C:/Windows/System32',
      MSYS: 'noacl winsymlinks:lnk'
    },
    existsSync: createExistsSync([
      `${vcpkgRoot}/scripts/buildsystems/vcpkg.cmake`,
      `${devkitRoot}/bin/gcc.exe`,
      `${devkitRoot}/bin/g++.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-gcc.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-g++.exe`,
      `${devkitRoot}/bin/ninja.exe`,
      `${programFiles}/Git/usr/bin/patch.exe`
    ]),
    spawnSync: createGnuPatchSpawnSync()
  })

  assert.equal(result.ok, true)
  assert.equal(result.environment.MSYS, 'noacl winsymlinks:lnk')

  const withDuplicateLinkFallback = prepareMingwCmakeEnvironment({
    env: {
      VCPKG_ROOT: vcpkgRoot,
      W64DEVKIT_ROOT: devkitRoot,
      ProgramFiles: programFiles,
      PATH: 'C:/Windows/System32',
      MSYS: 'noacl winsymlinks:lnk winsymlinks:lnk'
    },
    existsSync: createExistsSync([
      `${vcpkgRoot}/scripts/buildsystems/vcpkg.cmake`,
      `${devkitRoot}/bin/gcc.exe`,
      `${devkitRoot}/bin/g++.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-gcc.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-g++.exe`,
      `${devkitRoot}/bin/ninja.exe`,
      `${programFiles}/Git/usr/bin/patch.exe`
    ]),
    spawnSync: createGnuPatchSpawnSync()
  })
  assert.equal(withDuplicateLinkFallback.ok, true)
  assert.equal(withDuplicateLinkFallback.environment.MSYS, 'noacl winsymlinks:lnk')

  const withLaterConflictingLinkMode = prepareMingwCmakeEnvironment({
    env: {
      VCPKG_ROOT: vcpkgRoot,
      W64DEVKIT_ROOT: devkitRoot,
      ProgramFiles: programFiles,
      PATH: 'C:/Windows/System32',
      MSYS: 'noacl winsymlinks:lnk winsymlinks:native'
    },
    existsSync: createExistsSync([
      `${vcpkgRoot}/scripts/buildsystems/vcpkg.cmake`,
      `${devkitRoot}/bin/gcc.exe`,
      `${devkitRoot}/bin/g++.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-gcc.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-g++.exe`,
      `${devkitRoot}/bin/ninja.exe`,
      `${programFiles}/Git/usr/bin/patch.exe`
    ]),
    spawnSync: createGnuPatchSpawnSync()
  })
  assert.equal(withLaterConflictingLinkMode.ok, true)
  assert.equal(
    withLaterConflictingLinkMode.environment.MSYS,
    'noacl winsymlinks:native winsymlinks:lnk'
  )

  const withoutLinkFallback = prepareMingwCmakeEnvironment({
    env: {
      VCPKG_ROOT: vcpkgRoot,
      W64DEVKIT_ROOT: devkitRoot,
      ProgramFiles: programFiles,
      PATH: 'C:/Windows/System32',
      MSYS: 'noacl'
    },
    existsSync: createExistsSync([
      `${vcpkgRoot}/scripts/buildsystems/vcpkg.cmake`,
      `${devkitRoot}/bin/gcc.exe`,
      `${devkitRoot}/bin/g++.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-gcc.exe`,
      `${devkitRoot}/bin/x86_64-w64-mingw32-g++.exe`,
      `${devkitRoot}/bin/ninja.exe`,
      `${programFiles}/Git/usr/bin/patch.exe`
    ]),
    spawnSync: createGnuPatchSpawnSync()
  })
  assert.equal(withoutLinkFallback.ok, true)
  assert.equal(withoutLinkFallback.environment.MSYS, 'noacl winsymlinks:lnk')
})

test('MinGW configure script performs the preflight before invoking CMake', () => {
  const script = readFileSync(join(__dirname, 'configure-audio-engine-mingw.cjs'), 'utf8')

  assert.match(script, /findStaleCTestRegistrations/)
  assert.match(script, /prepareMingwCmakeEnvironment/)
  assert.match(script, /prepareMingwBuildLayout/)
  assert.match(script, /const toolchainEnvironment = resolveMingwEnvironment\(\)/)
  assert.match(
    script,
    /const buildLayout = prepareMingwBuildLayout\(\{ root, env: toolchainEnvironment \}\)/
  )
  assert.match(script, /const \{ buildDir \} = buildLayout/)
  assert.match(script, /'-B', buildDir/)
  assert.match(script, /const cmakeEnvironment = preflight\.environment/)
})

test('MinGW configure validates once and never retries a possibly active vcpkg configure', () => {
  const script = readFileSync(join(__dirname, 'configure-audio-engine-mingw.cjs'), 'utf8')

  assert.match(script, /const status = runCmake\(\)/)
  assert.match(script, /if \(status !== 0\) process\.exit\(status\)/)
  assert.equal(script.match(/runCmake\(\)/g)?.length, 2)
  assert.doesNotMatch(script, /cleanFfmpegExtractTemps|vcpkgLogText/)
})

test('MinGW scripts preflight CMake and CTest with the prepared environment', () => {
  const configureScript = readFileSync(join(__dirname, 'configure-audio-engine-mingw.cjs'), 'utf8')
  const runnerScript = readFileSync(join(__dirname, 'run-audio-engine-mingw.cjs'), 'utf8')

  assert.match(configureScript, /validateMingwBuildCommands/)
  assert.match(configureScript, /validateMingwBuildCommands\(\{ env: cmakeEnvironment \}\)/)
  assert.match(configureScript, /validateMingwCTestRegistration/)
  assert.match(configureScript, /expectedTests: MINGW_EXPECTED_CTESTS/)
  assert.match(runnerScript, /validateMingwBuildCommands/)
  assert.match(runnerScript, /prepareMingwBuildLayout/)
  assert.match(runnerScript, /const toolchainEnvironment = resolveMingwEnvironment\(\)/)
  assert.match(
    runnerScript,
    /const layout = prepareMingwBuildLayout\(\{ root, env: toolchainEnvironment \}\)/
  )
  assert.match(
    runnerScript,
    /validateMingwBuildCommands\(\{\s*env: preflight\.environment,\s*commands: \['cmake', 'ctest'\]\s*\}\)/
  )
  assert.match(runnerScript, /validateMingwCTestRegistration/)
  assert.match(
    runnerScript,
    /if \(!ctestRegistration\.ok\)[\s\S]*process\.exit\(ctestRegistration\.status \|\| 1\)/
  )
})

test('MinGW staging rejects an explicitly selected build directory instead of using fallback artifacts', (t) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'twilight-audio-stage-'))
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }))

  const fixtureScripts = join(fixtureRoot, 'scripts')
  mkdirSync(fixtureScripts, { recursive: true })
  copyFileSync(
    join(__dirname, 'stage-audio-engine.cjs'),
    join(fixtureScripts, 'stage-audio-engine.cjs')
  )
  copyFileSync(
    join(__dirname, 'audio-engine-toolchain.cjs'),
    join(fixtureScripts, 'audio-engine-toolchain.cjs')
  )

  const fallbackBuildDirs = [
    join(fixtureRoot, 'audio-engine', 'build', 'mingw-static'),
    join(fixtureRoot, 'audio-engine', 'build', 'windows-msvc'),
    join(fixtureRoot, 'audio-engine', 'build', 'default')
  ]
  const nativeLibrary =
    process.platform === 'win32'
      ? 'twilight-audio-engine.dll'
      : process.platform === 'darwin'
        ? 'libtwilight-audio-engine.dylib'
        : 'libtwilight-audio-engine.so'
  for (const fallbackBuildDir of fallbackBuildDirs) {
    mkdirSync(fallbackBuildDir, { recursive: true })
    for (const file of [nativeLibrary, 'twilight_audio_node.node']) {
      writeFileSync(join(fallbackBuildDir, file), 'fallback artifact')
    }
  }

  const selectedBuildDir = join(fixtureRoot, 'selected-build')
  const result = spawnSync(
    process.execPath,
    [join(fixtureScripts, 'stage-audio-engine.cjs'), '--build-dir', selectedBuildDir],
    {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, TAE_MINGW_BUILD_DIR: '' }
    }
  )

  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}\n${result.stderr}`, /selected audio-engine build directory/i)
  assert.equal(existsSync(join(fixtureRoot, 'resources', 'audio-engine', nativeLibrary)), false)
})

for (const fallbackName of ['windows-msvc', 'default']) {
  test(`generic audio staging discovers ${fallbackName} runtime artifacts`, (t) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'twilight audio stage-'))
    t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }))

    const fixtureScripts = join(fixtureRoot, 'scripts')
    mkdirSync(fixtureScripts, { recursive: true })
    copyFileSync(
      join(__dirname, 'stage-audio-engine.cjs'),
      join(fixtureScripts, 'stage-audio-engine.cjs')
    )
    copyFileSync(
      join(__dirname, 'audio-engine-toolchain.cjs'),
      join(fixtureScripts, 'audio-engine-toolchain.cjs')
    )

    const nativeLibrary =
      process.platform === 'win32'
        ? 'twilight-audio-engine.dll'
        : process.platform === 'darwin'
          ? 'libtwilight-audio-engine.dylib'
          : 'libtwilight-audio-engine.so'
    const fallbackBuildDir = join(fixtureRoot, 'audio-engine', 'build', fallbackName)
    mkdirSync(fallbackBuildDir, { recursive: true })
    for (const file of [nativeLibrary, 'twilight_audio_node.node']) {
      writeFileSync(join(fallbackBuildDir, file), `artifact from ${fallbackName}`)
    }

    const result = spawnSync(process.execPath, [join(fixtureScripts, 'stage-audio-engine.cjs')], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, TAE_MINGW_BUILD_DIR: '' }
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(
      readFileSync(join(fixtureRoot, 'resources', 'audio-engine', nativeLibrary), 'utf8'),
      `artifact from ${fallbackName}`
    )
  })
}

test('MinGW build runner stages from its selected external build directory', () => {
  const script = readFileSync(join(__dirname, 'run-audio-engine-mingw.cjs'), 'utf8')

  assert.match(
    script,
    /\[resolve\(__dirname, 'stage-audio-engine\.cjs'\), '--build-dir', layout\.buildDir\]/
  )
})

test('MinGW build runner reuses the preflight environment for builds and tests', () => {
  const script = readFileSync(join(__dirname, 'run-audio-engine-mingw.cjs'), 'utf8')

  assert.match(script, /prepareMingwCmakeEnvironment/)
  assert.match(
    script,
    /const preflight = prepareMingwCmakeEnvironment\(\{ buildDir: layout\.buildDir, env: toolchainEnvironment \}\)/
  )
  assert.match(script, /if \(!preflight\.ok\) \{[\s\S]*console\.error\(preflight\.message\)/)
  assert.match(script, /action === 'build'[\s\S]*\['cmake', \['--build', layout\.buildDir\]\]/)
  assert.match(
    script,
    /action === 'test'[\s\S]*\['ctest', \['--test-dir', layout\.buildDir, '--output-on-failure'\]\]/
  )
  assert.match(
    script,
    /spawnSync\(command\[0\], command\[1\], \{[\s\S]*env: preflight\.environment/
  )
})

test('MinGW configure clears CTestTestfile.cmake with other stale configure state', () => {
  const script = readFileSync(join(__dirname, 'configure-audio-engine-mingw.cjs'), 'utf8')
  const start = script.indexOf('function cleanCmakeConfigureState()')
  const end = script.indexOf('function cleanStaleCTestRegistration()')
  const cleanState = script.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(cleanState, /const ctestFile = join\(buildDir, 'CTestTestfile\.cmake'\)/)
  assert.match(cleanState, /rmSync\(ctestFile, \{ force: true \}\)/)
})

test('MinGW CTest validation requires every native test registration, including the performance gate', () => {
  const cmakeLists = readFileSync(join(__dirname, '..', 'audio-engine', 'CMakeLists.txt'), 'utf8')
  const registeredTests = [
    ...cmakeLists.matchAll(/add_test\(\s*NAME\s+(twilight_[a-z0-9_]+)/g)
  ].map((match) => match[1])

  assert.equal(MINGW_EXPECTED_CTESTS.length, 23)
  assert.ok(MINGW_EXPECTED_CTESTS.includes('twilight_audio_performance_gate'))
  assert.deepEqual([...MINGW_EXPECTED_CTESTS].sort(), registeredTests.sort())
  assert.match(cmakeLists, /target_compile_options\(twilight_audio_performance_gate PRIVATE -UNDEBUG\)/)
})

test('Windows release gate documents MinGW toolchain and no-whitespace build layout requirements', () => {
  const guide = readFileSync(join(__dirname, '..', 'docs', 'windows-release-gate.md'), 'utf8')

  for (const requirement of [
    'VCPKG_ROOT',
    'W64DEVKIT_ROOT',
    'TWILIGHT_GNU_PATCH',
    'TAE_MINGW_BUILD_DIR'
  ]) {
    assert.match(guide, new RegExp(requirement))
  }
  assert.ok(
    guide.indexOf('pnpm run configure:audio-engine:mingw') <
      guide.indexOf('pnpm run build:audio-engine:mingw')
  )
  assert.ok(
    guide.indexOf('pnpm run build:audio-engine:mingw') <
      guide.indexOf('pnpm run test:audio-engine:mingw')
  )
})
