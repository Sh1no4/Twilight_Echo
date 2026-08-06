<script lang="ts">
const lyricScrollPositions = new Map<string, number>()
</script>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type ComponentPublicInstance
} from 'vue'
import { storeToRefs } from 'pinia'
import { usePlayerStore } from '../stores/usePlayerStore'
import { useVisualizationStore } from '../stores/useVisualizationStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useLyricsManagement } from '../stores/lyricsManagement'
import CoverImg from './CoverImg.vue'
import { buildLyricLines, findActiveLyricIndex } from '../utils/lyrics'
import type { LyricLine } from '../utils/lyrics'
import { getLyricFocusLineIndices } from '../utils/lyricFocusWindow'
import { projectLyricDisplay, projectManagedLyrics } from '../../../shared/lyricsManagement.ts'
import AudioVisualizerPanel from './AudioVisualizerPanel.vue'
import PlayingLyricWords from './PlayingLyricWords.vue'
import PlayingMusicTimeChip from './PlayingMusicTimeChip.vue'
import LyricsAppearanceCustomizer from './LyricsAppearanceCustomizer.vue'
import {
  resolveLyricsFontFamily,
  type LyricsHighlightEffect,
  type LyricsStyleTarget
} from '../../../shared/lyricsAppearance.ts'

const playbackStore = usePlayerStore()
const visualizationStore = useVisualizationStore()
const { currentTrack, dominantColor, currentTime, lyricsLoadState, isPlaying, playbackRate } =
  playbackStore
const lyricWordClock = { currentTime, isPlaying, playbackRate }
const { visualizerActive } = storeToRefs(visualizationStore)
const { seek } = playbackStore
const { settings } = useSettingsStore()
const lyricsManagement = useLyricsManagement()
const emit = defineEmits<{ customizeAppearance: [] }>()
const appearanceMenuOpen = ref(false)
const appearanceMenuPosition = ref({ x: 0, y: 0 })

function openAppearanceMenu(event: MouseEvent): void {
  appearanceMenuPosition.value = {
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 210)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 52))
  }
  appearanceMenuOpen.value = true
}

function closeAppearanceMenu(): void {
  appearanceMenuOpen.value = false
}

function customizePlayerAppearance(): void {
  closeAppearanceMenu()
  emit('customizeAppearance')
}

function customizeLyricsAppearance(): void {
  closeAppearanceMenu()
  lyricsCustomizerOpen.value = true
}

const nowPlayingBackground = computed(() => settings.value.nowPlayingBackground)
const lyricsAppearance = computed(() => settings.value.lyricsAppearance)
const lyricAlign = computed(() => lyricsAppearance.value.align)
const lyricsCustomizerOpen = ref(false)

const lyricTextStyle = computed(() => lyricsAppearance.value.styles)

function lyricStyleVars(target: LyricsStyleTarget): Record<string, string> {
  const style = lyricTextStyle.value[target]
  const color =
    style.colorMode === 'custom'
      ? style.color
      : target === 'active'
        ? 'var(--te-playback-lyric-active-text, #fff)'
        : target === 'translation'
          ? 'var(--te-playback-lyric-translation, rgba(255, 255, 255, 0.58))'
          : 'var(--te-playback-lyric-text, rgba(255, 255, 255, 0.42))'
  const background =
    style.backgroundStyle === 'none'
      ? target === 'active'
        ? 'var(--te-playback-lyric-active-surface, transparent)'
        : 'transparent'
      : `color-mix(in srgb, ${style.backgroundColor} ${style.backgroundOpacity}%, transparent)`
  const highlight = style.highlightColor
  const highlightEffect: Record<LyricsHighlightEffect, string> = {
    none: 'none',
    shadow: `0 3px ${Math.round(6 + style.highlightIntensity * 0.14)}px color-mix(in srgb, ${highlight} 45%, transparent)`,
    glow: `0 0 ${Math.round(8 + style.highlightIntensity * 0.22)}px color-mix(in srgb, ${highlight} 58%, transparent)`,
    outline: `0 0 1px ${highlight}, 0 0 ${Math.round(2 + style.highlightIntensity * 0.08)}px ${highlight}`
  }
  const backgroundImage =
    style.backgroundStyle === 'gradient'
      ? `linear-gradient(135deg, ${background}, transparent)`
      : 'none'
  const backdropFilter = style.backgroundStyle === 'glass' ? 'blur(16px) saturate(130%)' : 'none'
  return {
    '--lyric-style-font-family': resolveLyricsFontFamily(style),
    '--lyric-style-font-size': `${style.fontSize}px`,
    '--lyric-style-font-weight': String(style.fontWeight),
    '--lyric-style-line-height': String(style.lineHeight),
    '--lyric-style-align': style.align,
    '--lyric-style-color': color,
    '--lyric-style-opacity': String(style.opacity / 100),
    '--lyric-style-background': background,
    '--lyric-style-background-image': backgroundImage,
    '--lyric-style-backdrop-filter': backdropFilter,
    '--lyric-style-highlight': highlightEffect[style.highlightEffect]
  }
}

const isBlurBackground = computed(() => nowPlayingBackground.value === 'blur')
const isFluidBackground = computed(() => nowPlayingBackground.value === 'fluid')
const isSolidBackground = computed(() => nowPlayingBackground.value === 'solid')

const lyricAlignClass = computed(() => `lyric-align-${lyricAlign.value}`)
const lyricStyle = computed<Record<string, string>>(() => {
  const appearance = lyricsAppearance.value
  const styles: Record<string, string> = {
    '--te-lyric-font-size': `${appearance.fontSize}px`,
    '--te-lyric-font-weight': String(appearance.fontWeight),
    '--te-lyric-line-height': String(appearance.lineHeight),
    '--lyric-dim': String(appearance.inactiveOpacity / 100)
  }

  if (appearance.fontFamily !== 'inherit') {
    const fontFamily = {
      system: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif",
      inter: "'Inter', 'MiSans', 'Microsoft YaHei', sans-serif",
      lxgw: "'LXGW WenKai', 'MiSans', 'Microsoft YaHei', sans-serif",
      sarasa: "'Sarasa Gothic SC', 'MiSans', 'Microsoft YaHei', sans-serif",
      comic: "'Comic Sans MS', 'MiSans', 'Microsoft YaHei', sans-serif"
    }[appearance.fontFamily]
    styles['--te-lyric-font-family'] = fontFamily
  }

  if (appearance.colorMode === 'custom') {
    styles['--te-playback-lyric-text'] = appearance.textColor
    styles['--te-playback-lyric-active-text'] = appearance.activeColor
    styles['--te-playback-lyric-karaoke'] = appearance.karaokeColor
    styles['--te-playback-lyric-translation'] =
      `color-mix(in srgb, ${appearance.textColor} 72%, transparent)`
    styles['--te-playback-lyric-translation-active'] =
      `color-mix(in srgb, ${appearance.activeColor} 82%, transparent)`
    styles['--te-playback-lyric-romanization'] =
      `color-mix(in srgb, ${appearance.textColor} 58%, transparent)`
    styles['--te-playback-lyric-romanization-active'] =
      `color-mix(in srgb, ${appearance.activeColor} 72%, transparent)`
  }

  return styles
})

// Visualizer toggle: replaces the cover+lyrics layout with the native-engine
// spectrum visualizer surface.
const viewMode = ref<'cover' | 'visualizer'>('cover')
function toggleVisualizer(): void {
  viewMode.value = viewMode.value === 'cover' ? 'visualizer' : 'cover'
}
// Mirror viewMode into the player store so App.vue can hide the PlayerBar while
// the visualizer surface is active.
watch(
  viewMode,
  (mode) => {
    visualizerActive.value = mode === 'visualizer'
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  visualizerActive.value = false
})

