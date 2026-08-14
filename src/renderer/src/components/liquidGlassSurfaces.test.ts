import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  LIQUID_GLASS_CARD_CLASSES,
  LIQUID_GLASS_CARD_SELECTOR,
  LIQUID_GLASS_CARD_FILTER_ID,
  LIQUID_GLASS_HOME_CARD_FILTER_ID,
  LIQUID_GLASS_PLAYBAR_FILTER_ID
} from '../../../shared/liquidGlass.ts'

const baseStyle = readFileSync(new URL('../assets/base.css', import.meta.url), 'utf8')
const defs = readFileSync(new URL('./LiquidGlassDefs.vue', import.meta.url), 'utf8')
const app = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
const streamingHome = readFileSync(new URL('./StreamingHome.vue', import.meta.url), 'utf8')
const themeStore = readFileSync(new URL('../stores/useThemeStore.ts', import.meta.url), 'utf8')
const playerBarStyle = readFileSync(new URL('./player-bar/PlayerBar.css', import.meta.url), 'utf8')
const settingsPageStyle = readFileSync(
  new URL('./settings-page/SettingsPage.css', import.meta.url),
  'utf8'
)
const localDashboardStyle = readFileSync(new URL('./LocalDashboard.css', import.meta.url), 'utf8')
const playerBarSource = readFileSync(new URL('./PlayerBar.vue', import.meta.url), 'utf8')

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

test('the pointer tracker shares the stylesheet card list', () => {
  // Hover resolution uses the exported selector; if it drifts from base.css the
  // tracker could light a card the stylesheet does not surface (or vice versa).
  const liquidClasses = classesInBlockAfter(baseStyle, MATERIAL_ATTRIBUTE)
  assert.deepEqual(
    [...LIQUID_GLASS_CARD_CLASSES].sort(),
    [...liquidClasses].sort(),
    'exported card classes drifted from the base.css surface list'
  )
  for (const className of LIQUID_GLASS_CARD_CLASSES) {
    assert.ok(LIQUID_GLASS_CARD_SELECTOR.includes(`.${className}`))
  }
})

