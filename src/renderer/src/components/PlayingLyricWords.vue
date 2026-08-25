<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import {
  requestAnimationFrameWithFallback,
  waitForAnimationFrameWithFallback
} from '../utils/animationFrameFallback'
import { clamp, frameDeltaSeconds } from '../utils/lyricMotion'
import {
  buildSyllableGroups,
  LyricSweepChannel,
  type SyllableSweepGroup
} from '../utils/lyricSyllableSweep'
import {
  chunkAndSplitLyricWords,
  resolveLyricWordTimings,
  type ResolvedLyricWord
} from '../utils/lyricWordChunks'
import type { LyricWord } from '../utils/lyrics'

/**
 * Karaoke fill driven by the syllable-sweep engine: a single boundary in
 * cumulative text-width coordinates moves through linear keyframes whose
 * durations are each time group's own span, and every word's fill layer is
 * clipped to how much of it the boundary has passed.
 *
 * The fill layers are plain overlay spans clipped with `clip-path`, written
 * only when a word's revealed width actually changes, so the per-frame cost
 * is one engine update plus a handful of style writes on the active line.
 */

interface LyricClockSnapshot {
  epoch: number
  revision: number
  position: number
}

type LyricMotionMode = 'full' | 'reduced' | 'off'
type LyricAnimationVoiceRole = 'lead' | 'background' | 'harmony'
type LyricDirection = 'ltr' | 'rtl'

const props = withDefaults(
  defineProps<{
    words: LyricWord[]
    active: boolean
    karaokeEnabled: boolean
    offsetSeconds: number
    motionMode?: LyricMotionMode
    voiceRole?: LyricAnimationVoiceRole
    direction?: LyricDirection
    clock: {
      snapshot: Ref<LyricClockSnapshot>
      isPlaying: Ref<boolean>
      positionAt: (at?: number) => number
    }
  }>(),
  {
    motionMode: 'full',
    voiceRole: 'lead',
    direction: 'ltr'
  }
)

interface RenderSyllable {
  key: number
  word: ResolvedLyricWord
}

type RenderChunk =
  | { kind: 'space'; key: string; text: string }
  | { kind: 'word'; key: string; syllables: RenderSyllable[] }

const BUILD_FRAME_FALLBACK_MS = 120
/** Skip a frame's DOM writes when the boundary barely moved. */
const CLIP_WRITE_THRESHOLD_PX = 0.25
/** Stop the loop after this many fully idle frames. */
const IDLE_FRAME_GRACE = 4

const resolvedWords = computed<ResolvedLyricWord[]>(() => resolveLyricWordTimings(props.words))

const renderChunks = computed<RenderChunk[]>(() => {
  const chunks = chunkAndSplitLyricWords(resolvedWords.value)
  const result: RenderChunk[] = []
  let syllableKey = 0

  chunks.forEach((chunk, index) => {
    if (chunk.kind === 'space') {
      result.push({ kind: 'space', key: `s${index}`, text: chunk.text })
      return
    }
    const words = chunk.kind === 'word' ? [chunk.word] : chunk.words
    result.push({
      kind: 'word',
      key: `w${index}-${words[0]?.time ?? 0}`,
      syllables: words.map((word) => ({ key: syllableKey++, word }))
    })
  })

  return result
})

const sweepEnabled = computed(
  () => props.active && props.karaokeEnabled && props.motionMode === 'full' && hasTimedWords.value
)

const hasTimedWords = computed(() => resolvedWords.value.length > 0)

/** Flat word list in render order, matching the element arrays below. */
const flatSyllables = computed<RenderSyllable[]>(() =>
  renderChunks.value.flatMap((chunk) => (chunk.kind === 'word' ? chunk.syllables : []))
)

const wordElements = ref<Array<HTMLElement | null>>([])
const fillElements = ref<Array<HTMLElement | null>>([])

function setWordElement(index: number, element: Element | null): void {
  wordElements.value[index] = element instanceof HTMLElement ? element : null
}

function setFillElement(index: number, element: Element | null): void {
  fillElements.value[index] = element instanceof HTMLElement ? element : null
}

let channel: LyricSweepChannel | null = null
let wordCumulative: number[] = []
let wordWidths: number[] = []
let lastInsets: number[] = []
let cancelFrame: (() => void) | null = null
let lastFrameNow: number | null = null
let idleFrames = 0
let buildGeneration = 0

function lyricTime(): number {
  return props.clock.positionAt() + props.offsetSeconds
}

function cancelLoop(): void {
  cancelFrame?.()
  cancelFrame = null
  lastFrameNow = null
  idleFrames = 0
}

function releaseSweep(): void {
  cancelLoop()
  channel = null
  wordCumulative = []
  wordWidths = []
  lastInsets = []
  for (const element of fillElements.value) {
    if (element) element.style.clipPath = ''
  }
}

