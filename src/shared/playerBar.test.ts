import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_PLAYER_BAR_SETTINGS,
  PLAYER_BAR_BOUNDS,
  PLAYER_BAR_MODES,
  clonePlayerBarSettings,
  normalizePlayerBarMode,
  normalizePlayerBarPageMode,
  normalizePlayerBarSettings,
  resolvePlayerBarPresentation,
  resolveSeekTargetSeconds
} from './playerBar.ts'

test('player bar defaults keep the existing standard shape', () => {
  assert.deepEqual(DEFAULT_PLAYER_BAR_SETTINGS, {
    mode: 'standard',
    playingPageMode: 'inherit',
    autoHideOnPlayingPage: false,
    revealThresholdPx: 120,
    hideDelayMs: 900
  })
  assert.deepEqual([...PLAYER_BAR_MODES], ['standard', 'mini'])
})

test('mode normalization falls back to standard for anything unrecognized', () => {
  assert.equal(normalizePlayerBarMode('mini'), 'mini')
  assert.equal(normalizePlayerBarMode('standard'), 'standard')
  assert.equal(normalizePlayerBarMode('compact'), 'standard')
  assert.equal(normalizePlayerBarMode(undefined), 'standard')
  assert.equal(normalizePlayerBarMode(null), 'standard')
  assert.equal(normalizePlayerBarMode(1), 'standard')
})

test('page mode normalization falls back to inherit', () => {
  assert.equal(normalizePlayerBarPageMode('mini'), 'mini')
  assert.equal(normalizePlayerBarPageMode('standard'), 'standard')
  assert.equal(normalizePlayerBarPageMode('inherit'), 'inherit')
  assert.equal(normalizePlayerBarPageMode('nonsense'), 'inherit')
  assert.equal(normalizePlayerBarPageMode(undefined), 'inherit')
})

test('settings normalization clamps and rounds numeric fields', () => {
  const low = normalizePlayerBarSettings({ revealThresholdPx: -50, hideDelayMs: -1 })
  assert.equal(low.revealThresholdPx, PLAYER_BAR_BOUNDS.revealThresholdPx.min)
  assert.equal(low.hideDelayMs, PLAYER_BAR_BOUNDS.hideDelayMs.min)

  const high = normalizePlayerBarSettings({ revealThresholdPx: 9999, hideDelayMs: 99_999 })
  assert.equal(high.revealThresholdPx, PLAYER_BAR_BOUNDS.revealThresholdPx.max)
  assert.equal(high.hideDelayMs, PLAYER_BAR_BOUNDS.hideDelayMs.max)

  const fractional = normalizePlayerBarSettings({ revealThresholdPx: 130.6, hideDelayMs: 240.4 })
  assert.equal(fractional.revealThresholdPx, 131)
  assert.equal(fractional.hideDelayMs, 240)
})

test('settings normalization survives garbage input', () => {
  for (const raw of [undefined, null, 42, 'mini', [], { mode: {}, hideDelayMs: 'soon' }]) {
    assert.deepEqual(normalizePlayerBarSettings(raw), DEFAULT_PLAYER_BAR_SETTINGS)
  }
  assert.equal(normalizePlayerBarSettings({ revealThresholdPx: Number.NaN }).revealThresholdPx, 120)
  assert.equal(
    normalizePlayerBarSettings({ hideDelayMs: Number.POSITIVE_INFINITY }).hideDelayMs,
    900
  )
  // Only a literal true enables auto-hide, so a truthy string cannot flip it.
  assert.equal(
    normalizePlayerBarSettings({ autoHideOnPlayingPage: 'yes' }).autoHideOnPlayingPage,
    false
  )
  assert.equal(
    normalizePlayerBarSettings({ autoHideOnPlayingPage: true }).autoHideOnPlayingPage,
    true
  )
})

