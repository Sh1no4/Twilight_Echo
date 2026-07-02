import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../types/music'

const { resolveUnifiedRecentTracks } = (await import(
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
