import assert from 'node:assert/strict'
import test from 'node:test'

import * as miniPlayerModule from './miniPlayer.ts'
import {
  DEFAULT_MINI_PLAYER_SETTINGS,
  MINI_PLAYER_MAX_WIDTH,
  MINI_PLAYER_MIN_HEIGHT,
  MINI_PLAYER_MIN_WIDTH,
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
  assert.equal(settings.windowWidth, MINI_PLAYER_MAX_WIDTH)
  assert.equal(settings.windowHeight, MINI_PLAYER_MIN_HEIGHT)
  const minimumSettings = normalizeMiniPlayerSettings({ windowWidth: 1, windowHeight: 1 })
  assert.equal(minimumSettings.windowWidth, MINI_PLAYER_MIN_WIDTH)
  assert.equal(minimumSettings.windowHeight, MINI_PLAYER_MIN_HEIGHT)
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
          fontFamily: "url('https://example.com/font.woff2')",
          surfaceOpacity: 2,
          glassBlur: 99,
          cornerRadius: 80,
          borderWidth: 9,
          borderColor: '#111111',
          shadowStrength: -5,
          shadowColor: '#222222'
        },
        layout: { preference: 'wide' },
        visibility: { artwork: false, playbackState: false, volume: false }
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
  assert.equal(
    profile.appearance.fontFamily,
    DEFAULT_MINI_PLAYER_SETTINGS.profiles['aurora-glass'].appearance.fontFamily
  )
  assert.equal(profile.appearance.shadowColor, '#222222')
  assert.equal(profile.visibility.artwork, false)
  assert.equal(profile.visibility.album, true)
  assert.equal('playbackState' in profile.visibility, false)
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
      format: 'FLAC',
      sampleRate: 192000,
      bitDepth: 24,
      coverSource: 'https://p1.music.126.net/cover.jpg',
      filePath: 'D:/private/song.flac'
    },
    isPlaying: true,
    currentTime: 120,
    duration: 100,
    volume: 3,
    playMode: 'listLoop',
    favoriteAvailable: true,
    favoriteLiked: true,
    favoriteLoading: false,
    dominantColor: '#7c4dff',
    queueIndex: 99,
    queueLength: 3
  })

  assert.equal(state.track?.title, 'Night Drive')
  assert.equal('filePath' in (state.track as object), false)
  assert.equal(state.track?.cover, 'cover://abc.jpg')
  assert.equal(state.track?.format, 'FLAC')
  assert.equal(state.track?.sampleRate, 192000)
  assert.equal(state.track?.bitDepth, 24)
  assert.equal(state.track?.coverSource, 'https://p1.music.126.net/cover.jpg')
  assert.equal(state.currentTime, 100)
  assert.equal(state.volume, 1)
  assert.equal(state.playMode, 'listLoop')
  assert.equal(state.favoriteAvailable, true)
  assert.equal(state.favoriteLiked, true)
  assert.equal(state.favoriteLoading, false)
  assert.equal(state.queueIndex, 2)
})

test('mini player track snapshot clamps quality numbers and drops unsafe ones', () => {
  const state = normalizeMiniPlayerStateSnapshot({
    track: {
      id: 'local:q',
      title: 'Quality',
      format: '   dsd  ',
      sampleRate: -8000,
      bitDepth: 128
    }
  })
  assert.equal(state.track?.format, 'dsd')
  assert.equal(state.track?.sampleRate, 1)
  assert.equal(state.track?.bitDepth, 64)

  const withoutQuality = normalizeMiniPlayerStateSnapshot({
    track: { id: 'local:q2', title: 'Plain' }
  })
  assert.equal(withoutQuality.track?.format, null)
  assert.equal(withoutQuality.track?.sampleRate, null)
  assert.equal(withoutQuality.track?.bitDepth, null)
})

