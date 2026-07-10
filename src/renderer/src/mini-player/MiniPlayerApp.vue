<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue'
import {
  DEFAULT_MINI_PLAYER_SETTINGS,
  EMPTY_MINI_PLAYER_STATE,
  cloneMiniPlayerSettings,
  type MiniPlayerCommand,
  type MiniPlayerSettings,
  type MiniPlayerSettingsPatch,
  type MiniPlayerStateSnapshot
} from '../../../shared/miniPlayer'
import { getNextMiniPlayerStyle, resolveMiniPlayerStyle } from './styles'

const state = ref<MiniPlayerStateSnapshot>({ ...EMPTY_MINI_PLAYER_STATE })
const settings = ref<MiniPlayerSettings>(cloneMiniPlayerSettings(DEFAULT_MINI_PLAYER_SETTINGS))
const ready = ref(false)
const coverFailed = ref(false)

const activeStyle = computed(() => resolveMiniPlayerStyle(settings.value.activeStyleId))
const activeAccent = computed(() =>
  activeStyle.value.accentMode === 'fixed'
    ? activeStyle.value.fixedAccent || '#5966d9'
    : state.value.dominantColor
)
const styleVariables = computed(
  () =>
    ({
      ...activeStyle.value.tokens,
      '--mini-track-accent': activeAccent.value,
      '--mini-progress': `${progressPercent.value}%`,
      '--mini-volume': `${Math.round(state.value.volume * 100)}%`
    }) as CSSProperties
)
const styleClasses = computed(() => [
  activeStyle.value.className,
  `mini-layout-${activeStyle.value.layout}`,
  {
    'is-ready': ready.value,
    'is-playing': state.value.isPlaying,
    'is-position-locked': settings.value.positionLocked
  }
])
const progressPercent = computed(() =>
  state.value.duration > 0
    ? Math.min(100, Math.max(0, (state.value.currentTime / state.value.duration) * 100))
    : 0
)
const hasCover = computed(() => Boolean(state.value.track?.cover) && !coverFailed.value)
const trackTitle = computed(() => state.value.track?.title || '暂无播放')
const trackArtist = computed(() => state.value.track?.artist || '从主窗口选择一首音乐')
const trackAlbum = computed(() => state.value.track?.album || 'TWILIGHT ECHO')
const playbackStateText = computed(() =>
  state.value.isLoading ? '载入中' : state.value.isPlaying ? '播放中' : '已暂停'
)
const playModeTitle = computed(() => {
  if (state.value.playMode === 'repeat') return '单曲循环'
  if (state.value.playMode === 'shuffle') return '随机播放'
  return '顺序播放'
})
const playModeIcon = computed(() => {
  if (state.value.playMode === 'repeat') return 'ph ph-repeat-once'
  if (state.value.playMode === 'shuffle') return 'ph ph-shuffle'
  return 'ph ph-arrow-right'
})

function sendCommand(command: MiniPlayerCommand): void {
  window.api.miniPlayer.command(command)
}

function togglePlay(): void {
  if (!state.value.track || state.value.isLoading) return
  sendCommand({ type: 'toggle-play' })
}

function seekTo(value: number): void {
  const time = Math.min(state.value.duration || value, Math.max(0, value))
  state.value = { ...state.value, currentTime: time }
  sendCommand({ type: 'seek', value: time })
}

function onProgressInput(event: Event): void {
  seekTo(Number((event.target as HTMLInputElement).value))
}

function setVolume(value: number): void {
  const volume = Math.min(1, Math.max(0, value))
  state.value = { ...state.value, volume }
  sendCommand({ type: 'set-volume', value: volume })
}

function onVolumeInput(event: Event): void {
  setVolume(Number((event.target as HTMLInputElement).value))
}

async function updateWindowSettings(patch: MiniPlayerSettingsPatch): Promise<void> {
  try {
    settings.value = await window.api.miniPlayer.updateSettings(patch)
  } catch (error) {
    console.error('[mini-player] Failed to update window settings:', error)
  }
}

function togglePositionLock(): void {
  void updateWindowSettings({ positionLocked: !settings.value.positionLocked })
}

function toggleAlwaysOnTop(): void {
  void updateWindowSettings({ alwaysOnTop: !settings.value.alwaysOnTop })
}

function switchStyle(): void {
  const nextStyle = getNextMiniPlayerStyle(activeStyle.value.id)
  void updateWindowSettings({
    activeStyleId: nextStyle.id
  })
}

function minimizeWindow(): void {
  window.api.miniPlayer.minimize()
}

function returnToMainWindow(): void {
  window.api.miniPlayer.returnToMain()
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

function handleKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  if (target?.tagName === 'INPUT') return

  switch (event.key) {
    case ' ':
      event.preventDefault()
      togglePlay()
      break
    case 'ArrowLeft':
      event.preventDefault()
      seekTo(state.value.currentTime - 5)
      break
    case 'ArrowRight':
      event.preventDefault()
      seekTo(state.value.currentTime + 5)
      break
    case 'ArrowUp':
      event.preventDefault()
      setVolume(state.value.volume + 0.05)
      break
    case 'ArrowDown':
      event.preventDefault()
      setVolume(state.value.volume - 0.05)
      break
    case 'Escape':
      returnToMainWindow()
      break
  }
}

let removeStateListener: (() => void) | null = null
let removeSettingsListener: (() => void) | null = null

onMounted(async () => {
  removeStateListener = window.api.miniPlayer.onState((nextState) => {
    state.value = nextState
  })
  removeSettingsListener = window.api.miniPlayer.onSettings((nextSettings) => {
    settings.value = nextSettings
  })
  window.addEventListener('keydown', handleKeydown)

  try {
    const bootstrap = await window.api.miniPlayer.getBootstrap()
    state.value = bootstrap.state
    settings.value = bootstrap.settings
  } catch (error) {
    console.error('[mini-player] Failed to load initial state:', error)
  } finally {
    requestAnimationFrame(() => {
      ready.value = true
    })
  }
})

