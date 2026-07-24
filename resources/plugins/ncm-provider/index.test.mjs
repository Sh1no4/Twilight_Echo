import assert from 'node:assert/strict'
import test from 'node:test'

import * as ncmProvider from './index.mjs'

function song(id) {
  return {
    id,
    name: `song-${id}`,
    ar: [{ name: 'artist' }],
    al: { name: `album-${id}`, picUrl: null },
    dt: 180000
  }
}

function album(id) {
  return {
    id,
    name: `album-${id}`,
    picUrl: null,
    size: 10
  }
}

async function activateProvider(
  request,
  settings = new Map([['cookie', 'MUSIC_U=test;']])
) {
  let registeredProvider = null
  await ncmProvider.activate({
    twilight: {
      internal: {
        ncm: {
          request,
          officialLogin: async () => 'MUSIC_U=test;',
          getCachedSong: async () => null,
          cacheSong: async () => null
        }
      },
      providers: {
        register: async (provider) => {
          registeredProvider = provider
        }
      }
    },
    settings: {
      get: async (key) => (key == null ? Object.fromEntries(settings) : settings.get(key)),
      set: async (key, value) => {
        settings.set(key, value)
      },
      delete: async (key) => {
        settings.delete(key)
      }
    },
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
  })
  assert.ok(registeredProvider)
  return registeredProvider
}

function parseRequest(path) {
  return new URL(path, 'http://twilight.local')
}

test('playback quality falls back only through official lower compatible levels', async () => {
  const requests = []
  const provider = await activateProvider(async (path) => {
    requests.push(path)
    const url = parseRequest(path)
    assert.equal(url.pathname, '/song/url/v1')
    assert.equal(url.searchParams.get('encodeType'), 'flac')
    if (url.searchParams.get('level') === 'lossless') {
      return {
        code: 200,
        data: [{ id: 77, url: null, code: 404, fee: 1, msg: 'VIP quality unavailable' }]
      }
    }
    if (url.searchParams.get('level') === 'exhigh') {
      return {
        code: 200,
        data: [{ id: 77, url: 'https://music.example/77.mp3', code: 200, level: 'exhigh' }]
      }
    }
    throw new Error(`unexpected quality: ${url.searchParams.get('level')}`)
  })

  try {
    assert.equal(
      await provider.getPlaybackUrl({ id: 'ncm:77' }, { quality: 'lossless' }),
      'https://music.example/77.mp3'
    )
    assert.deepEqual(
      requests.map((path) => parseRequest(path).searchParams.get('level')),
      ['lossless', 'exhigh']
    )
    assert.ok(requests.every((path) => !path.includes('unblock=')))
  } finally {
    ncmProvider.deactivate()
  }
})

test('automatic quality falls back through Hi-Res, lossless, extreme, and standard only', async () => {
  const requests = []
  const provider = await activateProvider(async (path) => {
    requests.push(path)
    const url = parseRequest(path)
    if (url.pathname !== '/song/url/v1') {
      throw new Error(`unexpected path: ${url.pathname}`)
    }
    const level = url.searchParams.get('level')
    if (level === 'exhigh') {
      return { code: 200, data: [{ id: 78, url: 'https://music.example/78.mp3', code: 200 }] }
    }
    return { code: 200, data: [{ id: 78, url: null, code: 404, msg: 'unavailable' }] }
  })

  try {
    assert.equal(await provider.getPlaybackUrl({ id: 'ncm:78' }), 'https://music.example/78.mp3')
    assert.deepEqual(
      requests.map((path) => parseRequest(path).searchParams.get('level')),
      ['hires', 'lossless', 'exhigh']
    )
  } finally {
    ncmProvider.deactivate()
  }
})

