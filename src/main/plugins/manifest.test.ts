import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

test('requires native permission for DSP plugins', () => {
  assert.throws(
    () =>
      validatePluginManifest({
        ...validManifest,
        type: ['dsp'],
        main: undefined,
        binary: { 'win32-x64': 'plugin.dll' }
      }),
    /dsp:native/
  )
  const manifest = validatePluginManifest({
    ...validManifest,
    type: ['dsp'],
    main: undefined,
    binary: { 'win32-x64': 'plugin.dll' },
    permissions: ['dsp:native']
  })
  assert.deepEqual(manifest.permissions, ['dsp:native'])
})

test('requires either executable entry or declarative theme contribution', () => {
  assert.throws(() => validatePluginManifest({ ...validManifest, main: undefined }), /main 或 binary/)
  const manifest = validatePluginManifest({
    ...validManifest,
    id: 'com.example.declarative-theme',
    type: ['theme'],
    main: undefined,
    permissions: [],
    contributes: {
      themes: [
        {
          id: 'nocturne',
          name: 'Nocturne',
          variables: {
            '--te-primary-500': '#2563eb'
          },
          stylesheet: 'theme.css'
        }
      ]
    }
  })
  assert.equal(manifest.main, undefined)
  assert.deepEqual(manifest.type, ['theme'])
})

test('rejects executable entries for pure theme plugins', () => {
  assert.throws(
    () =>
      validatePluginManifest({
        ...validManifest,
        id: 'com.example.scripted-theme',
        type: ['theme'],
        permissions: [],
        contributes: {
          themes: [{ id: 'scripted', name: 'Scripted', variables: { '--te-primary-500': '#fff' } }]
        }
      }),
    /纯 theme 插件只能通过 contributes\.themes 声明/
  )
})

test('rejects paths outside plugin root', () => {
  const rejectedPaths = [
    '../escape.mjs',
    'dist/../../escape.mjs',
    '..\\escape.mjs',
    'dist\\..\\..\\escape.mjs',
    '/absolute.mjs',
    '\\rooted.mjs',
    'C:\\absolute.mjs',
    'C:/absolute.mjs',
    'C:drive-relative.mjs',
    '\\\\server\\share\\plugin.mjs',
    '//server/share/plugin.mjs',
    '\\\\?\\C:\\device-path.mjs',
    '\\\\.\\pipe\\plugin.mjs',
    'assets/illegal\0file'
  ]
  for (const path of rejectedPaths) {
    assert.throws(
      () => validatePluginManifest({ ...validManifest, main: path }),
      /目录外|空字符/
    )
    assert.throws(
      () => validatePluginManifest({ ...validManifest, icon: path }),
      /目录外|空字符/
    )
    assert.throws(
      () =>
        validatePluginManifest({
          ...validManifest,
          binary: { 'win32-x64': path }
        }),
      /目录外|空字符/
    )
  }
})

test('normalizes nested main, icon, and binary paths to a platform-independent POSIX vector', () => {
  const common = {
    ...validManifest,
    id: 'com.example.cross-platform',
    type: ['tool', 'dsp'],
    permissions: ['dsp:native']
  }
  const windowsStyle = validatePluginManifest({
    ...common,
    main: 'dist\\generated\\..\\index.mjs',
    icon: 'assets\\icons\\plugin.png',
    binary: {
      'win32-x64': 'native\\win32\\plugin.dll',
      'linux-x64': 'native\\linux\\libplugin.so'
    }
  })
  const posixStyle = validatePluginManifest({
    ...common,
    main: 'dist/index.mjs',
    icon: 'assets/icons/plugin.png',
    binary: {
      'win32-x64': 'native/win32/plugin.dll',
      'linux-x64': 'native/linux/libplugin.so'
    }
  })

  assert.deepEqual(
    {
      main: windowsStyle.main,
      icon: windowsStyle.icon,
      binary: windowsStyle.binary
    },
    {
      main: 'dist/index.mjs',
      icon: 'assets/icons/plugin.png',
      binary: {
        'win32-x64': 'native/win32/plugin.dll',
        'linux-x64': 'native/linux/libplugin.so'
      }
    }
  )
  assert.deepEqual(windowsStyle, posixStyle)
})

test('rejects future plugin API versions', () => {
  assert.throws(() => validatePluginManifest({ ...validManifest, apiVersion: 99 }), /高于宿主支持版本/)
})

test('accepts valid plugin dependencies', () => {
  const manifest = validatePluginManifest({
    ...validManifest,
    dependencies: {
      'com.example.base': '>=1.0.0',
      'org.example.shared': '^2.1.0',
      'net.example.exact': '3.0.0',
      'io.example.any': '*'
    }
  })
  assert.deepEqual(manifest.dependencies, {
    'com.example.base': '>=1.0.0',
    'org.example.shared': '^2.1.0',
    'net.example.exact': '3.0.0',
    'io.example.any': '*'
  })
})

test('rejects invalid plugin dependencies', () => {
  assert.throws(
    () => validatePluginManifest({ ...validManifest, dependencies: [] }),
    /dependencies/
  )
  assert.throws(
    () => validatePluginManifest({ ...validManifest, dependencies: { bad: '>=1.0.0' } }),
    /非法插件 ID/
  )
  assert.throws(
    () =>
      validatePluginManifest({
        ...validManifest,
        dependencies: { 'com.example.base': 'latest' }
      }),
    /semver range/
  )
})

test('checks basic Twilight Echo engine ranges', () => {
  assert.equal(isCompatibleTwilightRange('>=0.20.0', '0.20.0'), true)
  assert.equal(isCompatibleTwilightRange('>=0.21.0', '0.20.0'), false)
  assert.equal(isCompatibleTwilightRange('^0.20.0', '0.20.1'), true)
  assert.equal(isCompatibleTwilightRange('~0.20.0', '0.21.0'), false)
})

test('accepts Phase 3 UI and theme sample manifests', () => {
  assert.deepEqual(
    validatePluginManifest({
      ...validManifest,
      id: 'com.example.scrobbler',
      type: ['tool', 'ui'],
      permissions: ['player:observe', 'ui:inject']
    }).type,
    ['tool', 'ui']
  )

  assert.deepEqual(
    validatePluginManifest({
      ...validManifest,
      id: 'com.example.theme',
      type: ['theme'],
      main: undefined,
      permissions: [],
      contributes: {
        themes: [
          {
            id: 'sample',
            name: 'Sample Theme',
            stylesheet: 'theme.css'
          }
        ]
      }
    }).type,
    ['theme']
  )
})

test('accepts bundled NetEase provider manifest', async () => {
  const raw = await readFile(
    new URL('../../../resources/plugins/ncm-provider/plugin.json', import.meta.url),
    'utf-8'
  )
  const manifest = validatePluginManifest(JSON.parse(raw))
  assert.equal(manifest.id, 'com.twilightecho.provider.ncm')
  assert.deepEqual(manifest.type, ['provider'])
  assert.equal(manifest.main, 'index.mjs')
  assert.ok(manifest.permissions.includes('network'))
  assert.ok(manifest.permissions.includes('settings'))
})
