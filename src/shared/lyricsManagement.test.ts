import assert from 'node:assert/strict'
import test from 'node:test'

const {
  clampLyricOffset,
  effectiveLyricOffsetSeconds,
  isLyricsManagementDocument,
  projectLyricDisplay,
  projectManagedLyrics
} = (await import(
  new URL('./lyricsManagement.ts', import.meta.url).href
)) as typeof import('./lyricsManagement')

test('lyric timing combines global and per-track offsets with a bounded range', () => {
  assert.equal(effectiveLyricOffsetSeconds(120, -45), 0.075)
  assert.equal(effectiveLyricOffsetSeconds(999_999, -999_999), 0)
  assert.equal(clampLyricOffset(-120_001), -120_000)
})

test('manual lyrics take precedence without changing automatic resolver output for other choices', () => {
  const automatic = {
    original: '[00:01.00]Provider',
    translation: '[00:01.00]Translation',
    romanization: null,
    originalSource: 'provider',
    translationSource: 'provider',
    romanizationSource: null
  }
  const manual = projectManagedLyrics(automatic, {
    offsetMs: 0,
    source: 'manual',
    original: '[00:01.00]Edited',
    translation: null,
    romanization: '[00:01.00]Roma',
    updatedAt: '2026-07-18T00:00:00.000Z'
  })

  assert.equal(manual.original, '[00:01.00]Edited')
  assert.equal(manual.originalSource, 'manual')
  assert.equal(manual.translation, null)
  assert.equal(manual.romanizationSource, 'manual')
  assert.equal(
    projectManagedLyrics(automatic, manualOverride()).original,
    '',
    'empty manual original must leave loading state (null → confirmed empty)'
  )
  assert.equal(
    projectManagedLyrics(automatic, { ...manualOverride(), source: 'provider' }),
    automatic
  )
  assert.deepEqual(automatic, {
    original: '[00:01.00]Provider',
    translation: '[00:01.00]Translation',
    romanization: null,
    originalSource: 'provider',
    translationSource: 'provider',
    romanizationSource: null
  })
})

test('lyric display toggles independently hide original, translation, and romanization', () => {
  const line = { text: 'Original', translation: 'Translation', romanization: 'Roma' }
  assert.deepEqual(
    projectLyricDisplay(line, {
      showOriginal: false,
      showTranslation: true,
      showRomanization: false
    }),
    { text: '', translation: 'Translation', romanization: null }
  )
})

test('lyrics management validation rejects malformed and oversized track maps', () => {
  assert.equal(
    isLyricsManagementDocument({
      schemaVersion: 1,
      globalOffsetMs: 0,
      showOriginal: true,
      showTranslation: true,
      showRomanization: false,
      tracks: { song: manualOverride() }
    }),
    true
  )
  assert.equal(isLyricsManagementDocument({ schemaVersion: 1, tracks: {} }), false)
})

function manualOverride() {
  return {
    offsetMs: 0,
    source: 'manual' as const,
    original: null,
    translation: null,
    romanization: null,
    updatedAt: '2026-07-18T00:00:00.000Z'
  }
}
