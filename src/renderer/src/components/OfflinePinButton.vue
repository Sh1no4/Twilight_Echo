<script setup lang="ts">
import { computed, ref } from 'vue'
import { getTrackProviderId } from '../providers/mediaProvider.ts'
import type { Track } from '../types/music'
import { useOfflineDownloads } from '../stores/useOfflineDownloads.ts'

const props = defineProps<{ track: Track }>()
const offline = useOfflineDownloads()
const busy = ref(false)
const error = ref('')
const pinUnsupported = computed(() => {
  if (!props.track.source || props.track.source === 'local') return true
  if (props.track.source === 'radio') return true
  return getTrackProviderId(props.track) === 'radio'
})
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
const pinTitle = computed(() => {
  if (props.track.source === 'radio' || getTrackProviderId(props.track) === 'radio') {
    return '直播电台无法离线固定'
  }
  return visibleError.value || '固定供离线使用'
})

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
      :disabled="busy || pinUnsupported"
      :title="pinTitle"
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
