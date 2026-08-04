<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch, type Ref, type WatchStopHandle } from 'vue'
import { getLyricWordProgress, type LyricWord } from '../utils/lyrics'

const props = defineProps<{
  words: LyricWord[]
  active: boolean
  karaokeEnabled: boolean
  offsetSeconds: number
  nextLineTime: number | null
  clock: {
    currentTime: Ref<number>
    isPlaying: Ref<boolean>
    playbackRate: Ref<number>
  }
}>()
const emit = defineEmits<{ reachNextLine: [time: number] }>()

const wordElements = ref<Array<HTMLElement | null>>([])
let animationFrame = 0
let clockAnchorPosition = 0
let clockAnchorTime = 0
let progressingWordIndex = -1
let stopClockWatch: WatchStopHandle | null = null
let stopPlaybackStateWatch: WatchStopHandle | null = null
let syncGeneration = 0
let reachedNextLine = false

function lyricTime(position = props.clock.currentTime.value): number {
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

function updateLineBoundary(time: number): void {
  if (reachedNextLine || !props.active || props.nextLineTime == null || time < props.nextLineTime)
    return
  reachedNextLine = true
  emit('reachNextLine', time)
}

function stopAnimation(): void {
  if (!animationFrame) return
  window.cancelAnimationFrame(animationFrame)
  animationFrame = 0
}

function animate(now: number): void {
  animationFrame = 0
  if (!props.active || !props.clock.isPlaying.value) return
  const rate = Number.isFinite(props.clock.playbackRate.value) ? props.clock.playbackRate.value : 1
  const predictedPosition = clockAnchorPosition + Math.max(0, now - clockAnchorTime) * rate * 0.001
  const time = lyricTime(predictedPosition)
  updateProgressingWord(time)
  updateLineBoundary(time)
  animationFrame = window.requestAnimationFrame(animate)
}

function startAnimation(): void {
  if (animationFrame || !props.active || !props.clock.isPlaying.value) return
  animationFrame = window.requestAnimationFrame(animate)
}

function anchorClock(): void {
  clockAnchorPosition = props.clock.currentTime.value
  clockAnchorTime = performance.now()
}

function unbindPlaybackClock(): void {
  stopClockWatch?.()
  stopPlaybackStateWatch?.()
  stopClockWatch = null
  stopPlaybackStateWatch = null
}

function bindPlaybackClock(): void {
  unbindPlaybackClock()
  if (!props.active) return

  stopClockWatch = watch(props.clock.currentTime, (position, previousPosition) => {
    const time = position + props.offsetSeconds
    const isSeek = position < previousPosition || Math.abs(position - previousPosition) > 1
    anchorClock()
    if (isSeek) syncAllWords(time)
    else updateProgressingWord(time)
    startAnimation()
  })

  stopPlaybackStateWatch = watch([props.clock.isPlaying, props.clock.playbackRate], () => {
    anchorClock()
    if (props.clock.isPlaying.value) startAnimation()
    else stopAnimation()
  })
}

watch(
  [
    () => props.active,
    () => props.karaokeEnabled,
    () => props.words,
    () => props.offsetSeconds,
    () => props.nextLineTime
  ],
  async () => {
    const generation = ++syncGeneration
    reachedNextLine = false
    stopAnimation()
    unbindPlaybackClock()
    anchorClock()
    await nextTick()
    if (generation !== syncGeneration) return
    const time = lyricTime()
    syncAllWords(time)
    updateLineBoundary(time)
    bindPlaybackClock()
    startAnimation()
  },
  { immediate: true, flush: 'post' }
)

onBeforeUnmount(() => {
  syncGeneration += 1
  stopAnimation()
  unbindPlaybackClock()
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
