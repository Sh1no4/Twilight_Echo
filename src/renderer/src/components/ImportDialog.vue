<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useMusicStore } from '../stores/useMusicStore'
import type { Track } from '../types/music'

defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const { scannedFolders, addFolder, addTracks, isScanning, saveLibrary } = useMusicStore()

const progress = ref({ current: 0, total: 0 })
const selectedFolders = ref<Set<string>>(new Set())

let cleanupProgress: (() => void) | null = null

const newlyAddedFolders = ref<string[]>([])

async function handleAddNewFolder(): Promise<void> {
  const path = await window.api.dialog.openFolder()
  if (path && !scannedFolders.value.includes(path)) {
    addFolder(path)
    selectedFolders.value.add(path)
    newlyAddedFolders.value.push(path)
  }
}

function toggleFolder(path: string): void {
  if (selectedFolders.value.has(path)) {
    selectedFolders.value.delete(path)
  } else {
    selectedFolders.value.add(path)
  }
}

async function startScan(): Promise<void> {
  if (isScanning.value) return

  const foldersToScan = Array.from(selectedFolders.value)

  if (foldersToScan.length === 0) {
    alert('请选择至少一个文件夹进行扫描')
    return
  }

  isScanning.value = true
  progress.value = { current: 0, total: 0 }

  try {
    for (const folder of foldersToScan) {
      const tracks = await window.api.fs.scanMusicFiles(folder)
      if (tracks && tracks.length > 0) {
        // Add in batches of 500
        const batchSize = 500
        for (let i = 0; i < tracks.length; i += batchSize) {
          const batch = (tracks as Track[]).slice(i, i + batchSize)
          await addTracks(batch)
          // Yield to allow UI updates
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
      }
    }

    // Save once at the end
    await saveLibrary()
    newlyAddedFolders.value = []
    emit('close')
  } catch (err) {
    console.error('Scan failed:', err)
  } finally {
    isScanning.value = false
    progress.value = { current: 0, total: 0 }
  }
}

onMounted(() => {
  scannedFolders.value.forEach((f) => selectedFolders.value.add(f))
  cleanupProgress = window.api.fs.onScanProgress((data) => {
    progress.value = data
  })
})

onUnmounted(() => {
  if (cleanupProgress) cleanupProgress()
})
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="modal-overlay" @click.self="emit('close')">
      <div class="import-dialog">
        <div class="dialog-header"></div>

        <div class="dialog-content">
          <div class="folder-list-section">
            <div class="section-header">
              <span class="section-title">已选文件夹</span>
            </div>

            <div class="folder-list">
              <div v-if="scannedFolders.length === 0" class="empty-folders">
                暂无文件夹，请点击下方按钮添加
              </div>
              <div v-for="folder in scannedFolders" :key="folder" class="folder-item">
                <i class="pi pi-folder"></i>
                <span class="folder-path" :title="folder">{{ folder }}</span>
                <input
                  type="checkbox"
                  :checked="selectedFolders.has(folder)"
                  :disabled="isScanning"
                  @change="toggleFolder(folder)"
                />
              </div>
            </div>
          </div>

          <div v-if="isScanning" class="progress-section">
            <div class="progress-info">
              <span>正在扫描...</span>
              <span>{{ progress.current }} / {{ progress.total }}</span>
            </div>
            <div class="progress-bar-bg">
              <div
                class="progress-bar-fill"
                :style="{
                  width: (progress.total > 0 ? (progress.current / progress.total) * 100 : 0) + '%'
                }"
              ></div>
            </div>
          </div>
        </div>

        <div class="dialog-footer">
          <button class="btn-cancel" :disabled="isScanning" @click="handleAddNewFolder">
            添加文件夹
          </button>
          <button
            class="btn-start"
            :disabled="isScanning || selectedFolders.size === 0"
            @click="startScan"
          >
            {{ isScanning ? '正在扫描...' : '重新扫描' }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  backdrop-filter: blur(4px);
}

.import-dialog {
  width: 500px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #eee;
}

.dialog-header {
  padding: 8px 20px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 24px;
}

.dialog-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
}

.btn-close {
  background: none;
  border: none;
  cursor: pointer;
  color: #999;
  font-size: 16px;
  padding: 4px;
}

.dialog-content {
  padding: 20px;
  flex: 1;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.section-title {
  font-size: 14px;
  font-weight: 500;
  color: #666;
}

.btn-add-folder {
  background: #f0f7ff;
  color: #1a73e8;
  border: 1px solid #c2e0ff;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;
}

.btn-add-folder:hover {
  background: #e1efff;
}

.folder-list {
  background: #f9f9f9;
  border: 1px solid #eee;
  border-radius: 8px;
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: 20px;
}

.empty-folders {
  padding: 32px;
  text-align: center;
  color: #999;
  font-size: 13px;
}

.folder-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  gap: 10px;
  border-bottom: 1px solid #eee;
}

.folder-item:last-child {
  border-bottom: none;
}

.folder-path {
  flex: 1;
  font-size: 13px;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.btn-remove-folder {
  background: none;
  border: none;
  cursor: pointer;
  color: #ccc;
  padding: 4px;
  transition: color 0.15s;
}

.btn-remove-folder:hover {
  color: #ff4d4f;
}

.options-section {
  margin-bottom: 20px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #666;
  cursor: pointer;
}

.progress-section {
  background: #f0f7ff;
  padding: 12px;
  border-radius: 8px;
  margin-top: 10px;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #1a73e8;
  margin-bottom: 8px;
}

.progress-bar-bg {
  height: 6px;
  background: #e1efff;
  border-radius: 3px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: #1a73e8;
  transition: width 0.3s ease;
}

.dialog-footer {
  padding: 16px 20px;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn-cancel {
  background: #fff;
  border: 1px solid #d9d9d9;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  color: #666;
}

.btn-start {
  background: #1a73e8;
  border: none;
  padding: 8px 24px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  color: #fff;
  font-weight: 500;
}

.btn-start:disabled {
  background: #bae7ff;
  cursor: not-allowed;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
