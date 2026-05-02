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
  exclusiveMode,
  cyclePlayMode,
  togglePlay,
  next,
  prev,
  seek,
  playTrack,
  toggleExclusiveMode,
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
const moreOpen = ref(false)

function toggleVolume(): void {
  volumeOpen.value = !volumeOpen.value
  if (volumeOpen.value) { playlistOpen.value = false; moreOpen.value = false }
}

function togglePlaylist(): void {
  playlistOpen.value = !playlistOpen.value
  if (playlistOpen.value) { volumeOpen.value = false; moreOpen.value = false }
}

function toggleMore(): void {
  moreOpen.value = !moreOpen.value
  if (moreOpen.value) { volumeOpen.value = false; playlistOpen.value = false }
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
  <div class="player-bar-shell" v-if="currentTrack">
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
            <img
              v-if="track.cover"
              :src="track.cover"
              class="playlist-cover"
              alt=""
            />
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
    <div class="player-bar" :class="{ 'player-bar-glass': glass }" :style="{ '--accent-color': dominantColor }">
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
          <button class="icon-btn" :class="{ active: volumeOpen }" title="音量" @click="toggleVolume">
            <i class="pi pi-volume-up"></i>
          </button>
        </div>

        <button class="icon-btn" :class="{ active: playlistOpen }" title="播放列表" @click="togglePlaylist">
          <i class="pi pi-list"></i>
        </button>

        <!-- 更多按钮 + 向上弹出抽屉 -->
        <div class="more-anchor">
          <Transition name="volume-drawer">
            <div v-if="moreOpen" class="more-drawer" :class="{ 'drawer-glass': glass }">
              <div class="more-item">
                <div class="more-item-header">
                  <span class="more-item-label">独占模式</span>
                  <button
                    class="toggle-switch"
                    :class="{ active: exclusiveMode }"
                    role="switch"
                    :aria-checked="exclusiveMode"
                    @click="toggleExclusiveMode"
                  >
                    <span class="toggle-knob"></span>
                  </button>
                </div>
                <p class="more-item-desc">绕过 Windows 混音器，直通音频设备，开启后系统内其他应用将无法同时播放音频</p>
              </div>
            </div>
          </Transition>
          <button class="icon-btn" :class="{ active: moreOpen }" title="更多设置" @click="toggleMore">
            <i class="pi pi-ellipsis-h"></i>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ===== Shell ===== */
.player-bar-shell {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 1002;
}

/* ===== Upward Drawer Transition ===== */
.drawer-up-enter-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.drawer-up-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.drawer-up-enter-from,
.drawer-up-leave-to {
  opacity: 0;
  transform: translateY(8px);
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
  margin-bottom: 6px;
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  padding: 10px 6px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.volume-drawer.drawer-glass {
  background: rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.06);
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
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.volume-drawer-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.volume-drawer-enter-from,
.volume-drawer-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px);
}

/* ===== Playlist Panel ===== */
.playlist-panel {
  background: #fff;
  border-top: 1px solid #e8e8e8;
  border-radius: 12px 12px 0 0;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.08);
  margin: 0 4px;
  max-height: 360px;
  display: flex;
  flex-direction: column;
}
.playlist-panel.panel-glass {
  background: rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(20px);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.playlist-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px 10px;
  font-size: 14px;
  font-weight: 600;
  color: #333;
  flex-shrink: 0;
}
.panel-glass .playlist-header {
  color: #fff;
}
.playlist-count {
  font-size: 12px;
  font-weight: 400;
  color: #999;
}
.panel-glass .playlist-count {
  color: rgba(255, 255, 255, 0.5);
}
.playlist-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
}
.playlist-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.1s;
}
.playlist-item:hover {
  background: rgba(0, 0, 0, 0.04);
}
.panel-glass .playlist-item:hover {
  background: rgba(255, 255, 255, 0.06);
}
.playlist-item.active {
  background: rgba(26, 115, 232, 0.08);
}
.panel-glass .playlist-item.active {
  background: rgba(255, 255, 255, 0.1);
}
.playlist-index {
  width: 20px;
  text-align: center;
  font-size: 12px;
  color: #bbb;
  flex-shrink: 0;
}
.playlist-item.active .playlist-index {
  color: #1a73e8;
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
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
}
.playlist-cover-placeholder {
  width: 32px;
  height: 32px;
  border-radius: 4px;
  background: #f5f5f5;
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
  font-weight: 500;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.playlist-item.active .playlist-title {
  color: #1a73e8;
}
.panel-glass .playlist-title {
  color: rgba(255, 255, 255, 0.9);
}
.panel-glass .playlist-item.active .playlist-title {
  color: #fff;
}
.playlist-artist {
  font-size: 11px;
  color: #999;
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
  background: #fff;
  border-top: 1px solid #e8e8e8;
  padding: 0 24px;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.04);
  transition: background 0.3s, border-color 0.3s, box-shadow 0.3s;
}

.player-bar-glass {
  background: rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(20px);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.15);
}

