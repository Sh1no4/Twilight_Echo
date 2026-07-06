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
import { usePlayerStore } from '../stores/usePlayerStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useCover } from '../utils/coverLoader'
import { buildLyricLines } from '../utils/lyrics'
import type { LyricLine } from '../utils/lyrics'
import { getTrackSource, shouldReserveLyricsColumn } from '../utils/nowPlayingLayout'
import type { LyricSource } from '../types/music'
import AudioVisualizerPanel from './AudioVisualizerPanel.vue'

const {
  currentTrack,
  dominantColor,
  currentTime,
  duration,
  seek,
  formatTime,
  visualizerActive
} = usePlayerStore()
const { settings } = useSettingsStore()

const nowPlayingBackground = computed(() => settings.value.nowPlayingBackground)
const lyricAlign = computed(() => settings.value.lyricAlign)
const lyricDimOpacity = computed(() => settings.value.lyricDimOpacity / 100)

const isBlurBackground = computed(() => nowPlayingBackground.value === 'blur')
const isFluidBackground = computed(() => nowPlayingBackground.value === 'fluid')
const isSolidBackground = computed(() => nowPlayingBackground.value === 'solid')

const lyricAlignClass = computed(() => `lyric-align-${lyricAlign.value}`)

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

const resolvedCover = useCover(computed(() => currentTrack.value?.cover ?? null))
const bgSrc = computed(() => resolvedCover.value ?? '')
const lyricsEl = ref<HTMLElement | null>(null)
const lyricLineEls = ref<Array<HTMLElement | null>>([])
let lyricScrollRaf = 0
let lyricCenterTimer = 0
let lyricManualScrollTimer = 0
let lyricManualScrollLocked = false
let lyricResizeObserver: ResizeObserver | null = null
let restoringLyricScroll = false
const LYRIC_SCROLL_DURATION_MS = 420
const LYRIC_RESIZE_SCROLL_DURATION_MS = 260
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
  lyricManualScrollLocked = false
  cancelLyricScrollAnimation()
  if (activeLyricIndex.value >= 0) {
    // Retry up to 3 frames in case lyricLineEls isn't populated yet
    for (let attempt = 0; attempt < 3; attempt++) {
      if (lyricLineEls.value[activeLyricIndex.value]) {
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
      lyricLineEls.value = []
      await nextTick()
      if (lyricsEl.value) {
        if (restoreLyricScrollPosition()) {
          // Restored saved scroll position for this track
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
      await nextTick()
      if (activeLyricIndex.value >= 0) {
        focusLyricLine(activeLyricIndex.value)
      }
    }
  }
)

onBeforeUnmount(() => {
  saveLyricScrollPosition()
  cancelLyricScrollAnimation()
  if (lyricCenterTimer !== 0) {
    window.clearTimeout(lyricCenterTimer)
    lyricCenterTimer = 0
  }
  clearLyricManualScrollTimer()
  lyricResizeObserver?.disconnect()
  lyricResizeObserver = null
})

const lyricLines = computed<LyricLine[]>(() => {
  return buildLyricLines(currentTrack.value?.lyrics, currentTrack.value?.translatedLyrics ?? null)
})

const hasLyrics = computed(() => lyricLines.value.length > 0)
const reserveLyricsColumn = computed(() =>
  shouldReserveLyricsColumn({
    source: getTrackSource(currentTrack.value),
    hasLyrics: hasLyrics.value,
    lyrics: currentTrack.value?.lyrics,
    translatedLyrics: currentTrack.value?.translatedLyrics
  })
)

const activeLyricIndex = computed(() => {
  const t = currentTime.value
  let idx = -1

  for (let i = 0; i < lyricLines.value.length; i++) {
    const lineTime = lyricLines.value[i].time
    if (lineTime != null && lineTime <= t) {
      idx = i
    } else {
      break
    }
  }

  return idx
})

const trackDurationLabel = computed(() => formatTime(duration.value))
const lyricSourceLabel = computed(() =>
  getLyricSourceLabel(currentTrack.value?.lyricsSource, '原文')
)
const translatedLyricSourceLabel = computed(() =>
  getLyricSourceLabel(currentTrack.value?.translatedLyricsSource, '翻译')
)

function getLyricSourceLabel(source: LyricSource | null | undefined, label: string): string {
  if (!source) return ''
  const sourceLabel =
    source === 'embedded'
      ? '内嵌'
      : source === 'local'
        ? '本地 LRC'
        : 'Provider'
  return `${label}: ${sourceLabel}`
}

function setLyricLineRef(index: number, el: Element | ComponentPublicInstance | null): void {
  lyricLineEls.value[index] = el instanceof HTMLElement ? el : null
}

function lyricTone(index: number): 'idle' | 'far' | 'mid' | 'near' | 'active' {
  const active = activeLyricIndex.value
  if (active < 0) return 'idle'

  const distance = Math.abs(index - active)
  if (distance === 0) return 'active'
  if (distance === 1) return 'near'
  if (distance === 2) return 'mid'
  return 'far'
}

function jumpToLyric(time: number | null): void {
  if (time == null) return
  seek(time)
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function cancelLyricScrollAnimation(): void {
  if (lyricScrollRaf !== 0) {
    window.cancelAnimationFrame(lyricScrollRaf)
    lyricScrollRaf = 0
  }
}

function getLyricTargetTop(index: number): number | null {
  const container = lyricsEl.value
  const line = lyricLineEls.value[index]

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
    lineOffsetTop -
    (container.clientHeight - line.offsetHeight) * LYRIC_ACTIVE_ANCHOR_RATIO
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
    lyricManualScrollLocked = false
    await nextTick()
    if (activeLyricIndex.value >= 0) {
      focusLyricLine(activeLyricIndex.value)
    }
  }, LYRIC_MANUAL_RETURN_DELAY_MS)
}

function onLyricsManualScroll(): void {
  lyricManualScrollLocked = true
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

watch(activeLyricIndex, async (index) => {
  if (index < 0) return
  if (lyricManualScrollLocked) return
  await nextTick()
  focusLyricLine(index)
})

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
  lyricResizeObserver = new ResizeObserver(() => {
    onLyricLayoutResize()
  })
  if (lyricsEl.value) {
    lyricResizeObserver.observe(lyricsEl.value)
  }
  void restoreOrCenterLyrics()
  window.addEventListener('resize', onLyricLayoutResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onLyricLayoutResize)
})
</script>

