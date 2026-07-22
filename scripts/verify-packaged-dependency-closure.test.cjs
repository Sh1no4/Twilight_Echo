const assert = require('node:assert/strict')
const test = require('node:test')

const {
  dependencyManifestCandidates,
  findMissingPackageDependencies,
  normalizeArchivePath,
  packageRootFromManifest
} = require('./verify-packaged-dependency-closure.cjs')

test('packaged dependency paths normalize scoped and nested package manifests', () => {
  assert.equal(
    normalizeArchivePath('\\node_modules\\token-types\\package.json'),
    '/node_modules/token-types/package.json'
  )
  assert.equal(
    packageRootFromManifest('/node_modules/@tokenizer/inflate/package.json'),
    '/node_modules/@tokenizer/inflate'
  )
  assert.deepEqual(
    dependencyManifestCandidates('/node_modules/parent/node_modules/child', 'shared'),
    [
      '/node_modules/parent/node_modules/child/node_modules/shared/package.json',
      '/node_modules/parent/node_modules/shared/package.json',
      '/node_modules/shared/package.json'
    ]
  )
})

test('packaged dependency closure reports every unresolved runtime dependency', () => {
  const manifests = new Map([
    ['/node_modules/root', { name: 'root', dependencies: { nested: '1.0.0', shared: '1.0.0' } }],
    [
      '/node_modules/root/node_modules/nested',
      { name: 'nested', dependencies: { shared: '1.0.0', missing: '1.0.0' } }
    ],
    ['/node_modules/shared', { name: 'shared' }]
  ])
  assert.deepEqual(findMissingPackageDependencies(manifests), ['nested -> missing'])
})
