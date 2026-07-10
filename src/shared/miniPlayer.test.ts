import assert from 'node:assert/strict'
import test from 'node:test'

import * as miniPlayerModule from './miniPlayer.ts'
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
    styleId: 'aurora-glass',
    backgroundColor: '#123456'
  })

  assert.equal(settings.windowX, -1920)
  assert.equal(settings.windowY, 48)
  assert.equal(settings.windowWidth, 900)
  assert.equal(settings.windowHeight, 140)
  assert.equal(settings.alwaysOnTop, true)
  assert.equal(settings.positionLocked, true)
  assert.equal(settings.activeStyleId, 'aurora-glass')
  assert.equal(settings.profiles['aurora-glass'].background.solidColor, '#123456')
  assert.equal(
    normalizeMiniPlayerSettings({ activeStyleId: '../unsafe' }).activeStyleId,
    'aurora-glass'
  )
  assert.equal(
    normalizeMiniPlayerSettings(null).windowWidth,
    DEFAULT_MINI_PLAYER_SETTINGS.windowWidth
  )
})

test('legacy mini player settings migrate into an independent active theme profile', () => {
  const settings = normalizeMiniPlayerSettings({
    windowX: 120,
    windowY: 80,
    windowWidth: 612,
    windowHeight: 244,
    alwaysOnTop: true,
    positionLocked: true,
    styleId: 'porcelain',
    backgroundColor: '#123456'
  })

  assert.equal(settings.activeStyleId, 'porcelain')
  assert.equal(settings.profiles.porcelain.background.solidColor, '#123456')
  assert.equal(settings.profiles.porcelain.background.fallbackColor, '#123456')
  assert.equal(settings.windowWidth, 612)
  assert.equal(settings.windowHeight, 244)
  assert.equal(settings.alwaysOnTop, true)
  assert.equal(settings.positionLocked, true)
})

test('mini player profiles clamp nested values and reject unsafe background urls', () => {
  const settings = normalizeMiniPlayerSettings({
    activeStyleId: 'aurora-glass',
    profiles: {
      'aurora-glass': {
        background: {
          kind: 'image',
          imageUrl: 'file:///D:/private/image.png',
          gradientAngle: 999,
          blur: -20,
          brightness: 400,
          saturation: -1,
          opacity: 150,
          overlayOpacity: -10
        },
        appearance: {
          accentMode: 'custom',
          accentColor: '#abcdef',
          textMode: 'custom',
          primaryTextColor: '#123456',
          mutedTextColor: '#654321',
          surfaceOpacity: 2,
          glassBlur: 99,
          cornerRadius: 80,
          borderWidth: 9,
          borderColor: '#111111',
          shadowStrength: -5
        },
        layout: { preference: 'wide' },
        visibility: { artwork: false, volume: false }
      }
    }
  })

  assert.ok(settings.profiles)
  const profile = settings.profiles['aurora-glass']
  assert.equal(profile.background.imageUrl, '')
  assert.equal(profile.background.kind, 'solid')
  assert.equal(profile.background.gradientAngle, 360)
  assert.equal(profile.background.blur, 0)
  assert.equal(profile.background.brightness, 150)
  assert.equal(profile.background.saturation, 0)
  assert.equal(profile.background.opacity, 100)
  assert.equal(profile.background.overlayOpacity, 0)
  assert.equal(profile.appearance.surfaceOpacity, 40)
  assert.equal(profile.appearance.glassBlur, 40)
  assert.equal(profile.appearance.cornerRadius, 36)
  assert.equal(profile.appearance.borderWidth, 3)
  assert.equal(profile.appearance.shadowStrength, 0)
  assert.equal(profile.visibility.artwork, false)
  assert.equal(profile.visibility.album, true)
})

test('mini player profile normalization is idempotent and clones defaults', () => {
  const first = normalizeMiniPlayerSettings({ activeStyleId: 'aurora-glass' })
  const second = normalizeMiniPlayerSettings(first)
  assert.deepEqual(second, first)

  const createDefaultMiniPlayerThemeProfile = (
    miniPlayerModule as unknown as {
      createDefaultMiniPlayerThemeProfile?: (styleId: string) => {
        background: { solidColor: string }
      }
    }
  ).createDefaultMiniPlayerThemeProfile
  assert.equal(typeof createDefaultMiniPlayerThemeProfile, 'function')
  const left = createDefaultMiniPlayerThemeProfile!('aurora-glass')
  const right = createDefaultMiniPlayerThemeProfile!('aurora-glass')
  left.background.solidColor = '#000000'
  assert.notEqual(right.background.solidColor, '#000000')
})

test('unknown theme profiles remain stored but cannot become active', () => {
  const settings = normalizeMiniPlayerSettings({
    activeStyleId: 'future-theme',
    profiles: {
      'future-theme': {
        background: { kind: 'solid', solidColor: '#334455' }
      }
    }
  })

  assert.equal(settings.activeStyleId, 'aurora-glass')
  assert.equal(settings.profiles['future-theme'].background.solidColor, '#334455')
})

test('mini player backgrounds accept only managed cache image urls', () => {
  const validUrl = `background://${'a'.repeat(24)}.png`
  const valid = normalizeMiniPlayerSettings({
    profiles: {
      'aurora-glass': { background: { kind: 'image', imageUrl: validUrl } }
    }
  })
  assert.equal(valid.profiles['aurora-glass'].background.kind, 'image')
  assert.equal(valid.profiles['aurora-glass'].background.imageUrl, validUrl)

  const unsafe = normalizeMiniPlayerSettings({
    profiles: {
      'aurora-glass': { background: { kind: 'image', imageUrl: 'background://..' } }
    }
  })
  assert.equal(unsafe.profiles['aurora-glass'].background.kind, 'solid')
  assert.equal(unsafe.profiles['aurora-glass'].background.imageUrl, '')
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