<template>
  <div class="playing-music" :class="`bg-${nowPlayingBackground}`" :style="{ '--accent-color': dominantColor, '--lyric-dim': lyricDimOpacity }">
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
        <img v-if="bgSrc && isBlurBackground" :key="bgSrc" :src="bgSrc" class="backdrop-cover" alt="" />
      </Transition>
      <div v-if="isFluidBackground" class="backdrop-fluid" />
      <div v-if="isSolidBackground" class="backdrop-solid" />
      <div class="backdrop-scrim" />
      <div class="backdrop-accent" />
    </div>

    <div v-if="currentTrack" class="stage">
      <AudioVisualizerPanel
        v-if="viewMode === 'visualizer'"
        class="visualizer-surface"
        :active="viewMode === 'visualizer'"
      />
      <main v-else class="layout" :class="{ 'layout--single': !reserveLyricsColumn }">
        <section class="cover-column">
          <div class="cover-frame">
            <img
              v-if="resolvedCover"
              :src="resolvedCover"
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
          :class="{ 'lyrics-column--pending': !hasLyrics }"
        >
          <div class="lyrics-head">
            <div class="time-chip">{{ formatTime(currentTime) }} / {{ trackDurationLabel }}</div>
            <div class="lyric-source-chips" aria-label="歌词来源">
              <span v-if="lyricSourceLabel" class="lyric-source-chip">{{ lyricSourceLabel }}</span>
              <span v-if="translatedLyricSourceLabel" class="lyric-source-chip">{{
                translatedLyricSourceLabel
              }}</span>
            </div>
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
            <div class="lyrics-list">
              <button
                v-for="(line, i) in lyricLines"
                :key="`${line.time}-${i}`"
                :ref="(el) => setLyricLineRef(i, el)"
                type="button"
                class="lyric-row"
                :class="[lyricTone(i), { 'is-plain': !line.timed }]"
                :disabled="!line.timed"
                @click="jumpToLyric(line.time)"
              >
                <span class="lyric-text">{{ line.text }}</span>
                <span v-if="line.translation" class="lyric-translation">{{
                  line.translation
                }}</span>
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
  </div>
</template>

<style scoped>
.playing-music {
  position: fixed;
  inset: -32px 0 0 0;
  z-index: 1100;
  overflow: hidden;
  color: #f4f7fb;
  background-color: var(--te-player-bg);
  background-image: var(--te-player-bg-image);
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
  --accent-color: #7c4dff;
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
    linear-gradient(
      180deg,
      rgba(5, 7, 11, 0.34) 0%,
      rgba(5, 7, 11, 0.64) 42%,
      rgba(5, 7, 11, 0.86) 100%
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
    radial-gradient(circle at 88% 20%, rgba(255, 255, 255, 0.12), transparent 26%);
  opacity: 0.8;
}

.backdrop-fluid {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, #0f172a, #1e3a5f, #312e81, #1e3a5f, #0f172a);
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
  0%, 100% { background-position: 0% 50%; }
  25% { background-position: 100% 50%; }
  50% { background-position: 100% 100%; }
  75% { background-position: 0% 100%; }
}

.stage {
  position: relative;
  z-index: 1;
  width: min(100%, 1560px);
  height: 100%;
  margin: 0 auto;
  padding: 72px 36px 28px;
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
  transform: translateX(44px);
}

.cover-frame {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 26px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
  box-shadow: 0 26px 70px rgba(0, 0, 0, 0.38);
}

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
  color: rgba(255, 255, 255, 0.34);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02)),
    color-mix(in srgb, var(--accent-color) 18%, transparent);
}

