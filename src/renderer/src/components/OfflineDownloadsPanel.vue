<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Track } from '../types/music'
import { useOfflineDownloads } from '../stores/useOfflineDownloads.ts'

const props = defineProps<{ tracks: Track[] }>()
const offline = useOfflineDownloads()
const {
  records,
  pinnedBytes,
  availableBytes,
  error: offlineError,
  loading,
  pinTracks,
  retry: retryDownload,
  cancel,
  unpin
} = offline
const expanded = ref(false)
const actionError = ref('')
const actionBusyId = ref('')
const onlineTracks = computed(() =>
  props.tracks.filter((track) => track.source && track.source !== 'local')
)

function formatBytes(value: number | null): string {
  if (value === null) return '未知'
  if (value < 1024 * 1024) return `${Math.max(0, Math.round(value / 1024))} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

async function pinAll(): Promise<void> {
  actionError.value = ''
  try {
    await pinTracks(onlineTracks.value)
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '离线下载启动失败'
  }
}

async function retry(record: (typeof offline.records.value)[number]): Promise<void> {
  const track = props.tracks.find((candidate) => candidate.id === record.trackId)
  if (!track) {
    actionError.value = '请重新打开包含这首歌的在线歌单后再重试'
    return
  }
  actionError.value = ''
  actionBusyId.value = record.id
  try {
    await retryDownload(record, track)
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '重试失败'
  } finally {
    actionBusyId.value = ''
  }
}

async function cancelDownload(record: (typeof offline.records.value)[number]): Promise<void> {
  actionError.value = ''
  actionBusyId.value = record.id
  try {
    await cancel(record)
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '取消下载失败'
  } finally {
    actionBusyId.value = ''
  }
}

async function removePin(record: (typeof offline.records.value)[number]): Promise<void> {
  actionError.value = ''
  actionBusyId.value = record.id
  try {
    await unpin(record)
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '取消固定失败'
  } finally {
    actionBusyId.value = ''
  }
}
</script>

<template>
  <div class="offline-downloads">
    <button
      type="button"
      class="stream-action-btn"
      :disabled="onlineTracks.length === 0 || loading"
      title="固定当前在线歌曲，下载完成后优先离线播放"
      @click="pinAll"
    >
      <i class="pi pi-download"></i>
      <span>离线可用{{ onlineTracks.length > 1 ? ` (${onlineTracks.length})` : '' }}</span>
    </button>
    <button
      type="button"
      class="stream-action-btn offline-toggle"
      :aria-expanded="expanded"
      title="查看固定下载的进度、空间、失败和过期状态"
      @click="expanded = !expanded"
    >
      <i class="pi pi-database"></i>
      <span>{{ formatBytes(pinnedBytes) }}</span>
    </button>
    <p v-if="actionError || offlineError" class="offline-error" role="alert" aria-live="assertive">
      {{ actionError || offlineError }}
    </p>
    <div v-if="expanded" class="offline-popover" role="region" aria-label="离线下载管理">
      <div class="offline-space">
        固定内容 {{ formatBytes(pinnedBytes) }}
        <span>可用空间 {{ formatBytes(availableBytes) }}</span>
      </div>
      <p v-if="records.length === 0" class="offline-empty">还没有固定的在线歌曲</p>
      <ul v-else class="offline-list">
        <li v-for="record in records" :key="record.id">
          <div>
            <strong>{{ record.title }}</strong>
            <small>
              {{ record.quality }} · {{ record.status }} ·
              {{
                record.expiresAt
                  ? `到期 ${new Date(record.expiresAt).toLocaleDateString()}`
                  : '无已知到期'
              }}
            </small>
          </div>
          <progress
            v-if="record.status === 'queued' || record.status === 'downloading'"
            :value="record.totalBytes === null ? undefined : record.bytesDownloaded"
            :max="record.totalBytes === null ? undefined : record.totalBytes"
            :aria-label="
              record.totalBytes === null
                ? `${record.title} 下载中，已下载 ${formatBytes(record.bytesDownloaded)}，总大小未知`
                : `${record.title} 下载进度 ${record.bytesDownloaded} / ${record.totalBytes} 字节`
            "
          ></progress>
          <small
            v-if="
              (record.status === 'queued' || record.status === 'downloading') &&
              record.totalBytes === null
            "
            class="offline-progress-detail"
          >
            已下载 {{ formatBytes(record.bytesDownloaded) }}，总大小未知
          </small>
          <span v-if="record.error" class="offline-error" role="alert" aria-live="assertive">{{
            record.error
          }}</span>
          <button
            v-if="record.status === 'queued' || record.status === 'downloading'"
            type="button"
            title="取消下载"
            :disabled="actionBusyId === record.id"
            @click="cancelDownload(record)"
          >
            <i class="pi pi-times"></i>
          </button>
          <button
            v-if="record.status === 'completed'"
            type="button"
            title="取消固定并删除离线文件"
            :disabled="actionBusyId === record.id"
            @click="removePin(record)"
          >
            <i class="pi pi-trash"></i>
          </button>
          <button
            v-if="
              record.status === 'failed' ||
              record.status === 'cancelled' ||
              record.status === 'expired' ||
              (record.status === 'completed' && Boolean(record.error))
            "
            type="button"
            title="使用新的在线地址重试下载"
            :disabled="actionBusyId === record.id"
            @click="retry(record)"
          >
            <i class="pi pi-refresh"></i>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.offline-downloads {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  position: relative;
}
.offline-toggle {
  min-width: 82px;
}
.offline-popover {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 12;
  width: min(420px, 80vw);
  max-height: 360px;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--border-color, #d8d8d8);
  background: var(--bg-color, #fff);
  box-shadow: 0 5px 20px rgb(0 0 0 / 15%);
}
.offline-space,
.offline-list li {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  align-items: center;
}
.offline-list {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}
.offline-list li {
  flex-wrap: wrap;
  padding: 8px 0;
  border-top: 1px solid var(--border-color, #eee);
}
.offline-list small,
.offline-error {
  display: block;
  color: #a33;
}
.offline-list .offline-progress-detail {
  color: #666;
  width: 100%;
}
.offline-list progress {
  width: 100%;
}
.offline-empty {
  margin: 8px 0 0;
  color: #777;
}
</style>