test('premium-only tracks return no URL when no officially authorized fallback exists', async () => {
  const requests = []
  const provider = await activateProvider(async (path) => {
    requests.push(path)
    return {
      code: 200,
      data: [{ id: 79, url: null, code: 404, fee: 1, msg: 'VIP only' }]
    }
  })

  try {
    assert.equal(await provider.getPlaybackUrl({ id: 'ncm:79' }, { quality: 'hires' }), null)
    assert.deepEqual(
      requests.map((path) => {
        const url = parseRequest(path)
        if (url.pathname === '/song/url/v1') return `v1:${url.searchParams.get('level')}`
        return `br:${url.searchParams.get('br')}`
      }),
      ['v1:hires', 'v1:lossless', 'v1:exhigh', 'v1:standard', 'br:999000', 'br:320000', 'br:128000']
    )
  } finally {
    ncmProvider.deactivate()
  }
})

test('classic bitrate endpoint is used when level-based player API has no URL', async () => {
  const requests = []
  const provider = await activateProvider(async (path) => {
    requests.push(path)
    const url = parseRequest(path)
    if (url.pathname === '/song/url/v1') {
      return { code: 200, data: [{ id: 80, url: null, code: 404, msg: 'level unavailable' }] }
    }
    if (url.pathname === '/song/url' && url.searchParams.get('br') === '320000') {
      return {
        code: 200,
        data: [{ id: 80, url: '//m701.music.126.net/song.mp3', br: 320000 }]
      }
    }
    return { code: 200, data: [{ id: 80, url: null, code: 404 }] }
  })

  try {
    assert.equal(
      await provider.getPlaybackUrl({ id: 'ncm:80' }, { quality: 'standard' }),
      'https://m701.music.126.net/song.mp3'
    )
    assert.ok(requests.some((path) => path.startsWith('/song/url?')))
    assert.ok(requests.some((path) => path.includes('br=320000')))
  } finally {
    ncmProvider.deactivate()
  }
})

test('protocol-relative stream URLs are normalized to https', async () => {
  const provider = await activateProvider(async () => ({
    code: 200,
    data: [{ id: 81, url: '//m801.music.126.net/track.flac', code: 200, level: 'hires' }]
  }))

  try {
    assert.equal(
      await provider.getPlaybackUrl({ id: 'ncm:81' }, { quality: 'hires' }),
      'https://m801.music.126.net/track.flac'
    )
  } finally {
    ncmProvider.deactivate()
  }
})

test('prefers a completed disk cache path and skips the network', async () => {
  const cachedPath = 'D:\\Cache\\ncm-cache\\90.flac'
  let networkCalls = 0
  let registeredProvider = null
  await ncmProvider.activate({
    twilight: {
      internal: {
        ncm: {
          request: async () => {
            networkCalls += 1
            throw new Error('network should not be used on cache hit')
          },
          officialLogin: async () => 'MUSIC_U=test;',
          getCachedSong: async (songId) => (Number(songId) === 90 ? cachedPath : null),
          cacheSong: async () => null
        }
      },
      providers: {
        register: async (provider) => {
          registeredProvider = provider
        }
      }
    },
    settings: {
      get: async (key) =>
        key == null ? { cookie: 'MUSIC_U=test;' } : key === 'cookie' ? 'MUSIC_U=test;' : undefined,
      set: async () => undefined,
      delete: async () => undefined
    },
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
  })
  assert.ok(registeredProvider)

  try {
    assert.equal(await registeredProvider.getPlaybackUrl({ id: 'ncm:90' }), cachedPath)
    assert.equal(networkCalls, 0)
    assert.equal(
      await registeredProvider.getPlaybackUrl({ id: 'ncm:90' }, { force: true }),
      null
    )
  } finally {
    ncmProvider.deactivate()
  }
})

test('artist songs keep paging when a short page reports more items', async () => {
  const requests = []
  const provider = await activateProvider(async (path) => {
    requests.push(path)
    const url = parseRequest(path)
    assert.equal(url.pathname, '/artist/songs')
    assert.equal(url.searchParams.get('id'), '6452')
    assert.equal(url.searchParams.get('order'), 'hot')
    assert.equal(url.searchParams.get('limit'), '100')

    const offset = Number(url.searchParams.get('offset'))
    if (offset === 0) return { songs: [song(1), song(2)], more: true }
    if (offset === 2) return { songs: [song(3)], more: false }
    throw new Error(`unexpected offset: ${offset}`)
  })

  try {
    const tracks = await provider.fetchArtistTopSongs(6452)
    assert.deepEqual(
      tracks.map((track) => track.ncmSongId),
      [1, 2, 3]
    )
    assert.equal(requests.length, 2)
    assert.equal(parseRequest(requests[1]).searchParams.get('offset'), '2')
  } finally {
    ncmProvider.deactivate()
  }
})

