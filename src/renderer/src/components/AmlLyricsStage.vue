<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { LyricPlayer } from '@applemusic-like-lyrics/vue'
import type { LyricLine as AmlLyricLine, LyricLineMouseEvent } from '@applemusic-like-lyrics/core'
import type { LyricLine } from '../utils/lyrics'
import { requestAnimationFrameWithFallback } from '../utils/animationFrameFallback'
import '@applemusic-like-lyrics/core/style.css'

interface PlaybackClockSnapshot {
  position: number
  epoch: number
  revision: number
}

interface PlaybackClock {
  snapshot: Readonly<{ value: PlaybackClockSnapshot }>
  isPlaying: Readonly<{ value: boolean }>
  positionAt: () => number
}

const props = withDefaults(
  defineProps<{
    lines: readonly LyricLine[]
    clock: PlaybackClock
    offsetSeconds?: number
    align?: 'left' | 'center' | 'right'
    karaokeEnabled?: boolean
    style?: Record<string, string>
  }>(),
  {
    offsetSeconds: 0,
    align: 'center',
    karaokeEnabled: true,
    style: () => ({})
  }
)

const emit = defineEmits<{ seek: [positionSeconds: number] }>()

const AMLL_FRAME_FALLBACK_MS = 120
const AMLL_LINE_FALLBACK_DURATION_MS = 5000
const AMLL_MIN_LINE_DURATION_MS = 180
const currentTimeMs = ref(0)
let cancelClockFrame: (() => void) | null = null

function toMilliseconds(seconds: number | null | undefined): number | null {
  if (seconds == null || !Number.isFinite(seconds)) return null
  return Math.max(0, Math.round(seconds * 1000))
}

function nextTimedLineStart(lines: readonly LyricLine[], from: number): number | null {
  for (let index = from + 1; index < lines.length; index += 1) {
    const time = toMilliseconds(lines[index]?.time)
    if (time != null) return time
  }
  return null
}

/**
 * AMLL owns all lyric layout, interpolation and word masks. This adapter only
 * converts Twilight Echo's normalized LRC/YRC model into AMLL's immutable,
 * millisecond-based data model.
 */
const amllLines = computed<AmlLyricLine[]>(() =>
  props.lines.map((line, lineIndex, lines) => {
    const startTime = toMilliseconds(line.time) ?? 0
    const nextStartTime = nextTimedLineStart(lines, lineIndex)
    const fallbackEndTime = Math.max(
      startTime + AMLL_MIN_LINE_DURATION_MS,
      nextStartTime != null ? nextStartTime : startTime + AMLL_LINE_FALLBACK_DURATION_MS
    )
    const sourceWords = line.words?.filter((word) => word.text.length > 0) ?? []

    const words =
      sourceWords.length > 0
        ? sourceWords.map((word, wordIndex) => {
            const wordStart = toMilliseconds(word.time) ?? startTime
            const nextWordStart = toMilliseconds(sourceWords[wordIndex + 1]?.time)
            const explicitEnd = toMilliseconds(word.endTime)
            const wordEnd = Math.max(
              wordStart + AMLL_MIN_LINE_DURATION_MS,
              explicitEnd ?? nextWordStart ?? fallbackEndTime
            )
            return { startTime: wordStart, endTime: wordEnd, word: word.text }
          })
        : [{ startTime, endTime: fallbackEndTime, word: line.text }]

    const endTime = Math.max(
      fallbackEndTime,
      words.reduce((latest, word) => Math.max(latest, word.endTime), startTime)
    )

    return {
      words,
      translatedLyric: line.translation ?? '',
      romanLyric: line.romanization ?? '',
      startTime,
      endTime,
      isBG: false,
      isDuet: false
    }
  })
)

