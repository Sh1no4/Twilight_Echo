<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { requestAnimationFrameWithFallback } from '../utils/animationFrameFallback'
import { buildKaraokeMaskPlan, type WordMeasurement } from '../utils/lyricEmphasis'
import {
  chunkAndSplitLyricWords,
  chunkSpan,
  resolveLyricWordTimings,
  type ResolvedLyricWord
} from '../utils/lyricWordChunks'
import type { LyricWord } from '../utils/lyrics'

/**
 * Karaoke fill and emphasis run on the Web Animations API rather than a
 * per-frame JavaScript loop.
 *
 * The previous version recomputed a CSS variable every frame on the main thread,
 * so any main-thread work showed up as a stutter in the fill, and a seek had to
 * be chased frame by frame. Precomputing keyframes hands the whole timeline to
 * the compositor: the fill cannot stutter, and a seek is one `currentTime`
 * assignment.
 *
 * Every animation shares one time origin (the line's start), so a single
 * `currentTime` value keeps the fill coherent.
 */

interface LyricClockSnapshot {
  epoch: number
  revision: number
  position: number
}

const props = defineProps<{
  words: LyricWord[]
  active: boolean
  karaokeEnabled: boolean
  offsetSeconds: number
  clock: {
    snapshot: Ref<LyricClockSnapshot>
    isPlaying: Ref<boolean>
    positionAt: (at?: number) => number
  }
}>()

interface RenderSyllable {
  key: number
  word: ResolvedLyricWord
}

type RenderChunk =
  | { kind: 'space'; key: string; text: string }
  | { kind: 'word'; key: string; syllables: RenderSyllable[] }

/** Drift beyond this is corrected; below it, leave the compositor alone. */
const DRIFT_TOLERANCE_MS = 80
const BUILD_FRAME_FALLBACK_MS = 120

const wordElements = ref<Array<HTMLElement | null>>([])
let activeAnimations: Animation[] = []
let cancelScheduledBuild: (() => void) | null = null
let buildGeneration = 0

const resolvedWords = computed<ResolvedLyricWord[]>(() => resolveLyricWordTimings(props.words))

const lineStartSeconds = computed(() => {
  let start = Number.POSITIVE_INFINITY
  for (const word of resolvedWords.value) start = Math.min(start, word.time)
  return Number.isFinite(start) ? start : 0
})

const lineEndSeconds = computed(() => {
  let end = Number.NEGATIVE_INFINITY
  for (const word of resolvedWords.value) end = Math.max(end, word.endTime)
  return Number.isFinite(end) ? end : lineStartSeconds.value
})

const renderChunks = computed<RenderChunk[]>(() => {
  const chunks = chunkAndSplitLyricWords(resolvedWords.value)
  const result: RenderChunk[] = []
  let syllableKey = 0

  chunks.forEach((chunk, index) => {
    if (chunk.kind === 'space') {
      result.push({ kind: 'space', key: `s${index}`, text: chunk.text })
      return
    }

    const span = chunkSpan(chunk)
    const words = chunk.kind === 'word' ? [chunk.word] : chunk.words

    result.push({
      kind: 'word',
      key: `w${index}-${span?.time ?? 0}`,
      syllables: words.map((word) => ({ key: syllableKey++, word }))
    })
  })

  return result
})

function supportsWebAnimations(): boolean {
  return typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function'
}

function lyricTime(position = props.clock.positionAt()): number {
  return position + props.offsetSeconds
}

function timelineMs(time = lyricTime()): number {
  // All animations use the line as their time origin. Keep that shared clock
  // inside the line window: after a line is complete, WAAPI should retain its
  // final fill instead of receiving an ever-growing currentTime that can make
  // the first word's delayed effects appear to start over.
  const lineDurationMs = Math.max(0, (lineEndSeconds.value - lineStartSeconds.value) * 1000)
  return Math.min(lineDurationMs, Math.max(0, (time - lineStartSeconds.value) * 1000))
}

function releaseAnimations(): void {
  for (const animation of activeAnimations) animation.cancel()
  activeAnimations = []
  for (const element of wordElements.value) {
    if (!element) continue
    element.style.removeProperty('mask-image')
    element.style.removeProperty('-webkit-mask-image')
    element.style.removeProperty('mask-size')
    element.style.removeProperty('-webkit-mask-size')
    element.style.removeProperty('mask-repeat')
    element.style.removeProperty('mask-origin')
  }
}

function measureWords(): WordMeasurement[] {
  return wordElements.value.map((element) => {
    if (!element) return { width: 0, height: 0, padding: 0 }
    const padding = Number.parseFloat(getComputedStyle(element).paddingLeft) || 0
    return {
      width: element.clientWidth - padding * 2,
      height: element.clientHeight - padding * 2,
      padding
    }
  })
}

/**
 * Measure, then hand the whole line to the compositor. Measuring needs a
 * committed layout, which is why this waits for a frame.
 */
