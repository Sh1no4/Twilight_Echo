<script setup lang="ts">
import { ref, computed } from 'vue'
import Slider from 'primevue/slider'
import { usePlayerStore } from '../stores/usePlayerStore'

defineProps<{
  glass?: boolean
}>()

const {
  currentTrack,
  dominantColor,
  isPlaying,
  currentTime,
  duration,
  volume,
  queue,
  queueIndex,
  playMode,
  cyclePlayMode,
  togglePlay,
  next,
  prev,
  seek,
  playTrack,
  formatTime
} = usePlayerStore()

const coverRef = ref<HTMLElement | null>(null)

const emit = defineEmits<{
  clickCover: [rect: { x: number; y: number; w: number; h: number }]
}>()

function onCoverClick(): void {
  const el = coverRef.value
  if (el) {
    const r = el.getBoundingClientRect()
    emit('clickCover', { x: r.left, y: r.top, w: r.width, h: r.height })
  } else {
    emit('clickCover', { x: 24, y: window.innerHeight - 60, w: 48, h: 48 })
  }
}

function onSeek(value: number | number[]): void {
  seek(Array.isArray(value) ? value[0] : value)
}

const volumeOpen = ref(false)
const playlistOpen = ref(false)

function toggleVolume(): void {
  volumeOpen.value = !volumeOpen.value
  if (volumeOpen.value) {
    playlistOpen.value = false
  }
}

function togglePlaylist(): void {
  playlistOpen.value = !playlistOpen.value
  if (playlistOpen.value) {
    volumeOpen.value = false
  }
}

const modeLabels: Record<string, string> = {
  sequential: '顺序播放',
  repeat: '单曲循环',
  shuffle: '随机播放'
}

const modeTitle = computed(() => modeLabels[playMode.value] ?? '')

function playTrackAt(index: number): void {
  const track = queue.value[index]
  if (track) {
    playTrack(track, queue.value)
  }
}
</script>

<template>
  <div v-if="currentTrack" class="player-bar-shell">
    <!-- 播放列表面板（向上抽屉） -->
    <Transition name="drawer-up">
      <div v-if="playlistOpen" class="playlist-panel" :class="{ 'panel-glass': glass }">
        <div class="playlist-header">
          <span>播放列表</span>
          <span class="playlist-count">{{ queue.length }} 首</span>
        </div>
        <div class="playlist-list">
          <div
            v-for="(track, i) in queue"
            :key="track.id"
            class="playlist-item"
            :class="{ active: i === queueIndex }"
            @click="playTrackAt(i)"
          >
            <span class="playlist-index">
              <i v-if="i === queueIndex" class="pi pi-volume-up playing-dot"></i>
              <span v-else>{{ i + 1 }}</span>
            </span>
            <img v-if="track.cover" :src="track.cover" class="playlist-cover" alt="" />
            <div v-else class="playlist-cover-placeholder">
              <i class="pi pi-wave-pulse" style="font-size: 12px; color: #bbb"></i>
            </div>
            <div class="playlist-info">
              <div class="playlist-title">{{ track.title }}</div>
              <div class="playlist-artist">{{ track.artist }}</div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- PlayerBar 主体 -->
    <div
      class="player-bar"
      :class="{ 'player-bar-glass': glass }"
      :style="{ '--accent-color': dominantColor }"
    >
      <!-- 左侧 -->
      <div class="player-left">
        <img
          v-if="currentTrack.cover"
          ref="coverRef"
          :src="currentTrack.cover"
          class="player-cover"
          alt="cover"
          title="打开播放页面"
          @click="onCoverClick"
        />
        <div v-else ref="coverRef" class="player-cover-placeholder" @click="onCoverClick">
          <i class="pi pi-wave-pulse" style="font-size: 18px; color: #bbb"></i>
        </div>
        <div class="player-track-info">
          <div class="player-title">{{ currentTrack.title }}</div>
          <div class="player-artist">{{ currentTrack.artist }}</div>
        </div>
      </div>

      <!-- 中间 -->
      <div class="player-center">
        <div class="player-controls">
          <button class="ctrl-btn" aria-label="上一首" @click="prev">
            <img src="/skip-last.svg" alt="上一首" />
          </button>
          <button class="ctrl-btn btn-play" aria-label="播放/暂停" @click="togglePlay">
            <img :src="isPlaying ? '/Pause.svg' : '/Start.svg'" alt="播放/暂停" />
          </button>
          <button class="ctrl-btn" aria-label="下一首" @click="next">
            <img src="/skip-next.svg" alt="下一首" />
          </button>
        </div>
        <div class="progress-area">
          <span class="time-label">{{ formatTime(currentTime) }}</span>
          <Slider
            :model-value="currentTime"
            :min="0"
            :max="duration || 1"
            :step="0.1"
            class="progress-slider"
            @update:model-value="onSeek"
          />
          <span class="time-label">{{ formatTime(duration) }}</span>
        </div>
      </div>

      <!-- 右侧 -->
      <div class="player-right">
        <button class="ctrl-btn mode-btn-right" :title="modeTitle" @click="cyclePlayMode">
          <img v-if="playMode === 'sequential'" src="/sequential%20playback.svg" alt="顺序" />
          <img v-else-if="playMode === 'repeat'" src="/Single%20song%20repeat.svg" alt="单曲循环" />
          <img v-else src="/Shuffle.svg" alt="随机" />
        </button>

        <!-- 音量按钮 + 向上弹出抽屉 -->
        <div class="volume-anchor">
          <Transition name="volume-drawer">
            <div v-if="volumeOpen" class="volume-drawer" :class="{ 'drawer-glass': glass }">
              <Slider
                v-model="volume"
                :min="0"
                :max="1"
                :step="0.01"
                orientation="vertical"
                class="volume-drawer-slider"
              />
              <span class="volume-drawer-val">{{ Math.round(volume * 100) }}</span>
            </div>
          </Transition>
          <button
            class="icon-btn"
            :class="{ active: volumeOpen }"
            title="音量"
            @click="toggleVolume"
          >
            <i class="pi pi-volume-up"></i>
          </button>
        </div>

        <button
          class="icon-btn"
          :class="{ active: playlistOpen }"
          title="播放列表"
          @click="togglePlaylist"
        >
          <i class="pi pi-list"></i>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ===== Shell ===== */
