import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

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
  const nativeCornerRule =
    mainStyles.match(/html\.mini-player-document\.mini-player-native-corners,[\s\S]*?\n\}/)?.[0] ??
    ''

  assert.doesNotMatch(rootRule, /padding:/)
  assert.match(rootRule, /clip-path: inset\(0 round var\(--mini-window-radius\)\)/)
  assert.match(rootRule, /contain: paint/)
  assert.doesNotMatch(surfaceRule, /var\(--mini-surface-shadow\)/)
  assert.doesNotMatch(surfaceRule, /backdrop-filter/)
  assert.match(mainStyles, /html\.mini-player-document[\s\S]*background: transparent !important/)
  assert.match(nativeCornerRule, /--mini-window-radius: 0px/)
  assert.match(rendererEntry, /query\.get\('nativeCorners'\) === '1'/)
  assert.match(rendererEntry, /classList\.add\('mini-player-native-corners'\)/)
  assert.match(miniPlayerWindow, /searchParams\.set\('nativeCorners', '1'\)/)
  assert.match(
    component,
    /<section class="mini-player-surface">\s*<div v-if="hasCover" class="mini-player-backdrop"/
  )
  assert.doesNotMatch(
    component,
    /<main class="mini-player-root"[^>]*>\s*<div v-if="hasCover" class="mini-player-backdrop"/
  )
})
