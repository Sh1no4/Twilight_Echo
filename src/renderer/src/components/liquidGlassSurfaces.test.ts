import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  LIQUID_GLASS_CARD_FILTER_ID,
  LIQUID_GLASS_PLAYBAR_FILTER_ID
} from '../../../shared/liquidGlass.ts'

const baseStyle = readFileSync(new URL('../assets/base.css', import.meta.url), 'utf8')
const defs = readFileSync(new URL('./LiquidGlassDefs.vue', import.meta.url), 'utf8')
const app = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
const themeStore = readFileSync(new URL('../stores/useThemeStore.ts', import.meta.url), 'utf8')

const MATERIAL_ATTRIBUTE = "html[data-te-surface-material='liquidGlass']"
/** Scrolls horizontally, so an inset:0 warp layer would scroll out of view. */
const SCROLLABLE_EXCLUSIONS = ['track-table-wrapper']

/** Selector-list class names from the first block matching `marker`. */
function classesInBlockAfter(css: string, marker: string): string[] {
  const start = css.indexOf(marker)
  assert.notEqual(start, -1, `expected a block for ${marker}`)
  const braceIndex = css.indexOf('{', css.indexOf(') {', start))
  const block = css.slice(start, braceIndex)
  return [...new Set([...block.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]))]
}

const standardCardClasses = classesInBlockAfter(baseStyle, "html[data-card-custom='on']")

test('the canonical card list is non-trivial', () => {
  // Guards the extraction itself: a broken regex would make every comparison vacuous.
  assert.ok(standardCardClasses.length > 30, `only found ${standardCardClasses.length} classes`)
  assert.ok(standardCardClasses.includes('album-card'))
  assert.ok(standardCardClasses.includes('artist-card'))
})

test('liquid glass covers exactly the same surfaces as the standard card list', () => {
  const liquidClasses = classesInBlockAfter(baseStyle, MATERIAL_ATTRIBUTE)
  assert.deepEqual(
    [...liquidClasses].sort(),
    [...standardCardClasses].sort(),
    'liquid glass and standard card surface lists drifted apart'
  )
})

