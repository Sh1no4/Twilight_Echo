const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const asar = require('@electron/asar')

function normalizeArchivePath(value) {
  return value.replaceAll('\\', '/')
}

function packageRootFromManifest(manifestPath) {
  return manifestPath.match(/^(.*\/node_modules\/(?:@[^/]+\/[^/]+|[^/]+))\/package\.json$/)?.[1]
}

function dependencyManifestCandidates(packageRoot, dependencyName) {
  const candidates = []
  let cursor = packageRoot
  for (;;) {
    candidates.push(`${cursor}/node_modules/${dependencyName}/package.json`)
    const parentIndex = cursor.lastIndexOf('/node_modules/')
    if (parentIndex <= 0) break
    cursor = cursor.slice(0, parentIndex)
  }
  candidates.push(`/node_modules/${dependencyName}/package.json`)
  return [...new Set(candidates)]
}

function findMissingPackageDependencies(manifests) {
  const manifestPaths = new Set(
    [...manifests.keys()].map((packageRoot) => `${packageRoot}/package.json`)
  )
  const missing = []
  for (const [packageRoot, manifest] of manifests) {
    for (const dependencyName of Object.keys(manifest.dependencies || {})) {
      const resolved = dependencyManifestCandidates(packageRoot, dependencyName).some((candidate) =>
        manifestPaths.has(candidate)
      )
      if (!resolved) missing.push(`${manifest.name || packageRoot} -> ${dependencyName}`)
    }
  }
  return [...new Set(missing)].sort()
}

function readPackagedManifests(asarPath) {
  assert.ok(fs.existsSync(asarPath), `Packaged app.asar not found: ${asarPath}`)
  const archiveEntries = asar.listPackage(asarPath)
  const archiveEntryByPath = new Map(
    archiveEntries.map((entry) => [normalizeArchivePath(entry), entry])
  )
  const manifests = new Map()
  for (const [manifestPath, archiveEntry] of archiveEntryByPath) {
    const packageRoot = packageRootFromManifest(manifestPath)
    if (!packageRoot) continue
    const contents = asar.extractFile(asarPath, archiveEntry.slice(1))
    manifests.set(packageRoot, JSON.parse(contents.toString('utf8')))
  }
  return manifests
}

function verifyPackagedDependencyClosure(asarPath) {
  const manifests = readPackagedManifests(asarPath)
  const missing = findMissingPackageDependencies(manifests)
  assert.deepEqual(missing, [], `Missing packaged runtime dependencies:\n${missing.join('\n')}`)
  return { packages: manifests.size }
}

function main(args = process.argv.slice(2)) {
  assert.equal(
    args.length,
    1,
    'Usage: node scripts/verify-packaged-dependency-closure.cjs <app.asar>'
  )
  const result = verifyPackagedDependencyClosure(path.resolve(args[0]))
  console.log(`Packaged dependency closure verified: ${result.packages} packages`)
}

if (require.main === module) main()

module.exports = {
  dependencyManifestCandidates,
  findMissingPackageDependencies,
  normalizeArchivePath,
  packageRootFromManifest,
  readPackagedManifests,
  verifyPackagedDependencyClosure
}