/** Measure the committed words and build the sweep channel for this layer. */
async function buildSweep(): Promise<void> {
  const generation = ++buildGeneration
  releaseSweep()
  if (!sweepEnabled.value) return

  await nextTick()
  await waitForAnimationFrameWithFallback(BUILD_FRAME_FALLBACK_MS)
  if (generation !== buildGeneration || !sweepEnabled.value) return

  const syllables = flatSyllables.value
  const widths = syllables.map((syllable) => {
    const element = wordElements.value[syllable.key]
    // `offsetWidth` is the layout width: transforms from the row's scale
    // spring must not leak into the clip math.
    return element ? element.offsetWidth : 0
  })
  const groups: SyllableSweepGroup[] = buildSyllableGroups(
    syllables.map((syllable) => syllable.word),
    widths
  )

  wordCumulative = []
  wordWidths = []
  let cumulative = 0
  for (const width of widths) {
    wordCumulative.push(cumulative)
    wordWidths.push(width)
    cumulative += width
  }
  lastInsets = widths.map(() => Number.NaN)

  channel = new LyricSweepChannel(groups)
  startLoop()
}

/** Write each word's clip from the boundary; true when anything changed. */
function writeClips(boundary: number): boolean {
  if (!channel) return false
  const rtl = props.direction === 'rtl'
  let changed = false

  for (let index = 0; index < wordWidths.length; index += 1) {
    const width = wordWidths[index]
    if (width <= 0) continue
    const element = fillElements.value[index]
    if (!element) continue

    const revealed = clamp(boundary - wordCumulative[index], 0, width)
    const inset = width - revealed
    if (Math.abs(inset - (lastInsets[index] ?? Number.NaN)) < CLIP_WRITE_THRESHOLD_PX) continue

    lastInsets[index] = inset
    changed = true
    element.style.clipPath =
      inset <= 0
        ? 'none'
        : rtl
          ? `inset(0 0 0 ${inset.toFixed(2)}px)`
          : `inset(0 ${inset.toFixed(2)}px 0 0)`
  }
  return changed
}

function frameLoop(now: number): void {
  cancelFrame = null
  if (!channel || !sweepEnabled.value) return

  const dt = frameDeltaSeconds(
    lastFrameNow == null ? 0 : (now - lastFrameNow) / 1000,
    lastFrameNow != null
  )
  lastFrameNow = now

  const time = lyricTime()
  const boundary = channel.update(time, dt)
  const changed = writeClips(boundary)
  idleFrames = changed ? 0 : idleFrames + 1

  const settled = idleFrames > IDLE_FRAME_GRACE
  if (settled && !channel.isSeeking() && (channel.finished(time) || !props.clock.isPlaying.value)) {
    lastFrameNow = null
    return
  }
  scheduleFrame()
}

function scheduleFrame(): void {
  if (cancelFrame) return
  cancelFrame = requestAnimationFrameWithFallback((now) => frameLoop(now), BUILD_FRAME_FALLBACK_MS)
}

function startLoop(): void {
  if (!channel || !sweepEnabled.value) return
  scheduleFrame()
}

watch(
  [
    () => props.active,
    () => props.karaokeEnabled,
    () => props.motionMode,
    () => props.direction,
    () => props.words
  ],
  () => {
    void buildSweep()
  },
  { immediate: true, flush: 'post' }
)

// A transport epoch bump marks a seek: follow the instant boundary from here.
watch(
  () => props.clock.snapshot.value.epoch,
  () => {
    if (!channel || !sweepEnabled.value) return
    channel.markSeek(lyricTime())
    startLoop()
  }
)

// Playback resuming re-opens a loop that idled out while paused.
watch(
  () => props.clock.isPlaying.value,
  (playing) => {
    if (playing) startLoop()
  }
)

onBeforeUnmount(() => {
  buildGeneration += 1
  releaseSweep()
})
</script>

<template>
  <span
    class="lyric-text lyric-text--words"
    :class="{ 'lyric-text--static': !sweepEnabled }"
    :dir="direction"
    :data-motion-mode="motionMode"
    :data-voice-role="voiceRole"
  >
    <template v-for="chunk in renderChunks" :key="chunk.key">
      <template v-if="chunk.kind === 'space'">{{ chunk.text }}</template>
      <span v-else class="lyric-word-group">
        <span
          v-for="syllable in chunk.syllables"
          :key="syllable.key"
          :ref="(element) => setWordElement(syllable.key, element as Element | null)"
          class="lyric-word"
          :data-word-text="syllable.word.text"
        >
          <span class="lyric-word__text">{{ syllable.word.text }}</span>
          <span
            v-if="sweepEnabled"
            :ref="(element) => setFillElement(syllable.key, element as Element | null)"
            class="lyric-word__fill"
            aria-hidden="true"
            >{{ syllable.word.text }}</span
          >
        </span>
      </span>
    </template>
  </span>
</template>

<style scoped>
.lyric-word-group {
  display: inline-block;
  white-space: pre-wrap;
}

.lyric-word {
  position: relative;
  display: inline-block;
  white-space: pre;
  backface-visibility: hidden;
}

/*
 * The fill layer re-draws the word in the karaoke colour and is clipped to
 * the swept width; `clip-path` values are written inline per frame.
 */
.lyric-word__fill {
  position: absolute;
  inset: 0;
  color: var(--te-playback-lyric-karaoke, currentColor);
  clip-path: inset(0 100% 0 0);
  pointer-events: none;
  user-select: none;
}

.lyric-text--static .lyric-word__fill {
  display: none;
}

:global([dir='rtl']) .lyric-word__fill {
  clip-path: inset(0 0 0 100%);
}
</style>
