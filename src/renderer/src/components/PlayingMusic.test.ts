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

test('now playing lyrics never reveal the global auto-hide scrollbar', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')
  const lyricsScroll = source.match(/\.lyrics-scroll \{[\s\S]*?\n\}/)?.[0] ?? ''
  const webkitScrollbar =
    source.match(/\.lyrics-scroll::-webkit-scrollbar \{[\s\S]*?\n\}/)?.[0] ?? ''
  const webkitThumb =
    source.match(/\.lyrics-scroll::-webkit-scrollbar-thumb \{[\s\S]*?\n\}/)?.[0] ?? ''

  assert.match(lyricsScroll, /scrollbar-width: none !important/)
  assert.match(webkitScrollbar, /display: none !important/)
  assert.match(webkitThumb, /background: transparent !important/)
})

test('visualizer mode does not keep the heavy blurred backdrop mounted', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')

  assert.match(source, /<div v-if="viewMode !== 'visualizer'" class="backdrop"/)
})

test('active lyric uses enlarged text emphasis without a glass surface', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')
  const mainStyle = readFileSync(new URL('../assets/main.css', import.meta.url), 'utf8')
  const activeRow = source.match(/\.lyric-row\.active \{[\s\S]*?\n\}/)?.[0] ?? ''
  const activeText = source.match(/\.lyric-row\.active \.lyric-text \{[\s\S]*?\n\}/)?.[0] ?? ''
  const themeInvariant =
    mainStyle.match(
      /html body \.playing-music button\.lyric-row\.active:not\(\.lyric-row--custom-background\) \{[\s\S]*?\n\}/
    )?.[0] ?? ''

  assert.match(activeRow, /transform: scale\(1\.035\)/)
  assert.match(activeRow, /background:\s*var\(--lyric-style-background, transparent\)/)
  assert.match(activeRow, /border-color: var\(--te-playback-lyric-active-border, transparent\)/)
  assert.match(activeRow, /box-shadow: var\(--te-playback-lyric-active-shadow, none\)/)
  assert.doesNotMatch(activeRow, /linear-gradient/)
  assert.match(
    activeText,
    /font-size:\s*clamp\(\s*12px,\s*var\(--lyric-style-font-size, calc\(var\(--te-lyric-font-size, 18px\) \+ 7px\)\),\s*48px\s*\)/
  )
  assert.match(
    activeText,
    /font-weight: var\(--lyric-style-font-weight, var\(--te-lyric-font-weight, 600\)\)/
  )
  assert.match(activeText, /text-shadow: var\(--lyric-style-highlight, none\)/)
  assert.doesNotMatch(activeText, /color-mix|0 0 10px/)
  assert.match(source, /:deep\(\.lyric-word\) \{[\s\S]*display: inline-block/)
  assert.match(source, /opacity: var\(--lyric-word-highlight-opacity, 0\)/)
  assert.match(source, /clip-path: inset\(0 calc\(100% - var\(--lyric-word-progress\)\) 0 0\)/)
  assert.doesNotMatch(source, /transition: clip-path 250ms linear/)
  assert.doesNotMatch(source, /width: var\(--lyric-word-progress\)/)
  assert.match(themeInvariant, /background: transparent !important/)
  assert.match(themeInvariant, /background-image: none !important/)
  assert.match(themeInvariant, /border-color: transparent !important/)
  assert.match(themeInvariant, /box-shadow: none !important/)
  assert.match(themeInvariant, /backdrop-filter: none !important/)
  assert.match(themeInvariant, /-webkit-backdrop-filter: none !important/)
})

