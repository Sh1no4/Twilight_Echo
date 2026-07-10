import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_MINI_PLAYER_SETTINGS,
  normalizeMiniPlayerCommand,
  normalizeMiniPlayerSettings,
  normalizeMiniPlayerStateSnapshot
} from './miniPlayer.ts'

test('mini player settings preserve valid monitor coordinates and clamp window size', () => {
  const settings = normalizeMiniPlayerSettings({
    windowX: -1920,
    windowY: 48.4,
    windowWidth: 10_000,
    windowHeight: 40,
    alwaysOnTop: true,
    positionLocked: true,
    styleId: 'custom.future-style',
    backgroundColor: '#123456'
  })

  assert.deepEqual(settings, {
    windowX: -1920,
    windowY: 48,
    windowWidth: 760,
    windowHeight: 140,
    alwaysOnTop: true,
    positionLocked: true,
    styleId: 'custom.future-style',
    backgroundColor: '#123456'
  })
  assert.equal(normalizeMiniPlayerSettings({ styleId: '../unsafe' }).styleId, 'aurora-glass')
  assert.equal(
    normalizeMiniPlayerSettings({ styleId: 'porcelain', backgroundColor: '#11121d' })
      .backgroundColor,
    '#f4f5fb'
  )
  assert.equal(
    normalizeMiniPlayerSettings({ styleId: 'aurora-glass', backgroundColor: '#f4f5fb' })
      .backgroundColor,
    '#11121d'
  )
  assert.equal(
    normalizeMiniPlayerSettings(null).windowWidth,
    DEFAULT_MINI_PLAYER_SETTINGS.windowWidth
  )
})

test('mini player state normalization keeps only the renderer snapshot contract', () => {
  const state = normalizeMiniPlayerStateSnapshot({
    track: {
      id: 'local:1',
      title: 'Night Drive',
      artist: 'Twilight Echo',
      album: 'Afterglow',
      cover: 'cover://abc.jpg',
      filePath: 'D:/private/song.flac'
    },
    isPlaying: true,
    currentTime: 120,
    duration: 100,
    volume: 3,
    playMode: 'shuffle',
    dominantColor: '#7c4dff',
    queueIndex: 99,
    queueLength: 3
  })

  assert.equal(state.track?.title, 'Night Drive')
  assert.equal('filePath' in (state.track as object), false)
  assert.equal(state.currentTime, 100)
  assert.equal(state.volume, 1)
  assert.equal(state.queueIndex, 2)
})

test('mini player commands reject invalid payloads and clamp numeric controls', () => {
  assert.deepEqual(normalizeMiniPlayerCommand({ type: 'toggle-play' }), {
    type: 'toggle-play'
  })
  assert.deepEqual(normalizeMiniPlayerCommand({ type: 'set-volume', value: -2 }), {
    type: 'set-volume',
    value: 0
  })
  assert.equal(normalizeMiniPlayerCommand({ type: 'seek', value: Number.NaN }), null)
  assert.equal(normalizeMiniPlayerCommand({ type: 'delete-library' }), null)
})