.player-bar-shell {
  position: fixed;
  bottom: 14px;
  left: 18px;
  right: 18px;
  z-index: 1002;
  pointer-events: none;
}

/* ===== Upward Drawer Transition ===== */
.drawer-up-enter-active {
  transition:
    opacity 0.28s ease,
    transform 0.34s var(--te-ease-soft);
}
.drawer-up-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.22s var(--te-ease-enter);
}
.drawer-up-enter-from,
.drawer-up-leave-to {
  opacity: 0;
  transform: translateY(16px) scale(0.985);
}

/* ===== Volume Drawer ===== */
.volume-anchor {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.volume-drawer {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 10px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.62);
  border-radius: 14px;
  box-shadow: 0 18px 55px rgba(86, 70, 160, 0.16);
  padding: 10px 6px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  backdrop-filter: blur(18px) saturate(150%);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
}

.volume-drawer.drawer-glass {
  background: rgba(255, 255, 255, 0.28);
  backdrop-filter: blur(22px) saturate(160%);
  -webkit-backdrop-filter: blur(22px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.28);
}

.volume-drawer-slider {
  height: 120px;
}

.volume-drawer-slider :deep(.p-slider) {
  background: color-mix(in srgb, var(--accent-color, #1a73e8) 18%, transparent);
  border-radius: 999px;
  padding: 0 10px;
  margin: 0 -10px;
  background-clip: content-box;
}

.volume-drawer-slider :deep(.p-slider-range) {
  background: var(--accent-color, #1a73e8);
}

.volume-drawer-slider :deep(.p-slider-handle) {
  display: none;
}

.drawer-glass .volume-drawer-slider :deep(.p-slider) {
  background: rgba(255, 255, 255, 0.12);
}

.drawer-glass .volume-drawer-slider :deep(.p-slider-range) {
  background: rgba(255, 255, 255, 0.55);
}

.drawer-glass .volume-drawer-slider :deep(.p-slider-handle) {
  display: none;
}

.volume-drawer-val {
  font-size: 11px;
  color: #888;
  font-variant-numeric: tabular-nums;
}

.drawer-glass .volume-drawer-val {
  color: rgba(255, 255, 255, 0.6);
}

.volume-drawer-enter-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.volume-drawer-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.volume-drawer-enter-from,
.volume-drawer-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px);
}

/* ===== Playlist Panel ===== */
.playlist-panel {
  position: relative;
  overflow: hidden;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.72), rgba(248, 245, 255, 0.52)),
    rgba(255, 255, 255, 0.56);
  border: 1px solid rgba(255, 255, 255, 0.66);
  border-bottom: 0;
  border-radius: 22px 22px 0 0;
  box-shadow:
    0 -26px 90px rgba(86, 70, 160, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
  margin: 0 clamp(8px, 2vw, 28px) 12px;
  max-height: 390px;
  display: flex;
  flex-direction: column;
  backdrop-filter: blur(22px) saturate(150%);
  -webkit-backdrop-filter: blur(22px) saturate(150%);
}

