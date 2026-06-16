import assert from 'node:assert/strict'
import test from 'node:test'

type NcmRequest = {
  path: string
  cookie?: string
}

interface TestNcmProvider {
  getQrKey(): Promise<unknown>
  getQrImage(key: string): Promise<unknown>
  checkQrLogin(key: string): Promise<unknown>
  searchSongs(keywords: string): Promise<unknown>
}

test('bundled NCM provider keeps QR login requests free of PC/Web fingerprint params', async () => {
  const requests: NcmRequest[] = []
  const registeredProvider: { current?: TestNcmProvider } = {}
  const settings = new Map<string, unknown>([['cookie', 'MUSIC_U=test-token']])

  const providerModule = (await import(
    new URL('../../../resources/plugins/ncm-provider/index.mjs', import.meta.url).href
  )) as {
    activate(context: unknown): Promise<void>
    deactivate(): void
  }

  await providerModule.activate({
    twilight: {
      internal: {
        ncm: {
          async request(path: string, cookie?: string): Promise<unknown> {
            requests.push({ path, cookie })
            if (path.startsWith('/login/qr/key')) {
              return { code: 200, data: { unikey: 'qr-key' } }
            }
            if (path.startsWith('/login/qr/create')) {
              return { code: 200, data: { qrimg: 'data:image/png;base64,test' } }
            }
            if (path.startsWith('/login/qr/check')) {
              return { code: 801 }
            }
            if (path.startsWith('/cloudsearch')) {
              return { code: 200, result: { songs: [], songCount: 0 } }
            }
            return { code: 200 }
          },
          async getCachedSong(): Promise<null> {
            return null
          },
          async cacheSong(): Promise<null> {
            return null
          }
        }
      },
      providers: {
        async register(provider: TestNcmProvider): Promise<void> {
          registeredProvider.current = provider
        }
      }
    },
    settings: {
      async get(key?: string): Promise<unknown> {
        return key ? settings.get(key) : Object.fromEntries(settings)
      },
      async set(key: string, value: unknown): Promise<void> {
        settings.set(key, value)
      },
      async delete(key: string): Promise<void> {
        settings.delete(key)
      }
    },
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {}
    }
  })

  assert.ok(registeredProvider.current)
  const provider = registeredProvider.current

  await provider.getQrKey()
  await provider.getQrImage('qr-key')
  await provider.checkQrLogin('qr-key')

  const loginRequests = requests.filter((request) => request.path.startsWith('/login/qr/'))
  assert.equal(loginRequests.length, 3)
  for (const request of loginRequests) {
    assert.equal(request.path.includes('ua=pc'), false, request.path)
    assert.equal(request.path.includes('platform=web'), false, request.path)
    assert.equal(request.path.includes('chainId='), false, request.path)
  }

  await provider.searchSongs('hello')
  const searchRequest = requests.find((request) => request.path.startsWith('/cloudsearch'))
  assert.ok(searchRequest)
  assert.equal(searchRequest.path.includes('ua=pc'), true, searchRequest.path)

  providerModule.deactivate()
})