test('search song normalization preserves legal bpm metadata', async () => {
  const provider = await activateProvider(async (path) => {
    const url = parseRequest(path)
    assert.equal(url.pathname, '/cloudsearch')
    return {
      result: {
        songs: [
          {
            ...song(128),
            bpm: '128.4'
          }
        ],
        songCount: 1
      }
    }
  })

  try {
    const result = await provider.searchSongs('tempo')
    assert.equal(result.items[0].bpm, 128.4)
  } finally {
    ncmProvider.deactivate()
  }
})

test('liked tracks fall back to playlist detail when playlist track-all is malformed', async () => {
  const requests = []
  const provider = await activateProvider(async (path) => {
    requests.push(path)
    const url = parseRequest(path)
    if (url.pathname === '/login/status') {
      return {
        code: 200,
        data: {
          code: 200,
          profile: {
            userId: 42,
            nickname: 'listener',
            avatarUrl: 'avatar.jpg',
            signature: ''
          }
        }
      }
    }
    if (url.pathname === '/user/playlist') {
      return {
        playlist: [
          {
            id: 9001,
            name: '喜欢的音乐',
            specialType: 5,
            trackCount: 2,
            coverImgUrl: 'cover.jpg'
          }
        ]
      }
    }
    if (url.pathname === '/playlist/track/all') {
      throw new Error('Unexpected non-whitespace character after JSON at position 25')
    }
    if (url.pathname === '/playlist/detail') {
      return { playlist: { trackIds: [{ id: 1 }, { id: 2 }] } }
    }
    if (url.pathname === '/song/detail') {
      return { songs: [song(1), song(2)] }
    }
    throw new Error(`unexpected endpoint: ${url.pathname}`)
  })

  try {
    const tracks = await provider.fetchLikedTracks(true)
    assert.deepEqual(
      tracks.map((track) => track.ncmSongId),
      [1, 2]
    )
    assert.equal(
      requests.filter((path) => parseRequest(path).pathname === '/playlist/track/all').length,
      3
    )
    assert.ok(requests.some((path) => parseRequest(path).pathname === '/playlist/detail'))
    assert.ok(requests.some((path) => parseRequest(path).pathname === '/song/detail'))
  } finally {
    ncmProvider.deactivate()
  }
})

test('liked tracks fall back to likelist when playlist endpoints fail', async () => {
  const requests = []
  const provider = await activateProvider(async (path) => {
    requests.push(path)
    const url = parseRequest(path)
    if (url.pathname === '/login/status') {
      return {
        code: 200,
        data: {
          code: 200,
          profile: {
            userId: 42,
            nickname: 'listener',
            avatarUrl: 'avatar.jpg',
            signature: ''
          }
        }
      }
    }
    if (url.pathname === '/user/playlist') {
      return {
        playlist: [
          {
            id: 9001,
            name: '喜欢的音乐',
            specialType: 5,
            trackCount: 2,
            coverImgUrl: 'cover.jpg'
          }
        ]
      }
    }
    if (url.pathname === '/playlist/track/all' || url.pathname === '/playlist/detail') {
      throw new Error(`endpoint unavailable: ${url.pathname}`)
    }
    if (url.pathname === '/likelist') {
      return { ids: [3, 4] }
    }
    if (url.pathname === '/song/detail') {
      return { songs: [song(3), song(4)] }
    }
    throw new Error(`unexpected endpoint: ${url.pathname}`)
  })

  try {
    const tracks = await provider.fetchLikedTracks(true)
    assert.deepEqual(
      tracks.map((track) => track.ncmSongId),
      [3, 4]
    )
    assert.ok(requests.some((path) => parseRequest(path).pathname === '/likelist'))
  } finally {
    ncmProvider.deactivate()
  }
})

