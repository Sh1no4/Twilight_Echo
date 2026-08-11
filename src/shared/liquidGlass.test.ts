import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_LIQUID_GLASS,
  DEFAULT_LIQUID_GLASS_DARK,
  DEFAULT_LIQUID_GLASS_LIGHT,
  LIQUID_GLASS_BOUNDS,
  LIQUID_GLASS_CARD_CLASSES,
  LIQUID_GLASS_CARD_SELECTOR,
  liquidGlassCssVariables,
  normalizeLiquidGlass,
  normalizeLiquidGlassTheme,
  normalizeSurfaceMaterial,
  resolveAberrationBlur,
  resolveChannelScales,
  SURFACE_MATERIALS
} from './liquidGlass.ts'

test('surface material normalization only accepts known values', () => {
  assert.equal(normalizeSurfaceMaterial('liquidGlass'), 'liquidGlass')
  assert.equal(normalizeSurfaceMaterial('standard'), 'standard')
  assert.equal(normalizeSurfaceMaterial('LiquidGlass'), 'standard')
  assert.equal(normalizeSurfaceMaterial(undefined), 'standard')
  assert.equal(normalizeSurfaceMaterial(null), 'standard')
  assert.equal(normalizeSurfaceMaterial(1), 'standard')
  assert.deepEqual([...SURFACE_MATERIALS], ['standard', 'liquidGlass'])
})

test('card surface list is non-trivial, unique, and selector-ready', () => {
  assert.ok(LIQUID_GLASS_CARD_CLASSES.length > 30, 'card list must stay canonical')
  assert.equal(new Set(LIQUID_GLASS_CARD_CLASSES).size, LIQUID_GLASS_CARD_CLASSES.length)
  for (const className of ['album-card', 'artist-card', 'playlist-card', 'card'] as const) {
    assert.ok(LIQUID_GLASS_CARD_CLASSES.includes(className), `${className} must be surfaced`)
  }
  for (const className of LIQUID_GLASS_CARD_CLASSES) {
    assert.ok(
      LIQUID_GLASS_CARD_SELECTOR.split(',').includes(`.${className}`),
      `selector must contain .${className}`
    )
  }
})

test('theme normalization falls back per field and clamps to bounds', () => {
  const normalized = normalizeLiquidGlassTheme(
    {
      displacementScale: 9999,
      blurAmount: -40,
      saturation: 'nope',
      aberrationIntensity: Number.NaN,
      specularOpacity: 61,
      tintOpacity: 250
    },
    DEFAULT_LIQUID_GLASS_LIGHT
  )

  assert.equal(normalized.displacementScale, LIQUID_GLASS_BOUNDS.displacementScale.max)
  assert.equal(normalized.blurAmount, LIQUID_GLASS_BOUNDS.blurAmount.min)
  // non-numeric input must fall back, not clamp to a bound
  assert.equal(normalized.saturation, DEFAULT_LIQUID_GLASS_LIGHT.saturation)
  assert.equal(normalized.aberrationIntensity, DEFAULT_LIQUID_GLASS_LIGHT.aberrationIntensity)
  assert.equal(normalized.specularOpacity, 61)
  assert.equal(normalized.tintOpacity, LIQUID_GLASS_BOUNDS.tintOpacity.max)
})

test('non-finite numbers fall back rather than pinning to a bound', () => {
  // Infinity/-Infinity are numbers but not usable values, so they are treated
  // like a wrong type. Silently pinning them to a bound would hide bad input.
  const normalized = normalizeLiquidGlassTheme(
    { tintOpacity: Infinity, blurAmount: -Infinity, saturation: Number.NaN },
    DEFAULT_LIQUID_GLASS_LIGHT
  )

  assert.equal(normalized.tintOpacity, DEFAULT_LIQUID_GLASS_LIGHT.tintOpacity)
  assert.equal(normalized.blurAmount, DEFAULT_LIQUID_GLASS_LIGHT.blurAmount)
  assert.equal(normalized.saturation, DEFAULT_LIQUID_GLASS_LIGHT.saturation)
})

test('theme normalization accepts non-object input', () => {
  assert.deepEqual(
    normalizeLiquidGlassTheme(undefined, DEFAULT_LIQUID_GLASS_DARK),
    DEFAULT_LIQUID_GLASS_DARK
  )
  assert.deepEqual(
    normalizeLiquidGlassTheme('glass', DEFAULT_LIQUID_GLASS_DARK),
    DEFAULT_LIQUID_GLASS_DARK
  )
})

