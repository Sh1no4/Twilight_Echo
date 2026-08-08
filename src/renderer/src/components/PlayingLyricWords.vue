<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { requestAnimationFrameWithFallback } from '../utils/animationFrameFallback'
import { getLyricWordProgress, type LyricWord } from '../utils/lyrics'

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

const wordElements = ref<Array<HTMLElement | null>>([])
let cancelScheduledFrame: (() => void) | null = null
let progressingWordIndex = -1
let syncGeneration = 0

function lyricTime(position = props.clock.snapshot.value.position): number {
  return position + props.offsetSeconds
}

function wordProgress(index: number, time: number): number {
  return getLyricWordProgress(props.words[index], props.words[index + 1]?.time, time)
}

function setWordProgress(index: number, progress: number): void {
  const element = wordElements.value[index]
  if (!element) return
  if (!props.karaokeEnabled) {
    element.style.removeProperty('--lyric-word-progress')
    element.style.removeProperty('--lyric-word-highlight-opacity')
    return
  }
  element.style.setProperty('--lyric-word-progress', `${progress * 100}%`)
  element.style.setProperty('--lyric-word-highlight-opacity', progress > 0 ? '1' : '0')
}

function setProgressingWord(index: number): void {
  if (progressingWordIndex === index) return
  const previous = wordElements.value[progressingWordIndex]
  if (previous) delete previous.dataset.progressing
  progressingWordIndex = index
  const current = wordElements.value[progressingWordIndex]
  if (current) current.dataset.progressing = 'true'
}

function findProgressingWordIndex(time: number): number {
  for (let index = 0; index < props.words.length; index += 1) {
    const word = props.words[index]
    if (time < word.time) break
    const endTime = word.endTime ?? props.words[index + 1]?.time ?? null
    if (endTime != null && endTime > word.time && time < endTime) return index
  }
  return -1
}

function syncAllWords(time: number): void {
  for (let index = 0; index < props.words.length; index += 1) {
    setWordProgress(index, props.active ? wordProgress(index, time) : 0)
  }
  setProgressingWord(props.active && props.karaokeEnabled ? findProgressingWordIndex(time) : -1)
}

function updateProgressingWord(time: number): void {
  if (!props.karaokeEnabled) {
    setProgressingWord(-1)
    return
  }
  const nextIndex = findProgressingWordIndex(time)
  if (nextIndex !== progressingWordIndex) {
    const previousIndex = progressingWordIndex
    setProgressingWord(nextIndex)
    if (previousIndex >= 0) setWordProgress(previousIndex, wordProgress(previousIndex, time))
  }
  if (nextIndex >= 0) setWordProgress(nextIndex, wordProgress(nextIndex, time))
}

function stopAnimation(): void {
  cancelScheduledFrame?.()
  cancelScheduledFrame = null
}

function scheduleAnimation(): void {
  if (cancelScheduledFrame || !props.active || !props.clock.isPlaying.value) return
  cancelScheduledFrame = requestAnimationFrameWithFallback(
    (now) => {
      cancelScheduledFrame = null
      if (!props.active || !props.clock.isPlaying.value) return
      updateProgressingWord(lyricTime(props.clock.positionAt(now)))
      scheduleAnimation()
    },
    80
  )
}

watch(
  [
    () => props.active,
    () => props.karaokeEnabled,
    () => props.words,
    () => props.offsetSeconds,
    () => props.clock.snapshot.value.epoch
  ],
  async () => {
    const generation = ++syncGeneration
    stopAnimation()
    await nextTick()
    if (generation !== syncGeneration) return
    syncAllWords(lyricTime())
    scheduleAnimation()
  },
  { immediate: true, flush: 'post' }
)

watch(
  () => (props.active ? props.clock.snapshot.value.revision : null),
  () => {
    if (!props.active) return
    const time = lyricTime()
    if (props.clock.isPlaying.value) updateProgressingWord(time)
    else syncAllWords(time)
  }
)

watch(props.clock.isPlaying, (playing) => {
  if (playing) scheduleAnimation()
  else stopAnimation()
})

onBeforeUnmount(() => {
  syncGeneration += 1
  stopAnimation()
})
</script>

<template>
  <span class="lyric-text lyric-text--words">
    <span
      v-for="(word, index) in words"
      :key="`${index}-${word.time}`"
      :ref="(element) => (wordElements[index] = element as HTMLElement | null)"
      class="lyric-word"
      :data-word-text="word.text"
      >{{ word.text }}</span
    >
  </span>
</template>