function buildAnimations(): void {
  releaseAnimations()
  if (!supportsWebAnimations() || !props.active || resolvedWords.value.length === 0) return

  const words = resolvedWords.value
  const measurements = measureWords()
  const lineStart = lineStartSeconds.value
  const lineEnd = lineEndSeconds.value
  let syllableIndex = 0

  for (const chunk of renderChunks.value) {
    if (chunk.kind === 'space') continue

    for (let wordIndex = 0; wordIndex < chunk.syllables.length; wordIndex += 1) {
      const element = wordElements.value[syllableIndex]
      const index = syllableIndex
      syllableIndex += 1
      if (!element) continue

      if (props.karaokeEnabled) {
        const mask = buildKaraokeMaskPlan(words, measurements, index, lineStart, lineEnd)
        if (mask) {
          element.style.setProperty('mask-image', mask.maskImage)
          element.style.setProperty('-webkit-mask-image', mask.maskImage)
          element.style.setProperty('mask-size', mask.maskSize)
          element.style.setProperty('-webkit-mask-size', mask.maskSize)
          element.style.setProperty('mask-repeat', 'no-repeat')
          element.style.setProperty('mask-origin', 'left')
          try {
            activeAnimations.push(element.animate(mask.keyframes, mask.timing))
          } catch {
            // A malformed keyframe set must not take the line down with it.
            element.style.removeProperty('mask-image')
            element.style.removeProperty('-webkit-mask-image')
          }
        }
      }
    }
  }

  syncAnimations(true)
}

/**
 * Align the compositor timeline with playback. `hard` seeks unconditionally;
 * otherwise only correct once drift is audible, so a healthy line is left to run.
 */
function syncAnimations(hard = false): void {
  if (activeAnimations.length === 0) return

  // `positionAt()` is an interpolated clock, unlike the lower-frequency
  // snapshot samples. Feeding snapshot positions back into a compositor-driven
  // animation makes its fill visibly step backwards whenever the audio engine
  // corrects a sample. During ordinary playback, preserve the compositor's
  // monotonic motion and only correct material forward drift. Epoch changes
  // (explicit seeks / track transitions) remain precise hard jumps.
  const target = timelineMs()
  const playing = props.active && props.clock.isPlaying.value

  for (const animation of activeAnimations) {
    const current = Number(animation.currentTime ?? 0)
    const forwardDrift = target - current
    const shouldCorrect =
      hard ||
      (!playing
        ? Math.abs(forwardDrift) > DRIFT_TOLERANCE_MS
        : forwardDrift > DRIFT_TOLERANCE_MS)
    if (shouldCorrect) animation.currentTime = target
    if (playing) animation.play()
    else animation.pause()
  }
}

function scheduleBuild(): void {
  const generation = ++buildGeneration
  cancelScheduledBuild?.()
  cancelScheduledBuild = requestAnimationFrameWithFallback(() => {
    cancelScheduledBuild = null
    if (generation !== buildGeneration) return
    buildAnimations()
  }, BUILD_FRAME_FALLBACK_MS)
}

watch(
  [() => props.active, () => props.karaokeEnabled, () => props.words, () => props.offsetSeconds],
  async () => {
    const generation = ++buildGeneration
    cancelScheduledBuild?.()
    cancelScheduledBuild = null
    releaseAnimations()
    await nextTick()
    if (generation !== buildGeneration) return
    scheduleBuild()
  },
  { immediate: true, flush: 'post' }
)

// A seek changes the clock epoch. Retarget the existing compositor effects
// instead of cancelling, measuring and rebuilding them for a frame.
watch(
  () => (props.active ? props.clock.snapshot.value.epoch : null),
  () => {
    if (!props.active) return
    syncAnimations(true)
  }
)

// The clock ticks far slower than a frame; this only corrects material forward
// drift. Backward sample corrections are deliberately left to the continuous
// compositor timeline so the visible fill never twitches.
watch(
  () => (props.active ? props.clock.snapshot.value.revision : null),
  () => {
    if (!props.active) return
    syncAnimations()
  }
)

watch(props.clock.isPlaying, () => {
  syncAnimations(true)
})

onBeforeUnmount(() => {
  buildGeneration += 1
  cancelScheduledBuild?.()
  cancelScheduledBuild = null
  releaseAnimations()
})
</script>

<template>
  <span class="lyric-text lyric-text--words">
    <template v-for="chunk in renderChunks" :key="chunk.key">
      <span v-if="chunk.kind === 'space'" class="lyric-space">{{ chunk.text }}</span>
      <span v-else class="lyric-word-group">
        <span
          v-for="syllable in chunk.syllables"
          :key="syllable.key"
          :ref="(element) => (wordElements[syllable.key] = (element as HTMLElement | null) ?? null)"
          class="lyric-word"
          :data-word-text="syllable.word.text"
        >
          {{ syllable.word.text }}
        </span>
      </span>
    </template>
  </span>
</template>