test('liked song detail requests split into smaller chunks after transient failures', async () => {
  const ids = Array.from({ length: 30 }, (_, index) => index + 1)
  const detailBatchSizes = []
  const provider = await activateProvider(async (path) => {
    const url = parseRequest(path)
    if (url.pathname === '/login/status') {
      return {
        code: 200,
        data: {
          code: 200,
          profile: {
            userId: 42,
            nickname: 'listener',
            avatarUrl: 'avatar.jpg',
            signature: ''
          }
        }
      }
    }
    if (url.pathname === '/user/playlist') return { playlist: [] }
    if (url.pathname === '/likelist') return { ids }
    if (url.pathname === '/song/detail') {
      const batch = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean).map(Number)
      detailBatchSizes.push(batch.length)
      if (batch.length > 25) throw new Error('socket hang up')
      return { songs: batch.map(song) }
    }
    throw new Error(`unexpected endpoint: ${url.pathname}`)
  })

  try {
    const tracks = await provider.fetchLikedTracks(true)
    assert.deepEqual(
      tracks.map((track) => track.ncmSongId),
      ids
    )
    assert.deepEqual(detailBatchSizes, [30, 30, 30, 15, 15])
  } finally {
    ncmProvider.deactivate()
  }
})

test('fetchPlaylistTracks pages track/all beyond the 200-track detail preview', async () => {
  const total = 450
  const ids = Array.from({ length: total }, (_, index) => index + 1)
  const requests = []
  const provider = await activateProvider(async (path) => {
    requests.push(path)
    const url = parseRequest(path)
    if (url.pathname === '/login/status') {
      return {
        code: 200,
        data: {
          code: 200,
          profile: { userId: 42, nickname: 'listener', avatarUrl: 'avatar.jpg', signature: '' }
        }
      }
    }
    if (url.pathname === '/playlist/track/all') {
      const limit = Number(url.searchParams.get('limit') || 1000)
      const offset = Number(url.searchParams.get('offset') || 0)
      assert.ok(limit <= 1000)
      return { songs: ids.slice(offset, offset + limit).map(song) }
    }
    if (url.pathname === '/playlist/detail') {
      return {
        playlist: {
          trackIds: ids.map((id) => ({ id })),
          tracks: ids.slice(0, 200).map(song)
        }
      }
    }
    throw new Error(`unexpected endpoint: ${url.pathname}`)
  })

  try {
    const tracks = await provider.fetchPlaylistTracks(55, true)
    assert.equal(tracks.length, total)
    assert.deepEqual(
      tracks.map((track) => track.ncmSongId),
      ids
    )
    const trackAllOffsets = requests
      .map(parseRequest)
      .filter((url) => url.pathname === '/playlist/track/all')
      .map((url) => Number(url.searchParams.get('offset') || 0))
    assert.deepEqual(trackAllOffsets, [0])
    assert.equal(
      requests.some((path) => parseRequest(path).pathname === '/playlist/detail'),
      false
    )
  } finally {
    ncmProvider.deactivate()
  }
})

test('fetchPlaylistTracks pages multiple track/all windows up to 5000', async () => {
  const total = 2500
  const ids = Array.from({ length: total }, (_, index) => 10_000 + index)
  const requests = []
  const provider = await activateProvider(async (path) => {
    requests.push(path)
    const url = parseRequest(path)
    if (url.pathname === '/login/status') {
      return {
        code: 200,
        data: {
          code: 200,
          profile: { userId: 42, nickname: 'listener', avatarUrl: 'avatar.jpg', signature: '' }
        }
      }
    }
    if (url.pathname === '/playlist/track/all') {
      const limit = Number(url.searchParams.get('limit') || 1000)
      const offset = Number(url.searchParams.get('offset') || 0)
      return { songs: ids.slice(offset, offset + limit).map(song) }
    }
    throw new Error(`unexpected endpoint: ${url.pathname}`)
  })

  try {
    const tracks = await provider.fetchPlaylistTracks(77, true)
    assert.equal(tracks.length, total)
    const trackAll = requests.map(parseRequest).filter((url) => url.pathname === '/playlist/track/all')
    assert.equal(trackAll.length, 3)
    assert.deepEqual(
      trackAll.map((url) => Number(url.searchParams.get('offset') || 0)),
      [0, 1000, 2000]
    )
  } finally {
    ncmProvider.deactivate()
  }
})

