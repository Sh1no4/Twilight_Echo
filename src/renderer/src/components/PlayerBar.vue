<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePlayerStore } from '../stores/usePlayerStore'
import { normalizeAccentColor } from '../utils/colorExtractor'

defineProps<{
  glass?: boolean
  menuOpen?: boolean
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
  audioOutput,
  audioDevice,
  audioOutputOptions,
  audioDeviceOptions,
  audioProcessing,
  playbackInfo,
  outputInfo,
  cyclePlayMode,
  togglePlay,
  next,
  prev,
  seek,
  playTrack,
  toggleExclusiveMode,
  setAudioOutput,
  setAudioDevice,
  toggleDspEnabled,
  toggleEqEnabled,
  toggleCrossfeed,
  toggleGapless,
  setReplayGainMode,
  formatTime
} = usePlayerStore()

const coverRef = ref<HTMLElement | null>(null)
const playButtonColor = computed(() => normalizeAccentColor(dominantColor.value))

const emit = defineEmits<{
  clickCover: [rect: { x: number; y: number; w: number; h: number }]
  openSettings: []
  openEqualizer: []
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

function onProgressInput(event: Event): void {
  const target = event.target as HTMLInputElement
  seek(Number(target.value))
}

function onVolumeInput(event: Event): void {
  const target = event.target as HTMLInputElement
  volume.value = Number(target.value)
}

const volumeOpen = ref(false)
const playlistOpen = ref(false)
const moreOpen = ref(false)

function toggleVolume(): void {
  volumeOpen.value = !volumeOpen.value
  if (volumeOpen.value) {
    playlistOpen.value = false
    moreOpen.value = false
  }
}

function togglePlaylist(): void {
  playlistOpen.value = !playlistOpen.value
  if (playlistOpen.value) {
    volumeOpen.value = false
    moreOpen.value = false
  }
}

function toggleMore(): void {
  moreOpen.value = !moreOpen.value
  if (moreOpen.value) {
    volumeOpen.value = false
    playlistOpen.value = false
  }
}

const modeLabels: Record<string, string> = {
  sequential: '顺序播放',
  repeat: '单曲循环',
  shuffle: '随机播放'
}

const modeTitle = computed(() => modeLabels[playMode.value] ?? '')
const selectedAudioOutput = computed(() =>
  audioOutputOptions.value.find((option) => option.id === audioOutput.value)
)
const selectedAudioDevice = computed(() =>
  audioDeviceOptions.value.find((option) => option.id === audioDevice.value)
)
const exclusiveAvailable = computed(() => selectedAudioOutput.value?.supportsExclusive ?? false)
const audioStatusChips = computed(() => {
  const chips: { label: string; tone?: 'success' | 'warning' | 'muted' }[] = []
  if (outputInfo.value?.bitPerfect) {
    chips.push({ label: 'BitPerfect', tone: 'success' })
  } else if (outputInfo.value?.resampled) {
    chips.push({ label: 'Resampled', tone: 'warning' })
  } else {
    chips.push({
      label: outputInfo.value?.supportsBitPerfect ? 'Ready' : 'Mixed',
      tone: outputInfo.value?.supportsBitPerfect ? undefined : 'muted'
    })
  }
  if (playbackInfo.value?.dspActive) chips.push({ label: 'DSP', tone: 'warning' })
  if (exclusiveMode.value) chips.push({ label: 'Exclusive', tone: 'success' })
  return chips
})
const nonBitPerfectReason = computed(() => {
  if (outputInfo.value?.bitPerfect) return ''
  return outputInfo.value?.resampleReason || playbackInfo.value?.resampleReason || ''
})

const replayGainMiniOptions = [
  { value: 'off', label: 'Off' },
  { value: 'track', label: 'Track' },
  { value: 'album', label: 'Album' }
] as const

function onAudioDeviceChange(event: Event): void {
  const target = event.target as HTMLSelectElement
  void setAudioDevice(target.value)
}

function playTrackAt(index: number): void {
  const track = queue.value[index]
  if (track) {
    playTrack(track, queue.value)
  }
}

function openPlaybackSettings(): void {
  moreOpen.value = false
  emit('openSettings')
}

function openEqualizer(): void {
  moreOpen.value = false
  emit('openEqualizer')
}
</script>

<template>
  <div v-if="currentTrack" class="player-bar-shell" :class="{ 'menu-open': menuOpen }">
    <!-- 播放列表面板（向上抽屉） -->
    <Transition name="drawer-up">
      <div v-if="playlistOpen" class="playlist-panel" :class="{ 'panel-glass': glass }">
        <div class="playlist-header">
          <div class="playlist-heading">
            <span class="playlist-heading-icon">
              <i class="pi pi-list"></i>
            </span>
            <div>
              <span class="playlist-heading-title">播放列表</span>
              <span class="playlist-heading-subtitle">当前队列</span>
            </div>
          </div>
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
      :style="{
        '--accent-color': dominantColor,
        '--play-button-color': playButtonColor
      }"
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
            <i :class="isPlaying ? 'pi pi-pause' : 'pi pi-play'"></i>
          </button>
          <button class="ctrl-btn" aria-label="下一首" @click="next">
            <img src="/skip-next.svg" alt="下一首" />
          </button>
        </div>
        <div class="progress-area">
          <span class="time-label">{{ formatTime(currentTime) }}</span>
          <input
            type="range"
            :value="currentTime"
            min="0"
            :max="duration || 1"
            step="0.1"
            class="progress-slider"
            :style="{ '--range-value': `${duration ? (currentTime / duration) * 100 : 0}%` }"
            @input="onProgressInput"
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
              <input
                type="range"
                :value="volume"
                min="0"
                max="1"
                step="0.01"
                class="volume-drawer-slider"
                :style="{ '--range-value': `${volume * 100}%` }"
                @input="onVolumeInput"
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

        <!-- 更多按钮 + 向上弹出抽屉 -->
        <div class="more-anchor">
          <Transition name="volume-drawer">
            <div v-if="moreOpen" class="more-drawer" :class="{ 'drawer-glass': glass }">
              <div class="more-action-grid">
                <button type="button" class="more-action" @click="openPlaybackSettings">
                  <span>
                    <span class="more-action-title">播放设置</span>
                    <span class="more-action-desc">输出、缓存与无缝播放</span>
                  </span>
                </button>
                <button type="button" class="more-action" @click="openEqualizer">
                  <span>
                    <span class="more-action-title">均衡器</span>
                    <span class="more-action-desc">图形、参数与预设</span>
                  </span>
                </button>
              </div>
              <div class="more-status">
                <span
                  v-for="chip in audioStatusChips"
                  :key="chip.label"
                  class="more-status-chip"
                  :class="chip.tone"
                >
                  {{ chip.label }}
                </span>
              </div>
              <p v-if="nonBitPerfectReason" class="more-item-desc compact-reason">
                {{ nonBitPerfectReason }}
              </p>
              <div class="more-item">
                <div class="more-item-header">
                  <span class="more-item-label">独占模式</span>
                  <button
                    class="toggle-switch"
                    :class="{ active: exclusiveMode }"
                    role="switch"
                    :aria-checked="exclusiveMode"
                    :disabled="!exclusiveAvailable"
                    @click="toggleExclusiveMode"
                  >
                    <span class="toggle-knob"></span>
                  </button>
                </div>
                <p class="more-item-desc">当前输出支持时可绕过系统混音器</p>
              </div>
              <div class="more-item">
                <div class="more-item-header">
                  <span class="more-item-label">DSP</span>
                  <button
                    class="toggle-switch"
                    :class="{ active: audioProcessing.dspEnabled }"
                    role="switch"
                    :aria-checked="audioProcessing.dspEnabled"
                    @click="toggleDspEnabled"
                  >
                    <span class="toggle-knob"></span>
                  </button>
                </div>
                <div class="quick-toggle-grid">
                  <button
                    type="button"
                    class="quick-toggle"
                    :class="{ active: audioProcessing.eqEnabled }"
                    @click="toggleEqEnabled"
                  >
                    EQ
                  </button>
                  <button
                    type="button"
                    class="quick-toggle"
                    :class="{ active: audioProcessing.crossfeedEnabled }"
                    @click="toggleCrossfeed"
                  >
                    Crossfeed
                  </button>
                  <button
                    type="button"
                    class="quick-toggle"
                    :class="{ active: audioProcessing.gapless }"
                    @click="toggleGapless"
                  >
                    Gapless
                  </button>
                </div>
                <div class="mini-segment" role="radiogroup" aria-label="ReplayGain">
                  <button
                    v-for="option in replayGainMiniOptions"
                    :key="option.value"
                    type="button"
                    class="mini-segment-option"
                    :class="{ active: audioProcessing.volumeNormalization === option.value }"
                    role="radio"
                    :aria-checked="audioProcessing.volumeNormalization === option.value"
                    @click="setReplayGainMode(option.value)"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>
              <div class="more-item">
                <div class="more-item-header">
                  <span class="more-item-label">音频输出</span>
                  <span class="more-item-value">{{ selectedAudioOutput?.label ?? '自动' }}</span>
                </div>
                <div class="audio-output-mini-list">
                  <button
                    v-for="option in audioOutputOptions"
                    :key="option.id"
                    type="button"
                    class="audio-output-mini"
                    :class="{ active: audioOutput === option.id }"
                    @click="setAudioOutput(option.id)"
                  >
                    {{ option.label }}
                  </button>
                </div>
                <select
                  class="audio-device-mini-select"
                  :value="audioDevice"
                  :title="selectedAudioDevice?.label ?? audioDevice"
                  @change="onAudioDeviceChange"
                >
                  <option v-for="device in audioDeviceOptions" :key="device.id" :value="device.id">
                    {{ device.label }}
                  </option>
                </select>
              </div>
            </div>
          </Transition>
          <button
            class="icon-btn"
            :class="{ active: moreOpen }"
            title="更多设置"
            @click="toggleMore"
          >
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
  bottom: 14px;
  left: 18px;
  right: 18px;
  z-index: 1002;
  pointer-events: none;
  transition:
    left 0.32s var(--te-ease-soft),
    right 0.32s var(--te-ease-soft),
    width 0.32s var(--te-ease-soft),
    z-index 0.32s var(--te-ease-soft);
}

