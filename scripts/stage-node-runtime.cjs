// Stage a pinned Node runtime for the Tauri sidecars.
//
// Twilight Echo's Tauri build ships a fixed Node runtime so the packaged app
// does not depend on a user-preinstalled Node (release-gate: "cleared Node PATH
// smoke"). This script downloads `node.exe` from nodejs.org and stages it under
// `resources/sidecar/` (gitignored, like `resources/audio-engine/**`).
//
// It is idempotent: when the staged runtime already reports the pinned version,
// it skips the download so `tauri build` stays fast and offline-friendly after
// the first stage. Use `--force` to re-download.
const { createWriteStream, existsSync, mkdirSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')
const { get } = require('node:https')

const NODE_VERSION = 'v22.17.0'
const NODE_DIST = 'https://nodejs.org/dist'
const ZIP_NAME = `node-${NODE_VERSION}-win-x64.zip`
const ZIP_URL = `${NODE_DIST}/${NODE_VERSION}/${ZIP_NAME}`
const TARGET_DIR = join(__dirname, '..', 'resources', 'sidecar')
const TARGET_EXE = join(TARGET_DIR, 'node.exe')
const FORCE = process.argv.includes('--force')

function stagedVersion() {
  if (!existsSync(TARGET_EXE)) return null
  const result = spawnSync(TARGET_EXE, ['--version'], { encoding: 'utf8', timeout: 15_000 })
  return result.status === 0 ? result.stdout.trim() : null
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        response.resume()
        download(response.headers.location, destination).then(resolve, reject)
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`HTTP ${response.statusCode} for ${url}`))
        return
      }
      const file = createWriteStream(destination)
      response.pipe(file)
      file.on('finish', () => file.close(resolve))
      file.on('error', reject)
    }).on('error', reject)
  })
}

function extractZip(zipPath, outputDir) {
  // Windows 10+ ships BSD tar which extracts zip; fall back to PowerShell.
  // Git-bash GNU tar misreads `C:\...` as a remote host, so normalize to slashes.
  const unixDir = outputDir.replace(/\\/g, '/')
  let result = spawnSync('tar', ['-xf', zipPath, '-C', unixDir], { stdio: 'inherit' })
  if (result.status === 0) return
  result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${outputDir}' -Force`
    ],
    { stdio: 'inherit' }
  )
  if (result.status !== 0) {
    throw new Error('failed to extract Node zip (tar and Expand-Archive both failed)')
  }
}

async function main() {
  if (!FORCE) {
    const current = stagedVersion()
    if (current === NODE_VERSION) {
      console.log(`Node runtime already staged: ${current} (${TARGET_EXE})`)
      return
    }
    if (current) console.log(`Staged node is ${current}; re-staging ${NODE_VERSION}`)
  }

  mkdirSync(TARGET_DIR, { recursive: true })
  const tmpZip = join(tmpdir(), ZIP_NAME)
  console.log(`Downloading ${ZIP_URL} …`)
  await download(ZIP_URL, tmpZip)

  const extractRoot = join(tmpdir(), `node-stage-${process.pid}`)
  mkdirSync(extractRoot, { recursive: true })
  extractZip(tmpZip, extractRoot)
  const extracted = join(
    extractRoot,
    `node-${NODE_VERSION}-win-x64`,
    'node.exe'
  )
  if (!existsSync(extracted)) {
    throw new Error(`node.exe not found in extracted archive: ${extracted}`)
  }

  const verify = spawnSync(extracted, ['--version'], { encoding: 'utf8', timeout: 15_000 })
  if (verify.status !== 0 || verify.stdout.trim() !== NODE_VERSION) {
    throw new Error(`downloaded node.exe version mismatch: ${verify.stdout?.trim() ?? 'unknown'}`)
  }

  const { copyFileSync, rmSync, statSync } = require('node:fs')
  copyFileSync(extracted, TARGET_EXE)
  rmSync(extractRoot, { recursive: true, force: true })
  rmSync(tmpZip, { force: true })
  const sizeMiB = (statSync(TARGET_EXE).size / 1024 / 1024).toFixed(1)
  console.log(`Staged Node runtime: ${verify.stdout.trim()} (${sizeMiB} MiB) → ${TARGET_EXE}`)
}

main().catch((error) => {
  console.error(`stage-node-runtime failed: ${error.message}`)
  process.exit(1)
})