const stageStyle = computed<Record<string, string>>(() => ({
  ...props.style,
  '--amll-lp-color': 'var(--te-playback-lyric-active-text, #fff)',
  /* Geometry and spring parameters deliberately remain AMLL package defaults. */
  '--amll-lp-hover-bg-color': 'transparent',
  '--amll-lp-font-size':
    'clamp(29px, calc(var(--lyric-style-font-size, var(--te-lyric-font-size, 18px)) * 1.78), 60px)',
  '--amll-lp-font-family':
    "'SF Pro Display', 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif"
}))

function syncCurrentTime(): void {
  const position = props.clock.positionAt()
  currentTimeMs.value = Math.max(0, Math.round((position + props.offsetSeconds) * 1000))
}

function stopClockLoop(): void {
  cancelClockFrame?.()
  cancelClockFrame = null
}

function scheduleClockLoop(): void {
  stopClockLoop()
  const tick = (): void => {
    syncCurrentTime()
    if (props.clock.isPlaying.value) {
      cancelClockFrame = requestAnimationFrameWithFallback(tick, AMLL_FRAME_FALLBACK_MS)
    }
  }
  syncCurrentTime()
  if (props.clock.isPlaying.value) {
    cancelClockFrame = requestAnimationFrameWithFallback(tick, AMLL_FRAME_FALLBACK_MS)
  }
}

function onLineClick(event: LyricLineMouseEvent): void {
  const line = amllLines.value[event.lineIndex]
  if (!line) return
  emit('seek', Math.max(0, line.startTime / 1000 - props.offsetSeconds))
}

watch(
  [
    () => props.clock.snapshot.value.epoch,
    () => props.clock.snapshot.value.revision,
    () => props.offsetSeconds,
    () => props.clock.isPlaying.value
  ],
  scheduleClockLoop,
  { immediate: true }
)

onBeforeUnmount(stopClockLoop)
</script>

<template>
  <LyricPlayer
    class="amll-stage"
    :style="stageStyle"
    :lyric-lines="amllLines"
    :current-time="currentTimeMs"
    :playing="clock.isPlaying.value"
    :word-fade-width="karaokeEnabled ? 0.5 : 0.0001"
    @line-click="onLineClick"
  />
</template>

<style scoped>
.amll-stage {
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: var(--amll-lp-font-family);
  font-weight: 780;
  letter-spacing: -0.038em;
  text-rendering: geometricPrecision;
  -webkit-font-smoothing: antialiased;
  user-select: none;
}

/* The row positions, blur and scaling remain AMLL-owned.  No native scroll
   container or local easing is layered over its virtual lyric stage. */
:deep(.FmKaba_interludeDots) {
  display: none !important;
}

:deep(.FmKaba_lyricMainLine) {
  font-family: var(--lyric-style-font-family, var(--amll-lp-font-family));
  font-weight: var(--lyric-style-font-weight, 780);
  line-height: clamp(1.12, var(--lyric-style-line-height, 1.24), 1.3);
  letter-spacing: -0.038em;
  text-align: v-bind(align);
  text-shadow: var(--lyric-style-highlight, none);
}

:deep(.FmKaba_lyricSubLine) {
  font-family: var(--lyric-style-font-family, var(--amll-lp-font-family));
  font-weight: 560;
  letter-spacing: -0.012em;
  text-align: v-bind(align);
  color: var(--te-playback-lyric-translation, rgba(255, 255, 255, 0.58));
}

:deep(.FmKaba_romanWord) {
  font-family: var(--lyric-style-font-family, var(--amll-lp-font-family));
}

:deep(.FmKaba_active .FmKaba_lyricMainLine) {
  color: var(--lyric-style-color, var(--te-playback-lyric-active-text, #fff));
}

:deep(.FmKaba_lyricLine:not(.FmKaba_active) .FmKaba_lyricMainLine) {
  color: var(--te-playback-lyric-text, rgba(255, 255, 255, 0.42));
}
</style>

<style>
/* This selector is intentionally global: AMLL creates this node imperatively,
   outside Vue's scoped-render path. */
.amll-stage .FmKaba_interludeDots {
  display: none !important;
}
</style>
