<script setup lang="ts">
import { computed, ref } from 'vue'
import { getTrackProviderId } from '../providers/mediaProvider.ts'
import type { Track } from '../types/music'
import { useOfflineDownloads } from '../stores/useOfflineDownloads.ts'

const props = defineProps<{ track: Track }>()
const offline = useOfflineDownloads()
const busy = ref(false)
const error = ref('')
const downloadFailure = computed(() => {
  const providerId = getTrackProviderId(props.track)
  if (!providerId) return ''
  return (
    offline.records.value.find(
      (record) => record.providerId === providerId && record.trackId === props.track.id
    )?.error ?? ''
  )
})
const visibleError = computed(() => error.value || downloadFailure.value)

async function pin(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    await offline.pinTrack(props.track)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法固定此歌曲'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <span class="offline-pin-control">
    <button
      type="button"
      class="btn-like offline-pin-btn"
      :disabled="busy || !track.source || track.source === 'local'"
      :title="visibleError || '固定供离线使用'"
      :aria-label="`固定 ${track.title} 供离线使用`"
      @click.stop="pin"
    >
      <i :class="busy ? 'pi pi-spin pi-spinner' : 'pi pi-download'" style="font-size: 14px"></i>
    </button>
    <span v-if="visibleError" class="offline-pin-error" role="alert" aria-live="assertive">{{
      visibleError
    }}</span>
  </span>
</template>

<style scoped>
.offline-pin-control {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
}

.offline-pin-error {
  color: #a33;
  font-size: 11px;
  max-width: 180px;
  overflow-wrap: anywhere;
}
</style>
