import assert from 'node:assert/strict'
import test from 'node:test'

const { findProviderRoute, providerSupportsMethod } = (await import(
  new URL('./providerRouting.ts', import.meta.url).href
)) as typeof import('./providerRouting')

type TestRunningProvider = {
  pluginId: string
  providers: Array<{
    id: string
    name: string
    capabilities: Array<'search' | 'playbackUrl' | 'lyrics' | 'cover' | 'playlist' | 'library' | 'login'>
  }>
}

const skeleton: TestRunningProvider = {
  pluginId: 'com.twilightecho.examples.bili-provider-skeleton',
  providers: [
    {
      id: 'bili',
      name: 'Bilibili Provider Skeleton',
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