.playlist-panel::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -2;
  pointer-events: none;
  background:
    radial-gradient(circle at 18% 18%, rgba(255, 255, 255, 0.88), transparent 18%),
    radial-gradient(circle at 24% 30%, rgba(124, 77, 255, 0.28), transparent 38%),
    radial-gradient(circle at 82% 18%, rgba(255, 126, 182, 0.22), transparent 34%),
    radial-gradient(circle at 58% 92%, rgba(34, 211, 238, 0.16), transparent 42%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.48), rgba(245, 241, 255, 0.22));
  animation: playlist-light 10s var(--te-ease-soft) infinite alternate;
}

.playlist-panel::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.46),
      transparent 22% 78%,
      rgba(255, 255, 255, 0.3)
    ),
    linear-gradient(180deg, rgba(255, 255, 255, 0.48), rgba(255, 255, 255, 0.16));
}
.playlist-panel.panel-glass {
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.34), rgba(255, 255, 255, 0.18)),
    rgba(17, 24, 39, 0.18);
  backdrop-filter: blur(24px) saturate(165%);
  -webkit-backdrop-filter: blur(24px) saturate(165%);
  border-color: rgba(255, 255, 255, 0.26);
}
.playlist-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 22px 10px;
  font-size: 14px;
  font-weight: 700;
  color: var(--te-neutral-900);
  flex-shrink: 0;
}
.panel-glass .playlist-header {
  color: #fff;
}
.playlist-count {
  font-size: 12px;
  font-weight: 500;
  color: var(--te-neutral-500);
}
.panel-glass .playlist-count {
  color: rgba(255, 255, 255, 0.5);
}
.playlist-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px 12px;
  scrollbar-width: thin;
  scrollbar-color: rgba(124, 77, 255, 0.26) transparent;
}

.playlist-list::-webkit-scrollbar {
  width: 10px;
}

