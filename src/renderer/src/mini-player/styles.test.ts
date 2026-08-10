import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  MINI_PLAYER_MIN_HEIGHT,
  MINI_PLAYER_MIN_WIDTH,
  createDefaultMiniPlayerThemeProfile
} from '../../../shared/miniPlayer.ts'
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
  assert.ok(styles.every((style) => style.windowSize.width >= MINI_PLAYER_MIN_WIDTH))
  assert.ok(styles.every((style) => style.windowSize.height >= MINI_PLAYER_MIN_HEIGHT))
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
    windowSize: { width: 1, height: 1 },
    accentMode: 'fixed',
    fixedAccent: '#123456',
    nativeBackgroundColor: '#101820',
    defaultProfile: createDefaultMiniPlayerThemeProfile('aurora-glass'),
    tokens: { '--mini-surface': '#000' }
  })

  assert.deepEqual(resolveMiniPlayerStyle('test-future-style').windowSize, {
    width: MINI_PLAYER_MIN_WIDTH,
    height: MINI_PLAYER_MIN_HEIGHT
  })
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

test('mini player lyric stage shows only the active line without moving controls', () => {
  const component = readFileSync(new URL('./MiniPlayerApp.vue', import.meta.url), 'utf8')
  const styles = readFileSync(new URL('./MiniPlayer.css', import.meta.url), 'utf8')
  const contentRule = styles.match(/\.mini-player-content\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
  const lyricStageRule = styles.match(/\.mini-lyric-stage\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
  const controlsRule =
    [...styles.matchAll(/\.mini-player-controls\s*\{[\s\S]*?\n\}/g)]
      .map((match) => match[0])
      .find((rule) => rule.includes('grid-template-columns')) ?? ''

  assert.match(component, /<Transition name="mini-lyric-switch" mode="out-in">/)
  assert.match(component, /class="mini-lyric-stage"/)
  assert.doesNotMatch(component, /previousLyricLine|nextLyricLine|mini-lyric-adjacent/)
  assert.match(contentRule, /min-height:\s*0/)
  assert.match(lyricStageRule, /min-height:\s*0/)
  assert.match(lyricStageRule, /overflow:\s*hidden/)
  assert.match(controlsRule, /height:\s*var\(--mini-controls-dock-height\)/)
  assert.match(controlsRule, /min-height:\s*var\(--mini-controls-dock-height\)/)
  assert.match(styles, /\.mini-lyric-original\s*\{[\s\S]*?white-space:\s*nowrap/)
  assert.match(styles, /\.mini-lyric-translation\s*\{[\s\S]*?white-space:\s*nowrap/)
  assert.match(styles, /\.mini-lyric-switch-enter-active/)
  assert.match(styles, /\.mini-lyric-switch-leave-active/)
})

test('mini player reserves independent track, lyric, and transport rails for long lyric lines', () => {
  const component = readFileSync(new URL('./MiniPlayerApp.vue', import.meta.url), 'utf8')
  const styles = readFileSync(new URL('./MiniPlayer.css', import.meta.url), 'utf8')
  const mainRule = styles.match(/\.mini-player-main\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
  const trackRule = styles.match(/\.mini-track-info\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
  const lyricStageRule = styles.match(/\.mini-lyric-stage\s*\{[\s\S]*?\n\}/)?.[0] ?? ''

  assert.match(component, /class="mini-player-main"/)
  assert.match(component, /class="mini-player-dock"/)
  assert.match(
    mainRule,
    /grid-template-rows:\s*var\(--mini-track-slot-height\)\s+minmax\(0,\s*1fr\)/
  )
  assert.match(mainRule, /row-gap:\s*var\(--mini-content-row-gap\)/)
  assert.match(trackRule, /height:\s*var\(--mini-track-slot-height\)/)
  assert.match(trackRule, /overflow:\s*hidden/)
  assert.match(lyricStageRule, /contain:\s*layout\s+paint/)
  assert.match(lyricStageRule, /overflow:\s*clip/)
})

test('mini player keeps the playback dock fixed while a lyric changes', () => {
  const component = readFileSync(new URL('./MiniPlayerApp.vue', import.meta.url), 'utf8')
  const styles = readFileSync(new URL('./MiniPlayer.css', import.meta.url), 'utf8')
  const contentRule = styles.match(/\.mini-player-content\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
  const dockRule = styles.match(/\.mini-player-dock\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
  const mainRule = styles.match(/\.mini-player-main\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
  const lyricRule = styles.match(/\.mini-lyric-original\s*\{[\s\S]*?\n\}/)?.[0] ?? ''

  const compactContentRule =
    styles.match(
      /\.mini-player-root\[data-layout='compact'\] \.mini-player-content\s*\{[\s\S]*?\n\}/
    )?.[0] ?? ''
  const wideContentRule =
    styles.match(
      /\.mini-player-root\[data-layout='wide'\] \.mini-player-content\s*\{[\s\S]*?\n\}/
    )?.[0] ?? ''

  assert.match(component, /class="mini-player-main"/)
  assert.match(component, /class="mini-player-dock"/)
  assert.match(
    contentRule,
    /grid-template-rows:\s*minmax\(0,\s*1fr\)\s+var\(--mini-player-dock-height\)/
  )
  assert.match(
    dockRule,
    /grid-template-rows:\s*var\(--mini-progress-dock-height\)\s+var\(--mini-controls-dock-height\)/
  )
  assert.match(
    mainRule,
    /grid-template-rows:\s*var\(--mini-track-slot-height\)\s+minmax\(0,\s*1fr\)/
  )
  assert.match(mainRule, /overflow:\s*hidden/)
  assert.match(lyricRule, /white-space:\s*nowrap/)
  assert.match(lyricRule, /text-overflow:\s*ellipsis/)
  assert.match(compactContentRule, /--mini-progress-dock-height:\s*24px/)
  assert.match(compactContentRule, /--mini-controls-dock-height:\s*46px/)
  assert.match(wideContentRule, /--mini-progress-dock-height:\s*32px/)
  assert.match(wideContentRule, /--mini-controls-dock-height:\s*60px/)
  assert.doesNotMatch(
    styles,
    /\.mini-player-root\[data-layout='compact'\] \.mini-progress-block\s*\{/
  )
  const lyricStageStart = component.indexOf('class="mini-lyric-stage"')
  const lyricTransitionEnd = component.indexOf('</Transition>', lyricStageStart)
  const lyricTemplate = component.slice(
    lyricStageStart,
    lyricTransitionEnd + '</Transition>'.length
  )
  assert.match(lyricTemplate, /\{\{ currentLyricLine!\.original \}\}/)
  assert.doesNotMatch(lyricTemplate, /ScrollingText/)
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
  assert.match(rootRule, /border-radius: var\(--mini-window-radius\)/)
  assert.match(rootRule, /overflow: hidden/)
  assert.doesNotMatch(rootRule, /clip-path/)
  assert.match(rootRule, /contain: paint/)
  assert.doesNotMatch(surfaceRule, /var\(--mini-surface-shadow\)/)
  assert.match(surfaceRule, /backdrop-filter: blur\(var\(--mini-glass-blur\)\)/)
  assert.doesNotMatch(surfaceRule, /border:\s*var\(--mini-border-width\)/)
  assert.doesNotMatch(surfaceRule, /--mini-highlight/)
  assert.match(
    styles,
    /\.mini-window-fill\s*\{[\s\S]*?background: var\(--mini-background-fallback\)/
  )
  assert.match(mainStyles, /html\.mini-player-document[\s\S]*background: transparent !important/)
  assert.doesNotMatch(mainStyles, /mini-player-native-corners/)
  assert.doesNotMatch(rendererEntry, /nativeCorners|mini-player-native-corners/)
  assert.doesNotMatch(miniPlayerWindow, /nativeCorners/)
  assert.match(miniPlayerWindow, /transparent: true/)
  assert.match(miniPlayerWindow, /roundedCorners: false/)
  assert.match(miniPlayerWindow, /hasShadow: false/)
  assert.match(miniPlayerWindow, /cornerRadius\s*-\s*2/)
  assert.match(rendererEntry, /document\.addEventListener\(\s*'dragstart'/)
  assert.match(rendererEntry, /closest\('\[draggable="true"\]'\)/)
  assert.match(rendererEntry, /event\.preventDefault\(\)/)
  assert.match(rendererEntry, /true\s*\)/)
  assert.match(component, /MiniPlayerCustomizer/)
  assert.match(component, /resolveMiniPlayerLayout/)
  assert.match(component, /data-layout/)
  assert.match(component, /mini-window-fill/)
  assert.match(component, /mini-background-source/)
  assert.match(component, /findActiveMiniPlayerLyricIndex/)
  assert.match(component, /mini-lyric-stage/)
  assert.match(component, /mini-lyric-current/)
  assert.match(component, /mini-quality/)
  assert.match(component, /trackQuality/)
  assert.match(component, /settings\.profiles\[settings\.activeStyleId\]/)
  assert.match(styles, /\[data-layout='compact'\]/)
  assert.match(styles, /\[data-layout='wide'\]/)
  assert.match(styles, /\.mini-lyric-stage/)
  assert.match(styles, /\.mini-lyric-current/)
  assert.match(styles, /@container \(max-height: 150px\)/)
  assert.match(styles, /mini-artwork-breathe/)
  assert.match(styles, /\.mini-quality-badge/)
  assert.match(styles, /var\(--mini-window-radius\)/)
  assert.match(artworkRule, /aspect-ratio: 1/)
  assert.doesNotMatch(artworkRule, /^\s*height: 100%;/m)
  assert.doesNotMatch(component, /mini-play-state|mini-state-dot|playbackStateText/)
  assert.doesNotMatch(styles, /mini-play-state|mini-state-dot/)
  assert.doesNotMatch(rendererEntry, /mini-player-native-corners/)
  assert.match(component, /class="mini-window-fill"/)
  assert.match(component, /mini-background-overlay/)
  assert.doesNotMatch(component, /mini-player-backdrop/)
})