test('the warp layer rides on ::after, never ::before', () => {
  // Five of these classes already use ::before for hover glows and layers; claiming
  // it would silently break them.
  const warpBlocks = baseStyle.match(/\)::after \{[^}]*filter: url\(#te-lg-card\)[^}]*\}/g)
  assert.ok(warpBlocks && warpBlocks.length > 0, 'no ::after warp layer found')
  assert.ok(
    !/data-te-surface-material='liquidGlass'[\s\S]{0,4000}?\)::before \{[^}]*filter: url\(/.test(
      baseStyle
    ),
    'liquid glass must not put the displacement filter on ::before'
  )
})

/**
 * Body of the first real rule (not the leading comment) whose selector starts at
 * `marker`. Anchoring on declarations avoids matching prose in the section comment.
 */
function ruleBodyAt(css: string, marker: string): string {
  const start = css.indexOf(marker, sectionStart())
  assert.notEqual(start, -1, `expected a rule starting with ${marker}`)
  const open = css.indexOf('{', css.indexOf(') {', start))
  return css.slice(open, css.indexOf('}', open))
}

/** Start of the material section, so lookups skip the prose in the header comment. */
function sectionStart(): number {
  const index = baseStyle.indexOf('===== Liquid glass material =====')
  assert.notEqual(index, -1, 'liquid glass section is missing from base.css')
  return index
}

/** Index of the first `::after` warp rule that actually applies the displacement. */
function warpRuleIndex(): number {
  const index = baseStyle.indexOf('filter: url(#te-lg-card);', sectionStart())
  assert.notEqual(index, -1, 'no rule applies the card displacement filter')
  return index
}

function warpRuleBody(): string {
  const open = baseStyle.lastIndexOf('{', warpRuleIndex())
  return baseStyle.slice(open, baseStyle.indexOf('}', open))
}

function selectorOfWarpRule(): string {
  const open = baseStyle.lastIndexOf('{', warpRuleIndex())
  const previousClose = baseStyle.lastIndexOf('}', open)
  return baseStyle.slice(previousClose + 1, open)
}

test('the scrollable surface is excluded from the warp layer but keeps the material', () => {
  const warpSelector = selectorOfWarpRule()
  for (const excluded of SCROLLABLE_EXCLUSIONS) {
    assert.ok(
      !warpSelector.includes(`.${excluded}`),
      `${excluded} scrolls and must not carry an inset:0 warp layer`
    )
    assert.ok(
      baseStyle.includes(`${MATERIAL_ATTRIBUTE} .${excluded}`),
      `${excluded} should still get the glass tint and blur`
    )
  }
})

test('the excluded scrollable surface is still part of the canonical card list', () => {
  // The exclusion covers the warp layer only; leaving the list entirely would mean
  // the surface stopped being treated as a card.
  for (const excluded of SCROLLABLE_EXCLUSIONS) {
    assert.ok(standardCardClasses.includes(excluded), `${excluded} left the card list`)
  }
})

test('content stays sharp: the warp layer sits behind content in an isolated context', () => {
  const surfaceRule = ruleBodyAt(baseStyle, MATERIAL_ATTRIBUTE)
  // Without isolation the negative-z layer can escape behind an ancestor background.
  assert.match(surfaceRule, /isolation: isolate/)
  assert.match(surfaceRule, /position: relative/)

  const warpRule = warpRuleBody()
  assert.match(warpRule, /z-index: -1/)
  assert.match(warpRule, /position: absolute/)
  assert.match(warpRule, /inset: 0/)
  assert.match(warpRule, /pointer-events: none/)
})

test('all three degradation contracts drop the displacement filter', () => {
  // Refraction without its blurred backdrop reads as a smear, not glass.
  for (const contract of [
    'body.te-no-blur',
    "[data-te-effects-mode='reduced']",
    "[data-window-transparent='on'][data-platform='linux']"
  ]) {
    const index = baseStyle.indexOf(contract, baseStyle.indexOf('Liquid glass degradation'))
    assert.notEqual(index, -1, `no liquid glass carve-out for ${contract}`)
    const rule = baseStyle.slice(index, baseStyle.indexOf('}', index))
    assert.match(rule, /filter: none !important/, `${contract} must clear the SVG filter`)
  }
})

test('reduced and disabled motion both pin the surface', () => {
  const index = baseStyle.indexOf("[data-te-motion='reduced'], [data-te-motion='off']")
  assert.notEqual(index, -1, 'motion preference must be honoured by the material')
})

test('both filter ids are defined once and referenced by the stylesheet', () => {
  for (const id of [LIQUID_GLASS_CARD_FILTER_ID, LIQUID_GLASS_PLAYBAR_FILTER_ID]) {
    assert.ok(defs.includes(id), `${id} must be declared in LiquidGlassDefs`)
  }
  assert.ok(
    baseStyle.includes(`url(#${LIQUID_GLASS_CARD_FILTER_ID})`),
    'card filter must be referenced from CSS'
  )
})

test('filter attributes are bound, not hardcoded, since SVG cannot read CSS vars', () => {
  assert.match(defs, /:scale="channelScales\.red"/)
  assert.match(defs, /:scale="channelScales\.green"/)
  assert.match(defs, /:scale="channelScales\.blue"/)
  assert.match(defs, /:href="cardMapUrl"/)
  assert.match(defs, /:href="playbarMapUrl"/)
  assert.match(defs, /getPropertyValue/, 'tuning must be read back from computed style')
})

test('the defs component is mounted once by the app shell', () => {
  assert.match(app, /<LiquidGlassDefs/)
  assert.match(app, /:active="settings\.surfaceMaterial === 'liquidGlass'"/)
  assert.match(app, /:follow-pointer="settings\.liquidGlass\.followPointer"/)
})

test('pointer tracking uses one shared listener rather than one per card', () => {
  // The album grid renders in batches up to the full library, so per-card listeners
  // would scale with library size.
  assert.match(defs, /window\.addEventListener\('pointermove'/)
  const listenerCount = (defs.match(/addEventListener\('pointermove'/g) ?? []).length
  assert.equal(listenerCount, 1, 'exactly one pointermove listener')
  assert.match(defs, /passive: true/)
  assert.match(defs, /removeEventListener\('pointermove'/, 'listener must be released')
})

test('the material attribute is emitted on every theme runtime return path', () => {
  const returns = (themeStore.match(/'data-te-surface-material': surfaceMaterial/g) ?? []).length
  // The main path plus the plugin-theme-unavailable early return. The attribute is
  // never removed by the managed-attribute sweep, so a path that omitted it would
  // leave a stale material applied.
  assert.equal(returns, 2, `expected 2 emit sites, found ${returns}`)
})

test('tuning variables are only emitted while the material is active', () => {
  assert.match(themeStore, /if \(surfaceMaterial !== 'liquidGlass'\) return/)
  assert.match(themeStore, /applyLiquidGlassVariables\(tone, variables\)/)
})
