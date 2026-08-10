import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BUILTIN_LYRICS_PRESETS,
  DEFAULT_LYRICS_PRESET_ID,
  MAX_CUSTOM_LYRICS_PRESETS,
  cloneLyricsPresetConfig,
  findLyricsPreset,
  normalizeLyricsPresetConfig
} from './lyricsPresets.ts'
import { DEFAULT_LYRICS_APPEARANCE, LYRICS_APPEARANCE_SCHEMA_VERSION } from './lyricsAppearance.ts'

test('every built-in preset is already normalized and uniquely identified', () => {
  const ids = new Set<string>()
  for (const preset of BUILTIN_LYRICS_PRESETS) {
    assert.equal(preset.builtin, true)
    assert.ok(preset.name.length > 0, `${preset.id} needs a label`)
    assert.equal(preset.appearance.schemaVersion, LYRICS_APPEARANCE_SCHEMA_VERSION)
    assert.ok(!ids.has(preset.id), `duplicate preset id ${preset.id}`)
    ids.add(preset.id)
  }
  assert.ok(ids.has(DEFAULT_LYRICS_PRESET_ID))
})

test('the default preset reproduces the shipped defaults exactly', () => {
  const fallback = findLyricsPreset({ activeId: '', custom: [] }, DEFAULT_LYRICS_PRESET_ID)
  assert.ok(fallback)
  assert.deepEqual(fallback.appearance, DEFAULT_LYRICS_APPEARANCE)
})

test('opinionated presets carry the looks the defaults deliberately avoid', () => {
  const apple = BUILTIN_LYRICS_PRESETS.find((preset) => preset.id === 'apple-music')
  assert.ok(apple)
  assert.equal(apple.appearance.inactiveOpacity, 40)
  assert.equal(apple.appearance.styles.active.highlightEffect, 'glow')
  assert.notEqual(
    apple.appearance.styles.translation.fontSize,
    apple.appearance.styles.normal.fontSize,
    'per-layer font sizes are what schema 3 unlocked'
  )
})

test('preset config falls back to the default when the active id is unknown', () => {
  assert.equal(normalizeLyricsPresetConfig(undefined).activeId, DEFAULT_LYRICS_PRESET_ID)
  assert.equal(normalizeLyricsPresetConfig({ activeId: 'nope' }).activeId, DEFAULT_LYRICS_PRESET_ID)
  assert.equal(normalizeLyricsPresetConfig({ activeId: 'minimal' }).activeId, 'minimal')
})

test('a custom preset keeps its id and normalizes its appearance', () => {
  const config = normalizeLyricsPresetConfig({
    activeId: 'mine',
    custom: [{ id: 'mine', name: '  我的方案  ', appearance: { fontSize: 900 } }]
  })

  assert.equal(config.activeId, 'mine')
  assert.equal(config.custom.length, 1)
  assert.equal(config.custom[0].name, '我的方案')
  assert.equal(config.custom[0].builtin, false)
  assert.equal(config.custom[0].appearance.fontSize, 48, 'appearance passes through the clamps')
})

test('malformed, duplicate and built-in-shadowing presets are dropped', () => {
  const config = normalizeLyricsPresetConfig({
    custom: [
      null,
      'nope',
      { name: 'no id' },
      { id: 'dup', name: 'first' },
      { id: 'dup', name: 'second' },
      // Shadowing a built-in id would make applying the built-in resolve here.
      { id: 'minimal', name: 'hijack' }
    ]
  })

  assert.deepEqual(
    config.custom.map((preset) => preset.id),
    ['dup']
  )
  assert.equal(config.custom[0].name, 'first')
})

test('the custom preset list is capped rather than growing without bound', () => {
  const custom = Array.from({ length: MAX_CUSTOM_LYRICS_PRESETS + 5 }, (_value, index) => ({
    id: `preset-${index}`,
    name: `方案 ${index}`
  }))

  assert.equal(normalizeLyricsPresetConfig({ custom }).custom.length, MAX_CUSTOM_LYRICS_PRESETS)
})

test('cloning a preset config detaches its appearance', () => {
  const config = normalizeLyricsPresetConfig({
    custom: [{ id: 'mine', name: '我的', appearance: { fontSize: 24 } }]
  })
  const copy = cloneLyricsPresetConfig(config)
  copy.custom[0].appearance.styles.active.fontSize = 40

  assert.equal(config.custom[0].appearance.styles.active.fontSize, 24)
})

test('findLyricsPreset resolves built-ins and custom entries alike', () => {
  const config = normalizeLyricsPresetConfig({
    custom: [{ id: 'mine', name: '我的' }]
  })

  assert.equal(findLyricsPreset(config, 'apple-music')?.builtin, true)
  assert.equal(findLyricsPreset(config, 'mine')?.builtin, false)
  assert.equal(findLyricsPreset(config, 'ghost'), undefined)
})