test('fetchPlaylistTracks caps at 5000 songs', async () => {
  const total = 5200
  const ids = Array.from({ length: total }, (_, index) => 20_000 + index)
  const provider = await activateProvider(async (path) => {
    const url = parseRequest(path)
    if (url.pathname === '/login/status') {
      return {
        code: 200,
        data: {
          code: 200,
          profile: { userId: 42, nickname: 'listener', avatarUrl: 'avatar.jpg', signature: '' }
        }
      }
    }
    if (url.pathname === '/playlist/track/all') {
      const limit = Number(url.searchParams.get('limit') || 1000)
      const offset = Number(url.searchParams.get('offset') || 0)
      return { songs: ids.slice(offset, offset + limit).map(song) }
    }
    throw new Error(`unexpected endpoint: ${url.pathname}`)
  })

  try {
    const tracks = await provider.fetchPlaylistTracks(88, true)
    assert.equal(tracks.length, 5000)
    assert.equal(tracks[0].ncmSongId, 20_000)
    assert.equal(tracks[4999].ncmSongId, 24_999)
  } finally {
    ncmProvider.deactivate()
  }
})

test('fetchPlaylistTracks detail fallback prefers full trackIds over truncated tracks', async () => {
  const ids = Array.from({ length: 350 }, (_, index) => 30_000 + index)
  const requests = []
  const provider = await activateProvider(async (path) => {
    requests.push(path)
    const url = parseRequest(path)
    if (url.pathname === '/login/status') {
      return {
        code: 200,
        data: {
          code: 200,
          profile: { userId: 42, nickname: 'listener', avatarUrl: 'avatar.jpg', signature: '' }
        }
      }
    }
    if (url.pathname === '/playlist/track/all') {
      throw new Error('track/all unavailable')
    }
    if (url.pathname === '/playlist/detail') {
      return {
        playlist: {
          trackIds: ids.map((id) => ({ id })),
          tracks: ids.slice(0, 200).map(song)
        }
      }
    }
    if (url.pathname === '/song/detail') {
      const batch = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean).map(Number)
      return { songs: batch.map(song) }
    }
    throw new Error(`unexpected endpoint: ${url.pathname}`)
  })

  try {
    const tracks = await provider.fetchPlaylistTracks(99, true)
    assert.equal(tracks.length, 350)
    assert.deepEqual(
      tracks.map((track) => track.ncmSongId),
      ids
    )
  } finally {
    ncmProvider.deactivate()
  }
})

