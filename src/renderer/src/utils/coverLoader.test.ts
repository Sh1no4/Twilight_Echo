import assert from 'node:assert/strict'
import test from 'node:test'

const { clearRemoteCoverGrantCache, resolveCover } = (await import(
  new URL('./coverLoader.ts', import.meta.url).href
)) as typeof import('./coverLoader')

test('resolveCover passes cover:// handles through without IPC', async () => {
  clearRemoteCoverGrantCache()
  assert.equal(await resolveCover('cover://abc.jpg'), 'cover://abc.jpg')
})

test('resolveCover prefers durable coverSource and re-grants remote origins', async () => {
  clearRemoteCoverGrantCache()
  const grants: string[] = []
  const globalRecord = globalThis as typeof globalThis & {
    window?: {
      api?: {
        data?: {
          grantRemoteCover?: (source: string) => Promise<string>
        }
      }
    }
  }
  const previous = globalRecord.window
  globalRecord.window = {
    api: {
      data: {
        grantRemoteCover: async (source: string) => {
          grants.push(source)
          return `twilight-media://image/reissued-${grants.length}`
        }
      }
    }
  }

  try {
    // Dead post-restart grant + durable origin → re-grant from origin.
    const restored = await resolveCover(
      'twilight-media://image/expired-token',
      'https://p1.music.126.net/cover.jpg'
    )
    assert.equal(restored, 'twilight-media://image/reissued-1')

    // Cached by origin.
    const again = await resolveCover(
      'twilight-media://image/other-token',
      'https://p1.music.126.net/cover.jpg'
    )
    assert.equal(again, 'twilight-media://image/reissued-1')
    assert.equal(grants.length, 1)

    // Legacy bare https cover (no coverSource) → grant for CSP.
    const bareHttps = await resolveCover('https://p1.music.126.net/legacy.jpg')
    assert.equal(bareHttps, 'twilight-media://image/reissued-2')

    // Source-only row.
    const fromSourceOnly = await resolveCover(null, 'https://p1.music.126.net/only-source.jpg')
    assert.equal(fromSourceOnly, 'twilight-media://image/reissued-3')

    // Live grant without durable origin still displays.
    assert.equal(
      await resolveCover('twilight-media://image/live-token'),
      'twilight-media://image/live-token'
    )
  } finally {
    globalRecord.window = previous
    clearRemoteCoverGrantCache()
  }
})