.playlist-list::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  border-radius: 999px;
  background: rgba(124, 77, 255, 0.28);
  background-clip: content-box;
}
.playlist-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 14px;
  cursor: pointer;
  border: 1px solid transparent;
  transition:
    background 0.18s,
    transform 0.18s var(--te-ease-soft),
    border-color 0.18s,
    box-shadow 0.18s;
}
.playlist-item:hover {
  background: rgba(255, 255, 255, 0.58);
  border-color: rgba(255, 255, 255, 0.52);
  box-shadow: 0 12px 34px rgba(86, 70, 160, 0.12);
  transform: translateY(-1px);
}
.panel-glass .playlist-item:hover {
  background: rgba(255, 255, 255, 0.16);
  border-color: rgba(255, 255, 255, 0.18);
}
.playlist-item.active {
  background:
    linear-gradient(90deg, rgba(124, 77, 255, 0.18), rgba(255, 126, 182, 0.1)),
    rgba(255, 255, 255, 0.48);
  border-color: rgba(124, 77, 255, 0.18);
  box-shadow:
    0 14px 34px rgba(124, 77, 255, 0.12),
    inset 3px 0 0 rgba(124, 77, 255, 0.72);
}
.panel-glass .playlist-item.active {
  background:
    linear-gradient(90deg, rgba(124, 77, 255, 0.28), rgba(255, 126, 182, 0.14)),
    rgba(255, 255, 255, 0.16);
}
.playlist-index {
  width: 20px;
  text-align: center;
  font-size: 12px;
  color: #bbb;
  flex-shrink: 0;
}
.playlist-item.active .playlist-index {
  color: var(--te-primary-500);
}
.panel-glass .playlist-item.active .playlist-index {
  color: rgba(255, 255, 255, 0.8);
}
.playing-dot {
  font-size: 11px;
}
.playlist-cover {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  object-fit: cover;
  flex-shrink: 0;
  box-shadow: 0 8px 20px rgba(86, 70, 160, 0.18);
}
.playlist-cover-placeholder {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background:
    radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.8), transparent 36%),
    linear-gradient(135deg, rgba(124, 77, 255, 0.2), rgba(34, 211, 238, 0.12));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.panel-glass .playlist-cover-placeholder {
  background: rgba(255, 255, 255, 0.08);
}
.playlist-info {
  overflow: hidden;
  min-width: 0;
}
.playlist-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--te-neutral-900);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.playlist-item.active .playlist-title {
  color: var(--te-primary-500);
}
.panel-glass .playlist-title {
  color: rgba(255, 255, 255, 0.9);
}
.panel-glass .playlist-item.active .playlist-title {
  color: #fff;
}
.playlist-artist {
  font-size: 11px;
  color: var(--te-neutral-500);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
}
.panel-glass .playlist-artist {
  color: rgba(255, 255, 255, 0.5);
}

/* ===== Player Bar ===== */
.player-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 72px;
  max-width: 1180px;
  margin: 0 auto;
  border-radius: 22px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.66), rgba(248, 245, 255, 0.42)),
    rgba(255, 255, 255, 0.48);
  border: 1px solid rgba(255, 255, 255, 0.68);
  padding: 0 22px;
  box-shadow:
    0 24px 80px rgba(86, 70, 160, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  pointer-events: auto;
  transition:
    background 0.3s,
    border-color 0.3s,
    box-shadow 0.3s;
}

.player-bar-glass {
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.26), rgba(255, 255, 255, 0.1)),
    rgba(17, 24, 39, 0.22);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border-top: 1px solid rgba(255, 255, 255, 0.18);
  box-shadow: 0 -22px 70px rgba(17, 24, 39, 0.22);
}

