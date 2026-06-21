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
  getPlaybackUrl(track: unknown): Promise<string | null>
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

  await provider.getPlaybackUrl({ id: 'ncm:1' })
  const playbackRequest = requests.find((request) => request.path.startsWith('/song/url'))
  assert.ok(playbackRequest)
  assert.equal(playbackRequest.path.includes('ua=pc'), false, playbackRequest.path)

  providerModule.deactivate()
})

test('bundled NCM provider falls back when the preferred playback endpoint fails', async () => {
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
            if (path.startsWith('/song/url') && path.includes('br=999000')) {
              throw new Error('preferred level unavailable')
            }
            if (path.startsWith('/song/url') && path.includes('br=320000')) {
              return {
                code: 200,
                data: [{ id: 2609824992, url: 'https://music.example/song.mp3', br: 320000 }]
              }
            }
            return { code: 200, data: [] }
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

  assert.equal(
    await registeredProvider.current?.getPlaybackUrl({ id: 'ncm:2609824992' }),
    'https://music.example/song.mp3'
  )
  assert.equal(requests.length, 2)
  assert.equal(requests[0].path.includes('br=999000'), true, requests[0].path)
  assert.equal(requests[1].path.includes('br=320000'), true, requests[1].path)

  await registeredProvider.current?.getPlaybackUrl({ id: 'ncm:2609824992' })
  assert.equal(requests.length, 2)

  providerModule.deactivate()
})

test('bundled NCM provider does not return local cache paths as playback URLs', async () => {
  const requests: NcmRequest[] = []
  const registeredProvider: { current?: TestNcmProvider } = {}
  const settings = new Map<string, unknown>([['cookie', 'MUSIC_U=test-token']])
  const cachedPath = 'D:\\TwilightCache\\ncm-cache\\2609824992.flac'

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
            return {
              code: 200,
              data: [{ id: 2609824992, url: 'https://music.example/song.flac', br: 999000 }]
            }
          },
          async getCachedSong(): Promise<string> {
            return cachedPath
          },
          async cacheSong(): Promise<string> {
            return cachedPath
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

  assert.equal(
    await registeredProvider.current?.getPlaybackUrl({ id: 'ncm:2609824992' }),
    'https://music.example/song.flac'
  )
  assert.equal(requests.length, 1)

  assert.equal(
    await registeredProvider.current?.getPlaybackUrl({ id: 'ncm:2609824992' }),
    'https://music.example/song.flac'
  )
  assert.equal(requests.length, 1)

  providerModule.deactivate()
})

test('bundled NCM provider does not cache empty playback lookups', async () => {
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
            return { code: 200, data: [{ id: 404, url: null, msg: 'no playable url' }] }
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

  assert.equal(await registeredProvider.current?.getPlaybackUrl({ id: 'ncm:404' }), null)
  assert.equal(requests.length, 6)

  assert.equal(await registeredProvider.current?.getPlaybackUrl({ id: 'ncm:404' }), null)
  assert.equal(requests.length, 12)

  providerModule.deactivate()
})