.player-bar-shell.menu-open {
  left: calc(var(--te-menu-width) + 18px);
  right: 18px;
  z-index: 999;
}

.player-bar-shell.menu-open .player-bar {
  width: 100%;
  max-width: none;
  margin: 0;
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
  width: 120px;
  height: 120px;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  cursor: pointer;
  transform: rotate(-90deg);
}

.volume-drawer-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background:
    linear-gradient(90deg, var(--accent-color, #1a73e8), var(--accent-color, #1a73e8)) 0 /
      var(--range-value, 70%) 100% no-repeat,
    color-mix(in srgb, var(--accent-color, #1a73e8) 18%, transparent);
}

.drawer-glass .volume-drawer-slider::-webkit-slider-runnable-track {
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0.55)) 0 /
      var(--range-value, 70%) 100% no-repeat,
    rgba(255, 255, 255, 0.12);
}

.volume-drawer-slider::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 0;
  height: 0;
}

.volume-drawer-slider::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-color, #1a73e8) 18%, transparent);
}

.volume-drawer-slider::-moz-range-progress {
  height: 4px;
  border-radius: 999px;
  background: var(--accent-color, #1a73e8);
}

.volume-drawer-slider::-moz-range-thumb {
  width: 0;
  height: 0;
  border: 0;
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
    linear-gradient(145deg, rgba(255, 255, 255, 0.68), rgba(255, 255, 255, 0.28)),
    rgba(255, 255, 255, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.68);
  border-radius: 12px;
  box-shadow:
    0 24px 76px rgba(86, 70, 160, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
  width: min(520px, calc(100vw - 36px));
  max-height: min(420px, calc(100vh - 132px));
  margin: 0 auto 12px;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  backdrop-filter: blur(26px) saturate(160%);
  -webkit-backdrop-filter: blur(26px) saturate(160%);
}

.playlist-panel::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -2;
  pointer-events: none;
  background:
    radial-gradient(circle at 18% 14%, rgba(255, 255, 255, 0.9), transparent 18%),
    radial-gradient(circle at 30% 26%, rgba(124, 77, 255, 0.075), transparent 38%),
    radial-gradient(circle at 86% 16%, rgba(255, 126, 182, 0.055), transparent 34%),
    radial-gradient(circle at 58% 92%, rgba(34, 211, 238, 0.05), transparent 42%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.48), rgba(255, 255, 255, 0.18));
  animation: playlist-light 10s var(--te-ease-soft) infinite alternate;
}