test('flat light settings pages supply ambient variation behind liquid glass', () => {
  // The settings route is a fixed, opaque page layer. Its backdrop must carry the
  // light field itself; a body-only gradient would never be visible through cards.
  const selector =
    "html[data-theme='pureWhite'][data-te-surface-material='liquidGlass'] .settings-preview-page"
  const start = settingsPageStyle.indexOf(selector)
  assert.notEqual(start, -1, 'light liquid-glass settings backdrop rule is missing')
  const open = settingsPageStyle.indexOf('{', start)
  const rule = settingsPageStyle.slice(open, settingsPageStyle.indexOf('}', open))
  assert.match(rule, /var\(--te-settings-bg-image, none\)/)
  assert.match(rule, /radial-gradient\(88% 74% at 8% -10%, rgba\(116, 164, 245, 0\.14\)/)
  assert.match(rule, /radial-gradient\(72% 68% at 103% 92%, rgba\(236, 164, 190, 0\.09\)/)
  assert.match(rule, /background-attachment:\s*fixed, fixed, fixed, fixed, fixed/)
})

test('flat dark settings pages supply restrained ambient variation behind liquid glass', () => {
  // A flat charcoal page makes a translucent dark pane indistinguishable from an
  // opaque raised block. Keep this fixed and subdued so scroll does not move the
  // lighting field and the theme does not turn neon.
  const selector =
    "html[data-theme='dark'][data-te-surface-material='liquidGlass'] .settings-preview-page"
  const start = settingsPageStyle.indexOf(selector)
  assert.notEqual(start, -1, 'dark liquid-glass settings backdrop rule is missing')
  const open = settingsPageStyle.indexOf('{', start)
  const rule = settingsPageStyle.slice(open, settingsPageStyle.indexOf('}', open))
  assert.match(rule, /var\(--te-settings-bg-image, none\)/)
  assert.match(rule, /radial-gradient\(96% 82% at 6% -14%, rgba\(62, 98, 168, 0\.22\)/)
  assert.match(rule, /radial-gradient\(82% 78% at 106% 100%, rgba\(122, 63, 120, 0\.14\)/)
  assert.match(rule, /background-attachment:\s*fixed, fixed, fixed, fixed, fixed/)
})

test('dark broad glass surfaces retain a thin rim instead of a heavy raised shadow', () => {
  const selector = "html[data-te-surface-material='liquidGlass'][data-theme='dark']"
  const start = baseStyle.indexOf(selector, sectionStart())
  assert.notEqual(start, -1, 'dark liquid-glass token rule is missing')
  const open = baseStyle.indexOf('{', start)
  const rule = baseStyle.slice(open, baseStyle.indexOf('}', open))
  assert.match(rule, /--te-lg-rim-strength:\s*0\.38/)
  assert.match(rule, /--te-lg-bottom-density-alpha:\s*0\.13/)
  assert.match(rule, /--te-lg-shade-alpha:\s*0\.15/)
  assert.match(rule, /--te-lg-drop-near-alpha:\s*0\.07/)
  assert.match(rule, /--te-lg-drop-alpha:\s*0\.18/)
})

test('the displacement filter runs on every non-scroll card surface', () => {
  const warpRule = baseWarpRuleBody()
  assert.match(warpRule, /backdrop-filter: blur\(var\(--te-lg-blur, 16px\)\)/)
  assert.match(warpRule, /filter: url\(#te-lg-card\)/)
  assert.ok(
    !/data-te-surface-material='liquidGlass'[\s\S]{0,4000}?\)::before \{[^}]*filter: url\(/.test(
      baseStyle
    ),
    'liquid glass must not put the displacement filter on ::before'
  )
})

test('the SVG filters do not keep a zero-offset copy stage', () => {
  assert.doesNotMatch(defs, /<feOffset\s+in="SourceGraphic"\s+dx="0"\s+dy="0"/)
  assert.equal((defs.match(/in="SourceGraphic" in2="INVERTED_MASK"/g) ?? []).length, 3)
})

test('offscreen liquid glass surfaces drop their expensive filter layers', () => {
  const selector = "html[data-te-surface-material='liquidGlass'] .te-liquid-glass-offscreen::after"
  const start = baseStyle.indexOf(selector)
  assert.notEqual(start, -1, 'offscreen glass rule is missing')
  const open = baseStyle.indexOf('{', start)
  const rule = baseStyle.slice(open, baseStyle.indexOf('}', open))
  assert.match(rule, /filter:\s*none\s*!important/)
  assert.match(rule, /backdrop-filter:\s*none\s*!important/)
  assert.match(rule, /-webkit-backdrop-filter:\s*none\s*!important/)
  assert.match(defs, /new IntersectionObserver/)
  assert.match(defs, /rootMargin:\s*'128px 0px'/)
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

function baseWarpRuleBody(): string {
  const index = warpRuleIndex()
  const open = baseStyle.lastIndexOf('{', index)
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
      `${excluded} should still get the lightweight glass tint`
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

test('continuously scrolling surfaces keep only the lightweight glass layer', () => {
  const marker = `${MATERIAL_ATTRIBUTE} .track-table-wrapper`
  const start = baseStyle.indexOf(marker, sectionStart())
  assert.notEqual(start, -1, 'track table liquid-glass rule is missing')
  const open = baseStyle.indexOf('{', start)
  const tableRule = baseStyle.slice(open, baseStyle.indexOf('}', open))
  assert.match(tableRule, /backdrop-filter:\s*none/)
  assert.match(tableRule, /-webkit-backdrop-filter:\s*none/)
  assert.doesNotMatch(tableRule, /blur\(/)
})

test('the player applies blur and refraction without an interaction gate', () => {
  const warp =
    playerBarStyle.match(/\.player-bar-liquid \.player-bar-warp\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  assert.match(warp, /backdrop-filter:\s*blur\(var\(--te-lg-blur, 16px\)\)/)
  assert.match(warp, /-webkit-backdrop-filter:\s*blur\(var\(--te-lg-blur, 16px\)\)/)
  assert.match(warp, /filter:\s*url\(#te-lg-playbar\)/)
})

test('content stays sharp: the warp layer sits behind content in an isolated context', () => {
  const surfaceRule = ruleBodyAt(baseStyle, MATERIAL_ATTRIBUTE)
  // Without isolation the negative-z layer can escape behind an ancestor background.
  assert.match(surfaceRule, /isolation: isolate/)
  assert.match(surfaceRule, /position: relative/)

  const warpRule = baseWarpRuleBody()
  assert.match(warpRule, /z-index: -1/)
  assert.match(warpRule, /position: absolute/)
  assert.match(warpRule, /inset: 0/)
  assert.match(warpRule, /pointer-events: none/)
  assert.match(warpRule, /backdrop-filter: blur\(var\(--te-lg-blur, 16px\)\)/)
  assert.match(warpRule, /filter: url\(#te-lg-card\)/)
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

test('all filter ids are defined once and referenced by their surface stylesheets', () => {
  for (const id of [
    LIQUID_GLASS_CARD_FILTER_ID,
    LIQUID_GLASS_HOME_CARD_FILTER_ID,
    LIQUID_GLASS_PLAYBAR_FILTER_ID
  ]) {
    assert.ok(defs.includes(id), `${id} must be declared in LiquidGlassDefs`)
  }
  assert.ok(
    baseStyle.includes(`url(#${LIQUID_GLASS_CARD_FILTER_ID})`),
    'card filter must be referenced from CSS'
  )
  assert.ok(
    localDashboardStyle.includes(`url(#${LIQUID_GLASS_HOME_CARD_FILTER_ID})`),
    'homepage filter must be referenced from CSS'
  )
})

test('homepage cards use their independently tuned variables and filter', () => {
  assert.match(localDashboardStyle, /data-te-home-liquid-glass='on'/)
  assert.match(localDashboardStyle, /--home-lg-blur: var\(--te-home-lg-blur/)
  assert.match(localDashboardStyle, /--home-lg-saturate: var\(--te-home-lg-saturate/)
  assert.match(localDashboardStyle, /--home-lg-filter: url\(#te-lg-home-card\)/)
  assert.match(localDashboardStyle, /filter: var\(--home-lg-filter\)/)
  assert.match(localDashboardStyle, /\.home\s+\.te-liquid-glass-offscreen::after/)
})

test('filter attributes are bound, not hardcoded, since SVG cannot read CSS vars', () => {
  assert.match(defs, /:scale="channelScales\.red"/)
  assert.match(defs, /:scale="channelScales\.green"/)
  assert.match(defs, /:scale="channelScales\.blue"/)
  assert.match(defs, /:href="cardMapUrl"/)
  assert.match(defs, /:href="playbarMapUrl"/)
  assert.match(defs, /getPropertyValue/, 'tuning must be read back from computed style')
})

test('both filters clip refraction back to the source so corners stay rounded', () => {
  // The displacement map is a full rectangle, so without clipping the aberration
  // band by SourceGraphic, refracted pixels fill the square corner wedges outside
  // a rounded element's arc and the surface reads as having right angles.
  const clipCount = (defs.match(/result="EDGE_ABERRATION_CLIPPED"/g) ?? []).length
  assert.equal(clipCount, 3, 'card, homepage, and playbar filters must clip the refraction band')
  const clipSteps = (
    defs.match(
      /<feComposite[\s\S]{0,220}?in2="SourceGraphic"[\s\S]{0,80}?operator="in"[\s\S]{0,80}?result="EDGE_ABERRATION_CLIPPED"/g
    ) ?? []
  ).length
  assert.equal(clipSteps, 3, 'each aberration pass must be composited with SourceGraphic')
  assert.equal(
    (defs.match(/in="EDGE_ABERRATION_CLIPPED" in2="CENTER_CLEAN" operator="over"/g) ?? []).length,
    3,
    'the final composite must use the corner-clipped aberration'
  )
})

test('the defs component is mounted once by the app shell', () => {
  assert.match(app, /<LiquidGlassDefs/)
  assert.match(app, /settings\.liquidGlass\.homeCards\.enabled/)
  assert.match(app, /settings\.liquidGlass\.playbarEnabled/)
  assert.match(app, /settings\.liquidGlass\.settingsNavigationEnabled/)
  assert.match(app, /settings\.surfaceMaterial === 'liquidGlass'/)
  assert.match(app, /:follow-pointer="settings\.liquidGlass\.followPointer"/)
})

test('pointer tracking uses one shared listener rather than one per card', () => {
  // The album grid renders in batches up to the full library, so per-card listeners
  // would scale with library size. A delegated pointerover listener arms high-rate
  // movement only after a card has actually been entered.
  assert.match(defs, /document\.addEventListener\('pointerover', onPointerOver/)
  assert.match(defs, /document\.addEventListener\('pointerout', onPointerOut/)
  assert.match(defs, /if \(card\) attachPointerMove\(\)/)
  assert.match(defs, /window\.addEventListener\('pointermove', onPointerMove/)
  const listenerCount = (defs.match(/addEventListener\('pointermove'/g) ?? []).length
  assert.equal(listenerCount, 1, 'exactly one pointermove listener')
  assert.match(defs, /pointerMoveAttached/)
  assert.match(defs, /detachPointerMove\(\)/, 'high-rate listener must be released')
  assert.match(defs, /passive: true/)
})

test('pointer exit clears a card synchronously so quick passes cannot leave stale glass state', () => {
  assert.match(defs, /function onPointerOut\(event: PointerEvent\): void/)
  assert.match(
    defs,
    /pointerFrames\.cancel\(\)[\s\S]{0,160}?clearHoveredCard\(\)[\s\S]{0,160}?detachPointerMove\(\)/
  )
  assert.match(defs, /const nextCard = resolvePointerCard\(event\.relatedTarget\)/)
  assert.match(defs, /if \(previousCard === nextCard\) return/)
})

test('pointer tracking is mouse-only and always resets when focus leaves the app', () => {
  assert.match(
    defs,
    /function isMousePointer\(event: PointerEvent\): boolean\s*\{[\s\S]*?event\.pointerType === 'mouse'/
  )
  assert.match(
    defs,
    /function onPointerMove\(event: PointerEvent\): void\s*\{[\s\S]{0,100}?if \(!isMousePointer\(event\)\) return/
  )
  assert.match(
    defs,
    /function onPointerOver\(event: PointerEvent\): void\s*\{[\s\S]{0,100}?if \(!isMousePointer\(event\)\) return/
  )
  assert.match(
    defs,
    /function onPointerOut\(event: PointerEvent\): void\s*\{[\s\S]{0,100}?if \(!isMousePointer\(event\)\) return/
  )
  assert.match(defs, /window\.addEventListener\('blur', onWindowBlur\)/)
  assert.match(defs, /document\.addEventListener\('visibilitychange', onVisibilityChange\)/)
  assert.match(defs, /window\.removeEventListener\('blur', onWindowBlur\)/)
  assert.match(defs, /document\.removeEventListener\('visibilitychange', onVisibilityChange\)/)
  assert.match(
    defs,
    /function resetHoveredPointer\(\): void\s*\{[\s\S]{0,200}?pointerFrames\.cancel\(\)[\s\S]{0,160}?clearHoveredCard\(\)[\s\S]{0,160}?detachPointerMove\(\)/
  )
})

test('pointer tracking lights only the hovered card without repeated hit tests or layout reads', () => {
  // The shared listener uses the event's already-resolved target and scopes
  // variables to that element, so moving the mouse does not rotate every card or
  // invoke document.elementFromPoint once per rendered frame.
  assert.doesNotMatch(defs, /document\.elementFromPoint/)
  assert.match(defs, /target instanceof Element/)
  assert.match(defs, /closest<HTMLElement>\(LIQUID_GLASS_CARD_SELECTOR\)/)
  assert.match(defs, /target: event\.target/)
  assert.match(defs, /hoveredCardRect \?\? next\.getBoundingClientRect\(\)/)
  assert.match(defs, /minIntervalMs: LIQUID_GLASS_POINTER_FRAME_INTERVAL_MS/)
  const staticResets = (defs.match(/staticPointerCssVariables\(\), hoveredCard/g) ?? []).length
  assert.ok(staticResets >= 1, 'the previously hovered card must be reset to static')
  const perElementWrites = (defs.match(/style\.setProperty\(name, value\)/g) ?? []).length
  assert.ok(perElementWrites >= 1, 'variables must be written onto the hovered element')
})

test('all material target attributes are emitted on every theme runtime return path', () => {
  const returns = (themeStore.match(/'data-te-surface-material': surfaceMaterial/g) ?? []).length
  // The main path plus the plugin-theme-unavailable early return. The attribute is
  // never removed by the managed-attribute sweep, so a path that omitted it would
  // leave a stale material applied.
  assert.equal(returns, 2, `expected 2 emit sites, found ${returns}`)
  for (const attribute of [
    'data-te-home-liquid-glass',
    'data-te-playbar-liquid-glass',
    'data-te-settings-navigation-liquid-glass'
  ]) {
    assert.equal(
      (themeStore.match(new RegExp(`'${attribute}':`, 'g')) ?? []).length,
      2,
      `${attribute} must be emitted on both return paths`
    )
  }
})

test('liquid glass has no hover or full-mode gate', () => {
  assert.doesNotMatch(baseStyle, /data-te-lg-full/)
  assert.doesNotMatch(playerBarStyle, /data-te-lg-full/)
  assert.doesNotMatch(baseStyle, /\):is\(:hover, :focus-within\)::after/)
  assert.doesNotMatch(playerBarStyle, /\.player-bar-liquid:is\(:hover, :focus-within\)/)
  assert.doesNotMatch(themeStore, /data-te-lg-full/)
})

test('shared tuning variables are emitted for global or independent shared targets', () => {
  assert.match(themeStore, /function usesSharedLiquidGlassProfile\(\): boolean/)
  assert.match(themeStore, /liquidGlass\.playbarEnabled/)
  assert.match(themeStore, /liquidGlass\.settingsNavigationEnabled/)
  assert.match(playerBarSource, /settings\.value\.liquidGlass\.playbarEnabled/)
  assert.match(themeStore, /applyLiquidGlassVariables\(tone, variables\)/)
})

test('runtime tuning changes refresh SVG filter inputs', () => {
  assert.match(themeStore, /LIQUID_GLASS_TUNING_CHANGED_EVENT/)
  assert.match(themeStore, /root\.style\.setProperty\(name, value, 'important'\)/)
  assert.match(themeStore, /applyLiquidGlassRuntimeVariables\(resolveTone\(\)\)/)
  assert.match(themeStore, /applyLiquidGlassRuntimeVariables\(state\.tone\)/)
  assert.match(themeStore, /dispatchEvent\(new Event\(LIQUID_GLASS_TUNING_CHANGED_EVENT\)\)/)
  assert.match(defs, /addEventListener\(LIQUID_GLASS_TUNING_CHANGED_EVENT, onTuningChanged\)/)
  assert.match(defs, /removeEventListener\(LIQUID_GLASS_TUNING_CHANGED_EVENT, onTuningChanged\)/)
})

test('streaming home consumes liquid-glass tuning variables', () => {
  assert.match(streamingHome, /var\(--te-lg-specular, 0\.44\)/)
  assert.match(streamingHome, /var\(--te-lg-tint, 0\.12\)/)
  assert.match(streamingHome, /var\(--te-lg-blur, 16px\)/)
  assert.match(streamingHome, /var\(--te-lg-saturate, 140%\)/)
  assert.match(streamingHome, /filter: url\(#te-lg-card\)/)
})