test('mini player state carries the active lyric line with its translation', () => {
  const state = normalizeMiniPlayerStateSnapshot({
    track: { id: 'ncm:1', title: 'Daydream' },
    currentLyric: {
      original: "I'll always be there for you",
      translation: '我会一直在你身边',
      extra: 'dropped'
    },
    currentTime: 42
  })

  assert.equal(state.currentLyric?.original, "I'll always be there for you")
  assert.equal(state.currentLyric?.translation, '我会一直在你身边')
  assert.equal('extra' in (state.currentLyric as object), false)

  const withoutTranslation = normalizeMiniPlayerStateSnapshot({
    currentLyric: { original: 'Solo line' }
  })
  assert.equal(withoutTranslation.currentLyric?.original, 'Solo line')
  assert.equal(withoutTranslation.currentLyric?.translation, null)

  const empty = normalizeMiniPlayerStateSnapshot({ currentLyric: null })
  assert.equal(empty.currentLyric, null)

  const blank = normalizeMiniPlayerStateSnapshot({ currentLyric: { original: '' } })
  assert.equal(blank.currentLyric, null)
})

test('mini player state normalizes timed lyric lines for the multi-line view', () => {
  const state = normalizeMiniPlayerStateSnapshot({
    track: { id: 'ncm:1', title: 'Daydream' },
    currentTime: 42,
    lyrics: [
      { time: 1.5, original: 'first line', translation: '第一行', extra: 'dropped' },
      { time: 3, original: 'second line' },
      { time: -1, original: 'negative time', translation: null },
      { time: 'bad', original: 'bad time', translation: null },
      { time: 5, original: '' }
    ]
  })

  assert.deepEqual(state.lyrics, [
    { time: 1.5, original: 'first line', translation: '第一行' },
    { time: 3, original: 'second line', translation: null },
    { time: 0, original: 'negative time', translation: null },
    { time: null, original: 'bad time', translation: null }
  ])

  assert.deepEqual(normalizeMiniPlayerStateSnapshot({}).lyrics, [])
  assert.deepEqual(normalizeMiniPlayerStateSnapshot({ lyrics: 'not-an-array' }).lyrics, [])
})

test('mini player track snapshot keeps large data: covers intact and drops unsafe cover sources', () => {
  const dataCover = `data:image/jpeg;base64,${'a'.repeat(200_000)}`
  const embedded = normalizeMiniPlayerStateSnapshot({
    track: { id: 'local:embedded', title: 'Embedded', cover: dataCover }
  })
  // A truncated data: URL is corrupt — the full payload must survive.
  assert.equal(embedded.track?.cover, dataCover)
  assert.equal(embedded.track?.coverSource, null)

  const oversized = normalizeMiniPlayerStateSnapshot({
    track: {
      id: 'local:huge',
      title: 'Huge',
      cover: `data:image/jpeg;base64,${'a'.repeat(4_500_000)}`
    }
  })
  assert.equal(oversized.track?.cover, null)

  const unsafeSource = normalizeMiniPlayerStateSnapshot({
    track: {
      id: 'ncm:1',
      title: 'Remote',
      cover: 'twilight-media://image/token',
      coverSource: 'file:///C:/private/cover.jpg'
    }
  })
  assert.equal(unsafeSource.track?.cover, 'twilight-media://image/token')
  assert.equal(unsafeSource.track?.coverSource, null)
})

test('mini player commands reject invalid payloads and clamp numeric controls', () => {
  assert.deepEqual(normalizeMiniPlayerCommand({ type: 'toggle-play' }), {
    type: 'toggle-play'
  })
  assert.deepEqual(normalizeMiniPlayerCommand({ type: 'set-volume', value: -2 }), {
    type: 'set-volume',
    value: 0
  })
  assert.deepEqual(normalizeMiniPlayerCommand({ type: 'set-play-mode', value: 'listLoop' }), {
    type: 'set-play-mode',
    value: 'listLoop'
  })
  assert.deepEqual(normalizeMiniPlayerCommand({ type: 'toggle-favorite' }), {
    type: 'toggle-favorite'
  })
  assert.equal(normalizeMiniPlayerCommand({ type: 'set-play-mode', value: 'unsafe' }), null)
  assert.equal(normalizeMiniPlayerCommand({ type: 'seek', value: Number.NaN }), null)
  assert.equal(normalizeMiniPlayerCommand({ type: 'delete-library' }), null)
})