.playlist-panel::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.58), transparent 42%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.36), rgba(255, 255, 255, 0.08));
}
.playlist-panel.panel-glass {
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.32), rgba(255, 255, 255, 0.14)),
    rgba(17, 24, 39, 0.16);
  backdrop-filter: blur(28px) saturate(168%);
  -webkit-backdrop-filter: blur(28px) saturate(168%);
  border-color: rgba(255, 255, 255, 0.3);
}
.playlist-header {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px 12px;
  color: var(--te-neutral-900);
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.54);
}
.playlist-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.playlist-heading-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  color: var(--te-primary-500);
  background:
    radial-gradient(circle at 35% 28%, rgba(255, 255, 255, 0.9), transparent 36%),
    linear-gradient(135deg, rgba(124, 77, 255, 0.14), rgba(34, 211, 238, 0.1));
  box-shadow: 0 12px 26px rgba(86, 70, 160, 0.1);
}
.playlist-heading-title,
.playlist-heading-subtitle {
  display: block;
  white-space: nowrap;
}
.playlist-heading-title {
  font-size: 14px;
  line-height: 1.2;
  font-weight: 800;
  color: var(--te-neutral-900);
}
.playlist-heading-subtitle {
  margin-top: 2px;
  font-size: 11px;
  font-weight: 700;
  color: rgba(80, 88, 116, 0.56);
}
.panel-glass .playlist-header {
  color: #fff;
}
.panel-glass .playlist-heading-title {
  color: rgba(255, 255, 255, 0.94);
}
.panel-glass .playlist-heading-subtitle {
  color: rgba(255, 255, 255, 0.52);
}
.panel-glass .playlist-heading-icon {
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.12);
}
.playlist-count {
  flex-shrink: 0;
  padding: 5px 9px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.68);
  background: rgba(255, 255, 255, 0.42);
  font-size: 11px;
  font-weight: 800;
  color: rgba(80, 88, 116, 0.68);
}
.panel-glass .playlist-count {
  border-color: rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.62);
}
.playlist-list {
  position: relative;
  z-index: 1;
  flex: 1;
  overflow-y: auto;
  padding: 10px 10px 12px;
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
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0);
  overflow: hidden;
  transition:
    background 0.18s,
    transform 0.18s var(--te-ease-soft),
    border-color 0.18s,
    box-shadow 0.18s;
}
.playlist-item:hover {
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.6), rgba(255, 255, 255, 0.24)),
    rgba(255, 255, 255, 0.22);
  border-color: rgba(255, 255, 255, 0.62);
  box-shadow: 0 12px 30px rgba(86, 70, 160, 0.09);
  transform: translateY(-1px);
}
.panel-glass .playlist-item:hover {
  background: rgba(255, 255, 255, 0.16);
  border-color: rgba(255, 255, 255, 0.18);
}
.playlist-item.active {
  background:
    linear-gradient(90deg, rgba(124, 77, 255, 0.12), rgba(34, 211, 238, 0.07)),
    rgba(255, 255, 255, 0.46);
  border-color: rgba(124, 77, 255, 0.16);
  box-shadow:
    0 14px 32px rgba(124, 77, 255, 0.1),
    inset 3px 0 0 rgba(124, 77, 255, 0.62);
}
.panel-glass .playlist-item.active {
  background:
    linear-gradient(90deg, rgba(124, 77, 255, 0.28), rgba(255, 126, 182, 0.14)),
    rgba(255, 255, 255, 0.16);
}
.playlist-index {
  width: 22px;
  text-align: center;
  font-size: 11px;
  font-weight: 800;
  color: rgba(80, 88, 116, 0.42);
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
  width: 34px;
  height: 34px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
  box-shadow: 0 10px 22px rgba(86, 70, 160, 0.14);
}
.playlist-cover-placeholder {
  width: 34px;
  height: 34px;
  border-radius: 8px;
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
  flex: 1;
}
.playlist-title {
  font-size: 13px;
  line-height: 1.25;
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
  font-weight: 700;
  color: rgba(80, 88, 116, 0.56);
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
    linear-gradient(145deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.06)),
    rgba(17, 24, 39, 0.1);
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
.player-bar-glass .btn-play {
  background: var(--play-button-color, var(--accent-color, var(--te-primary-500)));
  color: #fff;
  box-shadow: none;
}
.player-bar-glass .btn-play:hover {
  background: var(--play-button-color, var(--accent-color, var(--te-primary-500)));
  box-shadow: none;
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

.player-bar-glass .progress-slider::-webkit-slider-runnable-track {
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0.7)) 0 /
      var(--range-value, 0%) 100% no-repeat,
    color-mix(in srgb, var(--accent-color, #1a73e8) 12%, transparent);
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
  background: var(--play-button-color, var(--accent-color, var(--te-primary-500)));
  color: #fff;
  padding: 10px;
  box-shadow: none;
  transition: none;
}
.btn-play:hover {
  background: var(--play-button-color, var(--accent-color, var(--te-primary-500)));
  box-shadow: none;
}
.btn-play i {
  font-size: 18px;
  line-height: 1;
  color: #fff;
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
  height: 24px;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  cursor: pointer;
}

.progress-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background:
    linear-gradient(90deg, var(--accent-color, #7c4dff), #c084fc) 0 / var(--range-value, 0%) 100%
      no-repeat,
    color-mix(in srgb, var(--accent-color, #1a73e8) 18%, transparent);
}

.progress-slider::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 0;
  height: 0;
}

.progress-slider::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-color, #1a73e8) 18%, transparent);
}

.progress-slider::-moz-range-progress {
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent-color, #7c4dff), #c084fc);
}

.progress-slider::-moz-range-thumb {
  width: 0;
  height: 0;
  border: 0;
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
  margin-bottom: 10px;
  background: rgba(255, 255, 255, 0.74);
  border: 0;
  border-radius: 16px;
  box-shadow: 0 18px 55px rgba(86, 70, 160, 0.16);
  padding: 8px;
  min-width: 320px;
  max-height: min(560px, calc(100vh - 132px));
  overflow-y: auto;
  backdrop-filter: blur(18px) saturate(150%);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
}

.more-drawer.drawer-glass {
  background: rgba(255, 255, 255, 0.26);
  backdrop-filter: blur(22px) saturate(160%);
  -webkit-backdrop-filter: blur(22px) saturate(160%);
  border: 0;
}

.more-item {
  padding: 8px 10px;
}

.more-action-grid {
  display: grid;
  gap: 7px;
  padding-bottom: 8px;
  margin-bottom: 4px;
  border-bottom: 0;
}

.more-action {
  width: 100%;
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 0;
  padding: 8px 12px;
  border: 0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.46);
  color: rgba(52, 61, 87, 0.88);
  cursor: pointer;
  text-align: left;
  box-shadow: 0 10px 24px rgba(86, 70, 160, 0.08);
  transition:
    transform 0.2s var(--te-ease-soft),
    border-color 0.2s,
    background 0.2s,
    box-shadow 0.2s;
}

.more-action:hover {
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 12px 24px rgba(34, 42, 68, 0.08);
}

.more-action-title,
.more-action-desc {
  display: block;
}

.more-action-title {
  font-size: 12px;
  font-weight: 800;
  color: rgba(34, 42, 66, 0.9);
}

.more-action-desc {
  margin-top: 2px;
  font-size: 10px;
  font-weight: 700;
  color: rgba(80, 88, 116, 0.56);
}

.drawer-glass .more-action-grid {
  border-bottom: 0;
}

.drawer-glass .more-action {
  background: rgba(255, 255, 255, 0.08);
}

.drawer-glass .more-action-title {
  color: rgba(255, 255, 255, 0.9);
}

.drawer-glass .more-action-desc {
  color: rgba(255, 255, 255, 0.52);
}

.more-status {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 2px 8px;
}

.more-status-chip {
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.42);
  color: rgba(80, 88, 116, 0.72);
  font-size: 10px;
  font-weight: 900;
}

