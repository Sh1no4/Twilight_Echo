import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMiniPlayerStateSnapshot, resolveCurrentLyricForMiniPlayer } from './useMiniPlayerSync.ts'
import type { Track } from '../types/music.ts'

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'ncm:1',
    title: 'Daydream',
    artist: 'Twilight Echo',
    album: 'Afterglow',
    fileName: 'daydream.mp3',
    filePath: 'ncm:1',
    duration: 240,
    size: 0,
    lyrics: '[00:01.00]first line\n[00:03.00]second line',
    translatedLyrics: '[00:01.00]第一行\n[00:03.00]第二行',
    ...overrides
  }
}

function makeSource(track: Track | null, currentTime: number) {
  return {
    track,
    isPlaying: true,
    isLoading: false,
    currentTime,
    duration: 240,
    volume: 0.7,
    playMode: 'sequential' as const,
    favoriteAvailable: false,
    favoriteLiked: false,
    favoriteLoading: false,
    dominantColor: '#7c4dff',
    queueIndex: 0,
    queueLength: 1
  }
}

test('mini player snapshot carries the lyric line active at the snapshot time', () => {
  const snapshot = buildMiniPlayerStateSnapshot(makeSource(makeTrack(), 3.5))
  assert.equal(snapshot.currentLyric?.original, 'second line')
  assert.equal(snapshot.currentLyric?.translation, '第二行')
})

test('mini player lyric resolution returns null before the first timed line', () => {
  assert.equal(resolveCurrentLyricForMiniPlayer(makeTrack(), 0.5), null)
  assert.equal(resolveCurrentLyricForMiniPlayer(null, 10), null)
})

test('mini player lyric resolution ignores plain untimed lyrics', () => {
  const plain = makeTrack({ lyrics: 'Just a plain lyric line', translatedLyrics: '' })
  assert.equal(resolveCurrentLyricForMiniPlayer(plain, 10), null)
})

test('mini player snapshot drops the lyric field when no line is active', () => {
  const snapshot = buildMiniPlayerStateSnapshot(makeSource(makeTrack(), 0.5))
  assert.equal(snapshot.currentLyric, null)
})
