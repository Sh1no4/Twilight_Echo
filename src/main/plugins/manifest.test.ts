import assert from 'node:assert/strict'
import test from 'node:test'

const { isCompatibleTwilightRange, validatePluginManifest } = (await import(
  new URL('./manifest.ts', import.meta.url).href
)) as typeof import('./manifest')

const validManifest = {
  id: 'com.example.hello',
  name: 'Hello',
  version: '1.0.0',
  description: 'A test plugin',
  author: 'Example',
  license: 'Apache-2.0',
  type: ['tool'],
  main: 'index.mjs',
  engines: {
    twilightEcho: '>=0.20.0'
  },
  apiVersion: 1,
  permissions: ['player:observe']
}

test('validates a conforming JS plugin manifest', () => {
  const manifest = validatePluginManifest(validManifest)
  assert.equal(manifest.id, validManifest.id)
  assert.deepEqual(manifest.type, ['tool'])
  assert.deepEqual(manifest.permissions, ['player:observe'])
})

test('rejects missing mandatory permissions', () => {
  assert.throws(
    () => validatePluginManifest({ ...validManifest, permissions: undefined }),
    /permissions/
  )
})

test('rejects unknown permissions and plugin types', () => {
  assert.throws(
    () => validatePluginManifest({ ...validManifest, permissions: ['danger'] }),
    /未知权限/
  )
  assert.throws(() => validatePluginManifest({ ...validManifest, type: ['source'] }), /未知插件类型/)
})

test('requires binary for DSP plugins', () => {
  assert.throws(() => validatePluginManifest({ ...validManifest, type: ['dsp'] }), /binary/)
})

test('requires either JS main or native binary', () => {
  assert.throws(() => validatePluginManifest({ ...validManifest, main: undefined }), /main 或 binary/)
})

test('rejects paths outside plugin root', () => {
  assert.throws(() => validatePluginManifest({ ...validManifest, main: '../escape.mjs' }), /目录外/)
  assert.throws(
    () =>
      validatePluginManifest({
        ...validManifest,
        main: undefined,
        binary: {
          'win32-x64': '../escape.dll'
        }
      }),
    /目录外/
  )
})

test('rejects future plugin API versions', () => {
  assert.throws(() => validatePluginManifest({ ...validManifest, apiVersion: 99 }), /高于宿主支持版本/)
})

test('checks basic Twilight Echo engine ranges', () => {
  assert.equal(isCompatibleTwilightRange('>=0.20.0', '0.20.0'), true)
  assert.equal(isCompatibleTwilightRange('>=0.21.0', '0.20.0'), false)
  assert.equal(isCompatibleTwilightRange('^0.20.0', '0.20.1'), true)
  assert.equal(isCompatibleTwilightRange('~0.20.0', '0.21.0'), false)
})