test('cloning produces an independent object', () => {
  const source = normalizePlayerBarSettings({ mode: 'mini', hideDelayMs: 300 })
  const copy = clonePlayerBarSettings(source)
  assert.deepEqual(copy, source)
  assert.notEqual(copy, source)
  copy.hideDelayMs = 1200
  assert.equal(source.hideDelayMs, 300)
})

test('playing page mode inherits the global shape when set to inherit', () => {
  const settings = normalizePlayerBarSettings({ mode: 'mini', playingPageMode: 'inherit' })
  assert.equal(resolvePlayerBarPresentation(settings, { onPlayingPage: true }).mode, 'mini')
  assert.equal(resolvePlayerBarPresentation(settings, { onPlayingPage: false }).mode, 'mini')
})

test('playing page mode overrides the global shape only on the playing page', () => {
  const settings = normalizePlayerBarSettings({ mode: 'standard', playingPageMode: 'mini' })
  assert.equal(resolvePlayerBarPresentation(settings, { onPlayingPage: true }).mode, 'mini')
  assert.equal(resolvePlayerBarPresentation(settings, { onPlayingPage: false }).mode, 'standard')

  const inverse = normalizePlayerBarSettings({ mode: 'mini', playingPageMode: 'standard' })
  assert.equal(resolvePlayerBarPresentation(inverse, { onPlayingPage: true }).mode, 'standard')
  assert.equal(resolvePlayerBarPresentation(inverse, { onPlayingPage: false }).mode, 'mini')
})

test('edge progress tracks the mini shape exactly', () => {
  const mini = normalizePlayerBarSettings({ mode: 'mini' })
  const standard = normalizePlayerBarSettings({ mode: 'standard' })
  assert.equal(resolvePlayerBarPresentation(mini, { onPlayingPage: false }).edgeProgress, true)
  assert.equal(resolvePlayerBarPresentation(standard, { onPlayingPage: false }).edgeProgress, false)
})

test('auto-hide requires the playing page, the mini shape, and the setting', () => {
  const enabled = normalizePlayerBarSettings({
    mode: 'mini',
    playingPageMode: 'inherit',
    autoHideOnPlayingPage: true
  })
  assert.equal(resolvePlayerBarPresentation(enabled, { onPlayingPage: true }).autoHide, true)
  // Off the playing page the bar is always present, even with the setting on.
  assert.equal(resolvePlayerBarPresentation(enabled, { onPlayingPage: false }).autoHide, false)

  const standardOnPlayingPage = normalizePlayerBarSettings({
    mode: 'mini',
    playingPageMode: 'standard',
    autoHideOnPlayingPage: true
  })
  assert.equal(
    resolvePlayerBarPresentation(standardOnPlayingPage, { onPlayingPage: true }).autoHide,
    false
  )

  const settingOff = normalizePlayerBarSettings({ mode: 'mini', autoHideOnPlayingPage: false })
  assert.equal(resolvePlayerBarPresentation(settingOff, { onPlayingPage: true }).autoHide, false)
})

test('seek mapping converts a 0..1 ratio into seconds', () => {
  assert.equal(resolveSeekTargetSeconds(0, 240), 0)
  assert.equal(resolveSeekTargetSeconds(0.5, 240), 120)
  assert.equal(resolveSeekTargetSeconds(1, 240), 240)
})

test('seek mapping refuses unusable timelines and out-of-range ratios', () => {
  assert.equal(resolveSeekTargetSeconds(0.5, 0), null)
  assert.equal(resolveSeekTargetSeconds(0.5, -10), null)
  assert.equal(resolveSeekTargetSeconds(0.5, Number.NaN), null)
  assert.equal(resolveSeekTargetSeconds(0.5, Number.POSITIVE_INFINITY), null)
  assert.equal(resolveSeekTargetSeconds(Number.NaN, 240), null)
  assert.equal(resolveSeekTargetSeconds(-0.01, 240), null)
  assert.equal(resolveSeekTargetSeconds(1.01, 240), null)
})
