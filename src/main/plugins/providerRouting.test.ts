import assert from 'node:assert/strict'
import test from 'node:test'

const { dedupeProviderRegistrations, findProviderRoute, providerSupportsMethod } = (await import(
  new URL('./providerRouting.ts', import.meta.url).href
)) as typeof import('./providerRouting')
const { isRecoverableBundledPluginFailure } = (await import(
  new URL('./stateRecovery.ts', import.meta.url).href
)) as typeof import('./stateRecovery')

type TestRunningProvider = {
  pluginId: string
  providers: Array<{
    id: string
    name: string
    capabilities: Array<'search' | 'playbackUrl' | 'lyrics' | 'cover' | 'playlist' | 'library' | 'login'>
  }>
}

const skeleton: TestRunningProvider = {
  pluginId: 'com.test.bili-provider-basic',
  providers: [
    {
      id: 'bili',
      name: 'Bilibili Basic Provider',
      capabilities: ['search', 'playbackUrl', 'lyrics', 'cover', 'playlist']
    }
  ]
}

const fullProvider: TestRunningProvider = {
  pluginId: 'com.twilightecho.provider.bilibili',
  providers: [
    {
      id: 'bili',
      name: 'Bilibili',
      capabilities: ['login', 'playlist', 'library', 'playbackUrl', 'cover']
    }
  ]
}

test('routes provider calls to a plugin that declares the required method capability', () => {
  assert.equal(providerSupportsMethod(skeleton.providers[0], 'getQrLogin'), false)
  assert.equal(providerSupportsMethod(fullProvider.providers[0], 'getQrLogin'), true)

  assert.equal(
    findProviderRoute([skeleton, fullProvider], 'bili', 'getQrLogin')?.pluginId,
    fullProvider.pluginId
  )
  assert.equal(
    findProviderRoute([skeleton, fullProvider], 'bili', 'searchSongs')?.pluginId,
    skeleton.pluginId
  )
})

test('prefers the latest registration when multiple plugins expose the same provider id', () => {
  assert.equal(
    findProviderRoute([skeleton, fullProvider], 'bili', 'getPlaybackUrl')?.pluginId,
    fullProvider.pluginId
  )
  assert.deepEqual(dedupeProviderRegistrations([skeleton, fullProvider]), fullProvider.providers)
})

test('treats bundled plugin host-exit failures as recoverable startup state', () => {
  assert.equal(isRecoverableBundledPluginFailure('插件宿主进程退出：18446744073709552000'), true)
  assert.equal(isRecoverableBundledPluginFailure('Provider 调用超时：ncm.getPlaybackUrl'), false)
  assert.equal(isRecoverableBundledPluginFailure(undefined), false)
})
