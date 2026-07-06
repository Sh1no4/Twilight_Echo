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

async function activateProvider(request) {
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
      get: async () => 'MUSIC_U=test;',
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
  return registeredProvider
}

function parseRequest(path) {
  return new URL(path, 'http://twilight.local')
}

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
