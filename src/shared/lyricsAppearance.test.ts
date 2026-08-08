import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_LYRICS_APPEARANCE,
  cloneLyricsAppearance,
  normalizeLyricsAppearance,
  syncLegacyLyricsAppearance
} from './lyricsAppearance.ts'

test('lyrics appearance migrates legacy lyric style settings into independent layers', () => {
  const normalized = normalizeLyricsAppearance(undefined, {
    lyricFontSize: 24,
    lyricAlign: 'left',
    lyricDimOpacity: 65
  })
  assert.equal(normalized.fontSize, 24)
  assert.equal(normalized.align, 'left')
  assert.equal(normalized.inactiveOpacity, 65)
  assert.equal(normalized.styles.normal.fontSize, 24)
  assert.equal(normalized.styles.active.fontSize, 24)
  assert.equal(normalized.styles.translation.fontSize, 24)
  assert.equal(normalized.styles.normal.align, 'left')
  assert.equal(normalized.styles.active.align, 'left')
  assert.equal(normalized.styles.translation.align, 'left')
})

test('lyrics appearance defaults to full lyrics mode and accepts compact modes', () => {
  assert.equal(normalizeLyricsAppearance(undefined).focusLineCount, 'all')
  assert.equal(normalizeLyricsAppearance({ focusLineCount: 3 }).focusLineCount, 3)
})

test('lyrics appearance rejects invalid values and normalizes per-layer customization', () => {
  const normalized = normalizeLyricsAppearance({
    fontFamily: 'unknown',
    fontSize: 200,
    fontWeight: 550,
    lineHeight: 4,
    align: 'right',
    inactiveOpacity: 0,
    focusLineCount: 4,
    colorMode: 'custom',
    textColor: '#A0B1C2',
    activeColor: 'red',
    karaokeColor: '#abcdef',
    karaokeEnabled: false,
    styles: {
      normal: { fontSize: 80, align: 'right', opacity: 3, backgroundStyle: 'solid' },
      active: { fontWeight: 880, highlightEffect: 'outline', highlightIntensity: 140 },
      translation: { fontFamily: 'custom', customFontFamily: '  Noto Sans CJK SC  ' }
    }
  })

  assert.equal(normalized.fontSize, 32)
  assert.equal(normalized.fontWeight, 600)
  assert.equal(normalized.lineHeight, 2.6)
  assert.equal(normalized.align, 'right')
  assert.equal(normalized.inactiveOpacity, 10)
  assert.equal(normalized.colorMode, 'custom')
  assert.equal(normalized.textColor, '#a0b1c2')
  assert.equal(normalized.activeColor, DEFAULT_LYRICS_APPEARANCE.activeColor)
  assert.equal(normalized.karaokeColor, '#abcdef')
  assert.equal(normalized.karaokeEnabled, false)
  assert.equal(normalized.styles.normal.fontSize, 32)
  assert.equal(normalized.styles.active.fontSize, 32)
  assert.equal(normalized.styles.translation.fontSize, 32)
  assert.equal(normalized.styles.normal.align, 'right')
  assert.equal(normalized.styles.normal.opacity, 10)
  assert.equal(normalized.styles.normal.backgroundStyle, 'solid')
  assert.equal(normalized.styles.active.fontWeight, 900)
  assert.equal(normalized.styles.active.highlightEffect, 'outline')
  assert.equal(normalized.styles.active.highlightIntensity, 100)
  assert.equal(normalized.styles.translation.fontFamily, 'custom')
  assert.equal(normalized.styles.translation.customFontFamily, 'Noto Sans CJK SC')
})

test('legacy quick controls stay compatible with the independent style layers', () => {
  const synced = syncLegacyLyricsAppearance(cloneLyricsAppearance(DEFAULT_LYRICS_APPEARANCE), {
    fontSize: 22,
    fontFamily: 'lxgw',
    align: 'right',
    textColor: '#abcdef',
    activeColor: '#fedcba'
  })

  assert.equal(synced.styles.normal.fontSize, 22)
  assert.equal(synced.styles.active.fontSize, 22)
  assert.equal(synced.styles.translation.fontSize, 22)
  assert.equal(synced.styles.normal.fontFamily, 'lxgw')
  assert.equal(synced.styles.active.align, 'right')
  assert.equal(synced.styles.translation.color, '#abcdef')
  assert.equal(synced.styles.active.color, '#fedcba')
})