test('settings normalization defaults followPointer on and keeps both tones', () => {
  const normalized = normalizeLiquidGlass({})
  assert.equal(normalized.followPointer, true)
  assert.deepEqual(normalized.light, DEFAULT_LIQUID_GLASS_LIGHT)
  assert.deepEqual(normalized.dark, DEFAULT_LIQUID_GLASS_DARK)

  assert.equal(normalizeLiquidGlass({ followPointer: false }).followPointer, false)
  // only an explicit false disables it
  assert.equal(normalizeLiquidGlass({ followPointer: 0 }).followPointer, true)
})

test('normalization never aliases the exported default objects', () => {
  const normalized = normalizeLiquidGlass({})
  normalized.light.blurAmount = 1
  normalized.dark.blurAmount = 2

  assert.notEqual(normalized.light, DEFAULT_LIQUID_GLASS_LIGHT)
  assert.notEqual(normalized.dark, DEFAULT_LIQUID_GLASS_DARK)
  assert.equal(DEFAULT_LIQUID_GLASS_LIGHT.blurAmount, 0)
  assert.equal(DEFAULT_LIQUID_GLASS_DARK.blurAmount, 0)
  assert.equal(DEFAULT_LIQUID_GLASS.light.blurAmount, 0)
  assert.equal(DEFAULT_LIQUID_GLASS.dark.elasticity, 0)
  assert.equal(DEFAULT_LIQUID_GLASS.overLight, false)
})

test('channel scales trail red to produce aberration and never invert', () => {
  const scales = resolveChannelScales(70, 2)
  assert.equal(scales.red, 70)
  assert.ok(scales.green < scales.red, 'green trails red')
  assert.ok(scales.blue < scales.green, 'blue trails green')

  // zero aberration collapses the channels together (no fringing)
  const flat = resolveChannelScales(70, 0)
  assert.equal(flat.red, flat.green)
  assert.equal(flat.green, flat.blue)

  // extreme aberration must not push a channel negative
  const extreme = resolveChannelScales(10, 8)
  assert.ok(extreme.green >= 0)
  assert.ok(extreme.blue >= 0)
})

test('channel scales stay at zero when displacement is off', () => {
  const off = resolveChannelScales(0, 4)
  assert.deepEqual(off, { red: 0, green: 0, blue: 0 })
})

test('aberration blur stays in a usable range', () => {
  assert.equal(resolveAberrationBlur(0), 0.5)
  assert.ok(resolveAberrationBlur(8) >= 0.1, 'blur never reaches zero or negative')
  assert.ok(resolveAberrationBlur(2) < resolveAberrationBlur(0), 'more aberration, less softening')
})

test('css variables carry units the stylesheet expects', () => {
  const vars = liquidGlassCssVariables({
    displacementScale: 70,
    blurAmount: 16,
    saturation: 140,
    aberrationIntensity: 2,
    elasticity: 40,
    specularOpacity: 55,
    tintOpacity: 12
  })

  assert.equal(vars['--te-lg-displacement'], '70')
  assert.equal(vars['--te-lg-blur'], '16px')
  assert.equal(vars['--te-lg-saturate'], '140%')
  assert.equal(vars['--te-lg-aberration'], '2')
  assert.equal(vars['--te-lg-elasticity'], '40')
  // opacities are emitted as 0-1 ratios for direct use in color functions
  assert.equal(vars['--te-lg-specular'], '0.550')
  assert.equal(vars['--te-lg-tint'], '0.120')
})

test('new tuning fields normalize and clamp to their bounds', () => {
  const normalized = normalizeLiquidGlassTheme(
    {
      displacementScale: 90,
      blurAmount: 0,
      saturation: 100,
      aberrationIntensity: 1.5,
      elasticity: 999,
      specularOpacity: 41,
      tintOpacity: 10
    },
    DEFAULT_LIQUID_GLASS_LIGHT
  )
  assert.equal(normalized.elasticity, 100)
  assert.equal(normalized.displacementScale, 90)
  assert.equal(normalized.blurAmount, 0)
  assert.equal(normalized.saturation, 100)
})

test('over light flag normalizes to a strict boolean', () => {
  assert.equal(normalizeLiquidGlass({ overLight: true }).overLight, true)
  assert.equal(normalizeLiquidGlass({ overLight: 1 }).overLight, false)
  assert.equal(normalizeLiquidGlass({}).overLight, false)
})
