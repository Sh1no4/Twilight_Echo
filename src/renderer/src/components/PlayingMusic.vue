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

interface LyricLine {
  time: number
  text: string
  translation: string | null
}

const { currentTrack, dominantColor, currentTime, duration, seek, formatTime } = usePlayerStore()

const bgSrc = ref(currentTrack.value?.cover ?? '')
const lyricsEl = ref<HTMLElement | null>(null)
const lyricLineEls = ref<Array<HTMLElement | null>>([])
let lyricScrollRaf = 0
let lyricCenterTimer = 0
let lyricOpenCenterTimer = 0
let lyricManualScrollTimer = 0
let lyricManualScrollLocked = false
let lyricResizeObserver: ResizeObserver | null = null
const LYRIC_SCROLL_DURATION_MS = 420
const LYRIC_RESIZE_SCROLL_DURATION_MS = 260
const LYRIC_OPEN_CENTER_DELAY_MS = 620
const LYRIC_MANUAL_RETURN_DELAY_MS = 3000
const LYRIC_CENTER_OFFSET_RATIO = 0.08
const LYRIC_CENTER_OFFSET_MAX = 72

watch(
  () => currentTrack.value?.cover,
  (newCover) => {
    bgSrc.value = newCover ?? ''
  },
  { immediate: true }
)

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
      lyricLineEls.value = []
      await nextTick()
      if (lyricsEl.value) {
        lyricsEl.value.scrollTo({ top: 0, behavior: 'auto' })
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
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  cancelLyricScrollAnimation()
  if (lyricCenterTimer !== 0) {
    window.clearTimeout(lyricCenterTimer)
    lyricCenterTimer = 0
  }
  if (lyricOpenCenterTimer !== 0) {
    window.clearTimeout(lyricOpenCenterTimer)
    lyricOpenCenterTimer = 0
  }
  clearLyricManualScrollTimer()
  lyricResizeObserver?.disconnect()
  lyricResizeObserver = null
})

interface ParsedLyricLine {
  time: number
  text: string
}

function parseLrc(lrc: string | null | undefined): ParsedLyricLine[] {
  if (!lrc) return []

  const lines: ParsedLyricLine[] = []
  const lineRe = /\[(\d{1,3}):(\d{2})(?:[.:](\d{2,3}))?\]/g

  for (const raw of lrc.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    const timestamps: Array<{ time: number; index: number; end: number }> = []
    let match: RegExpExecArray | null
    lineRe.lastIndex = 0

    while ((match = lineRe.exec(trimmed)) !== null) {
      const min = Number.parseInt(match[1], 10)
      const sec = Number.parseInt(match[2], 10)
      let ms = 0

      if (match[3]) {
        ms = Number.parseInt(match[3], 10)
        if (match[3].length === 2) {
          ms *= 10
        }
      }

      timestamps.push({
        time: min * 60 + sec + ms / 1000,
        index: match.index,
        end: match.index + match[0].length
      })
    }

    const text = trimmed.replace(lineRe, '').trim()
    if (!text || timestamps.length === 0) continue

    const hasInlineTimestamps = timestamps.some((timestamp, index) => {
      if (index === 0) return timestamp.index > 0
      const previous = timestamps[index - 1]
      return trimmed.slice(previous.end, timestamp.index).trim().length > 0
    })

    if (hasInlineTimestamps) {
      lines.push({ time: timestamps[0].time, text })
      continue
    }

    for (const ts of timestamps) {
      lines.push({ time: ts.time, text })
    }
  }

  lines.sort((a, b) => a.time - b.time)
  return lines
}

const lyricLines = computed<LyricLine[]>(() => {
  const originalLines = parseLrc(currentTrack.value?.lyrics)
  const translatedLines = parseLrc(currentTrack.value?.translatedLyrics ?? null)

  if (originalLines.length === 0) {
    return translatedLines.map((line) => ({
      time: line.time,
      text: line.text,
      translation: null
    }))
  }

  const translatedMap = new Map<number, string>()
  for (const line of translatedLines) {
    translatedMap.set(Math.round(line.time * 1000), line.text)
  }

  return originalLines.map((line) => ({
    time: line.time,
    text: line.text,
    translation: translatedMap.get(Math.round(line.time * 1000)) ?? null
  }))
})

const hasLyrics = computed(() => lyricLines.value.length > 0)

const activeLyricIndex = computed(() => {
  const t = currentTime.value
  let idx = -1

  for (let i = 0; i < lyricLines.value.length; i++) {
    if (lyricLines.value[i].time <= t) {
      idx = i
    } else {
      break
    }
  }

  return idx
})

const trackDurationLabel = computed(() => formatTime(duration.value))

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

function jumpToLyric(time: number): void {
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

  const containerRect = container.getBoundingClientRect()
  const lineRect = line.getBoundingClientRect()
  const centerOffset = Math.min(
    LYRIC_CENTER_OFFSET_MAX,
    container.clientHeight * LYRIC_CENTER_OFFSET_RATIO
  )
  const targetTop =
    container.scrollTop +
    (lineRect.top - containerRect.top) -
    (container.clientHeight - lineRect.height) * 0.5 +
    centerOffset
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
  scheduleLyricReturnToCenter()
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

function scheduleLyricOpenCenter(): void {
  scheduleActiveLyricCenter()

  if (lyricOpenCenterTimer !== 0) {
    window.clearTimeout(lyricOpenCenterTimer)
  }

  lyricOpenCenterTimer = window.setTimeout(() => {
    lyricOpenCenterTimer = 0
    if (!lyricManualScrollLocked) {
      void centerActiveLyric()
    }
  }, LYRIC_OPEN_CENTER_DELAY_MS)
}

function onLyricLayoutResize(): void {
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
    scheduleLyricOpenCenter()
  }
})

onMounted(() => {
  lyricResizeObserver = new ResizeObserver(() => {
    onLyricLayoutResize()
  })
  if (lyricsEl.value) {
    lyricResizeObserver.observe(lyricsEl.value)
  }
  scheduleLyricOpenCenter()
  window.addEventListener('resize', onLyricLayoutResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onLyricLayoutResize)
})
</script>

<template>
  <div class="playing-music" :style="{ '--accent-color': dominantColor }">
    <div class="backdrop" aria-hidden="true">
      <Transition name="backdrop-cover-fade" appear>
        <img v-if="bgSrc" :key="bgSrc" :src="bgSrc" class="backdrop-cover" alt="" />
      </Transition>
      <div class="backdrop-scrim" />
      <div class="backdrop-accent" />
    </div>

    <div v-if="currentTrack" class="stage">
      <main class="layout" :class="{ 'layout--single': !hasLyrics }">
        <section class="cover-column">
          <div class="cover-frame">
            <img
              v-if="currentTrack.cover"
              :src="currentTrack.cover"
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

        <section v-if="hasLyrics" class="lyrics-column">
          <div class="lyrics-head">
            <div class="time-chip">{{ formatTime(currentTime) }} / {{ trackDurationLabel }}</div>
          </div>

          <div
            ref="lyricsEl"
            class="lyrics-scroll"
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
                :class="lyricTone(i)"
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
  background: #05070b;
  --accent-color: #7c4dff;
}

.backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  background: #05070b;
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
  transform: translateX(28px);
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
  opacity: 0.56;
}

.lyric-row.far {
  opacity: 0.3;
}

.lyric-row.mid {
  opacity: 0.52;
}

.lyric-row.near {
  opacity: 0.84;
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
</style>
