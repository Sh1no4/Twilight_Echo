const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const MIB = 1024 * 1024
const DEFAULT_BUDGETS = Object.freeze({
  'twilight-audio-engine.dll': 192 * MIB,
  'twilight_audio_node.node': 16 * MIB,
  'twilight-vst3-host.exe': 32 * MIB,
  'twilight-vst3-scanner.exe': 32 * MIB,
  installer: 384 * MIB
})
const DEFAULT_SHIPPED_BINARY_BUDGET = 64 * MIB

function parseArgs(argv) {
  const options = {
    nativeDir: '',
    artifactDir: '',
    installer: '',
    requireSignature: false,
    signingThumbprint: process.env.TWILIGHT_RELEASE_SIGNING_THUMBPRINT || ''
  }
  const args = argv[0] === '--' ? argv.slice(1) : argv
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--require-signature') {
      options.requireSignature = true
      continue
    }
    if (!['--native-dir', '--artifact-dir', '--installer', '--signing-thumbprint'].includes(arg)) {
      throw new Error(`Unknown argument: ${arg}`)
    }
    const value = args[++index]
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a path or value`)
    if (arg === '--native-dir') options.nativeDir = value
    if (arg === '--artifact-dir') options.artifactDir = value
    if (arg === '--installer') options.installer = value
    if (arg === '--signing-thumbprint') options.signingThumbprint = value
  }
  if (!options.nativeDir) throw new Error('--native-dir is required')
  if (!options.installer && !options.artifactDir) {
    throw new Error('Provide --installer or --artifact-dir so the installer size budget can be checked')
  }
  return options
}

function normalizeThumbprint(value) {
  const normalized = String(value || '').replace(/[^a-f0-9]/gi, '').toUpperCase()
  if (!/^[A-F0-9]{40,64}$/.test(normalized)) return ''
  return normalized
}

function readPeHeader(filePath) {
  const buffer = fs.readFileSync(filePath)
  if (buffer.length < 0x40 || buffer.toString('ascii', 0, 2) !== 'MZ') {
    throw new Error(`${filePath} is not a PE binary`)
  }
  const peOffset = buffer.readUInt32LE(0x3c)
  if (peOffset + 24 > buffer.length || buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error(`${filePath} has an invalid PE header`)
  }
  const coffOffset = peOffset + 4
  const optionalSize = buffer.readUInt16LE(coffOffset + 16)
  const optionalOffset = coffOffset + 20
  if (optionalOffset + optionalSize > buffer.length || optionalSize < 96) {
    throw new Error(`${filePath} has a truncated PE optional header`)
  }
  const optionalMagic = buffer.readUInt16LE(optionalOffset)
  const dataDirectoryOffset = optionalMagic === 0x20b ? optionalOffset + 112 : optionalOffset + 96
  if (![0x10b, 0x20b].includes(optionalMagic) || dataDirectoryOffset + 8 * 7 > optionalOffset + optionalSize) {
    throw new Error(`${filePath} has an unsupported PE optional header`)
  }
  const sectionCount = buffer.readUInt16LE(coffOffset + 2)
  const symbolTableOffset = buffer.readUInt32LE(coffOffset + 8)
  const symbolCount = buffer.readUInt32LE(coffOffset + 12)
  const debugDirectoryRva = buffer.readUInt32LE(dataDirectoryOffset + 8 * 6)
  const debugDirectorySize = buffer.readUInt32LE(dataDirectoryOffset + 8 * 6 + 4)
  const sectionTableOffset = optionalOffset + optionalSize
  const sections = []
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionTableOffset + index * 40
    if (offset + 40 > buffer.length) throw new Error(`${filePath} has a truncated PE section table`)
    sections.push(buffer.toString('ascii', offset, offset + 8).replace(/\0+$/, ''))
  }
  return { symbolTableOffset, symbolCount, debugDirectoryRva, debugDirectorySize, sections }
}

function assertStrippedPe(filePath) {
  const pe = readPeHeader(filePath)
  assert.equal(pe.symbolTableOffset, 0, `${path.basename(filePath)} retains a COFF symbol table`)
  assert.equal(pe.symbolCount, 0, `${path.basename(filePath)} retains COFF symbols`)
  assert.equal(pe.debugDirectoryRva, 0, `${path.basename(filePath)} retains a PE debug directory`)
  assert.equal(pe.debugDirectorySize, 0, `${path.basename(filePath)} retains PE debug data`)
  assert.equal(
    pe.sections.some((section) => /^\.debug/i.test(section)),
    false,
    `${path.basename(filePath)} retains a debug section`
  )
}

function assertBudget(filePath, maxBytes, label = path.basename(filePath)) {
  const size = fs.statSync(filePath).size
  assert.ok(size > 0, `${label} is empty`)
  assert.ok(size <= maxBytes, `${label} is ${size} bytes; budget is ${maxBytes} bytes`)
  return size
}

function listNativeBinaries(nativeDir) {
  const required = Object.keys(DEFAULT_BUDGETS).filter((name) => name !== 'installer')
  return required.map((name) => {
    const filePath = path.resolve(nativeDir, name)
    assert.ok(fs.existsSync(filePath), `Missing required native binary: ${filePath}`)
    return filePath
  })
}

function listShippedBinaries(nativeDir) {
  const binaries = fs
    .readdirSync(nativeDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(dll|exe|node)$/i.test(entry.name))
    .map((entry) => path.join(nativeDir, entry.name))
  assert.ok(binaries.length > 0, `No shipped DLL/EXE/NODE binaries found in ${nativeDir}`)
  return binaries
}

function findInstaller(options) {
  if (options.installer) {
    const installer = path.resolve(options.installer)
    assert.ok(fs.existsSync(installer), `Installer does not exist: ${installer}`)
    return installer
  }
  const artifactDir = path.resolve(options.artifactDir)
  assert.ok(fs.existsSync(artifactDir), `Artifact directory does not exist: ${artifactDir}`)
  const installers = fs
    .readdirSync(artifactDir)
    .filter((name) => /-setup\.exe$/i.test(name))
    .map((name) => path.join(artifactDir, name))
  assert.equal(installers.length, 1, `Expected exactly one NSIS installer in ${artifactDir}`)
  return installers[0]
}

function readWindowsSignature(filePath, run = execFileSync) {
  const script = [
    "$signature = Get-AuthenticodeSignature -LiteralPath $args[0]",
    "[PSCustomObject]@{ status = [string]$signature.Status; thumbprint = [string]$signature.SignerCertificate.Thumbprint } | ConvertTo-Json -Compress"
  ].join('; ')
  const output = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script, filePath], {
    encoding: 'utf8',
    windowsHide: true
  })
  return JSON.parse(String(output).trim())
}

function assertWindowsSignature(filePath, expectedThumbprint, readSignature = readWindowsSignature) {
  const expected = normalizeThumbprint(expectedThumbprint)
  assert.ok(expected, 'TWILIGHT_RELEASE_SIGNING_THUMBPRINT is required for a signed Windows release')
  const actual = readSignature(filePath)
  assert.equal(actual.status, 'Valid', `${path.basename(filePath)} does not have a valid Authenticode signature`)
  assert.equal(
    normalizeThumbprint(actual.thumbprint),
    expected,
    `${path.basename(filePath)} was not signed by TWILIGHT_RELEASE_SIGNING_THUMBPRINT`
  )
}

function verifyReleaseArtifacts(options, dependencies = {}) {
  const nativeBinaries = listNativeBinaries(options.nativeDir)
  const shippedBinaries = listShippedBinaries(options.nativeDir)
  const installer = findInstaller(options)
  const sizes = {}
  for (const filePath of shippedBinaries) {
    const name = path.basename(filePath)
    sizes[name] = assertBudget(filePath, DEFAULT_BUDGETS[name] || DEFAULT_SHIPPED_BINARY_BUDGET)
  }
  for (const filePath of nativeBinaries) {
    assertStrippedPe(filePath)
  }
  sizes.installer = assertBudget(installer, DEFAULT_BUDGETS.installer, 'NSIS installer')
  if (options.requireSignature) {
    for (const filePath of [...nativeBinaries, installer]) {
      assertWindowsSignature(filePath, options.signingThumbprint, dependencies.readSignature)
    }
  }
  return { nativeBinaries, shippedBinaries, installer, sizes, signatureRequired: options.requireSignature }
}

function main() {
  const result = verifyReleaseArtifacts(parseArgs(process.argv.slice(2)))
  console.log(`Release artifacts verified: ${result.nativeBinaries.length} native binaries, installer=${result.installer}`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

module.exports = {
  DEFAULT_BUDGETS,
  DEFAULT_SHIPPED_BINARY_BUDGET,
  assertBudget,
  assertStrippedPe,
  assertWindowsSignature,
  findInstaller,
  listNativeBinaries,
  listShippedBinaries,
  normalizeThumbprint,
  parseArgs,
  readPeHeader,
  verifyReleaseArtifacts
}
