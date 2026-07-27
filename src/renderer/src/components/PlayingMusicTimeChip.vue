<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore } from '../stores/usePlayerStore'

const { currentTime, duration, formatTime } = usePlayerStore()
const label = computed(() => `${formatTime(currentTime.value)} / ${formatTime(duration.value)}`)
</script>

<template>
  <div class="time-chip">{{ label }}</div>
</template>
