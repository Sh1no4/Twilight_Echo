const { existsSync, readFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { isDeepStrictEqual } = require('node:util')
const { resolve } = require('node:path')

function readManifest(binary, spawn = spawnSync) {
  if (!existsSync(binary))
    return { ok: false, message: `ABI manifest executable is missing: ${binary}` }
  const result = spawn(binary, [], { encoding: 'utf8', windowsHide: true })
  if (result?.error || result?.status !== 0) {
    return {
      ok: false,
      message: `ABI manifest executable failed: ${binary}${result?.error ? ` (${result.error.message})` : ''}`
    }
  }
  try {
    return { ok: true, value: JSON.parse(result.stdout) }
  } catch (error) {
    return {
      ok: false,
      message: `ABI manifest executable returned invalid JSON: ${binary} (${error instanceof Error ? error.message : String(error)})`
    }
  }
}

function verifyAsioAbiManifests({
  goldenPath,
  manifestPaths,
  readFile = readFileSync,
  spawn = spawnSync
}) {
  let golden
  try {
    golden = JSON.parse(readFile(goldenPath, 'utf8'))
  } catch (error) {
    return {
      ok: false,
      message: `ABI golden manifest could not be read: ${goldenPath} (${error instanceof Error ? error.message : String(error)})`
    }
  }
  const values = []
  for (const manifestPath of manifestPaths) {
    const manifest = readManifest(manifestPath, spawn)
    if (!manifest.ok) return manifest
    if (!isDeepStrictEqual(manifest.value, golden)) {
      return {
        ok: false,
        message: `ABI manifest differs from the frozen golden manifest: ${manifestPath}`
      }
    }
    values.push(manifest.value)
  }
  for (const value of values.slice(1)) {
    if (!isDeepStrictEqual(value, values[0])) {
      return { ok: false, message: 'MSVC and MinGW ABI manifests differ' }
    }
  }
  return { ok: true, message: '' }
}

function parseArguments(args) {
  const manifestPaths = []
  let goldenPath = ''
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === '--golden') goldenPath = args[++index] || ''
    else if (value === '--manifest') manifestPaths.push(args[++index] || '')
    else return { ok: false, message: `Unknown argument: ${value}` }
  }
  if (!goldenPath || manifestPaths.length === 0 || manifestPaths.some((path) => !path)) {
    return {
      ok: false,
      message:
        'Usage: verify-asio-abi-manifest --golden <path> --manifest <path> [--manifest <path>]'
    }
  }
  return {
    ok: true,
    goldenPath: resolve(goldenPath),
    manifestPaths: manifestPaths.map((path) => resolve(path))
  }
}

if (require.main === module) {
  const options = parseArguments(process.argv.slice(2))
  if (!options.ok) {
    console.error(options.message)
    process.exit(1)
  }
  const result = verifyAsioAbiManifests(options)
  if (!result.ok) {
    console.error(result.message)
    process.exit(1)
  }
}

module.exports = { parseArguments, readManifest, verifyAsioAbiManifests }