test('liked tracks page loads only the requested window', async () => {
  const playlistIds = Array.from({ length: 250 }, (_, index) => 1000 + index)
  const likelistIds = Array.from({ length: 250 }, (_, index) => index + 1)
  const detailIds = []
  const requests = []
  const provider = await activateProvider(async (path) => {
    requests.push(path)
    const url = parseRequest(path)
    if (url.pathname === '/login/status') {
      return {
        code: 200,
        data: {
          code: 200,
          profile: {
            userId: 42,
            nickname: 'listener',
            avatarUrl: 'avatar.jpg',
            signature: ''
          }
        }
      }
    }
    if (url.pathname === '/user/playlist') {
      return {
        playlist: [
          {
            id: 9001,
            name: '喜欢的音乐',
            specialType: 5,
            trackCount: playlistIds.length,
            coverImgUrl: 'cover.jpg'
          }
        ]
      }
    }
    if (url.pathname === '/playlist/detail') {
      return { playlist: { trackIds: playlistIds.map((id) => ({ id })) } }
    }
    if (url.pathname === '/likelist') return { ids: likelistIds }
    if (url.pathname === '/song/detail') {
      const batch = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean).map(Number)
      detailIds.push(...batch)
      return { songs: batch.map(song) }
    }
    throw new Error(`unexpected endpoint: ${url.pathname}`)
  })

  try {
    const page = await provider.fetchLikedTracksPage(100, 100, true)
    assert.equal(page.total, 250)
    assert.equal(page.offset, 100)
    assert.equal(page.limit, 100)
    assert.equal(page.nextOffset, 200)
    assert.equal(page.hasMore, true)
    assert.deepEqual(
      page.tracks.map((track) => track.ncmSongId),
      playlistIds.slice(100, 200)
    )
    assert.deepEqual(detailIds, playlistIds.slice(100, 200))
    assert.equal(requests.some((path) => parseRequest(path).pathname === '/likelist'), false)
  } finally {
    ncmProvider.deactivate()
  }
})

test('artist albums keep paging when a short page reports more items', async () => {
  const requests = []
  const provider = await activateProvider(async (path) => {
    requests.push(path)
    const url = parseRequest(path)
    assert.equal(url.pathname, '/artist/album')
    assert.equal(url.searchParams.get('id'), '6452')
    assert.equal(url.searchParams.get('limit'), '100')

    const offset = Number(url.searchParams.get('offset'))
    if (offset === 0) return { hotAlbums: [album(1), album(2)], more: true }
    if (offset === 2) return { hotAlbums: [album(3)], more: false }
    throw new Error(`unexpected offset: ${offset}`)
  })

  try {
    const albums = await provider.fetchArtistAlbums(6452)
    assert.deepEqual(
      albums.map((item) => item.id),
      [1, 2, 3]
    )
    assert.equal(requests.length, 2)
    assert.equal(parseRequest(requests[1]).searchParams.get('offset'), '2')
  } finally {
    ncmProvider.deactivate()
  }
})

test('artist songs still fall back to the top-song endpoint when all-song paging fails', async () => {
  const requests = []
  const provider = await activateProvider(async (path) => {
    requests.push(path)
    const url = parseRequest(path)
    if (url.pathname === '/artist/songs') throw new Error('all songs unavailable')
    if (url.pathname === '/artist/top/song') return { songs: [song(9)] }
    throw new Error(`unexpected endpoint: ${url.pathname}`)
  })

  try {
    const tracks = await provider.fetchArtistTopSongs(6452)
    assert.deepEqual(
      tracks.map((track) => track.ncmSongId),
      [9]
    )
    assert.equal(parseRequest(requests[0]).pathname, '/artist/songs')
    assert.equal(parseRequest(requests[1]).pathname, '/artist/top/song')
  } finally {
    ncmProvider.deactivate()
  }
})

test('artist intro and follow state use dedicated artist endpoints', async () => {
  const requests = []
  const provider = await activateProvider(async (path) => {
    requests.push(path)
    const url = parseRequest(path)
    if (url.pathname === '/artist/desc') return { briefDesc: '  artist introduction  ' }
    if (url.pathname === '/artist/detail/dynamic') return { data: { followed: true } }
    throw new Error(`unexpected endpoint: ${url.pathname}`)
  })

  try {
    assert.equal(await provider.fetchArtistIntro(6452), 'artist introduction')
    assert.equal(await provider.fetchArtistFollowState(6452), true)
    assert.deepEqual(
      requests.map((path) => parseRequest(path).pathname),
      ['/artist/desc', '/artist/detail/dynamic']
    )
  } finally {
    ncmProvider.deactivate()
  }
})

