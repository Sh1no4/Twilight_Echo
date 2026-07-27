<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore } from '../stores/usePlayerStore'
import { findActiveWordIndex, type LyricWord } from '../utils/lyrics'

const props = defineProps<{
  words: LyricWord[]
  active: boolean
  offsetSeconds: number
}>()

const { currentTime } = usePlayerStore()
const activeWordIndex = computed(() => {
  if (!props.active) return -1
  return findActiveWordIndex(props.words, currentTime.value + props.offsetSeconds)
})
</script>

<template>
  <span class="lyric-text lyric-text--words">
    <span
      v-for="(word, index) in words"
      :key="`${index}-${word.time}`"
      class="lyric-word"
      :class="{ 'lyric-word--active': index === activeWordIndex }"
      >{{ word.text }}</span
    >
  </span>
</template>