const coverIdentity = computed(
  () =>
    `${currentTrack.value?.id ?? 'none'}:${currentTrack.value?.cover ?? ''}:${currentTrack.value?.coverSource ?? ''}`
)
const lyricsEl = ref<HTMLElement | null>(null)
const lyricLineEls = new Map<number, HTMLElement>()
let lyricScrollRaf = 0
let lyricScrollDelayTimer = 0
let lyricCenterTimer = 0
let lyricManualScrollTimer = 0
let lyricManualScrollLocked = false
let lyricResizeObserver: ResizeObserver | null = null
let restoringLyricScroll = false
const LYRIC_SCROLL_DURATION_MS = 420
const LYRIC_RESIZE_SCROLL_DURATION_MS = 260
const LYRIC_SCROLL_DELAY_MS = 140
const LYRIC_EXIT_DURATION_MS = 280
const LYRIC_MANUAL_RETURN_DELAY_MS = 3000
const LYRIC_ACTIVE_ANCHOR_RATIO = 0.58

function currentTrackId(): string {
  return currentTrack.value?.id ?? ''
}

function saveLyricScrollPosition(trackId = currentTrackId()): void {
  const el = lyricsEl.value
  if (!trackId || !el) return
  lyricScrollPositions.set(trackId, el.scrollTop)
}

function restoreLyricScrollPosition(): boolean {
  const trackId = currentTrackId()
  const el = lyricsEl.value
  if (!trackId || !el || !lyricScrollPositions.has(trackId)) return false

  const savedTop = lyricScrollPositions.get(trackId) ?? 0
  const maxTop = Math.max(0, el.scrollHeight - el.clientHeight)
  restoringLyricScroll = true
  cancelLyricScrollAnimation()
  clearLyricManualScrollTimer()
  lyricManualScrollLocked = true
  el.scrollTo({ top: Math.min(maxTop, Math.max(0, savedTop)), behavior: 'auto' })
  window.requestAnimationFrame(() => {
    restoringLyricScroll = false
  })
  return true
}

