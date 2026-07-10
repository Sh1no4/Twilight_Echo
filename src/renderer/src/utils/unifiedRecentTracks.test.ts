import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../types/music'

const { createUnifiedRecentTrackResolver, resolveUnifiedRecentTracks } = (await import(
  new URL('./unifiedRecentTracks.ts', import.meta.url).href
)) as typeof import('./unifiedRecentTracks')

const localTrack: Track = {
  id: 'local:moon',
  title: 'Moon River',
  artist: 'Audrey',
  album: 'Local Album',
  filePath: 'D:\\Music\\Moon River.flac',
  fileName: 'Moon River.flac',
  duration: 181,
  size: 10_000,
  cover: null,
  lyrics: null,
  source: 'local',
  format: 'flac'
}

const providerTrack: Track = {
  id: 'ncm:moon',
  title: 'Moon River',
  artist: 'Audrey',
  album: 'Online Album',
  filePath: 'ncm:moon',
  fileName: 'Moon River',
  duration: 180,
  size: 0,
  cover: 'https://cover.example/moon.jpg',
  lyrics: null,
  source: 'ncm'
}

test('unified recent tracks prefer playable local sources from the same logical track', () => {
  const tracks = resolveUnifiedRecentTracks({
    recentStats: [
      {
        id: 'logic:moon river::audrey',
        seconds: 60,
        plays: 2,
        lastPlayed: 2_000,
        title: 'Moon River',
        artist: 'Audrey',
        cover: providerTrack.cover,
        sourceIds: [
          { source: 'ncm', trackId: providerTrack.id },
          { source: 'local', trackId: localTrack.id }
        ],
        track: providerTrack
      }
    ],
    localTracks: [localTrack]
  })

  assert.deepEqual(
    tracks.map((track) => track.id),
    ['local:moon']
  )
})

test('unified recent tracks keep provider snapshots when no local source exists', () => {
  const tracks = resolveUnifiedRecentTracks({
    recentStats: [
      {
        id: 'logic:moon river::audrey',
        seconds: 60,
        plays: 2,
        lastPlayed: 2_000,
        title: 'Moon River',
        artist: 'Audrey',
        cover: providerTrack.cover,
        sourceIds: [{ source: 'ncm', trackId: providerTrack.id }],
        track: providerTrack
      }
    ],
    localTracks: []
  })

  assert.deepEqual(
    tracks.map((track) => track.id),
    ['ncm:moon']
  )
})

test('unified recent tracks prefer newly available local variants even when history only has a provider source id', () => {
  const tracks = resolveUnifiedRecentTracks({
    recentStats: [
      {
        id: 'logic:moon river::audrey',
        seconds: 60,
        plays: 2,
        lastPlayed: 2_000,
        title: 'Moon River',
        artist: 'Audrey',
        cover: providerTrack.cover,
        sourceIds: [{ source: 'ncm', trackId: providerTrack.id }],
        track: providerTrack
      }
    ],
    localTracks: [localTrack]
  })

  assert.deepEqual(
    tracks.map((track) => track.id),
    ['local:moon']
  )
})

test('unified recent tracks prefer the best local source variant for a logical track', () => {
  const localMp3: Track = {
    ...localTrack,
    id: 'local:moon-mp3',
    filePath: 'D:\\Music\\Moon River.mp3',
    fileName: 'Moon River.mp3',
    format: 'mp3',
    bitDepth: undefined
  }
  const localFlac: Track = {
    ...localTrack,
    id: 'local:moon-flac',
    filePath: 'D:\\Music\\Moon River.flac',
    fileName: 'Moon River.flac',
    format: 'flac',
    bitDepth: 24
  }

  const tracks = resolveUnifiedRecentTracks({
    recentStats: [
      {
        id: 'logic:moon river::audrey',
        seconds: 60,
        plays: 2,
        lastPlayed: 2_000,
        title: 'Moon River',
        artist: 'Audrey',
        cover: providerTrack.cover,
        sourceIds: [{ source: 'ncm', trackId: providerTrack.id }],
        track: providerTrack
      }
    ],
    localTracks: [localMp3, localFlac]
  })

  assert.deepEqual(
    tracks.map((track) => track.id),
    ['local:moon-flac']
  )
})

test('unified recent tracks de-duplicate legacy split local and provider stats by logical track', () => {
  const tracks = resolveUnifiedRecentTracks({
    recentStats: [
      {
        id: 'ncm:moon',
        seconds: 30,
        plays: 1,
        lastPlayed: 3_000,
        title: 'Moon River',
        artist: 'Audrey',
        cover: providerTrack.cover,
        sourceIds: [{ source: 'ncm', trackId: providerTrack.id }],
        track: providerTrack
      },
      {
        id: 'local:moon',
        seconds: 60,
        plays: 1,
        lastPlayed: 2_000,
        title: ' moon  river ',
        artist: 'AUDREY',
        cover: null,
        sourceIds: [{ source: 'local', trackId: localTrack.id }],
        track: localTrack
      }
    ],
    localTracks: []
  })

  assert.deepEqual(
    tracks.map((track) => track.id),
    ['ncm:moon']
  )
})

test('unified recent tracks resolves a source id from a large local library', () => {
  const localTracks = Array.from({ length: 5000 }, (_, index) => ({
    ...localTrack,
    id: `local:${index}`,
    title: `Local Song ${index}`,
    filePath: `D:\\Music\\Local Song ${index}.flac`,
    fileName: `Local Song ${index}.flac`
  }))

  const tracks = resolveUnifiedRecentTracks({
    recentStats: [
      {
        id: 'logic:local song 4200::audrey',
        seconds: 60,
        plays: 1,
        lastPlayed: 4_200,
        title: 'Local Song 4200',
        artist: 'Audrey',
        cover: null,
        sourceIds: [{ source: 'local', trackId: 'local:4200' }]
      }
    ],
    localTracks
  })

  assert.deepEqual(
    tracks.map((track) => track.id),
    ['local:4200']
  )
})

test('unified recent track resolver reuses one local library snapshot for multiple stats', () => {
  const localTracks = [
    localTrack,
    {
      ...localTrack,
      id: 'local:sun',
      title: 'Sun River',
      filePath: 'D:\\Music\\Sun River.flac',
      fileName: 'Sun River.flac'
    }
  ]
  const resolveTrack = createUnifiedRecentTrackResolver(localTracks)

  assert.equal(
    resolveTrack({
      id: 'logic:moon river::audrey',
      seconds: 60,
      plays: 1,
      lastPlayed: 2_000,
      title: 'Moon River',
      artist: 'Audrey',
      cover: null,
      sourceIds: [{ source: 'local', trackId: 'local:moon' }]
    })?.id,
    'local:moon'
  )
  assert.equal(
    resolveTrack({
      id: 'logic:sun river::audrey',
      seconds: 30,
      plays: 1,
      lastPlayed: 1_000,
      title: 'Sun River',
      artist: 'Audrey',
      cover: null,
      sourceIds: [{ source: 'local', trackId: 'local:sun' }]
    })?.id,
    'local:sun'
  )
})