.player-bar-glass .player-title { color: #fff; }
.player-bar-glass .player-artist { color: rgba(255, 255, 255, 0.7); }
.player-bar-glass .ctrl-btn { color: rgba(255, 255, 255, 0.8); }
.player-bar-glass .ctrl-btn:hover { background: rgba(255, 255, 255, 0.1); }
.player-bar-glass .btn-play:hover { background: var(--accent-color, #1a73e8); }
.player-bar-glass .mode-btn-right { color: rgba(255, 255, 255, 0.6); }
.player-bar-glass .mode-btn-right img { opacity: 0.55; }
.player-bar-glass .time-label { color: rgba(255, 255, 255, 0.5); }
.player-bar-glass .player-cover-placeholder { background: rgba(255, 255, 255, 0.1); }
.player-bar-glass .player-cover-placeholder:hover { background: rgba(255, 255, 255, 0.18); }
.player-bar-glass .player-cover-placeholder i { color: rgba(255, 255, 255, 0.4); }
.player-bar-glass .icon-btn { color: rgba(255, 255, 255, 0.6); }
.player-bar-glass .icon-btn:hover { background: rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.9); }
.player-bar-glass .icon-btn.active { color: var(--accent-color, #1a73e8); background: rgba(26, 115, 232, 0.15); }

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
  width: 48px; height: 48px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}
.player-cover:hover { transform: scale(1.08); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15); }
.player-cover-placeholder {
  width: 48px; height: 48px;
  border-radius: 6px;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  transition: background 0.15s;
}
.player-cover-placeholder:hover { background: #eee; }
.player-track-info { overflow: hidden; min-width: 0; }
.player-title {
  font-size: 14px; font-weight: 500; color: #1a1a1a;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.player-artist {
  font-size: 12px; color: #999; margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ===== Player Center ===== */
.player-center {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  flex: 1; max-width: 600px; margin: 0 40px;
}
.player-controls { display: flex; align-items: center; gap: 12px; margin-top: 6px; }
.ctrl-btn {
  display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; cursor: pointer;
  padding: 6px; border-radius: 50%; transition: background 0.15s; color: #555;
}
.ctrl-btn:hover { background: #f0f0f0; }
.ctrl-btn img { width: 25px; height: 25px; }
.btn-play {
  width: 44px; height: 44px;
  background: var(--accent-color, #1a73e8); color: #fff; padding: 10px;
  transition: transform 0.15s;
}
.btn-play:hover { background: var(--accent-color, #1a73e8); transform: scale(1.08); }
.btn-play img { width: 22px; height: 22px; filter: brightness(0) invert(1); }

/* ===== Progress ===== */
.progress-area { display: flex; align-items: center; gap: 10px; width: 100%; }
.time-label {
  font-size: 11px; color: #999; min-width: 36px;
  font-variant-numeric: tabular-nums; text-align: center;
}
.progress-slider { flex: 1; }
.progress-slider :deep(.p-slider) {
  background: color-mix(in srgb, var(--accent-color, #1a73e8) 18%, transparent);
  padding: 14px 0;
  margin: -14px 0;
  background-clip: content-box;
}
.progress-slider :deep(.p-slider-range) { background: var(--accent-color, #1a73e8); }
.progress-slider :deep(.p-slider-handle) { opacity: 0; pointer-events: none; }

/* ===== Player Right ===== */
.player-right {
  display: flex; align-items: center; gap: 6px;
  min-width: 160px; justify-content: flex-end;
}

.mode-btn-right {
  width: 32px; height: 32px;
  padding: 3px;
  display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; cursor: pointer;
  border-radius: 50%; transition: background 0.15s;
  color: #999;
  flex-shrink: 0;
}
.mode-btn-right:hover { background: #f0f0f0; }
.mode-btn-right img { width: 22px; height: 22px; opacity: 0.45; }

.icon-btn {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px;
  border: none; background: transparent; cursor: pointer;
  border-radius: 50%; font-size: 14px;
  color: #888;
  transition: background 0.15s, color 0.15s;
}
.icon-btn:hover { background: #f0f0f0; color: #555; }
.icon-btn.active { color: var(--accent-color, #1a73e8); }

/* ===== More Drawer ===== */
.more-anchor {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.more-drawer {
  position: absolute;
  bottom: 100%;
  right: -8px;
  margin-bottom: 6px;
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  padding: 8px;
  min-width: 220px;
}

.more-drawer.drawer-glass {
  background: rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.more-item {
  padding: 8px 10px;
}

.more-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.more-item-label {
  font-size: 13px;
  font-weight: 500;
  color: #333;
  white-space: nowrap;
}

.drawer-glass .more-item-label {
  color: rgba(255, 255, 255, 0.9);
}

.more-item-desc {
  margin: 6px 0 0 0;
  font-size: 11px;
  color: #999;
  line-height: 1.4;
}

.drawer-glass .more-item-desc {
  color: rgba(255, 255, 255, 0.45);
}

/* ===== Toggle Switch ===== */
.toggle-switch {
  position: relative;
  width: 40px;
  height: 22px;
  border: none;
  background: #d5d5d5;
  border-radius: 999px;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: background 0.2s ease;
}

.toggle-switch.active {
  background: var(--accent-color, #1a73e8);
}

.drawer-glass .toggle-switch {
  background: rgba(255, 255, 255, 0.18);
}

.drawer-glass .toggle-switch.active {
  background: var(--accent-color, #1a73e8);
}

.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  transition: transform 0.2s ease;
}

.toggle-switch.active .toggle-knob {
  transform: translateX(18px);
}
</style>