async function restoreOrCenterLyrics(): Promise<void> {
  await nextTick()
  // Use rAF to ensure the DOM layout is fully computed before measuring
  // element positions. On re-mount, nextTick resolves after Vue's virtual
  // DOM patch but the browser may not have performed layout yet.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  manualLyricBrowse.value = false
  lyricManualScrollLocked = false
  cancelLyricScrollAnimation()
  if (activeLyricIndex.value >= 0) {
    // Retry up to 3 frames in case lyricLineEls isn't populated yet
    for (let attempt = 0; attempt < 3; attempt++) {
      if (lyricLineEls.has(activeLyricIndex.value)) {
        focusLyricLine(activeLyricIndex.value, 0)
        return
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
    // Final attempt without duration constraint
    focusLyricLine(activeLyricIndex.value)
  } else if (lyricsEl.value) {
    lyricsEl.value.scrollTo({ top: 0, behavior: 'auto' })
  }
}

watch(
  () =>
    [
      currentTrack.value?.id,
      currentTrack.value?.lyrics,
      currentTrack.value?.translatedLyrics
    ] as const,
  async ([id], previous) => {
    const [prevId, prevLyrics, prevTranslatedLyrics] = previous ?? []

    if (id !== prevId) {
      if (prevId) {
        saveLyricScrollPosition(prevId)
      }
      cancelLyricTransition()
      cancelLyricScrollAnimation()
      manualLyricBrowse.value = Boolean(id && lyricScrollPositions.has(id))
      lyricLineEls.clear()
      await nextTick()
      if (lyricsEl.value) {
        if (restoreLyricScrollPosition()) {
          scheduleLyricReturnToCenter()
        } else {
          lyricManualScrollLocked = false
          if (activeLyricIndex.value >= 0) {
            focusLyricLine(activeLyricIndex.value)
          } else {
            lyricsEl.value.scrollTo({ top: 0, behavior: 'auto' })
          }
        }
      }
      return
    }

    if (
      currentTrack.value &&
      (currentTrack.value.lyrics !== prevLyrics ||
        currentTrack.value.translatedLyrics !== prevTranslatedLyrics)
    ) {
      cancelLyricTransition()
      await nextTick()
      if (activeLyricIndex.value >= 0) {
        focusLyricLine(activeLyricIndex.value)
      }
    }
  }
)

onBeforeUnmount(() => {
  saveLyricScrollPosition()
  clearLyricIndexTimer()
  clearLyricHighlightTimer()
  cancelLyricScrollAnimation()
  if (lyricCenterTimer !== 0) {
    window.clearTimeout(lyricCenterTimer)
    lyricCenterTimer = 0
  }
  clearLyricManualScrollTimer()
  cancelLyricTransition()
  lyricResizeObserver?.disconnect()
  lyricResizeObserver = null
})

const lyricVisibility = computed(() => lyricsManagement.document.value)
const managedLyricOverride = computed(() => lyricsManagement.entryFor(currentTrack.value?.id ?? ''))
const managedLyrics = computed(() =>
  projectManagedLyrics(
    {
      original: currentTrack.value?.lyrics,
      translation: currentTrack.value?.translatedLyrics,
      romanization: currentTrack.value?.romanizedLyrics,
      originalSource: currentTrack.value?.lyricsSource,
      translationSource: currentTrack.value?.translatedLyricsSource,
      romanizationSource: currentTrack.value?.romanizedLyricsSource
    },
    managedLyricOverride.value
  )
)
const lyricLines = computed<LyricLine[]>(() => {
  return buildLyricLines(
    managedLyrics.value.original,
    managedLyrics.value.translation,
    managedLyrics.value.romanization
  )
})
const displayLyricLines = computed<LyricLine[]>(() =>
  lyricLines.value.map((line) => ({ ...line, ...projectLyricDisplay(line, lyricVisibility.value) }))
)
const currentLyricOffsetSeconds = computed(() =>
  lyricsManagement.effectiveOffsetSeconds(currentTrack.value?.id ?? '')
)

const hasLyrics = computed(() => lyricLines.value.length > 0)
const lyricsStillLoading = computed(
  () =>
    !hasLyrics.value &&
    lyricsLoadState.value.trackId === currentTrack.value?.id &&
    lyricsLoadState.value.status === 'loading'
)
const lyricsPendingLabel = computed(() => (lyricsStillLoading.value ? '加载歌词…' : '暂无歌词'))
const reserveLyricsColumn = computed(() => hasLyrics.value || lyricsStillLoading.value)
const activeLyricIndex = ref(-1)
const highlightedLyricIndex = ref(-1)
const manualLyricBrowse = ref(false)
const lyricLeavingIndex = ref(-1)
const lyricEnteringIndex = ref(-1)
let lyricTransitionTimer = 0
let lyricIndexTimer = 0
let lyricHighlightTimer = 0
let lastObservedLyricTime = Number.NaN
let predictedLyricTime = Number.NEGATIVE_INFINITY

function resetPredictedLyricTime(): void {
  lastObservedLyricTime = Number.NaN
  predictedLyricTime = Number.NEGATIVE_INFINITY
}

function lyricTime(position = currentTime.value): number {
  return position + currentLyricOffsetSeconds.value
}

function syncActiveLyricIndex(time = currentTime.value): void {
  const observedTime = lyricTime(time)
  if (observedTime < lastObservedLyricTime) predictedLyricTime = Number.NEGATIVE_INFINITY
  lastObservedLyricTime = observedTime
  const nextIndex = findActiveLyricIndex(
    lyricLines.value,
    Math.max(observedTime, predictedLyricTime)
  )
  if (nextIndex !== activeLyricIndex.value) activeLyricIndex.value = nextIndex
}

function clearLyricIndexTimer(): void {
  if (lyricIndexTimer !== 0) {
    window.clearTimeout(lyricIndexTimer)
    lyricIndexTimer = 0
  }
}

function clearLyricHighlightTimer(): void {
  if (lyricHighlightTimer !== 0) {
    window.clearTimeout(lyricHighlightTimer)
    lyricHighlightTimer = 0
  }
}

function scheduleLyricIndexBoundary(): void {
  clearLyricIndexTimer()
  if (!isPlaying.value) return

  const rate = Number.isFinite(playbackRate.value) ? playbackRate.value : 1
  if (rate <= 0) return

  const referenceTime = Math.max(lyricTime(), predictedLyricTime)
  let nextTime: number | null = null
  for (
    let index = Math.max(0, activeLyricIndex.value + 1);
    index < lyricLines.value.length;
    index += 1
  ) {
    const time = lyricLines.value[index].time
    if (time != null && time > referenceTime + 0.0001) {
      nextTime = time
      break
    }
  }
  if (nextTime == null) return

  const delay = Math.max(0, ((nextTime - referenceTime) / rate) * 1000)
  lyricIndexTimer = window.setTimeout(() => {
    lyricIndexTimer = 0
    if (!isPlaying.value) return
    predictedLyricTime = Math.max(predictedLyricTime, nextTime)
    syncActiveLyricIndex()
    scheduleLyricIndexBoundary()
  }, delay)
}

watch(
  [lyricLines, currentTime, currentLyricOffsetSeconds],
  ([lines, _time, offsetSeconds], previous) => {
    if (previous && (lines !== previous[0] || offsetSeconds !== previous[2])) {
      resetPredictedLyricTime()
    }
    syncActiveLyricIndex()
    scheduleLyricIndexBoundary()
  },
  { immediate: true }
)

watch([isPlaying, playbackRate], () => {
  scheduleLyricIndexBoundary()
})

watch(activeLyricIndex, (index, previousIndex) => {
  clearLyricHighlightTimer()
  if (index < 0 || previousIndex == null || previousIndex < 0 || index <= previousIndex) {
    highlightedLyricIndex.value = index
    return
  }
  lyricHighlightTimer = window.setTimeout(() => {
    lyricHighlightTimer = 0
    if (activeLyricIndex.value === index) highlightedLyricIndex.value = index
  }, LYRIC_SCROLL_DELAY_MS)
})

watch(
  () => currentTrack.value?.id,
  () => {
    clearLyricHighlightTimer()
    highlightedLyricIndex.value = activeLyricIndex.value
  }
)

function advanceActiveLyricIndex(time: number): void {
  if (!Number.isFinite(time)) return
  predictedLyricTime = Math.max(predictedLyricTime, time)
  syncActiveLyricIndex()
  scheduleLyricIndexBoundary()
}

const renderedLyricLines = computed(() => {
  const lines = displayLyricLines.value
  const indices = manualLyricBrowse.value
    ? lines.map((_line, index) => index)
    : getLyricFocusLineIndices(
        lines.length,
        activeLyricIndex.value,
        lyricsAppearance.value.focusLineCount
      )

  // Keep the compact focus window authoritative during lyric handoff. Re-inserting
  // a completed line after it leaves this window makes it a new flex item at the
  // top of the list until the exit timer ends, which briefly stacks old lyrics.
  // Lines that remain inside the window still receive the exiting class below.
  return indices.map((index) => ({ index, line: lines[index] }))
})

function setLyricLineRef(index: number, el: Element | ComponentPublicInstance | null): void {
  if (el instanceof HTMLElement) {
    lyricLineEls.set(index, el)
    return
  }
  lyricLineEls.delete(index)
}

function lyricTone(index: number): 'idle' | 'far' | 'mid' | 'near' | 'active' {
  const active = highlightedLyricIndex.value
  if (active < 0) return 'idle'

  const distance = Math.abs(index - active)
  if (distance === 0) return 'active'
  if (distance === 1) return 'near'
  if (distance === 2) return 'mid'
  return 'far'
}

function jumpToLyric(time: number | null): void {
  if (time == null) return
  clearLyricManualScrollTimer()
  cancelLyricTransition()
  manualLyricBrowse.value = false
  lyricManualScrollLocked = false
  cancelLyricScrollAnimation()
  seek(Math.max(0, time - currentLyricOffsetSeconds.value))
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function cancelLyricScrollAnimation(): void {
  if (lyricScrollRaf !== 0) {
    window.cancelAnimationFrame(lyricScrollRaf)
    lyricScrollRaf = 0
  }
  if (lyricScrollDelayTimer !== 0) {
    window.clearTimeout(lyricScrollDelayTimer)
    lyricScrollDelayTimer = 0
  }
}

function cancelLyricTransition(): void {
  if (lyricTransitionTimer !== 0) {
    window.clearTimeout(lyricTransitionTimer)
    lyricTransitionTimer = 0
  }
  lyricLeavingIndex.value = -1
  lyricEnteringIndex.value = -1
}

function scheduleLyricTransition(previousIndex: number, nextIndex: number): void {
  cancelLyricTransition()
  lyricLeavingIndex.value = previousIndex
  lyricEnteringIndex.value = nextIndex
  lyricTransitionTimer = window.setTimeout(
    () => {
      lyricTransitionTimer = 0
      lyricLeavingIndex.value = -1
      lyricEnteringIndex.value = -1
    },
    LYRIC_SCROLL_DELAY_MS + LYRIC_EXIT_DURATION_MS + 80
  )
}

function scheduleLyricScroll(index: number): void {
  if (lyricScrollDelayTimer !== 0) {
    window.clearTimeout(lyricScrollDelayTimer)
  }
  lyricScrollDelayTimer = window.setTimeout(async () => {
    lyricScrollDelayTimer = 0
    if (activeLyricIndex.value !== index || lyricManualScrollLocked) return
    await nextTick()
    if (activeLyricIndex.value === index && !lyricManualScrollLocked) {
      focusLyricLine(index)
    }
  }, LYRIC_SCROLL_DELAY_MS)
}

function getLyricTargetTop(index: number): number | null {
  const container = lyricsEl.value
  const line = lyricLineEls.get(index)

  if (!container || !line) return null

  // Use offsetTop traversal instead of getBoundingClientRect().
  // getBoundingClientRect() returns positions affected by CSS transforms
  // (e.g. the scale(0.12) transition on the parent .playing-music), which
  // gives incorrect scroll targets during the enter/leave animation.
  // offsetTop / offsetHeight are layout properties unaffected by transforms.
  let lineOffsetTop = 0
  let current: HTMLElement | null = line
  while (current && current !== container) {
    lineOffsetTop += current.offsetTop
    current = current.offsetParent as HTMLElement | null
  }

  const targetTop =
    lineOffsetTop - (container.clientHeight - line.offsetHeight) * LYRIC_ACTIVE_ANCHOR_RATIO
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight)

  return Math.min(maxTop, Math.max(0, targetTop))
}

function animateLyricScrollTo(targetTop: number, duration: number): void {
  const container = lyricsEl.value
  if (!container) return

  cancelLyricScrollAnimation()

  const startTop = container.scrollTop
  const distance = targetTop - startTop

  if (Math.abs(distance) < 0.5 || duration <= 0) {
    container.scrollTop = targetTop
    return
  }

  const startAt = performance.now()
  const step = (now: number): void => {
    const progress = Math.min(1, (now - startAt) / duration)
    container.scrollTop = startTop + distance * easeOutCubic(progress)

    if (progress < 1) {
      lyricScrollRaf = window.requestAnimationFrame(step)
      return
    }

    container.scrollTop = targetTop
    lyricScrollRaf = 0
  }

  lyricScrollRaf = window.requestAnimationFrame(step)
}

function focusLyricLine(index: number, duration = LYRIC_SCROLL_DURATION_MS): void {
  const targetTop = getLyricTargetTop(index)
  if (targetTop == null) return
  animateLyricScrollTo(targetTop, duration)
}

async function centerActiveLyric(duration = LYRIC_RESIZE_SCROLL_DURATION_MS): Promise<void> {
  await nextTick()
  if (activeLyricIndex.value >= 0) {
    focusLyricLine(activeLyricIndex.value, duration)
  }
}

function clearLyricManualScrollTimer(): void {
  if (lyricManualScrollTimer !== 0) {
    window.clearTimeout(lyricManualScrollTimer)
    lyricManualScrollTimer = 0
  }
}

function scheduleLyricReturnToCenter(): void {
  clearLyricManualScrollTimer()
  lyricManualScrollTimer = window.setTimeout(async () => {
    lyricManualScrollTimer = 0
    manualLyricBrowse.value = false
    lyricManualScrollLocked = false
    await nextTick()
    if (activeLyricIndex.value >= 0) {
      focusLyricLine(activeLyricIndex.value)
    }
  }, LYRIC_MANUAL_RETURN_DELAY_MS)
}

function onLyricsManualScroll(): void {
  manualLyricBrowse.value = true
  lyricManualScrollLocked = true
  cancelLyricTransition()
  cancelLyricScrollAnimation()
  saveLyricScrollPosition()
  scheduleLyricReturnToCenter()
}

function onLyricsScroll(): void {
  if (restoringLyricScroll) return
  if (lyricManualScrollLocked) {
    saveLyricScrollPosition()
  }
}

function scheduleActiveLyricCenter(duration = LYRIC_RESIZE_SCROLL_DURATION_MS, delay = 80): void {
  if (lyricCenterTimer !== 0) {
    window.clearTimeout(lyricCenterTimer)
  }

  lyricCenterTimer = window.setTimeout(() => {
    lyricCenterTimer = 0
    void centerActiveLyric(duration)
  }, delay)
}

function onLyricLayoutResize(): void {
  if (lyricManualScrollLocked) return
  scheduleActiveLyricCenter()
}

watch(activeLyricIndex, async (index, previousIndex) => {
  if (index < 0) return
  if (lyricManualScrollLocked) {
    cancelLyricTransition()
    cancelLyricScrollAnimation()
    return
  }
  if (previousIndex != null && previousIndex >= 0 && index > previousIndex) {
    cancelLyricScrollAnimation()
    scheduleLyricTransition(previousIndex, index)
    scheduleLyricScroll(index)
    return
  }
  cancelLyricTransition()
  cancelLyricScrollAnimation()
  await nextTick()
  focusLyricLine(index)
})

watch(
  () => lyricsAppearance.value.focusLineCount,
  async () => {
    if (lyricManualScrollLocked) return
    cancelLyricTransition()
    await nextTick()
    if (activeLyricIndex.value >= 0) focusLyricLine(activeLyricIndex.value, 0)
  }
)

watch(lyricsEl, (el, previousEl) => {
  if (previousEl) {
    lyricResizeObserver?.unobserve(previousEl)
  }
  if (el) {
    lyricResizeObserver?.observe(el)
    void restoreOrCenterLyrics()
  }
})

onMounted(() => {
  void lyricsManagement.ensureLoaded()
  lyricResizeObserver = new ResizeObserver(() => {
    onLyricLayoutResize()
  })
  if (lyricsEl.value) {
    lyricResizeObserver.observe(lyricsEl.value)
  }
  void restoreOrCenterLyrics()
  window.addEventListener('resize', onLyricLayoutResize)
  window.addEventListener('pointerdown', closeAppearanceMenu)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onLyricLayoutResize)
  window.removeEventListener('pointerdown', closeAppearanceMenu)
})
</script>

<template>
  <div
    class="playing-music"
    :class="`bg-${nowPlayingBackground}`"
    :style="{ '--accent-color': dominantColor }"
    @contextmenu.prevent="openAppearanceMenu"
  >
    <button
      type="button"
      class="visualizer-toggle-button"
      :class="{ 'visualizer-toggle-button--close': viewMode === 'visualizer' }"
      :title="viewMode === 'cover' ? '音频可视化' : '返回封面'"
      @click="toggleVisualizer"
    >
      <i :class="viewMode === 'cover' ? 'pi pi-chart-bar' : 'pi pi-times'"></i>
    </button>

    <div v-if="viewMode !== 'visualizer'" class="backdrop" aria-hidden="true">
      <Transition name="backdrop-cover-fade" appear>
        <div
          v-if="isBlurBackground && currentTrack"
          :key="`bg:${coverIdentity}`"
          class="backdrop-cover-wrap"
        >
          <CoverImg
            :cover="currentTrack.cover"
            :cover-source="currentTrack.coverSource"
            :identity="currentTrack.id"
            class="backdrop-cover"
            alt=""
          />
        </div>
      </Transition>
      <div v-if="isFluidBackground" class="backdrop-fluid" />
      <div v-if="isSolidBackground" class="backdrop-solid" />
      <div class="backdrop-scrim" />
      <div class="backdrop-accent" />
    </div>

    <div
      v-if="currentTrack"
      :key="`stage:${coverIdentity}`"
      :class="['stage', { 'stage--visualizer': viewMode === 'visualizer' }]"
    >
      <AudioVisualizerPanel
        v-if="viewMode === 'visualizer'"
        class="visualizer-surface"
        :active="viewMode === 'visualizer'"
      />
      <main v-else class="layout" :class="{ 'layout--single': !reserveLyricsColumn }">
        <section class="cover-column">
          <div class="cover-frame">
            <CoverImg
              v-if="currentTrack.cover || currentTrack.coverSource"
              :cover="currentTrack.cover"
              :cover-source="currentTrack.coverSource"
              :identity="currentTrack.id"
              class="cover-image"
              alt="cover"
            />
            <div v-else class="cover-placeholder">
              <i class="pi pi-wave-pulse"></i>
            </div>
          </div>

          <div class="cover-meta">
            <h1 class="track-title">{{ currentTrack.title }}</h1>
            <p class="track-artist">{{ currentTrack.artist }}</p>
            <p v-if="currentTrack.album" class="track-album">{{ currentTrack.album }}</p>
          </div>
        </section>

        <section
          v-if="reserveLyricsColumn"
          class="lyrics-column"
          :class="{
            'lyrics-column--pending': !hasLyrics,
            'lyrics-column--karaoke-disabled': !lyricsAppearance.karaokeEnabled
          }"
          :style="lyricStyle"
        >
          <div class="lyrics-head">
            <PlayingMusicTimeChip />
          </div>

          <div
            ref="lyricsEl"
            class="lyrics-scroll"
            :class="lyricAlignClass"
            @scroll.passive="onLyricsScroll"
            @wheel.passive="onLyricsManualScroll"
            @pointerdown="onLyricsManualScroll"
            @touchstart.passive="onLyricsManualScroll"
          >
            <div v-if="!hasLyrics" class="lyrics-pending" aria-live="polite">
              {{ lyricsPendingLabel }}
            </div>
            <div v-else class="lyrics-list">
              <!-- The visual target is delayed from activeLyricIndex during line handoff. -->
              <!-- :style="lyricStyleVars(item.index === activeLyricIndex ? 'active' : 'normal')" -->
              <button
                v-for="item in renderedLyricLines"
                :key="`${item.line.time}-${item.index}`"
                :ref="(el) => setLyricLineRef(item.index, el)"
                type="button"
                class="lyric-row"
                :class="[
                  lyricTone(item.index),
                  {
                    'is-plain': !item.line.timed,
                    'lyric-row--custom-background':
                      lyricTextStyle[item.index === highlightedLyricIndex ? 'active' : 'normal']
                        .backgroundStyle !== 'none',
                    'lyric-row--exiting': item.index === lyricLeavingIndex,
                    'lyric-row--entering': item.index === lyricEnteringIndex
                  }
                ]"
                :style="lyricStyleVars(item.index === highlightedLyricIndex ? 'active' : 'normal')"
                :disabled="!item.line.timed"
                @pointerdown.stop
                @click="jumpToLyric(item.line.time)"
              >
                <span class="lyric-row-content">
                  <PlayingLyricWords
                    v-if="item.line.words?.length"
                    :words="item.line.words ?? []"
                    :active="item.index === highlightedLyricIndex"
                    :offset-seconds="currentLyricOffsetSeconds"
                    :next-line-time="displayLyricLines[item.index + 1]?.time ?? null"
                    :clock="lyricWordClock"
                    :karaoke-enabled="lyricsAppearance.karaokeEnabled"
                    @reach-next-line="advanceActiveLyricIndex"
                  />
                  <span v-else-if="item.line.text" class="lyric-text">{{ item.line.text }}</span>
                  <span
                    v-if="item.line.translation"
                    class="lyric-translation"
                    :style="lyricStyleVars('translation')"
                    >{{ item.line.translation }}</span
                  >
                  <span v-if="item.line.romanization" class="lyric-romanization">{{
                    item.line.romanization
                  }}</span>
                </span>
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>

    <div v-else class="empty-shell">
      <div class="empty-state">
        <i class="pi pi-wave-pulse"></i>
        <p>暂无正在播放的歌曲</p>
      </div>
    </div>
    <Teleport to="body">
      <div
        v-if="appearanceMenuOpen"
        class="player-appearance-menu"
        :style="{
          left: `${appearanceMenuPosition.x}px`,
          top: `${appearanceMenuPosition.y}px`
        }"
        @pointerdown.stop
      >
        <button type="button" @click="customizeLyricsAppearance">
          <i class="ph ph-text-aa"></i><span>个性化歌词</span>
        </button>
        <button type="button" @click="customizePlayerAppearance">
          <i class="ph ph-palette"></i><span>定制此区域外观</span>
        </button>
      </div>
    </Teleport>
    <Teleport to="body">
      <LyricsAppearanceCustomizer
        :open="lyricsCustomizerOpen"
        @close="lyricsCustomizerOpen = false"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.playing-music {
  position: fixed;
  inset: 0;
  z-index: 1100;
  overflow: hidden;
  color: var(--te-playback-page-text, #f4f7fb);
  background-color: var(--te-player-bg);
  background-image: var(--te-player-bg-image);
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
  --accent-color: var(--te-playback-accent, #7c4dff);
}

.player-appearance-menu {
  position: fixed;
  z-index: 10000;
  width: 218px;
  padding: 5px;
  border: 1px solid var(--te-card-border);
  border-radius: 6px;
  box-shadow: var(--te-glass-shadow);
  background: var(--te-card-bg);
}

.player-appearance-menu button {
  display: flex;
  width: 100%;
  min-height: 36px;
  align-items: center;
  gap: 9px;
  padding: 0 9px;
  border: 0;
  border-radius: 4px;
  color: var(--te-neutral-900);
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.player-appearance-menu button:hover {
  color: var(--te-primary-500);
  background: var(--te-hover-bg);
}

.backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  background-color: var(--te-player-bg);
  background-image: var(--te-player-bg-image);
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
}

.backdrop-cover-wrap {
  position: absolute;
  inset: 0;
}
.backdrop-cover-wrap :deep(img),
.backdrop-cover {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  transform: scale(1.06);
  transform-origin: center;
  filter: blur(58px) saturate(1.28) brightness(0.42);
  will-change: opacity, transform;
}

/* Light theme: slightly brighter backdrop art so the stage does not crush blacks */
:global(html[data-theme='light'] .playing-music .backdrop-cover-wrap img),
:global(html[data-theme='pureWhite'] .playing-music .backdrop-cover-wrap img) {
  filter: var(--te-playback-backdrop-filter, blur(58px) saturate(1.22) brightness(0.52));
}

:global(html[data-theme='dark'] .playing-music .backdrop-cover-wrap img) {
  filter: var(--te-playback-backdrop-filter, blur(58px) saturate(1.32) brightness(0.36));
}

.backdrop-cover-fade-enter-active,
.backdrop-cover-fade-leave-active {
  transition:
    opacity 0.7s ease,
    transform 0.7s ease;
}

.backdrop-cover-fade-enter-from {
  opacity: 0;
  transform: translateY(-18px) scale(1.09);
}

.backdrop-cover-fade-enter-to {
  opacity: 1;
  transform: translateY(0) scale(1.06);
}

.backdrop-cover-fade-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1.06);
}