.player-bar-glass .player-title {
  color: #fff;
}
.player-bar-glass .player-artist {
  color: rgba(255, 255, 255, 0.7);
}
.player-bar-glass .ctrl-btn {
  color: rgba(255, 255, 255, 0.8);
}
.player-bar-glass .ctrl-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}
.player-bar-glass .btn-play:hover {
  background: var(--accent-color, #1a73e8);
}
.player-bar-glass .mode-btn-right {
  color: rgba(255, 255, 255, 0.6);
}
.player-bar-glass .mode-btn-right img {
  opacity: 0.55;
}
.player-bar-glass .time-label {
  color: rgba(255, 255, 255, 0.5);
}
.player-bar-glass .player-cover-placeholder {
  background: rgba(255, 255, 255, 0.1);
}
.player-bar-glass .player-cover-placeholder:hover {
  background: rgba(255, 255, 255, 0.18);
}
.player-bar-glass .player-cover-placeholder i {
  color: rgba(255, 255, 255, 0.4);
}
.player-bar-glass .icon-btn {
  color: rgba(255, 255, 255, 0.6);
}
.player-bar-glass .icon-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}
.player-bar-glass .icon-btn.active {
  color: var(--accent-color, #1a73e8);
  background: rgba(26, 115, 232, 0.15);
}

.player-bar-glass :deep(.p-slider) {
  background: color-mix(in srgb, var(--accent-color, #1a73e8) 12%, transparent);
}
.player-bar-glass :deep(.p-slider-range) {
  background: rgba(255, 255, 255, 0.7);
}
.player-bar-glass :deep(.p-slider-handle) {
  opacity: 0;
  pointer-events: none;
}

/* ===== Player Left ===== */
.player-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 220px;
  max-width: 300px;
}
.player-cover {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  object-fit: cover;
  flex-shrink: 0;
  cursor: pointer;
  transition:
    transform 0.22s var(--te-ease-soft),
    box-shadow 0.22s,
    filter 0.22s;
  box-shadow: 0 14px 32px rgba(86, 70, 160, 0.2);
}
.player-cover:hover {
  transform: translateY(-2px) scale(1.05);
  box-shadow: 0 20px 45px rgba(86, 70, 160, 0.26);
  filter: saturate(1.08);
}
.player-cover-placeholder {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background:
    radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.9), transparent 36%),
    linear-gradient(135deg, rgba(124, 77, 255, 0.2), rgba(34, 211, 238, 0.12));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  transition: background 0.15s;
}
.player-cover-placeholder:hover {
  background: #eee;
}
.player-track-info {
  overflow: hidden;
  min-width: 0;
}
.player-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--te-neutral-900);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.player-artist {
  font-size: 12px;
  color: #999;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ===== Player Center ===== */
.player-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex: 1;
  max-width: 600px;
  margin: 0 40px;
}
.player-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
}
.ctrl-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 6px;
  border-radius: 50%;
  transition: background 0.15s;
  color: #555;
}
.ctrl-btn:hover {
  background: #f0f0f0;
}
.ctrl-btn img {
  width: 25px;
  height: 25px;
}
.btn-play {
  width: 44px;
  height: 44px;
  background:
    radial-gradient(circle at 34% 25%, rgba(255, 255, 255, 0.42), transparent 26%),
    linear-gradient(135deg, var(--accent-color, #7c4dff), #a855f7);
  color: #fff;
  padding: 10px;
  box-shadow:
    0 14px 34px color-mix(in srgb, var(--accent-color, #7c4dff) 32%, transparent),
    0 0 0 6px color-mix(in srgb, var(--accent-color, #7c4dff) 8%, transparent);
  transition:
    transform 0.2s var(--te-ease-soft),
    box-shadow 0.2s;
}
.btn-play:hover {
  background:
    radial-gradient(circle at 34% 25%, rgba(255, 255, 255, 0.5), transparent 26%),
    linear-gradient(135deg, var(--accent-color, #7c4dff), #c084fc);
  transform: translateY(-2px) scale(1.06);
  box-shadow:
    0 18px 42px color-mix(in srgb, var(--accent-color, #7c4dff) 38%, transparent),
    0 0 0 9px color-mix(in srgb, var(--accent-color, #7c4dff) 9%, transparent);
}
.btn-play img {
  width: 22px;
  height: 22px;
  filter: brightness(0) invert(1);
}

/* ===== Progress ===== */
.progress-area {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.time-label {
  font-size: 11px;
  color: #999;
  min-width: 36px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.progress-slider {
  flex: 1;
}
.progress-slider :deep(.p-slider) {
  background: color-mix(in srgb, var(--accent-color, #1a73e8) 18%, transparent);
  padding: 14px 0;
  margin: -14px 0;
  background-clip: content-box;
}
.progress-slider :deep(.p-slider-range) {
  background: linear-gradient(90deg, var(--accent-color, #7c4dff), #c084fc);
}
.progress-slider :deep(.p-slider-handle) {
  opacity: 0;
  pointer-events: none;
}

/* ===== Player Right ===== */
.player-right {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 160px;
  justify-content: flex-end;
}

.mode-btn-right {
  width: 32px;
  height: 32px;
  padding: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 50%;
  transition: background 0.15s;
  color: #999;
  flex-shrink: 0;
}
.mode-btn-right:hover {
  background: #f0f0f0;
}
.mode-btn-right img {
  width: 22px;
  height: 22px;
  opacity: 0.45;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 50%;
  font-size: 14px;
  color: #888;
  transition:
    background 0.15s,
    color 0.15s;
}
.icon-btn:hover {
  background: rgba(124, 77, 255, 0.1);
  color: var(--te-primary-500);
}
.icon-btn.active {
  color: var(--accent-color, #7c4dff);
  background: color-mix(in srgb, var(--accent-color, #7c4dff) 12%, transparent);
}

@keyframes playlist-light {
  from {
    transform: translate3d(-10px, 0, 0) scale(1);
  }
  to {
    transform: translate3d(14px, -6px, 0) scale(1.04);
  }
}
</style>
