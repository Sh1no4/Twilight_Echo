import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

test('now playing lyrics do not surface original/translated source path chips', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /const lyricSourceLabel = computed/)
  assert.doesNotMatch(source, /const translatedLyricSourceLabel = computed/)
  assert.doesNotMatch(source, /class="lyric-source-chip"/)
  assert.doesNotMatch(source, /lyric-source-chips/)
  assert.match(source, /currentTrack\.value\?\.lyricsSource/)
  assert.match(source, /currentTrack\.value\?\.translatedLyricsSource/)
})

test('now playing keeps lyric source controls in the player bar sidebar', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /class="lyric-source-controls"/)
  assert.doesNotMatch(source, /class="lyric-translation-toggle"/)
})

test('now playing lyrics use a clipped AMLL stage rather than exposing a scrollbar', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')
  const lyricsScroll = source.match(/\.lyrics-scroll \{[\s\S]*?\n\}/)?.[0] ?? ''

  assert.match(lyricsScroll, /overflow: hidden/)
  assert.doesNotMatch(source, /lyrics-scroll::\-webkit-scrollbar|scrollbar-width: none/)
})

test('visualizer mode does not keep the heavy blurred backdrop mounted', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')

  assert.match(source, /<div v-if="viewMode !== 'visualizer'" class="backdrop"/)
})

test('lyrics use the official AMLL focus-stage renderer and typography', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')
  const stage = readFileSync(new URL('./AmlLyricsStage.vue', import.meta.url), 'utf8')

  assert.match(source, /import AmlLyricsStage/)
  assert.match(source, /<AmlLyricsStage/)
  assert.match(
    stage,
    /import \{ LyricPlayer(?:, type LyricPlayerRef)? \} from '@applemusic-like-lyrics\/vue'/
  )
  assert.match(stage, /import '@applemusic-like-lyrics\/core\/style\.css'/)
  // Let the installed AMLL renderer retain ownership of its own movement,
  // scale and alignment defaults. Local spring values easily drift from the
  // library and were the source of the non-reference scrolling feel.
  assert.doesNotMatch(stage, /line-pos-y-spring-params/)
  assert.doesNotMatch(stage, /line-scale-spring-params/)
  assert.doesNotMatch(stage, /AMLL_(?:VERTICAL|SCALE)_SPRING/)
  assert.doesNotMatch(stage, /align-anchor=/)
  assert.doesNotMatch(stage, /align-position=/)
  assert.doesNotMatch(stage, /enable-spring=/)
  assert.doesNotMatch(stage, /enable-blur=/)
  assert.doesNotMatch(stage, /enable-scale=/)
  assert.doesNotMatch(stage, /--amll-lp-line-width-aspect/)
  assert.doesNotMatch(stage, /--amll-lp-line-padding-x/)
  assert.match(stage, /--amll-lp-font-size/)
  assert.match(stage, /font-weight: 780/)
  assert.match(stage, /FmKaba_interludeDots/)
  assert.doesNotMatch(source, /function advanceLyricScrollSpring/)
  assert.doesNotMatch(source, /scrollTo\(\{ behavior: 'smooth' \}\)/)
})

test('now playing exposes independent lyric customization with live persisted preview', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')
  const stage = readFileSync(new URL('./AmlLyricsStage.vue', import.meta.url), 'utf8')
  const customizer = readFileSync(
    new URL('./LyricsAppearanceCustomizer.vue', import.meta.url),
    'utf8'
  )
  const appearance = readFileSync(
    new URL('../../../shared/lyricsAppearance.ts', import.meta.url),
    'utf8'
  )

  assert.match(source, /import LyricsAppearanceCustomizer/)
  assert.match(source, /个性化歌词/)
  assert.match(source, /:style="lyricStageStyle"/)
  assert.match(source, /\.\.\.lyricStyleVars\('active'\)/)
  assert.match(stage, /--lyric-style-font-family/)
  assert.match(customizer, /普通歌词/)
  assert.match(customizer, /当前歌词/)
  assert.match(customizer, /翻译歌词/)
  assert.match(customizer, /实时预览/)
  assert.match(customizer, /恢复全部默认/)
  assert.match(customizer, /function scheduleSave\(delay = 180\)/)
  assert.match(appearance, /styles: Record<LyricsStyleTarget, LyricsTextStyle>/)
})