.backdrop-cover-fade-leave-to {
  opacity: 0;
  transform: translateY(18px) scale(1.09);
}

.backdrop-scrim {
  position: absolute;
  inset: 0;
  background:
    var(
      --te-playback-backdrop-scrim,
      linear-gradient(
        180deg,
        rgba(5, 7, 11, 0.72) 0%,
        rgba(5, 7, 11, 0.74) 52%,
        rgba(5, 7, 11, 0.78) 100%
      )
    ),
    color-mix(in srgb, var(--accent-color) 8%, transparent);
  backdrop-filter: blur(10px);
}

.backdrop-accent {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(
      circle at 18% 26%,
      color-mix(in srgb, var(--accent-color) 22%, transparent),
      transparent 42%
    ),
    radial-gradient(
      circle at 88% 20%,
      var(--te-playback-backdrop-highlight, rgba(255, 255, 255, 0.12)),
      transparent 26%
    );
  opacity: 0.8;
}

.backdrop-fluid {
  position: absolute;
  inset: 0;
  background: var(
    --te-playback-fluid-bg,
    linear-gradient(135deg, #0f172a, #1e3a5f, #312e81, #1e3a5f, #0f172a)
  );
  background-size: 400% 400%;
  animation: fluid-drift 18s ease-in-out infinite;
}

.backdrop-solid {
  position: absolute;
  inset: 0;
  background-color: var(--te-player-bg);
  background-image: var(--te-player-bg-image);
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
}

@keyframes fluid-drift {
  0%,
  100% {
    background-position: 0% 50%;
  }
  25% {
    background-position: 100% 50%;
  }
  50% {
    background-position: 100% 100%;
  }
  75% {
    background-position: 0% 100%;
  }
}

.stage {
  position: relative;
  z-index: 1;
  width: min(100%, 1560px);
  height: 100%;
  margin: 0 auto;
  padding: 72px 36px 28px;
}

.stage--visualizer {
  width: 100vw;
  height: 100vh;
  max-width: none;
  margin: 0;
  padding: 0;
}

.layout {
  display: grid;
  grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 40px;
  align-items: stretch;
  height: 100%;
  min-height: 0;
}

.layout--single {
  grid-template-columns: minmax(300px, 440px);
  align-content: center;
  justify-content: center;
}

.layout--single .cover-column {
  width: min(100%, 440px);
  justify-self: center;
  transform: none;
}

.layout--single .cover-meta {
  text-align: center;
}

.cover-column {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
  align-self: center;
}

@media (min-width: 1121px) {
  :global(html[data-te-player-layout='standard'] .playing-music .cover-column) {
    transform: translateX(clamp(42px, 5vw, 80px));
  }
}

.cover-frame {
  width: var(--te-playback-cover-size, 100%);
  max-width: 100%;
  margin-inline: auto;
  aspect-ratio: 1;
  border-radius: var(--te-playback-cover-radius, 26px);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
  box-shadow: 0 26px 70px rgba(0, 0, 0, 0.38);
}

:global(html[data-te-motion='full'] .cover-frame) {
  animation: te-playing-artwork-arrive var(--te-motion-page) var(--te-ease-spring) both;
}

@keyframes te-playing-artwork-arrive {
  from {
    opacity: 0;
    scale: 0.9;
  }
}

:global(html[data-theme='dark'] .playing-music .cover-frame) {
  background: var(--te-playback-cover-surface, rgba(15, 23, 42, 0.45));
  box-shadow: var(
    --te-playback-cover-shadow,
    0 26px 70px rgba(0, 0, 0, 0.55),
    inset 0 0 0 1px rgba(255, 255, 255, 0.06)
  );
}

:global(html[data-theme='light'] .playing-music .cover-frame),
:global(html[data-theme='pureWhite'] .playing-music .cover-frame) {
  background: var(--te-playback-cover-surface, rgba(15, 23, 42, 0.08));
  box-shadow: var(--te-playback-cover-shadow, 0 26px 70px rgba(15, 23, 42, 0.28));
}

:global(html[data-te-artwork-shadow='off'] .playing-music .cover-frame) {
  box-shadow: none;
}

.cover-frame :deep(img.cover-image),
.cover-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 68px;
  color: var(--te-playback-cover-placeholder-text, rgba(255, 255, 255, 0.34));
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02)),
    color-mix(in srgb, var(--accent-color) 18%, transparent);
}