watch(
  () => state.value.track?.cover,
  () => {
    coverFailed.value = false
  }
)

onBeforeUnmount(() => {
  removeStateListener?.()
  removeSettingsListener?.()
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <main class="mini-player-root" :class="styleClasses" :style="styleVariables">
    <section class="mini-player-surface">
      <div v-if="hasCover" class="mini-player-backdrop" aria-hidden="true">
        <img :src="state.track?.cover || ''" alt="" />
      </div>

      <span class="mini-drag-hint" aria-hidden="true"></span>

      <div class="mini-artwork-wrap">
        <img
          v-if="hasCover"
          :src="state.track?.cover || ''"
          class="mini-artwork"
          alt="专辑封面"
          @error="coverFailed = true"
        />
        <div v-else class="mini-artwork mini-artwork-placeholder" aria-label="暂无封面">
          <i class="ph ph-music-notes"></i>
        </div>
        <div class="mini-play-state" :class="{ active: state.isPlaying }">
          <span class="mini-state-dot"></span>
          {{ playbackStateText }}
        </div>
        <div class="mini-equalizer" :class="{ active: state.isPlaying }" aria-hidden="true">
          <span></span><span></span><span></span><span></span>
        </div>
      </div>

      <div class="mini-player-content">
        <header class="mini-player-header">
          <div class="mini-track-meta">
            <div class="mini-track-kicker">{{ trackAlbum }}</div>
            <h1 :title="trackTitle">{{ trackTitle }}</h1>
            <p :title="trackArtist">{{ trackArtist }}</p>
          </div>

          <div class="mini-window-actions mini-no-drag">
            <button
              type="button"
              class="mini-tool-button"
              :title="`切换样式 · 当前：${activeStyle.name}`"
              aria-label="切换迷你播放器样式"
              @click="switchStyle"
            >
              <i class="ph ph-palette"></i>
            </button>
            <button
              type="button"
              class="mini-tool-button"
              :class="{ active: settings.positionLocked }"
              :title="settings.positionLocked ? '解锁窗口位置' : '锁定窗口位置'"
              :aria-pressed="settings.positionLocked"
              @click="togglePositionLock"
            >
              <i :class="settings.positionLocked ? 'ph ph-lock' : 'ph ph-lock-open'"></i>
            </button>
            <button
              type="button"
              class="mini-tool-button"
              :class="{ active: settings.alwaysOnTop }"
              :title="settings.alwaysOnTop ? '取消保持置顶' : '保持窗口置顶'"
              :aria-pressed="settings.alwaysOnTop"
              @click="toggleAlwaysOnTop"
            >
              <i class="ph ph-push-pin"></i>
            </button>
            <button
              type="button"
              class="mini-tool-button"
              title="最小化"
              aria-label="最小化"
              @click="minimizeWindow"
            >
              <i class="ph ph-minus"></i>
            </button>
            <button
              type="button"
              class="mini-tool-button return-button"
              title="返回完整播放器"
              aria-label="返回完整播放器"
              @click="returnToMainWindow"
            >
              <i class="ph ph-arrows-out-simple"></i>
            </button>
          </div>
        </header>

        <div class="mini-progress-block mini-no-drag">
          <input
            type="range"
            class="mini-range mini-progress-range"
            min="0"
            :max="state.duration || 1"
            step="0.1"
            :value="state.currentTime"
            aria-label="播放进度"
            :disabled="!state.track"
            @input="onProgressInput"
          />
          <div class="mini-time-row">
            <span>{{ formatTime(state.currentTime) }}</span>
            <span>{{ formatTime(state.duration) }}</span>
          </div>
        </div>

        <footer class="mini-player-controls mini-no-drag">
          <button
            type="button"
            class="mini-control-button mode-button"
            :title="playModeTitle"
            :aria-label="playModeTitle"
            :disabled="!state.track"
            @click="sendCommand({ type: 'cycle-play-mode' })"
          >
            <i :class="playModeIcon"></i>
          </button>

          <div class="mini-transport">
            <button
              type="button"
              class="mini-control-button transport-button"
              title="上一首"
              aria-label="上一首"
              :disabled="!state.track"
              @click="sendCommand({ type: 'previous' })"
            >
              <i class="ph ph-skip-back"></i>
            </button>
            <button
              type="button"
              class="mini-play-button"
              :title="state.isPlaying ? '暂停' : '播放'"
              :aria-label="state.isPlaying ? '暂停' : '播放'"
              :disabled="!state.track || state.isLoading"
              @click="togglePlay"
            >
              <i
                :class="
                  state.isLoading
                    ? 'pi pi-spin pi-spinner'
                    : state.isPlaying
                      ? 'ph ph-pause'
                      : 'ph ph-play'
                "
              ></i>
            </button>
            <button
              type="button"
              class="mini-control-button transport-button"
              title="下一首"
              aria-label="下一首"
              :disabled="!state.track"
              @click="sendCommand({ type: 'next' })"
            >
              <i class="ph ph-skip-forward"></i>
            </button>
          </div>

          <label class="mini-volume" title="音量">
            <i class="ph ph-speaker-high"></i>
            <input
              type="range"
              class="mini-range mini-volume-range"
              min="0"
              max="1"
              step="0.01"
              :value="state.volume"
              aria-label="音量"
              @input="onVolumeInput"
            />
          </label>
        </footer>
      </div>
    </section>
  </main>
</template>

<style src="./MiniPlayer.css"></style>