test('now playing exposes independent lyric customization with live persisted preview', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')
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
  assert.match(
    source,
    /:style="lyricStyleVars\(item\.index === activeLyricIndex \? 'active' : 'normal'\)"/
  )
  assert.match(source, /:style="lyricStyleVars\('translation'\)"/)
  assert.match(customizer, /普通歌词/)
  assert.match(customizer, /当前歌词/)
  assert.match(customizer, /翻译歌词/)
  assert.match(customizer, /实时预览/)
  assert.match(customizer, /恢复全部默认/)
  assert.match(customizer, /function scheduleSave\(delay = 180\)/)
  assert.match(customizer, /updateSettings\(\{ lyricsAppearance:/)
  assert.match(customizer, /@media \(max-width: 620px\)/)
  assert.match(appearance, /styles: Record<LyricsStyleTarget, LyricsTextStyle>/)
  assert.match(appearance, /backgroundStyle: LyricsBackgroundStyle/)
  assert.match(appearance, /highlightEffect: LyricsHighlightEffect/)
  assert.match(source, /glow: `0 0 1px[\s\S]*0 0 3px color-mix\(in srgb,[\s\S]*highlightIntensity/)
  assert.doesNotMatch(source, /glow: `0 0 \$\{Math\.round\(8 \+ style\.highlightIntensity/)
})

test('lyric handoff keeps completed lines out of the top layout flow', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')
  const renderedLines =
    source.match(/const renderedLyricLines = computed\(\(\) => \{[\s\S]*?\n\}\)/)?.[0] ?? ''
  assert.match(source, /const LYRIC_SCROLL_DELAY_MS = 140/)
  assert.match(source, /const LYRIC_EXIT_DURATION_MS = 280/)
  assert.match(source, /lyricLeavingIndex\.value = previousIndex/)
  assert.match(source, /scheduleLyricScroll\(index\)/)
  assert.match(source, /class="lyric-row-content"/)
  assert.match(source, /'lyric-row--exiting': item\.index === lyricLeavingIndex/)
  assert.match(renderedLines, /getLyricFocusLineIndices/)
  assert.doesNotMatch(renderedLines, /indices\.push\(lyricLeavingIndex\.value\)/)
  assert.match(
    source,
    /\.lyric-row--exiting \.lyric-row-content\),[\s\S]*\.lyric-row--entering \.lyric-row-content\)[\s\S]*animation: none/
  )
  assert.doesNotMatch(source, /@keyframes te-lyric-line-exit/)
  assert.doesNotMatch(source, /@keyframes te-lyric-line-enter/)
})

test('clicking a timed lyric releases manual scroll lock before seeking', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')
  const jumpToLyric = source.match(
    /function jumpToLyric\(time: number \| null\): void \{[\s\S]*?\n\}/
  )?.[0]

  assert.ok(jumpToLyric)
  assert.match(jumpToLyric, /clearLyricManualScrollTimer\(\)/)
  assert.match(jumpToLyric, /lyricManualScrollLocked = false/)
  assert.match(jumpToLyric, /cancelLyricScrollAnimation\(\)/)
  assert.match(jumpToLyric, /seek\(Math\.max\(0, time - currentLyricOffsetSeconds\.value\)\)/)
  assert.match(source, /class="lyric-row"[\s\S]*@pointerdown\.stop[\s\S]*@click="jumpToLyric/)
})