test('create delete and track mutations call NetEase playlist write endpoints', async () => {
  const requests = []
  const provider = await activateProvider(async (path) => {
    requests.push(path)
    const url = parseRequest(path)
    if (url.pathname === '/user/playlist') {
      return {
        playlist: [
          {
            id: 11,
            name: '我创建的',
            userId: 1001,
            trackCount: 2,
            coverImgUrl: null
          },
          {
            id: 22,
            name: '别人的',
            userId: 2002,
            trackCount: 5,
            coverImgUrl: null
          }
        ]
      }
    }
    if (url.pathname === '/login/status') {
      return {
        code: 200,
        data: {
          code: 200,
          profile: {
            userId: 1001,
            nickname: 'tester',
            avatarUrl: null,
            signature: '',
            follows: 0,
            followeds: 0
          }
        }
      }
    }
    if (url.pathname === '/playlist/create') {
      return {
        code: 200,
        playlist: {
          id: 99,
          name: url.searchParams.get('name'),
          userId: 1001,
          trackCount: 0,
          coverImgUrl: null
        }
      }
    }
    if (
      url.pathname === '/playlist/delete' ||
      url.pathname === '/playlist/subscribe' ||
      url.pathname === '/playlist/tracks'
    ) {
      return { code: 200 }
    }
    return { code: 200 }
  })

  try {
    const library = await provider.fetchUserLibrary(true)
    assert.equal(library.playlists.find((item) => item.id === 11)?.owned, true)
    assert.equal(library.playlists.find((item) => item.id === 22)?.owned, false)

    const created = await provider.createPlaylist('新歌单')
    assert.equal(created.id, 99)
    assert.equal(created.owned, true)
    assert.ok(requests.some((path) => parseRequest(path).pathname === '/playlist/create'))

    await provider.addTracksToPlaylist(99, [1, 2, 2])
    await provider.removeTracksFromPlaylist(99, [1])
    const trackWrite = requests
      .map((path) => parseRequest(path))
      .filter((url) => url.pathname === '/playlist/tracks')
    assert.equal(trackWrite.length, 2)
    assert.equal(trackWrite[0].searchParams.get('op'), 'add')
    assert.equal(trackWrite[0].searchParams.get('tracks'), '1,2')
    assert.equal(trackWrite[1].searchParams.get('op'), 'del')

    await provider.deletePlaylist(11)
    assert.ok(
      requests.some((path) => {
        const url = parseRequest(path)
        return url.pathname === '/playlist/delete' && url.searchParams.get('id') === '11'
      })
    )

    await provider.deletePlaylist(22)
    assert.ok(
      requests.some((path) => {
        const url = parseRequest(path)
        return (
          url.pathname === '/playlist/subscribe' &&
          url.searchParams.get('t') === '2' &&
          url.searchParams.get('id') === '22'
        )
      })
    )
  } finally {
    ncmProvider.deactivate()
  }
})

test('artist and user follow actions call NetEase follow endpoints', async () => {
  const requests = []
  const provider = await activateProvider(async (path) => {
    requests.push(path)
    return { code: 200 }
  })

  try {
    await provider.followArtist(6452, true)
    await provider.followArtist(6452, false)
    await provider.followUser(32953014, true)
    await provider.followUser(32953014, false)

    assert.deepEqual(
      requests.map((path) => {
        const url = parseRequest(path)
        return `${url.pathname}?id=${url.searchParams.get('id')}&t=${url.searchParams.get('t')}`
      }),
      [
        '/artist/sub?id=6452&t=1',
        '/artist/sub?id=6452&t=0',
        '/follow?id=32953014&t=1',
        '/follow?id=32953014&t=0'
      ]
    )
  } finally {
    ncmProvider.deactivate()
  }
})