.cover-meta {
  min-width: 0;
}

.track-title {
  margin: 0;
  font-family: var(--te-font-display);
  font-size: 32px;
  font-weight: 400;
  line-height: 1.22;
  color: #fff;
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
  color: rgba(255, 255, 255, 0.78);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.track-album {
  margin: 4px 0 0;
  font-family: var(--te-font-rounded);
  font-size: 14px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.48);
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

.lyrics-column--pending {
  visibility: hidden;
  pointer-events: none;
}

.lyrics-head {
  display: flex;
  align-items: end;
  justify-content: flex-end;
  gap: 16px;
  padding-bottom: 18px;
  min-width: 0;
}

.lyric-source-chips {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.lyric-source-chip {
  max-width: 160px;
  padding: 5px 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.time-chip {
  flex-shrink: 0;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.lyrics-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 8px;
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
  width: 0;
  height: 0;
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
  background: transparent;
  padding: 12px 20px;
  text-align: center;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.42);
  transition:
    color 0.22s ease,
    opacity 0.22s ease,
    transform 0.22s ease,
    background 0.22s ease,
    border-color 0.22s ease,
    box-shadow 0.22s ease;
}

.lyric-row:hover {
  color: rgba(255, 255, 255, 0.74);
}

.lyric-row.idle {
  opacity: var(--lyric-dim, 0.56);
}

.lyric-row.far {
  opacity: calc(var(--lyric-dim, 0.56) * 0.54);
}

.lyric-row.mid {
  opacity: calc(var(--lyric-dim, 0.56) * 0.93);
}

.lyric-row.near {
  opacity: calc(var(--lyric-dim, 0.56) * 1.5);
}

.lyric-row.active {
  opacity: 1;
  color: #fff;
  transform: scale(1.012);
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--accent-color) 22%, transparent), transparent),
    rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 14px 28px rgba(0, 0, 0, 0.18);
}

.lyric-text {
  min-width: 0;
  width: 100%;
  font-size: var(--te-lyric-font-size, 18px);
  line-height: 1.85;
  text-align: center;
  word-break: break-word;
}

.lyrics-scroll.lyric-align-left .lyric-text,
.lyrics-scroll.lyric-align-left .lyric-translation {
  text-align: left;
}

.lyric-row.active .lyric-text {
  font-size: calc(var(--te-lyric-font-size, 18px) + 4px);
  font-weight: 600;
}

.lyric-translation {
  min-width: 0;
  width: 100%;
  font-size: calc(var(--te-lyric-font-size, 18px) - 2px);
  line-height: 1.45;
  text-align: center;
  color: rgba(255, 255, 255, 0.58);
  word-break: break-word;
}

.lyric-row.active .lyric-translation {
  color: rgba(255, 255, 255, 0.82);
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
  color: rgba(255, 255, 255, 0.42);
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

/* Visualizer toggle button (floating, top-right) */
.visualizer-toggle-button {
  position: fixed;
  top: 42px;
  right: 42px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--te-glass-bg, rgba(255, 255, 255, 0.55));
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(15, 23, 42, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--te-neutral-700, #334155);
  font-size: 16px;
  transition: all 0.2s;
  z-index: 1200;
}

.visualizer-toggle-button:hover {
  background: var(--te-card-bg, rgba(255, 255, 255, 0.85));
  color: var(--te-primary-500, #6366f1);
  transform: scale(1.06);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.12);
}

.visualizer-toggle-button--close {
  top: 8px;
  left: 14px;
  right: auto;
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  z-index: 10000;
}

.visualizer-toggle-button--close:hover {
  background: rgba(255, 255, 255, 0.85);
  border-color: rgba(15, 23, 42, 0.08);
  transform: scale(1.06);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.12);
}

/* Visualizer surface fills the stage area */
.visualizer-surface {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

:global(html[data-theme='dark']) .visualizer-toggle-button {
  background: rgba(30, 32, 40, 0.6);
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.85);
}

:global(html[data-theme='dark']) .visualizer-toggle-button:hover {
  background: rgba(40, 42, 52, 0.85);
  color: var(--te-primary-500, #8b9bff);
}

:global(html[data-theme='dark']) .visualizer-toggle-button--close {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}

:global(html[data-theme='dark']) .visualizer-toggle-button--close:hover {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.16);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
}

</style>