test('now playing isolates high-frequency playhead updates from the full lyrics list', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')
  const words = readFileSync(new URL('./PlayingLyricWords.vue', import.meta.url), 'utf8')
  const timeChip = readFileSync(new URL('./PlayingMusicTimeChip.vue', import.meta.url), 'utf8')

  assert.match(source, /lyricsLoadState\.value\.status === 'loading'/)
  assert.match(source, /watch\(\s*\[lyricLines, currentTime, currentLyricOffsetSeconds\],/)
  assert.match(source, /Math\.max\(observedTime, predictedLyricTime\)/)
  assert.match(source, /function scheduleLyricIndexBoundary\(\): void/)
  assert.match(source, /clearLyricIndexTimer\(\)/)
  assert.match(source, /function advanceActiveLyricIndex\(time: number\): void/)
  assert.match(source, /const lyricWordClock = \{ currentTime, isPlaying, playbackRate \}/)
  assert.match(source, /<PlayingLyricWords[\s\S]*:clock="lyricWordClock"/)
  assert.match(source, /:next-line-time="displayLyricLines\[item\.index \+ 1\]\?\.time \?\? null"/)
  assert.match(source, /@reach-next-line="advanceActiveLyricIndex"/)
  assert.match(source, /getLyricFocusLineIndices/)
  assert.match(source, /manualLyricBrowse/)
  assert.match(source, /lyrics-column--karaoke-disabled/)
  assert.match(source, /<PlayingMusicTimeChip/)
  assert.doesNotMatch(source, /formatTime\(currentTime\)/)
  assert.doesNotMatch(source, /findActiveWordIndex/)
  assert.doesNotMatch(words, /usePlayerStore/)
  assert.match(words, /currentTime: Ref<number>/)
  assert.match(words, /isPlaying: Ref<boolean>/)
  assert.match(words, /playbackRate: Ref<number>/)
  assert.match(words, /nextLineTime: number \| null/)
  assert.match(words, /karaokeEnabled: boolean/)
  assert.match(words, /defineEmits<\{ reachNextLine: \[time: number\] \}>\(\)/)
  assert.match(words, /window\.requestAnimationFrame\(animate\)/)
  assert.match(words, /clockAnchorPosition \+ Math\.max\(0, now - clockAnchorTime\)/)
  assert.match(words, /if \(isSeek\) syncAllWords\(time\)/)
  assert.match(words, /else updateProgressingWord\(time\)/)
  assert.match(words, /function bindPlaybackClock\(\): void/)
  assert.match(words, /function updateLineBoundary\(time: number\): void/)
  assert.match(words, /emit\('reachNextLine', time\)/)
  assert.match(words, /if \(!props\.active\) return[\s\S]*stopClockWatch = watch/)
  assert.match(words, /function unbindPlaybackClock\(\): void/)
  assert.match(words, /if \(nextIndex >= 0\) setWordProgress\(nextIndex/)
  assert.match(words, /dataset\.progressing = 'true'/)
  assert.match(
    source,
    /lyric-word\[data-progressing='true'\]\)::after[\s\S]*will-change: clip-path/
  )
  assert.match(words, /getLyricWordProgress\(/)
  assert.match(words, /--lyric-word-highlight-opacity', progress > 0 \? '1' : '0'/)
  assert.match(words, /data-word-text/)
  assert.doesNotMatch(words, /findActiveWordIndex|activeWordIndex|lyric-word--active/)
  assert.doesNotMatch(source, /lyric-word--active|te-lyric-word-pulse/)
  assert.match(timeChip, /const \{ currentTime, duration, formatTime \} = usePlayerStore\(\)/)
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
  assert.match(source, /\.visualizer-toggle-button--close \{[\s\S]*top: 8px[\s\S]*left: 14px/)
  assert.match(source, /\.visualizer-toggle-button--close \{[\s\S]*right: auto/)
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
  assert.match(sidebar, /<strong>当前歌词高光<\/strong>/)
  assert.match(sidebar, /:aria-checked="lyricHighlightOn"/)
  assert.match(sidebar, /@click="emit\('toggleLyricHighlight'\)"/)
  assert.match(playerBar, /const lyricHighlightOn = computed/)
  assert.match(playerBar, /lyricsAppearance\.styles\.active\.highlightEffect === 'glow'/)
  assert.match(playerBar, /lyricsAppearance\.styles\.active\.highlightEffect =/)
  assert.match(playerBar, /await updateSettings\(\{ lyricsAppearance \}\)/)
  assert.match(playerBar, /:lyric-highlight-on="lyricHighlightOn"/)
  assert.match(playerBar, /@set-lyric-layer-selection="setLyricLayerSelection"/)
  assert.match(playerBar, /@toggle-translation-visibility="toggleTranslationVisibility"/)
  assert.match(playerBar, /@toggle-lyric-highlight="toggleLyricHighlight"/)
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
