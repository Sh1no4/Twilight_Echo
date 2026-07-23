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
import { buildLyricLines, findActiveLyricIndex, findActiveWordIndex } from '../utils/lyrics'
import type { LyricLine } from '../utils/lyrics'
import { getTrackSource, shouldReserveLyricsColumn } from '../utils/nowPlayingLayout'
import { projectLyricDisplay, projectManagedLyrics } from '../../../shared/lyricsManagement.ts'
import AudioVisualizerPanel from './AudioVisualizerPanel.vue'

const playbackStore = usePlayerStore()
const visualizationStore = useVisualizationStore()
const { currentTrack, dominantColor, currentTime, duration } = playbackStore
const { visualizerActive } = storeToRefs(visualizationStore)
const { seek, formatTime } = playbackStore
const { settings } = useSettingsStore()
const lyricsManagement = useLyricsManagement()

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

const coverIdentity = computed(
  () =>
    `${currentTrack.value?.id ?? 'none'}:${currentTrack.value?.cover ?? ''}:${currentTrack.value?.coverSource ?? ''}`
)
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
  () => managedLyrics.value.original == null && managedLyrics.value.translation == null
)
const lyricsPendingLabel = computed(() => (lyricsStillLoading.value ? '加载歌词…' : '暂无歌词'))
const reserveLyricsColumn = computed(() =>
  shouldReserveLyricsColumn({
    source: getTrackSource(currentTrack.value),
    hasLyrics: hasLyrics.value,
    lyrics: managedLyrics.value.original,
    translatedLyrics: managedLyrics.value.translation
  })
)

const activeLyricIndex = computed(() =>
  findActiveLyricIndex(lyricLines.value, currentTime.value + currentLyricOffsetSeconds.value)
)

const trackDurationLabel = computed(() => formatTime(duration.value))

function activeWordIndexForLine(line: LyricLine, lineIndex: number): number {
  if (lineIndex !== activeLyricIndex.value || !line.words?.length) return -1
  return findActiveWordIndex(line.words, currentTime.value + currentLyricOffsetSeconds.value)
}

function wordClass(line: LyricLine, lineIndex: number, wordIndex: number): string {
  if (lineIndex !== activeLyricIndex.value) return 'lyric-word'
  const active = activeWordIndexForLine(line, lineIndex)
  return active === wordIndex ? 'lyric-word lyric-word--active' : 'lyric-word'
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
  clearLyricManualScrollTimer()
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
  void lyricsManagement.ensureLoaded()
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
  <div
    class="playing-music"
    :class="`bg-${nowPlayingBackground}`"
    :style="{ '--accent-color': dominantColor, '--lyric-dim': lyricDimOpacity }"
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
          :class="{ 'lyrics-column--pending': !hasLyrics }"
        >
          <div class="lyrics-head">
            <div class="time-chip">{{ formatTime(currentTime) }} / {{ trackDurationLabel }}</div>
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
              <button
                v-for="(line, i) in displayLyricLines"
                :key="`${line.time}-${i}`"
                :ref="(el) => setLyricLineRef(i, el)"
                type="button"
                class="lyric-row"
                :class="[lyricTone(i), { 'is-plain': !line.timed }]"
                :disabled="!line.timed"
                @pointerdown.stop
                @click="jumpToLyric(line.time)"
              >
                <span v-if="line.words?.length" class="lyric-text lyric-text--words">
                  <span
                    v-for="(word, wi) in line.words"
                    :key="`${i}-${wi}-${word.time}`"
                    :class="wordClass(line, i, wi)"
                    >{{ word.text }}</span
                  >
                </span>
                <span v-else-if="line.text" class="lyric-text">{{ line.text }}</span>
                <span v-if="line.translation" class="lyric-translation">{{
                  line.translation
                }}</span>
                <span v-if="line.romanization" class="lyric-romanization">{{
                  line.romanization
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
  transform: translateX(32px);
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
  color: var(--te-playback-lyric-text, rgba(255, 255, 255, 0.42));
  transition:
    color 0.22s ease,
    opacity 0.22s ease,
    transform 0.22s ease,
    background 0.22s ease,
    border-color 0.22s ease,
    box-shadow 0.22s ease;
}

.lyric-row:hover {
  color: var(--te-playback-lyric-hover-text, rgba(255, 255, 255, 0.74));
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
  color: var(--te-playback-lyric-active-text, #fff);
  transform: scale(1.012);
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--accent-color) 22%, transparent), transparent),
    var(--te-playback-lyric-active-surface, rgba(255, 255, 255, 0.08));
  border-color: var(--te-playback-lyric-active-border, rgba(255, 255, 255, 0.1));
  box-shadow: var(--te-playback-lyric-active-shadow, 0 14px 28px rgba(0, 0, 0, 0.18));
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
.lyrics-scroll.lyric-align-left .lyric-translation,
.lyrics-scroll.lyric-align-left .lyric-romanization {
  text-align: left;
}

.lyric-row.active .lyric-text {
  font-size: calc(var(--te-lyric-font-size, 18px) + 4px);
  font-weight: 600;
}

.lyric-text--words {
  display: inline;
}

.lyric-word {
  transition:
    color 0.12s ease,
    opacity 0.12s ease;
}

.lyric-row.active .lyric-word {
  opacity: 0.55;
}

.lyric-word--active {
  opacity: 1 !important;
  color: color-mix(in srgb, var(--accent-color, #ffd700) 85%, #fff);
  font-weight: 700;
  text-shadow: 0 0 12px color-mix(in srgb, var(--accent-color, #ffd700) 45%, transparent);
}

.lyric-translation {
  min-width: 0;
  width: 100%;
  font-size: calc(var(--te-lyric-font-size, 18px) - 2px);
  line-height: 1.45;
  text-align: center;
  color: var(--te-playback-lyric-translation, rgba(255, 255, 255, 0.58));
  word-break: break-word;
}

.lyric-row.active .lyric-translation {
  color: var(--te-playback-lyric-translation-active, rgba(255, 255, 255, 0.82));
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
  transition: all 0.2s;
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
  top: 8px;
  left: 14px;
  right: auto;
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
