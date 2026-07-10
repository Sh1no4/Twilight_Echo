import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { createDefaultMiniPlayerThemeProfile } from '../../../shared/miniPlayer.ts'
import {
  getNextMiniPlayerStyle,
  listMiniPlayerStyles,
  registerMiniPlayerStyle,
  resolveMiniPlayerStyle
} from './styles.ts'

test('mini player ships switchable built-in styles with declared window sizes', () => {
  const styles = listMiniPlayerStyles()
  assert.ok(styles.length >= 2)
  assert.equal(resolveMiniPlayerStyle('missing-style').id, 'aurora-glass')
  assert.notEqual(getNextMiniPlayerStyle('aurora-glass').id, 'aurora-glass')
  assert.ok(styles.every((style) => style.windowSize.width >= 360))
  assert.ok(styles.every((style) => /^#[\da-f]{6}$/i.test(style.nativeBackgroundColor)))
})

test('registered mini player styles expose isolated complete default profiles', () => {
  const aurora = resolveMiniPlayerStyle('aurora-glass')
  const porcelain = resolveMiniPlayerStyle('porcelain')
  assert.ok(aurora.defaultProfile)
  assert.ok(porcelain.defaultProfile)
  assert.equal(aurora.defaultProfile.appearance.accentMode, 'track')
  assert.equal(porcelain.defaultProfile.appearance.accentMode, 'custom')
  assert.notStrictEqual(aurora.defaultProfile, porcelain.defaultProfile)
})

test('mini player style registry supports future styles and reversible registration', () => {
  const unregister = registerMiniPlayerStyle({
    id: 'test-future-style',
    name: 'Future',
    description: 'Test style',
    className: 'mini-style-future',
    layout: 'artwork-card',
    windowSize: { width: 444, height: 166 },
    accentMode: 'fixed',
    fixedAccent: '#123456',
    nativeBackgroundColor: '#101820',
    defaultProfile: createDefaultMiniPlayerThemeProfile('aurora-glass'),
    tokens: { '--mini-surface': '#000' }
  })

  assert.equal(resolveMiniPlayerStyle('test-future-style').windowSize.width, 444)
  assert.throws(
    () =>
      registerMiniPlayerStyle({
        ...resolveMiniPlayerStyle('test-future-style'),
        name: 'Duplicate'
      }),
    /already registered/
  )

  unregister()
  assert.equal(resolveMiniPlayerStyle('test-future-style').id, 'aurora-glass')
})

test('mini player surface fills the native window without a rectangular backdrop wrapper', () => {
  const component = readFileSync(new URL('./MiniPlayerApp.vue', import.meta.url), 'utf8')
  const styles = readFileSync(new URL('./MiniPlayer.css', import.meta.url), 'utf8')
  const mainStyles = readFileSync(new URL('../assets/main.css', import.meta.url), 'utf8')
  const rendererEntry = readFileSync(new URL('../main.ts', import.meta.url), 'utf8')
  const miniPlayerWindow = readFileSync(
    new URL('../../../main/integrations/miniPlayer.ts', import.meta.url),
    'utf8'
  )
  const rootRule = styles.match(/\.mini-player-root\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
  const surfaceRule = styles.match(/\.mini-player-surface\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
  const artworkRule = styles.match(/\.mini-artwork-wrap\s*\{[\s\S]*?\n\}/)?.[0] ?? ''

  assert.doesNotMatch(rootRule, /padding:/)
  assert.match(rootRule, /clip-path: inset\(0 round var\(--mini-window-radius\)\)/)
  assert.match(rootRule, /contain: paint/)
  assert.doesNotMatch(surfaceRule, /var\(--mini-surface-shadow\)/)
  assert.match(surfaceRule, /backdrop-filter: blur\(var\(--mini-glass-blur\)\)/)
  assert.match(mainStyles, /html\.mini-player-document[\s\S]*background: transparent !important/)
  assert.doesNotMatch(mainStyles, /mini-player-native-corners/)
  assert.doesNotMatch(rendererEntry, /nativeCorners|mini-player-native-corners/)
  assert.doesNotMatch(miniPlayerWindow, /nativeCorners/)
  assert.match(miniPlayerWindow, /transparent: true/)
  assert.match(miniPlayerWindow, /roundedCorners: true/)
  assert.match(component, /MiniPlayerCustomizer/)
  assert.match(component, /resolveMiniPlayerLayout/)
  assert.match(component, /data-layout/)
  assert.match(component, /mini-background-source/)
  assert.match(component, /settings\.profiles\[settings\.activeStyleId\]/)
  assert.match(styles, /\[data-layout='compact'\]/)
  assert.match(styles, /\[data-layout='wide'\]/)
  assert.match(styles, /var\(--mini-window-radius\)/)
  assert.match(artworkRule, /aspect-ratio: 1/)
  assert.doesNotMatch(artworkRule, /^\s*height: 100%;/m)
  assert.doesNotMatch(component, /mini-play-state|mini-state-dot|playbackStateText/)
  assert.doesNotMatch(styles, /mini-play-state|mini-state-dot/)
  assert.doesNotMatch(rendererEntry, /mini-player-native-corners/)
  assert.match(
    component,
    /<section class="mini-player-surface">\s*<div class="mini-background-source"/
  )
  assert.match(component, /<div class="mini-background-overlay"/)
  assert.doesNotMatch(component, /mini-player-backdrop/)
})