:global(html[data-theme='dark'] .playing-music .cover-placeholder) {
  color: var(--te-playback-cover-placeholder-text, rgba(148, 163, 184, 0.55));
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.01)),
    color-mix(in srgb, var(--accent-color) 22%, rgba(15, 23, 42, 0.65));
}

.cover-meta {
  min-width: 0;
}

:global(html[data-te-motion='full'] .cover-meta) {
  animation: te-playing-meta-arrive var(--te-motion-panel) var(--te-ease-spring) 36ms both;
}

@keyframes te-playing-meta-arrive {
  from {
    opacity: 0;
    translate: 0 12px;
  }
}

.track-title {
  margin: 0;
  font-family: var(--te-font-display);
  font-size: 32px;
  font-weight: 400;
  line-height: 1.22;
  color: var(--te-playback-track-title, #fff);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.track-artist {
  margin: 10px 0 0;
  font-family: var(--te-font-rounded);
  font-size: 18px;
  font-weight: 700;
  color: var(--te-playback-track-artist, rgba(255, 255, 255, 0.78));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.track-album {
  margin: 4px 0 0;
  font-family: var(--te-font-rounded);
  font-size: 14px;
  font-weight: 500;
  color: var(--te-playback-track-album, rgba(255, 255, 255, 0.48));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lyrics-column {
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-left: 6px;
  align-self: stretch;
}

:global(html[data-te-motion='full'] .lyrics-column) {
  animation: te-playing-lyrics-arrive var(--te-motion-page) var(--te-ease-spring) 64ms both;
}

@keyframes te-playing-lyrics-arrive {
  from {
    opacity: 0;
    translate: 18px 0;
  }
}

.lyrics-column--pending {
  pointer-events: none;
}

.lyrics-pending {
  flex: 1;
  display: grid;
  place-items: center;
  min-height: 120px;
  color: var(--te-playback-lyric-text, rgba(255, 255, 255, 0.42));
  font-size: 14px;
  letter-spacing: 0.08em;
}

.lyrics-head {
  display: flex;
  align-items: end;
  justify-content: flex-end;
  gap: 16px;
  padding-bottom: 18px;
  min-width: 0;
}

.time-chip {
  flex-shrink: 0;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid var(--te-playback-control-border, rgba(255, 255, 255, 0.1));
  background: var(--te-playback-control-surface, rgba(255, 255, 255, 0.08));
  color: var(--te-playback-control-text, rgba(255, 255, 255, 0.7));
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.lyrics-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 8px;
  -ms-overflow-style: none;
  scrollbar-width: none !important;
  scroll-behavior: auto;
  overscroll-behavior: contain;
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(0, 0, 0, 0.26) 6%,
    rgba(0, 0, 0, 1) 18%,
    rgba(0, 0, 0, 1) 82%,
    rgba(0, 0, 0, 0.26) 94%,
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(0, 0, 0, 0.26) 6%,
    rgba(0, 0, 0, 1) 18%,
    rgba(0, 0, 0, 1) 82%,
    rgba(0, 0, 0, 0.26) 94%,
    transparent 100%
  );
}

.lyrics-scroll::-webkit-scrollbar {
  display: none !important;
  width: 0;
  height: 0;
}

.lyrics-scroll::-webkit-scrollbar-thumb {
  border: 0 !important;
  background: transparent !important;
}

.lyrics-list {
  max-width: 820px;
  margin: 0 auto;
  padding: 16vh 0 22vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.lyric-row {
  width: min(100%, 760px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid transparent;
  border-radius: 18px;
  background: var(--lyric-style-background, transparent);
  background-image: var(--lyric-style-background-image, none);
  backdrop-filter: var(--lyric-style-backdrop-filter, none);
  -webkit-backdrop-filter: var(--lyric-style-backdrop-filter, none);
  padding: 12px 20px;
  font-family: var(--lyric-style-font-family, var(--te-lyric-font-family, inherit));
  font-weight: var(--lyric-style-font-weight, var(--te-lyric-font-weight, 600));
  text-align: var(--lyric-style-align, center);
  cursor: pointer;
  color: var(--lyric-style-color, var(--te-playback-lyric-text, rgba(255, 255, 255, 0.42)));
  transition:
    color var(--te-motion-hover) ease,
    background var(--te-motion-hover) ease,
    opacity var(--te-motion-hover) ease,
    transform var(--te-motion-hover) var(--te-ease-soft);
}

.lyric-row-content {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  overflow: hidden;
}

.lyric-row:hover {
  color: var(--te-playback-lyric-hover-text, rgba(255, 255, 255, 0.74));
}

.lyric-row.idle {
  opacity: calc(var(--lyric-dim, 0.56) * var(--lyric-style-opacity, 1));
}

.lyric-row.far {
  opacity: calc(var(--lyric-dim, 0.56) * var(--lyric-style-opacity, 1) * 0.54);
}

.lyric-row.mid {
  opacity: calc(var(--lyric-dim, 0.56) * var(--lyric-style-opacity, 1) * 0.93);
}

.lyric-row.near {
  opacity: min(1, calc(var(--lyric-dim, 0.56) * var(--lyric-style-opacity, 1) * 1.5));
}

.lyric-row.active {
  opacity: var(--lyric-style-opacity, 1);
  color: var(--lyric-style-color, var(--te-playback-lyric-active-text, #fff));
  transform: scale(1.035);
  background: var(--lyric-style-background, transparent);
  border-color: var(--te-playback-lyric-active-border, transparent);
  box-shadow: var(--te-playback-lyric-active-shadow, none);
}

.lyric-text {
  min-width: 0;
  width: 100%;
  font-size: clamp(12px, var(--lyric-style-font-size, var(--te-lyric-font-size, 18px)), 48px);
  line-height: var(--lyric-style-line-height, var(--te-lyric-line-height, 1.85));
  text-align: var(--lyric-style-align, center);
  word-break: break-word;
}

.lyrics-scroll.lyric-align-left .lyric-text,
.lyrics-scroll.lyric-align-left .lyric-translation,
.lyrics-scroll.lyric-align-left .lyric-romanization {
  text-align: left;
}

.lyric-row.active .lyric-text {
  font-size: clamp(
    12px,
    var(--lyric-style-font-size, calc(var(--te-lyric-font-size, 18px) + 7px)),
    48px
  );
  font-weight: var(--lyric-style-font-weight, var(--te-lyric-font-weight, 600));
  letter-spacing: 0.012em;
  text-shadow: var(
    --lyric-style-highlight,
    0 0 10px color-mix(in srgb, var(--te-playback-lyric-karaoke, #fff8df) 20%, transparent)
  );
}

:global(html[data-te-motion='full'] .lyric-row.active .lyric-text) {
  animation: te-lyric-focus var(--te-motion-panel) var(--te-ease-spring) both;
}

@keyframes te-lyric-focus {
  from {
    opacity: 0.62;
    translate: 0 6px;
  }
}

:global(html[data-te-motion='full'] .lyric-row--exiting) {
  pointer-events: none;
}

:global(html[data-te-motion='full'] .lyric-row--exiting .lyric-row-content) {
  animation: te-lyric-line-exit var(--te-motion-panel) var(--te-ease-soft) both;
}

:global(html[data-te-motion='full'] .lyric-row--entering .lyric-row-content) {
  animation: te-lyric-line-enter var(--te-motion-panel) var(--te-ease-spring) both;
}

@keyframes te-lyric-line-exit {
  from {
    opacity: 1;
    transform: scale(1.035);
  }
  to {
    opacity: 0.2;
    transform: scale(0.98);
  }
}

@keyframes te-lyric-line-enter {
  from {
    transform: translateY(12px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1.035);
  }
}

.lyric-text--words {
  display: inline;
}

:deep(.lyric-word) {
  --lyric-word-progress: 0%;
  position: relative;
  display: inline-block;
  contain: paint;
  color: color-mix(in srgb, currentColor 62%, transparent);
  white-space: pre;
}

:deep(.lyric-word[data-progressing='true'])::after {
  will-change: clip-path;
}

/* The reference uses a restrained white-to-warm-white karaoke sweep rather
   than a saturated neon color. A clipped highlight layer keeps the text
   layout stable while the fill advances with the word timestamp. */
:deep(.lyric-word)::after {
  position: absolute;
  inset: 0;
  color: var(--te-playback-lyric-karaoke, #fff8df);
  white-space: pre;
  opacity: var(--lyric-word-highlight-opacity, 0);
  pointer-events: none;
  clip-path: inset(0 calc(100% - var(--lyric-word-progress)) 0 0);
  content: attr(data-word-text);
}

.lyric-row.active :deep(.lyric-word) {
  opacity: 0.76;
}

.lyrics-column--karaoke-disabled :deep(.lyric-word) {
  color: inherit;
}

.lyrics-column--karaoke-disabled :deep(.lyric-word)::after {
  display: none;
}

.lyric-translation {
  min-width: 0;
  width: 100%;
  padding: 3px 7px;
  border-radius: 9px;
  font-family: var(--lyric-style-font-family, var(--te-lyric-font-family, inherit));
  font-size: clamp(
    12px,
    var(--lyric-style-font-size, calc(var(--te-lyric-font-size, 18px) - 2px)),
    48px
  );
  font-weight: var(--lyric-style-font-weight, 500);
  line-height: var(--lyric-style-line-height, 1.45);
  text-align: var(--lyric-style-align, center);
  color: var(--lyric-style-color, var(--te-playback-lyric-translation, rgba(255, 255, 255, 0.58)));
  opacity: var(--lyric-style-opacity, 1);
  background: var(--lyric-style-background, transparent);
  background-image: var(--lyric-style-background-image, none);
  backdrop-filter: var(--lyric-style-backdrop-filter, none);
  -webkit-backdrop-filter: var(--lyric-style-backdrop-filter, none);
  text-shadow: var(--lyric-style-highlight, none);
  word-break: break-word;
  transition:
    opacity var(--te-motion-hover) ease,
    color var(--te-motion-hover) ease,
    background var(--te-motion-hover) ease,
    text-shadow var(--te-motion-hover) ease;
}

.lyric-row.active .lyric-translation {
  color: var(
    --lyric-style-color,
    var(--te-playback-lyric-translation-active, rgba(255, 255, 255, 0.82))
  );
}

.lyric-romanization {
  min-width: 0;
  width: 100%;
  font-size: calc(var(--te-lyric-font-size, 18px) - 3px);
  line-height: 1.35;
  text-align: center;
  color: var(--te-playback-lyric-romanization, rgba(255, 255, 255, 0.46));
  word-break: break-word;
}

.lyric-row.active .lyric-romanization {
  color: var(--te-playback-lyric-romanization-active, rgba(255, 255, 255, 0.72));
}

.empty-shell {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: min(100%, 1560px);
  height: 100%;
  margin: 0 auto;
  padding: 40px 36px 28px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  color: var(--te-playback-lyric-text, rgba(255, 255, 255, 0.42));
  font-size: 14px;
}

.empty-state i {
  font-size: 42px;
  color: rgba(255, 255, 255, 0.16);
}

.empty-state p {
  margin: 0;
}

@media (max-width: 1120px) {
  .stage,
  .empty-shell {
    padding: 38px 22px 20px;
  }

  .layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 28px;
  }

  .lyrics-column {
    padding-left: 0;
    border-left: none;
  }

  .cover-column {
    align-self: stretch;
    transform: none;
  }

  .lyrics-list {
    padding-top: 4vh;
  }
}

@media (max-width: 760px) {
  .stage,
  .empty-shell {
    padding: 34px 16px 16px;
  }

  .track-title {
    font-size: 28px;
  }

  .track-artist {
    font-size: 16px;
  }

  .lyrics-list {
    padding: 2vh 0 18vh;
  }

  .lyric-row {
    padding-inline: 12px;
  }
}

/* Visualizer toggle — same frosted chip style as the time chip */
.visualizer-toggle-button {
  position: fixed;
  top: 42px;
  left: 42px;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background: var(--te-playback-control-surface, rgba(255, 255, 255, 0.08));
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--te-playback-control-border, rgba(255, 255, 255, 0.1));
  box-shadow: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--te-playback-control-text, rgba(255, 255, 255, 0.7));
  font-size: 16px;
  transition:
    background var(--te-motion-hover) ease,
    border-color var(--te-motion-hover) ease,
    color var(--te-motion-hover) ease,
    transform var(--te-motion-hover) var(--te-ease-spring),
    box-shadow var(--te-motion-hover) ease;
  z-index: 1200;
}

.visualizer-toggle-button:hover {
  background: var(--te-playback-control-hover-surface, rgba(255, 255, 255, 0.14));
  border-color: var(--te-playback-control-hover-border, rgba(255, 255, 255, 0.16));
  color: var(--te-playback-control-hover-text, rgba(255, 255, 255, 0.92));
  transform: scale(1.06);
  box-shadow: var(--te-playback-control-hover-shadow, 0 4px 12px rgba(0, 0, 0, 0.18));
}

.visualizer-toggle-button--close {
  z-index: 10000;
}

.visualizer-toggle-button--close:hover {
  background: var(--te-playback-control-hover-surface, rgba(255, 255, 255, 0.14));
  border-color: var(--te-playback-control-hover-border, rgba(255, 255, 255, 0.16));
  transform: scale(1.06);
  box-shadow: var(--te-playback-control-hover-shadow, 0 4px 12px rgba(0, 0, 0, 0.18));
}

/* Visualizer surface fills the stage area */
.visualizer-surface {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

:global(html[data-theme='dark'] .playing-music .visualizer-toggle-button) {
  background: var(--te-playback-control-surface, rgba(255, 255, 255, 0.08));
  border-color: var(--te-playback-control-border, rgba(255, 255, 255, 0.1));
  color: var(--te-playback-control-text, rgba(255, 255, 255, 0.7));
}

:global(html[data-theme='dark'] .playing-music .visualizer-toggle-button:hover) {
  background: var(--te-playback-control-hover-surface, rgba(255, 255, 255, 0.14));
  border-color: var(--te-playback-control-hover-border, rgba(255, 255, 255, 0.16));
  color: var(--te-playback-control-hover-text, rgba(255, 255, 255, 0.92));
}

:global(html[data-theme='dark'] .playing-music .visualizer-toggle-button--close) {
  background: var(--te-playback-control-surface, rgba(255, 255, 255, 0.08));
  border-color: var(--te-playback-control-border, rgba(255, 255, 255, 0.1));
  box-shadow: none;
}

:global(html[data-theme='dark'] .playing-music .visualizer-toggle-button--close:hover) {
  background: var(--te-playback-control-hover-surface, rgba(255, 255, 255, 0.14));
  border-color: var(--te-playback-control-hover-border, rgba(255, 255, 255, 0.16));
  box-shadow: var(--te-playback-control-hover-shadow, 0 4px 12px rgba(0, 0, 0, 0.18));
}

@keyframes te-artwork-fade {
  from {
    opacity: 0;
  }
}

@keyframes te-artwork-slide {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
}

:global(html[data-te-artwork-transition='fade'] .playing-music .cover-frame) {
  animation: te-artwork-fade 0.42s var(--te-ease-enter, ease-out) both;
}

:global(html[data-te-artwork-transition='slide'] .playing-music .cover-frame) {
  animation: te-artwork-slide 0.46s var(--te-ease-soft, ease-out) both;
}

:global(html[data-te-artwork-transition='none'] .playing-music .cover-frame) {
  animation: none;
}

:global(html[data-te-player-title-align='center'] .playing-music .cover-meta) {
  text-align: center;
}

:global(html[data-te-player-layout='full-cover'] .playing-music .stage) {
  width: 100%;
  max-width: none;
  padding: 0;
}

:global(html[data-te-player-layout='full-cover'] .playing-music .layout) {
  display: block;
  position: absolute;
  inset: 0;
  height: 100%;
  min-height: 0;
}

:global(html[data-te-player-layout='full-cover'] .playing-music .cover-column) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: block;
  transform: none;
}

:global(html[data-te-player-layout='full-cover'] .playing-music .cover-frame) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: 0;
  aspect-ratio: auto;
}

:global(html[data-te-player-layout='full-cover'] .playing-music .cover-meta) {
  position: absolute;
  left: clamp(28px, 6vw, 92px);
  bottom: 118px;
  z-index: 1;
  width: min(520px, calc(100vw - 56px));
  padding: 18px 20px;
  border-radius: var(--te-player-time-radius, 8px);
  background: color-mix(in srgb, var(--te-playback-control-surface) 86%, transparent);
  backdrop-filter: blur(18px) saturate(130%);
}

:global(html[data-te-player-layout='full-cover'] .playing-music .lyrics-column) {
  position: absolute;
  top: 76px;
  right: clamp(24px, 5vw, 78px);
  bottom: 118px;
  z-index: 1;
  width: min(44vw, 680px);
  padding: 16px 18px;
  border: 1px solid var(--te-playback-control-border);
  border-radius: var(--te-playback-cover-radius, 26px);
  background: color-mix(in srgb, var(--te-playback-control-surface) 78%, transparent);
  backdrop-filter: blur(18px) saturate(130%);
}

:global(html[data-te-player-layout='lyrics-focus'] .playing-music .layout) {
  grid-template-columns: minmax(150px, 220px) minmax(0, 1fr);
  gap: clamp(24px, 4vw, 64px);
}

:global(html[data-te-player-layout='lyrics-focus'] .playing-music .cover-column) {
  align-self: start;
  margin-top: 10vh;
  transform: none;
}

:global(html[data-te-player-layout='lyrics-focus'] .playing-music .cover-meta) {
  text-align: center;
}

:global(html[data-te-player-layout='lyrics-focus'] .playing-music .track-title) {
  font-size: 24px;
}

:global(html[data-te-player-layout='lyrics-focus'] .playing-music .lyrics-list) {
  max-width: 980px;
}

:global(html[data-te-player-layout='split'] .playing-music .layout) {
  grid-template-columns: minmax(280px, 0.82fr) minmax(420px, 1.38fr);
  gap: clamp(32px, 5vw, 84px);
}

:global(html[data-te-player-layout='split'] .playing-music .cover-column) {
  width: min(100%, 520px);
  justify-self: end;
  transform: none;
}

:global(html[data-te-player-layout='minimal'] .playing-music .layout) {
  display: grid;
  grid-template-columns: minmax(280px, 460px);
  place-content: center;
}

:global(html[data-te-player-layout='minimal'] .playing-music .cover-column) {
  width: min(100%, 460px);
  justify-self: center;
  transform: none;
}

:global(html[data-te-player-layout='minimal'] .playing-music .lyrics-column) {
  display: none;
}

:global(html[data-te-player-layout='minimal'] .playing-music .cover-meta) {
  text-align: center;
}

:global(html[data-te-visible-player-artwork='false'] .playing-music .cover-frame),
:global(html[data-te-visible-player-track-info='false'] .playing-music .cover-meta),
:global(html[data-te-visible-player-duration='false'] .playing-music .time-chip),
:global(html[data-te-visible-player-misc-icons='false'] .playing-music .visualizer-toggle-button) {
  display: none;
}

:global(html[data-te-visible-player-album-artist='false'] .playing-music .track-artist),
:global(html[data-te-visible-player-album-artist='false'] .playing-music .track-album),
:global(html[data-te-player-layout='minimal'] .playing-music .track-artist),
:global(html[data-te-player-layout='minimal'] .playing-music .track-album) {
  display: none;
}

:global(
  html[data-te-player-layout='minimal'][data-te-visible-player-album-artist='true']
    .playing-music
    .track-artist
),
:global(
  html[data-te-player-layout='minimal'][data-te-visible-player-album-artist='true']
    .playing-music
    .track-album
) {
  display: block;
}

@media (max-width: 1120px) {
  :global(html[data-te-player-layout='standard'] .playing-music .cover-column),
  :global(html[data-te-player-layout='split'] .playing-music .cover-column) {
    display: grid;
    grid-template-columns: minmax(132px, 180px) minmax(0, 1fr);
    align-items: center;
    gap: 22px;
    width: min(100%, 720px);
    justify-self: center;
  }

  :global(html[data-te-player-layout='standard'] .playing-music .cover-frame),
  :global(html[data-te-player-layout='split'] .playing-music .cover-frame) {
    width: min(100%, 180px);
  }

  :global(html[data-te-player-layout='full-cover'] .playing-music .stage) {
    padding: 0;
  }

  :global(html[data-te-player-layout='full-cover'] .playing-music .layout) {
    display: block;
  }

  :global(html[data-te-player-layout='full-cover'] .playing-music .lyrics-column) {
    top: 88px;
    right: 22px;
    bottom: 122px;
    width: min(44vw, 480px);
  }

  :global(html[data-te-player-layout='full-cover'] .playing-music .cover-meta) {
    left: 22px;
    width: min(42vw, 440px);
  }

  :global(html[data-te-player-layout='lyrics-focus'] .playing-music .layout) {
    grid-template-columns: minmax(126px, 176px) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }

  :global(html[data-te-player-layout='lyrics-focus'] .playing-music .cover-column) {
    align-self: start;
    margin-top: 8vh;
  }

  :global(html[data-te-player-layout='split'] .playing-music .layout) {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 28px;
  }

  :global(html[data-te-player-layout='split'] .playing-music .cover-column) {
    width: auto;
    justify-self: stretch;
  }
}

@media (max-width: 760px) {
  :global(html[data-te-player-layout='full-cover'] .playing-music .lyrics-column) {
    top: 70px;
    right: 16px;
    bottom: 290px;
    left: 16px;
    width: auto;
  }

  :global(html[data-te-player-layout='full-cover'] .playing-music .cover-meta) {
    left: 16px;
    bottom: 112px;
    width: calc(100vw - 32px);
  }

  :global(html[data-te-player-layout='lyrics-focus'] .playing-music .layout) {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  :global(html[data-te-player-layout='lyrics-focus'] .playing-music .cover-column) {
    margin-top: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  :global(html[data-te-artwork-transition] .playing-music .cover-frame) {
    animation: none;
  }
}
</style>