.more-status-chip.success {
  background: rgba(16, 185, 129, 0.14);
  color: #047857;
}

.more-status-chip.warning {
  background: rgba(245, 158, 11, 0.16);
  color: #b45309;
}

.more-status-chip.muted {
  background: rgba(148, 163, 184, 0.16);
  color: rgba(80, 88, 116, 0.62);
}

.drawer-glass .more-status-chip {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
}

.compact-reason {
  margin: 0 2px 4px;
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

.more-item-value {
  flex-shrink: 0;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.42);
  color: rgba(80, 88, 116, 0.68);
  font-size: 11px;
  font-weight: 800;
}

.drawer-glass .more-item-label {
  color: rgba(255, 255, 255, 0.9);
}

.drawer-glass .more-item-value {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.62);
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

.quick-toggle-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin-top: 8px;
}

.quick-toggle,
.mini-segment-option {
  min-width: 0;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.34);
  color: rgba(80, 88, 116, 0.72);
  cursor: pointer;
  font-size: 11px;
  font-weight: 800;
}

.quick-toggle:hover,
.quick-toggle.active,
.mini-segment-option:hover,
.mini-segment-option.active {
  background: color-mix(in srgb, var(--accent-color, #7c4dff) 12%, rgba(255, 255, 255, 0.58));
  color: var(--accent-color, #7c4dff);
}

.mini-segment {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin-top: 7px;
}

.drawer-glass .quick-toggle,
.drawer-glass .mini-segment-option {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.58);
}

.drawer-glass .quick-toggle:hover,
.drawer-glass .quick-toggle.active,
.drawer-glass .mini-segment-option:hover,
.drawer-glass .mini-segment-option.active {
  background: rgba(255, 255, 255, 0.16);
  color: rgba(255, 255, 255, 0.92);
}

.audio-output-mini-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.audio-output-mini {
  min-width: 58px;
  height: 26px;
  padding: 0 9px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.34);
  color: rgba(80, 88, 116, 0.72);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition:
    background 0.18s,
    color 0.18s,
    border-color 0.18s;
}

.audio-output-mini:hover,
.audio-output-mini.active {
  background: color-mix(in srgb, var(--accent-color, #7c4dff) 12%, rgba(255, 255, 255, 0.58));
  color: var(--accent-color, #7c4dff);
}

.audio-device-mini-select {
  width: 100%;
  height: 30px;
  margin-top: 8px;
  border: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.42);
  color: rgba(52, 61, 87, 0.84);
  font-size: 11px;
  font-weight: 700;
  outline: none;
  padding: 0 9px;
}

.drawer-glass .audio-output-mini {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.58);
}

.drawer-glass .audio-device-mini-select {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.82);
}

.drawer-glass .audio-output-mini:hover,
.drawer-glass .audio-output-mini.active {
  background: rgba(255, 255, 255, 0.16);
  color: rgba(255, 255, 255, 0.92);
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

.toggle-switch:disabled {
  cursor: not-allowed;
  opacity: 0.52;
}

.toggle-switch.active {
  background: linear-gradient(135deg, var(--accent-color, #7c4dff), #c084fc);
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

@keyframes playlist-light {
  from {
    transform: translate3d(-10px, 0, 0) scale(1);
  }
  to {
    transform: translate3d(14px, -6px, 0) scale(1.04);
  }
}
</style>