test('lyrics delegate virtual layout and scrolling to AMLL rather than native scrolling', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')
  const stage = readFileSync(new URL('./AmlLyricsStage.vue', import.meta.url), 'utf8')
  const lyricsScroll = source.match(/\.lyrics-scroll \{[^}]*\}/)?.[0] ?? ''

  assert.match(lyricsScroll, /overflow: hidden/)
  assert.match(stage, /<LyricPlayer/)
  assert.match(stage, /:lyric-lines="amllLines"/)
  assert.match(stage, /:current-time="currentTimeMs"/)
  assert.doesNotMatch(stage, /align-position=/)
  assert.doesNotMatch(stage, /line-(?:pos-y|scale)-spring-params/)
  assert.doesNotMatch(stage, /--amll-lp-line-width-aspect/)
  assert.doesNotMatch(stage, /--amll-lp-line-padding-x/)
  assert.match(stage, /requestAnimationFrameWithFallback/)
  assert.doesNotMatch(source, /scroll\.scrollTo|scroll\.scrollTop|function followLyricIntoView/)
  assert.doesNotMatch(source, /createLyricViewportController|--lyric-list-offset/)
})

test('clicking a timed lyric seeks directly through AMLL line events', () => {
  const stage = readFileSync(new URL('./AmlLyricsStage.vue', import.meta.url), 'utf8')
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')

  assert.match(stage, /function onLineClick\(event: LyricLineMouseEvent\)/)
  assert.match(
    stage,
    /emit\('seek', Math\.max\(0, line\.startTime \/ 1000 - props\.offsetSeconds\)\)/
  )
  assert.match(source, /@seek="seek"/)
  assert.doesNotMatch(stage, /scrollTo\(/)
})

test('now playing isolates high-frequency playhead updates inside the AMLL adapter', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')
  const stage = readFileSync(new URL('./AmlLyricsStage.vue', import.meta.url), 'utf8')

  assert.match(source, /lyricsLoadState\.value\.status === 'loading'/)
  assert.match(source, /const lyricStageClock = \{/)
  assert.match(source, /snapshot: playbackClockSnapshot/)
  assert.match(source, /positionAt: estimatePlaybackClockPosition/)
  assert.match(source, /<AmlLyricsStage[\s\S]*:clock="lyricStageClock"/)
  assert.match(stage, /function syncCurrentTime\(\)/)
  assert.match(stage, /positionAt\(\)/)
  assert.match(stage, /requestAnimationFrameWithFallback/)
  assert.match(stage, /:word-fade-width=/)
  assert.doesNotMatch(source, /PlayingLyricWords/)
  assert.doesNotMatch(source, /lyric-word--active|te-lyric-word-pulse/)
})

test('now playing and player bar share the same playback singleton', () => {
  const nowPlaying = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')
  const playerBar = readFileSync(new URL('./PlayerBar.vue', import.meta.url), 'utf8')

  assert.match(nowPlaying, /import \{ usePlayerStore \} from '\.\.\/stores\/usePlayerStore'/)
  assert.doesNotMatch(nowPlaying, /usePlaybackQueueStore/)
  assert.match(playerBar, /import \{ usePlayerStore \} from '\.\.\/stores\/usePlayerStore'/)
})

test('renderer playback consumers cannot retain a second playback state after hot reload', () => {
  const playbackConsumers = [
    './AudioVisualizerPanel.vue',
    './LocalDashboard.vue',
    './PlayingMusic.vue',
    './PlayerBar.vue',
    './SettingsPage.vue',
    './SongList.vue',
    './StreamingPage.vue',
    './player-bar/LyricsManagerPanel.vue'
  ]

  for (const component of playbackConsumers) {
    const source = readFileSync(new URL(component, import.meta.url), 'utf8')
    assert.match(source, /import \{[\s\S]*?usePlayerStore[\s\S]*?\} from /, component)
    assert.doesNotMatch(source, /usePlaybackQueueStore/, component)
  }

  const compatibilityExport = readFileSync(
    new URL('../stores/usePlaybackQueueStore.ts', import.meta.url),
    'utf8'
  )
  assert.match(
    compatibilityExport,
    /export \{ usePlayerStore as usePlaybackQueueStore \} from '\.\/usePlayerStore'/
  )
  assert.doesNotMatch(compatibilityExport, /defineStore/)
})

test('player bar artist is a keyboard-accessible navigation button', () => {
  const playerBar = readFileSync(new URL('./PlayerBar.vue', import.meta.url), 'utf8')
  const style = readFileSync(new URL('./player-bar/PlayerBar.css', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')

  assert.match(playerBar, /openArtist: \[\]/)
  assert.match(
    playerBar,
    /<button[\s\S]*?class="player-artist"[\s\S]*?@click\.stop="onArtistClick"/
  )
  assert.match(playerBar, /emit\('openArtist'\)/)
  assert.match(style, /\.player-artist:not\(:disabled\):focus-visible/)
  assert.match(app, /@open-artist="handlePlayerBarArtistClick"/)
  assert.match(app, /onSelectView\('artists', `artist:\$\{trackArtist\}`\)/)
  assert.match(app, /:artist-navigation-request="streamingArtistRequest"/)
})

test('player bar remounts the progress control for every queue entry', () => {
  const source = readFileSync(new URL('./PlayerBar.vue', import.meta.url), 'utf8')

  assert.match(
    source,
    /:key="`progress:\$\{currentTrack\.id\}:\$\{currentTrack\.queueEntryId \|\| ''\}`"/
  )
})

test('player bar smooths progress between player store ticks and snaps large jumps', () => {
  const source = readFileSync(new URL('./PlayerBar.vue', import.meta.url), 'utf8')

  assert.match(source, /useSmoothedValue\(progressPercent, \{\s*tau: 160,\s*snapThreshold: 2\.5/)
  assert.match(
    source,
    /width: `\$\{Math\.min\(100, Math\.max\(0, smoothedProgressPercent\.value\)\)\}%`/
  )
})

test('visualizer mode uses a full viewport stage without changing the regular stage cap', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')

  assert.match(source, /class="\['stage', \{ 'stage--visualizer': viewMode === 'visualizer' \}\]"/)
  assert.match(source, /\.stage \{[\s\S]*width: min\(100%, 1560px\)/)
  assert.match(source, /\.stage--visualizer \{[\s\S]*width: 100vw/)
  assert.match(source, /\.stage--visualizer \{[\s\S]*height: 100vh/)
  assert.match(source, /\.stage--visualizer \{[\s\S]*max-width: none/)
  assert.match(source, /\.stage--visualizer \{[\s\S]*padding: 0/)
  assert.match(source, /\.stage--visualizer \{[\s\S]*margin: 0/)
})

test('visualizer toggle sits top-left with the frosted time-chip style', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')

  assert.match(
    source,
    /:class="\{ 'visualizer-toggle-button--close': viewMode === 'visualizer' \}"/
  )
  assert.match(source, /\.visualizer-toggle-button \{[\s\S]*top: 42px[\s\S]*left: 42px/)
  assert.match(source, /\.visualizer-toggle-button \{[\s\S]*border-radius: 999px/)
  assert.match(
    source,
    /\.visualizer-toggle-button \{[\s\S]*background: var\(--te-playback-control-surface, rgba\(255, 255, 255, 0\.08\)\)/
  )
  assert.match(
    source,
    /\.visualizer-toggle-button \{[\s\S]*border: 1px solid var\(--te-playback-control-border, rgba\(255, 255, 255, 0\.1\)\)/
  )
  assert.match(source, /\.visualizer-toggle-button--close \{[\s\S]*z-index: 10000/)
  assert.doesNotMatch(source, /\.visualizer-toggle-button--close\s*\{[^}]*\b(?:top|left|right)\s*:/)
  assert.match(
    source,
    /\.visualizer-toggle-button--close:hover \{[\s\S]*background: var\(--te-playback-control-hover-surface, rgba\(255, 255, 255, 0\.14\)\)/
  )
  assert.doesNotMatch(source, /\.visualizer-toggle-button--close \{[^}]*border-radius: 0/)
  assert.doesNotMatch(source, /title-bar-left-controls/)
  assert.doesNotMatch(source, /lyric-manage-button/)
  assert.doesNotMatch(source, /lyric-manager-backdrop/)
})

test('playbar lyrics section hosts the lyrics manager panel', () => {
  const sidebar = readFileSync(new URL('./player-bar/HiFiSidebar.vue', import.meta.url), 'utf8')
  const playerBar = readFileSync(new URL('./PlayerBar.vue', import.meta.url), 'utf8')
  const panel = readFileSync(
    new URL('./player-bar/LyricsManagerPanel.vue', import.meta.url),
    'utf8'
  )

  assert.match(sidebar, /import LyricsManagerPanel from '\.\/LyricsManagerPanel\.vue'/)
  assert.match(sidebar, /<LyricsManagerPanel \/>/)
  assert.match(panel, /class="lyric-manager lyric-manager--panel"/)
  assert.match(panel, /保存歌词/)
  assert.match(panel, /导入 LRC/)
  assert.match(sidebar, /class="deck-lyric-source-controls"/)
  assert.match(sidebar, /:value="originalLayerSelection"/)
  assert.match(sidebar, /:value="translationLayerSelection"/)
  assert.match(sidebar, /@click="emit\('toggleTranslationVisibility'\)"/)
  assert.match(playerBar, /:show-translation="showTranslation"/)
  assert.match(playerBar, /@set-lyric-layer-selection="setLyricLayerSelection"/)
  assert.match(playerBar, /@toggle-translation-visibility="toggleTranslationVisibility"/)
})

test('desktop lyrics html exposes lyric source metadata on hover', () => {
  const source = readFileSync(
    new URL('../../../../resources/desktop-lyrics.html', import.meta.url),
    'utf8'
  )

  assert.match(source, /function lyricSourceLabel\(source\)/)
  assert.match(source, /data\.lyricsSource/)
  assert.match(source, /data\.translatedLyricsSource/)
  assert.match(source, /sourceLabel/)
  assert.match(source, /songInfoEl\.title = sourceLabel/)
})

test('phase four layouts only rearrange the existing cover and lyrics instances', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')

  for (const layout of ['full-cover', 'lyrics-focus', 'split', 'minimal']) {
    assert.match(source, new RegExp(`data-te-player-layout='${layout}'`))
  }
  assert.match(source, /@media \(max-width: 1120px\)[\s\S]*data-te-player-layout='split'/)
  assert.match(
    source,
    /data-te-player-layout='minimal'\]\[data-te-visible-player-album-artist='true'\]/
  )
  assert.equal(source.match(/<CoverImg/g)?.length, 2)
  assert.equal(source.match(/class="lyrics-scroll"/g)?.length, 1)
  assert.doesNotMatch(source, /usePlaybackQueueStore/)
})

test('player visibility selectors target stable controls and remove hidden buttons from layout', () => {
  const component = readFileSync(new URL('./PlayerBar.vue', import.meta.url), 'utf8')
  const style = readFileSync(new URL('./player-bar/PlayerBar.css', import.meta.url), 'utf8')

  for (const className of [
    'previous-button',
    'next-button',
    'track-menu-button',
    'player-misc-icon',
    'player-artwork-slot'
  ]) {
    assert.match(component, new RegExp(className))
  }
  assert.match(style, /data-te-visible-previous-button='false'[\s\S]*display: none/)
  assert.match(style, /data-te-visible-next-button='false'/)
  assert.match(style, /data-te-visible-player-track-menu='false'/)
  assert.match(style, /data-te-visible-player-waveform='false'/)
})

test('player volume control opens the volume drawer without toggling mute', () => {
  const source = readFileSync(new URL('./PlayerBar.vue', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /toggleMute/)
  assert.doesNotMatch(source, /onVolumeButtonClick/)
  assert.match(source, /class="[^"]*volume-control-button[^"]*"[\s\S]*@click="toggleVolume"/)
  assert.match(source, /aria-label="音量控制"/)
  assert.match(source, /:aria-expanded="volumeOpen"/)
  assert.doesNotMatch(source, /volume-control-chevron/)
  assert.doesNotMatch(source, /pi-angle-up/)
})

test('timed lyric rows remain click-to-seek controls through AMLL', () => {
  const stage = readFileSync(new URL('./AmlLyricsStage.vue', import.meta.url), 'utf8')
  assert.match(stage, /@line-click="onLineClick"/)
  assert.match(stage, /LyricLineMouseEvent/)
})

test('lyric replacements are rebuilt by AMLL from immutable mapped line data', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')
  const stage = readFileSync(new URL('./AmlLyricsStage.vue', import.meta.url), 'utf8')
  assert.match(source, /:lines="displayLyricLines"/)
  assert.match(stage, /const amllLines = computed<AmlLyricLine\[\]>/)
  assert.match(stage, /converts Twilight Echo's normalized LRC\/YRC model/)
  assert.doesNotMatch(source, /function followLyricIntoView/)
})

test('playbar hover response applies globally while preserving the menu-position transition', () => {
  const style = readFileSync(new URL('./player-bar/PlayerBar.css', import.meta.url), 'utf8')
  const shell = style.match(/\.player-bar-shell \{[\s\S]*?\n\}/)?.[0] ?? ''

  assert.match(shell, /opacity: 0\.15/)
  assert.match(shell, /translate: 0 12px/)
  assert.match(shell, /left 0\.32s var\(--te-ease-soft\)/)
  assert.match(style, /\.player-bar-shell:hover,[\s\S]*?\.player-bar-shell:focus-within/)
  assert.doesNotMatch(style, /data-te-now-playing-active/)
})

test('sung gaps do not add a local flash or interlude pulse over AMLL', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')
  const stage = readFileSync(new URL('./AmlLyricsStage.vue', import.meta.url), 'utf8')
  assert.match(stage, /FmKaba_interludeDots[\s\S]*display: none !important/)
  assert.match(stage, /:playing="clock\.isPlaying\.value"/)
  assert.doesNotMatch(source, /completedLyricIndexInGap|interludeDots|te-lyric-focus/)
})