test('like and follow retries with one idempotency key execute the upstream write once', async () => {
  const requests = []
  let releaseRequest
  const requestGate = new Promise((resolve) => {
    releaseRequest = resolve
  })
  const provider = await activateProvider(async (path) => {
    requests.push(path)
    await requestGate
    return { code: 200 }
  })
  const firstContext = {
    signal: new AbortController().signal,
    idempotencyKey: 'like-track-42'
  }

  try {
    const first = provider.likeTrack(42, true, firstContext)
    const concurrentRetry = provider.likeTrack(42, true, {
      signal: new AbortController().signal,
      idempotencyKey: 'like-track-42'
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(requests.length, 1)

    releaseRequest()
    await Promise.all([first, concurrentRetry])
    await provider.likeTrack(42, true, firstContext)
    assert.equal(requests.length, 1)

    await assert.rejects(
      () => provider.likeTrack(42, false, firstContext),
      /reused for a different write payload/
    )
    await provider.likeTrack(42, false, {
      signal: new AbortController().signal,
      idempotencyKey: 'unlike-track-42'
    })
    assert.equal(requests.length, 2)
  } finally {
    ncmProvider.deactivate()
  }
})

test('completed provider writes survive a built-in provider restart without replaying upstream', async () => {
  const settings = new Map([['cookie', 'MUSIC_U=test;']])
  const requests = []
  const context = {
    signal: new AbortController().signal,
    idempotencyKey: 'restart-like-track-42'
  }
  let provider = await activateProvider(async (path, _cookie, options) => {
    requests.push({ path, options })
    return { code: 200 }
  }, settings)

  try {
    await provider.likeTrack(42, true, context)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].options.idempotencyKey, context.idempotencyKey)
    assert.strictEqual(requests[0].options.signal, context.signal)
    const persisted = settings.get('providerWriteIdempotency')
    assert.equal(Array.isArray(persisted.records), true)
    assert.equal(persisted.records.length, 1)

    ncmProvider.deactivate()
    provider = await activateProvider(async (path, _cookie, options) => {
      requests.push({ path, options })
      return { code: 200 }
    }, settings)
    await provider.likeTrack(42, true, context)
    assert.equal(requests.length, 1)
    assert.equal(provider.isTrackLiked(42), true)
  } finally {
    ncmProvider.deactivate()
  }
})

test('aborted writes forward the signal and never mutate the local liked state', async () => {
  let releaseRequest
  let seenOptions = null
  const requestGate = new Promise((resolve) => {
    releaseRequest = resolve
  })
  const provider = await activateProvider(async (_path, _cookie, options) => {
    seenOptions = options
    await requestGate
    return { code: 200 }
  })
  const controller = new AbortController()

  try {
    const pending = provider.likeTrack(42, true, {
      signal: controller.signal,
      idempotencyKey: 'abort-like-track-42'
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.strictEqual(seenOptions.signal, controller.signal)
    assert.equal(seenOptions.idempotencyKey, 'abort-like-track-42')

    controller.abort(new Error('caller cancelled the write'))
    releaseRequest()
    await assert.rejects(pending, /caller cancelled the write/)
    assert.equal(provider.isTrackLiked(42), false)
  } finally {
    ncmProvider.deactivate()
  }
})

test('follow list uses artist sublist and returns artist identities', async () => {
  const requests = []
  const provider = await activateProvider(async (path) => {
    requests.push(path)
    const url = parseRequest(path)
    if (url.pathname !== '/artist/sublist') {
      throw new Error(`unexpected endpoint: ${url.pathname}`)
    }
    assert.equal(url.searchParams.get('limit'), '100')
    assert.equal(url.searchParams.get('offset'), '0')
    return {
      data: [
        { id: 101, name: 'aiss', picUrl: 'https://img.test/aiss.jpg', musicSize: 12 },
        { id: 202, name: '7FIV6', img1v1Url: 'https://img.test/7fiv6.jpg', musicSize: 8 }
      ]
    }
  })

  try {
    const follows = await provider.fetchUserFollows(12345, 100, 0)
    assert.deepEqual(follows, [
      {
        id: 101,
        name: 'aiss',
        picUrl: 'https://img.test/aiss.jpg',
        musicSize: 12,
        userType: 2,
        artistId: 101,
        followed: true
      },
      {
        id: 202,
        name: '7FIV6',
        picUrl: 'https://img.test/7fiv6.jpg',
        musicSize: 8,
        userType: 2,
        artistId: 202,
        followed: true
      }
    ])
    assert.equal(requests.length, 1)
  } finally {
    ncmProvider.deactivate()
  }
})
