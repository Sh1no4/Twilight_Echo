<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useMusicStore } from '../stores/useMusicStore'
import { useListeningStatsStore } from '../stores/useListeningStatsStore'
import { usePlayerStore } from '../stores/usePlayerStore'
import type { Track } from '../types/music'
import { useCover } from '../utils/coverLoader'
import CoverImg from './CoverImg.vue'
import nextTrackIcon from '../assets/icons/next-track.svg'
import pauseIcon from '../assets/icons/pause.svg'
import playIcon from '../assets/icons/play.svg'
import previousTrackIcon from '../assets/icons/previous-track.svg'
import repeatIcon from '../assets/icons/single-song-repeat.svg'
import shuffleIcon from '../assets/icons/shuffle.svg'
import sequentialIcon from '../assets/icons/sequential-playback.svg'

const emit = defineEmits<{
  (event: 'open-dsp'): void
}>()

interface DspNode {
  id: string
  name: string
  icon: string
  active: boolean
}

const DEFAULT_COVER = '/icon.png'
const FALLBACK_THUMB = '/icon.png'
const HEATMAP_DAYS = 140
const dashboardSpectrumCanvasRef = ref<HTMLCanvasElement | null>(null)
let dashboardSpectrumResizeObserver: ResizeObserver | null = null
let dashboardSpectrumRaf = 0

function onCoverError(event: Event): void {
  const img = event.target as HTMLImageElement
  if (img && img.src !== DEFAULT_COVER) {
    img.src = DEFAULT_COVER
  }
}

const { tracks, albums } = useMusicStore()
const { listeningStats } = useListeningStatsStore()
const {
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  progress,
  playMode,
  audioProcessing,
  playbackInfo,
  outputInfo,
  visualizationData,
  setPlayMode,
  playTrack,
  togglePlay,
  next,
  prev,
  seek,
  formatTime
} = usePlayerStore()

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function isBiliTrack(track: Track | undefined): boolean {
  return track?.source === 'bili' || track?.id.startsWith('bili:') === true
}

const nowPlayingTitle = computed(() => currentTrack.value?.title || '暂无正在播放')
const nowPlayingArtist = computed(() => currentTrack.value?.artist || '选择一首本地或在线音乐开始')
const resolvedCurrentCover = useCover(computed(() => currentTrack.value?.cover ?? null))
const nowPlayingCover = computed(() => resolvedCurrentCover.value || DEFAULT_COVER)
const nowPlayingMeta = computed(() => {
  const track = currentTrack.value
  if (!track) return 'Ready'
  const album = track.album || 'Unknown Album'
  const format = formatTrackFormat(track)
  return `${album} • ${format}`
})

const progressWidth = computed(() => `${Math.min(100, Math.max(0, progress.value))}%`)

const libraryDays = computed(() => {
  const seconds = tracks.value.reduce((sum, track) => sum + Math.max(0, track.duration || 0), 0)
  return seconds / 86400
})

const recentlyAddedTracks = computed(() => tracks.value.slice(-3).reverse())
const DASHBOARD_QUEUE_WINDOW = 200
const topTracks = computed(() => {
  const byId = new Map(tracks.value.map((track) => [track.id, track]))
  const stats = Object.entries(listeningStats.value.tracks)
    .filter(([id, stat]) => !id.startsWith('bili:') && !isBiliTrack(stat.track))
    .sort(([, a], [, b]) => b.seconds - a.seconds)
    .slice(0, 3)
    .map(([id, stat]) => ({ id, stat, track: byId.get(id) ?? stat.track }))

  if (stats.length > 0) return stats

  return tracks.value.slice(0, 3).map((track) => ({
    id: track.id,
    track,
    stat: {
      seconds: 0,
      plays: 0,
      title: track.title,
      artist: track.artist,
      cover: track.cover
    }
  }))
})

const heatmapCells = computed(() => {
  return Array.from({ length: HEATMAP_DAYS }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - (HEATMAP_DAYS - index - 1))
    const seconds = listeningStats.value.days[dayKey(date)] ?? 0
    const hours = seconds / 3600
    return {
      key: dayKey(date),
      level: heatmapLevel(hours),
      info:
        seconds > 0
          ? `${formatDuration(seconds)} on ${date.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric'
            })}`
          : `No activity on ${date.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric'
            })}`
    }
  })
})

const thisMonthSeconds = computed(() => {
  const monthPrefix = dayKey(new Date()).slice(0, 7)
  return Object.entries(listeningStats.value.days).reduce(
    (sum, [date, seconds]) => (date.startsWith(monthPrefix) ? sum + seconds : sum),
    0
  )
})

const dailyAverageSeconds = computed(() => {
  const now = new Date()
  return thisMonthSeconds.value / now.getDate()
})

const dayStreak = computed(() => {
  let streak = 0
  const cursor = new Date()
  while ((listeningStats.value.days[dayKey(cursor)] ?? 0) > 0) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
})

const thisMonthDisplay = computed(() => formatStatDuration(thisMonthSeconds.value))
const dailyAverageDisplay = computed(() => formatStatDuration(dailyAverageSeconds.value))

const dspNodes = computed<DspNode[]>(() => {
  const output = outputInfo.value
  const nativePlugins = Array.isArray(output?.nativeDsp?.plugins) ? output.nativeDsp.plugins : []
  const activeNativePlugins = nativePlugins
    .map((plugin) => normalizeNativeDspPlugin(plugin))
    .filter((plugin): plugin is DspNode => !!plugin)

  return [
    {
      id: 'source',
      name: playbackInfo.value?.source ? 'Source File' : 'No Source',
      icon: 'ph ph-file-audio',
      active: !!playbackInfo.value?.source
    },
    {
      id: 'resampler',
      name: output?.resampled ? 'SOXR Resampler' : 'Native Rate',
      icon: 'ph ph-wave-sine',
      active: output?.resampled === true
    },
    {
      id: 'eq',
      name: audioProcessing.value.eqMode === 'parametric' ? 'Parametric EQ' : '10-Band EQ',
      icon: 'ph ph-faders',
      active: audioProcessing.value.dspEnabled && audioProcessing.value.eqEnabled
    },
    {
      id: 'replaygain',
      name: audioProcessing.value.volumeNormalization === 'off' ? 'ReplayGain Off' : 'ReplayGain',
      icon: 'ph ph-gauge',
      active:
        audioProcessing.value.dspEnabled && audioProcessing.value.volumeNormalization !== 'off'
    },
    {
      id: 'crossfeed',
      name: 'Bauer Crossfeed',
      icon: 'ph ph-headphones',
      active: audioProcessing.value.dspEnabled && audioProcessing.value.crossfeedEnabled
    },
    ...activeNativePlugins,
    {
      id: 'output',
      name: output?.actualBackend ? `${output.actualBackend.toUpperCase()} Output` : 'Audio Output',
      icon: 'ph ph-speaker-hifi',
      active: playbackInfo.value?.state === 'playing'
    }
  ]
})

function resolveCanvasColor(canvas: HTMLCanvasElement, name: string, fallback: string): string {
  const value = getComputedStyle(canvas).getPropertyValue(name).trim()
  return value || fallback
}

function prepareCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const cssWidth = canvas.clientWidth
  const cssHeight = canvas.clientHeight
  if (cssWidth <= 0 || cssHeight <= 0) return null
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const bufferWidth = Math.max(1, Math.round(cssWidth * dpr))
  const bufferHeight = Math.max(1, Math.round(cssHeight * dpr))
  if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
    canvas.width = bufferWidth
    canvas.height = bufferHeight
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssWidth, cssHeight)
  return ctx
}

function normalizedSpectrumValues(points = 24): number[] {
  const source = visualizationData.value.spectrum
  return Array.from({ length: points }, (_, index) => {
    const value = source[index] ?? 0
    if (!visualizationData.value.active) return 0.14
    const width = Math.max(12, Math.min(132, 12 + Math.sqrt(Math.max(0, value)) * 120))
    return Math.min(1, Math.max(0.08, width / 132))
  })
}

function drawDashboardSpectrumNow(): void {
  dashboardSpectrumRaf = 0
  const canvas = dashboardSpectrumCanvasRef.value
  if (!canvas) return
  const ctx = prepareCanvas(canvas)
  if (!ctx) return

  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const values = normalizedSpectrumValues()
  const accent = resolveCanvasColor(canvas, '--accent', '#7c4dff')
  const accentLight = resolveCanvasColor(canvas, '--accent-light', '#22d3ee')
  const compactLayout = width < 360 || height < 140

  if (compactLayout) {
    const gap = 4
    const barWidth = Math.max(2, Math.min(4, (width - gap * (values.length - 1)) / values.length))
    const totalWidth = values.length * barWidth + (values.length - 1) * gap
    const startX = Math.max(0, (width - totalWidth) / 2)
    const maxHeight = Math.min(58, height - 4)
    const gradient = ctx.createLinearGradient(0, height - maxHeight, 0, height)
    gradient.addColorStop(0, accentLight)
    gradient.addColorStop(1, accent)
    ctx.fillStyle = gradient
    values.forEach((scale, index) => {
      const barHeight = Math.max(4, maxHeight * scale)
      const x = startX + index * (barWidth + gap)
      ctx.fillRect(x, height - barHeight, barWidth, barHeight)
    })
    return
  }

  const gap = 4
  const barHeight = Math.max(2, Math.min(4, (height - gap * (values.length - 1)) / values.length))
  const totalHeight = values.length * barHeight + (values.length - 1) * gap
  const startY = Math.max(0, (height - totalHeight) / 2)
  const maxWidth = Math.min(132, width - 4)
  const gradient = ctx.createLinearGradient(width - maxWidth, 0, width, 0)
  gradient.addColorStop(0, accentLight)
  gradient.addColorStop(1, accent)
  ctx.fillStyle = gradient
  values.forEach((scale, index) => {
    const barWidth = Math.max(12, maxWidth * scale)
    const x = width - barWidth
    const y = startY + index * (barHeight + gap)
    ctx.fillRect(x, y, barWidth, barHeight)
  })
}

function queueDashboardSpectrumDraw(): void {
  if (dashboardSpectrumRaf !== 0) return
  dashboardSpectrumRaf = window.requestAnimationFrame(drawDashboardSpectrumNow)
}

watch(visualizationData, queueDashboardSpectrumDraw, { flush: 'post' })

onMounted(() => {
  if (dashboardSpectrumCanvasRef.value) {
    dashboardSpectrumResizeObserver = new ResizeObserver(queueDashboardSpectrumDraw)
    dashboardSpectrumResizeObserver.observe(dashboardSpectrumCanvasRef.value)
  }
  queueDashboardSpectrumDraw()
})

onBeforeUnmount(() => {
  if (dashboardSpectrumRaf !== 0) {
    window.cancelAnimationFrame(dashboardSpectrumRaf)
    dashboardSpectrumRaf = 0
  }
  dashboardSpectrumResizeObserver?.disconnect()
  dashboardSpectrumResizeObserver = null
})

function normalizeNativeDspPlugin(plugin: unknown): DspNode | null {
  if (!isRecord(plugin)) return null
  const id = typeof plugin.id === 'string' ? plugin.id : ''
  const name = typeof plugin.name === 'string' ? plugin.name : id || 'Native DSP'
  if (!id && !name) return null
  return {
    id: `native:${id || name}`,
    name,
    icon: 'ph ph-cpu',
    active: plugin.active === true && plugin.bypassed !== true
  }
}

function heatmapLevel(hours: number): string {
  if (hours >= 4) return 'level-4'
  if (hours >= 2) return 'level-3'
  if (hours >= 0.5) return 'level-2'
  if (hours > 0) return 'level-1'
  return ''
}

function formatTrackFormat(track: Track): string {
  const parts: string[] = []
  if (track.format) parts.push(track.format.toUpperCase())
  if (track.bitDepth) parts.push(`${track.bitDepth}-bit`)
  if (track.sampleRate) parts.push(`${Math.round(track.sampleRate / 1000)}kHz`)
  if (parts.length > 0) return parts.join(' / ')
  return track.source === 'ncm' ? 'NCM Stream' : track.source === 'bili' ? 'Bilibili Audio' : 'Local Audio'
}

function formatCompactNumber(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 1 : 0)}k`
  return String(value)
}

function formatDays(value: number): string {
  if (value >= 10) return Math.round(value).toString()
  return value.toFixed(1)
}

function formatDuration(seconds: number): string {
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(seconds >= 36000 ? 0 : 1)}h`
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`
  return `${Math.round(seconds)}s`
}

function formatStatDuration(seconds: number): { value: string; unit: string } {
  if (seconds >= 3600) {
    return {
      value: (seconds / 3600).toFixed(seconds >= 36000 ? 0 : 1),
      unit: 'h'
    }
  }
  return {
    value: String(Math.round(seconds / 60)),
    unit: 'm'
  }
}

function handleSeek(event: MouseEvent): void {
  if (duration.value <= 0) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  seek(duration.value * ratio)
}

function playDashboardTrack(track: Track | undefined): void {
  if (!track) return
  const sourceIndex = tracks.value.findIndex((item) => item.id === track.id)
  if (sourceIndex < 0) {
    playTrack(track, [track])
    return
  }

  const halfWindow = Math.floor(DASHBOARD_QUEUE_WINDOW / 2)
  const start = Math.max(0, sourceIndex - halfWindow)
  const end = Math.min(tracks.value.length, start + DASHBOARD_QUEUE_WINDOW)
  const queueStart = Math.max(0, end - DASHBOARD_QUEUE_WINDOW)
  playTrack(track, tracks.value.slice(queueStart, end))
}
</script>

<template>
  <div class="dashboard-wrapper">
    <div class="dashboard">

        <!-- Now Playing Card (Left Top - Horizontal & Wide) -->
        <div class="card now-playing">
            <div class="album-art-container">
                <div class="album-art">
                    <img :src="nowPlayingCover" alt="Album Art" @error="onCoverError">
                </div>
            </div>
            
            <div class="player-content">
                <div class="song-info">
                    <h2>{{ nowPlayingTitle }}</h2>
                    <p>{{ nowPlayingArtist }}</p>
                    <div class="meta">{{ nowPlayingMeta }}</div>
                </div>

                <div class="progress-container">
                    <div class="progress-bar" @click="handleSeek">
                        <div class="progress-fill" :style="{ width: progressWidth }"></div>
                    </div>
                    <div class="time">
                        <span>{{ formatTime(currentTime) }}</span>
                        <span>{{ formatTime(duration) }}</span>
                    </div>
                </div>

                <div class="controls">
                    <button
                      class="control-btn"
                      :class="{ active: playMode === 'shuffle' }"
                      title="随机播放"
                      aria-label="随机播放"
                      @click="setPlayMode(playMode === 'shuffle' ? 'sequential' : 'shuffle')"
                    >
                      <img :src="shuffleIcon" alt="随机播放" />
                    </button>
                    <button class="control-btn" title="上一首" aria-label="上一首" @click="prev">
                      <img :src="previousTrackIcon" alt="上一首" />
                    </button>
                    <button class="control-btn play-btn" title="播放/暂停" aria-label="播放/暂停" @click="togglePlay">
                      <img :src="isPlaying ? pauseIcon : playIcon" :alt="isPlaying ? '暂停' : '播放'" />
                    </button>
                    <button class="control-btn" title="下一首" aria-label="下一首" @click="next">
                      <img :src="nextTrackIcon" alt="下一首" />
                    </button>
                    <button
                      class="control-btn"
                      :class="{ active: playMode === 'repeat' }"
                      title="单曲循环 / 顺序播放"
                      aria-label="单曲循环 / 顺序播放"
                      @click="setPlayMode(playMode === 'repeat' ? 'sequential' : 'repeat')"
                    >
                      <img
                        :src="playMode === 'repeat' ? repeatIcon : sequentialIcon"
                        :alt="playMode === 'repeat' ? '单曲循环' : '顺序播放'"
                      />
                    </button>
                </div>
            </div>
        </div>

        <!-- Listening Calendar Card (Left Bottom - Under Now Playing) -->
        <div class="card calendar-card">
            <div class="card-header">
                <i class="ph ph-calendar-blank"></i>
                Listening Journey
            </div>

            <div class="heatmap-container">
                <div class="heatmap-labels">
                    <span>Mon</span>
                    <span>Wed</span>
                    <span>Fri</span>
                </div>
                <div class="heatmap">
                    <div
                      v-for="cell in heatmapCells"
                      :key="cell.key"
                      class="heatmap-cell"
                      :class="cell.level"
                      :data-info="cell.info"
                    ></div>
                </div>
            </div>

            <div class="calendar-stats">
                <div class="stat">
                    <span class="stat-value">{{ thisMonthDisplay.value }}<span style="font-size:1rem;color:var(--text-muted);font-weight:600;">{{ thisMonthDisplay.unit }}</span></span>
                    <span class="stat-label">This Month</span>
                </div>
                <div class="stat">
                    <span class="stat-value">{{ dailyAverageDisplay.value }}<span style="font-size:1rem;color:var(--text-muted);font-weight:600;">{{ dailyAverageDisplay.unit }}</span></span>
                    <span class="stat-label">Daily Avg</span>
                </div>
                <div class="stat">
                    <span class="stat-value">{{ dayStreak }}</span>
                    <span class="stat-label">Day Streak</span>
                </div>
            </div>
        </div>

        <!-- Library Overview (Center Top) -->
        <div class="card library-card">
            <div class="card-header">
                <i class="ph ph-books"></i>
                Local Library
            </div>
            
            <div class="library-stats-header">
                <div class="lib-stat">
                    <span>{{ formatCompactNumber(tracks.length) }}</span>
                    <label>Tracks</label>
                </div>
                <div class="lib-stat">
                    <span>{{ formatCompactNumber(albums.length) }}</span>
                    <label>Albums</label>
                </div>
                <div class="lib-stat">
                    <span>{{ formatDays(libraryDays) }}</span>
                    <label>Days</label>
                </div>
            </div>

            <h3 class="section-title">Recently Added</h3>
            <div class="recent-list">
                <div
                  v-for="track in recentlyAddedTracks"
                  :key="track.id"
                  class="recent-item"
                  @click="playDashboardTrack(track)"
                >
                    <CoverImg :cover="track.cover" :fallback="FALLBACK_THUMB" alt="Album" class="recent-img" @error="onCoverError" />
                    <div class="recent-info">
                        <h4>{{ track.title }}</h4>
                        <p>{{ track.artist || 'Unknown Artist' }}</p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Top Tracks (Center Bottom) -->
        <div class="card top-tracks-card">
            <div class="card-header">
                <i class="ph ph-music-notes"></i>
                Top Tracks
            </div>

            <div class="track-list">
                <div
                  v-for="(entry, index) in topTracks"
                  :key="entry.id"
                  class="track-item"
                  @click="playDashboardTrack(entry.track)"
                >
                    <div class="rank">{{ index + 1 }}</div>
                    <CoverImg :cover="entry.track?.cover || entry.stat.cover" :fallback="FALLBACK_THUMB" alt="Track" class="rank-img" @error="onCoverError" />
                    <div class="track-info">
                        <h4>{{ entry.track?.title || entry.stat.title }}</h4>
                        <p>{{ entry.track?.artist || entry.stat.artist }} • {{ entry.stat.plays }} plays</p>
                    </div>
                </div>
            </div>
        </div>

        <!-- DSP Chain Card (Right - Vertical) -->
        <div class="card dsp-chain">
            <div class="card-header">
                <i class="ph ph-sliders-horizontal"></i>
                DSP Chain
            </div>
            
            <div class="dsp-scroll-container">
                <div class="dsp-nodes">
                    <div
                      v-for="node in dspNodes"
                      :key="node.id"
                      class="dsp-node"
                      :class="{ active: node.active }"
                      @click="emit('open-dsp')"
                    >
                        <i :class="node.icon"></i>
                        <div class="name">{{ node.name }}</div>
                        <div class="status-dot"></div>
                    </div>
                </div>
            </div>

            <!-- Horizontal Spectrum Analyzer (Right to Left) -->
            <div class="visualizer-container" v-show="visualizationData.active">
                <canvas
                  ref="dashboardSpectrumCanvasRef"
                  class="visualizer-canvas"
                  aria-hidden="true"
                ></canvas>
            </div>
        </div>

    </div>
  </div>
</template>

<style scoped>
.dashboard-wrapper {
  /* Light Mode Color Palette variables mapped specifically for the dashboard */
  --card-bg: rgba(255, 255, 255, 0.7);
  --card-border: rgba(255, 255, 255, 0.8);
  --text-main: #1f2937;
  --text-muted: #6b7280;
  --accent: var(--te-primary-500);
  --accent-light: var(--te-primary-400);
  --accent-glow: var(--te-glow-main);
  --success: #10b981;

  font-family: 'Inter', sans-serif;
  color: var(--text-main);
  background-color: var(--te-local-bg);
  background-image: var(--te-local-bg-image);
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
  width: 100%;
  height: 100%;
  padding: 2rem 1rem;
  overflow-y: auto;
  overflow-x: hidden;
  box-sizing: border-box;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* Updated Grid Layout: 
    Col 1 (Wide, Left): Now Playing (Top), Calendar (Bottom)
    Col 2 (Medium, Center): Library (Top), Top Tracks (Bottom)
    Col 3 (Narrow, Right): DSP Chain (Vertical, Top to Bottom)
*/
.dashboard {
    display: grid;
    grid-template-columns: 1fr 340px 280px;
    grid-template-rows: auto 1fr;
    gap: 1.5rem;
    max-width: 1650px;
    width: 100%;
    margin: 0 auto;
}

.card {
    background: var(--card-bg);
    backdrop-filter: blur(18px) saturate(126%);
    -webkit-backdrop-filter: blur(18px) saturate(126%);
    border: 1px solid var(--card-border);
    border-radius: 26px;
    padding: 1.8rem;
    box-shadow:
      0 18px 54px rgba(15, 23, 42, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.72);
    transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.4s ease;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

.card:hover {
    transform: translateY(-4px);
    box-shadow: 0 15px 50px rgba(31, 38, 135, 0.1);
}

/* --- Shared Header --- */
.card-header {
    font-family: 'Outfit', sans-serif;
    font-size: 1.15rem;
    font-weight: 700;
    margin-bottom: 1.5rem;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--text-main);
}

.card-header i {
    color: var(--accent);
    font-size: 1.4rem;
}

/* --- Now Playing Section (Left Top - Horizontal) --- */
.now-playing {
    grid-column: 1 / 2;
    grid-row: 1 / 2;
    flex-direction: row;
    align-items: center;
    gap: 3rem;
    padding: 2.5rem 3rem;
}

.album-art-container {
    position: relative;
    flex-shrink: 0;
    width: 240px;
    height: 240px;
}

.album-art {
    width: 100%;
    height: 100%;
    border-radius: 20px;
    box-shadow: 0 15px 35px rgba(0,0,0,0.15), 0 0 50px var(--accent-glow);
    overflow: hidden;
    position: relative;
    z-index: 2;
}

.album-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.5s ease;
}

.album-art:hover img {
    transform: scale(1.05);
}

.player-content {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
}

.song-info {
    width: 100%;
    text-align: left;
}

.song-info h2 {
    font-family: 'Outfit', sans-serif;
    font-size: 2.5rem;
    font-weight: 700;
    margin-bottom: 0.2rem;
    letter-spacing: -0.5px;
    background: linear-gradient(135deg, #1f2937 0%, #4b5563 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

.song-info p {
    color: var(--accent);
    font-size: 1.2rem;
    font-weight: 600;
    margin-bottom: 0.6rem;
}

.song-info .meta {
    color: var(--text-muted);
    font-size: 0.85rem;
    font-weight: 500;
    margin-bottom: 2rem;
    background: rgba(0,0,0,0.04);
    padding: 4px 12px;
    border-radius: 12px;
    display: inline-block;
}

.progress-container {
    width: 100%;
    margin-bottom: 2rem;
}

.progress-bar {
    height: 8px;
    background: rgba(0,0,0,0.06);
    border-radius: 4px;
    overflow: hidden;
    position: relative;
    cursor: pointer;
}

.progress-fill {
    position: absolute;
    top: 0; left: 0; height: 100%;
    width: 65%;
    background: linear-gradient(90deg, var(--accent), var(--accent-light));
    border-radius: 4px;
    box-shadow: 0 0 10px var(--accent-glow);
    transition: width 0.1s linear;
}

.time {
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
    margin-top: 0.8rem;
    font-variant-numeric: tabular-nums;
}

.controls {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 1.5rem;
    width: 100%;
}

.control-btn {
    background: none;
    border: none;
    color: #222;
    font-size: 1.6rem;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    opacity: 0.75;
}

.control-btn i {
    display: none;
}

.control-btn img {
    width: 1.35rem;
    height: 1.35rem;
    display: block;
    object-fit: contain;
    pointer-events: none;
    user-select: none;
}

.play-btn img {
    width: 1.75rem;
    height: 1.75rem;
    filter: brightness(0) invert(1);
}

.control-btn:hover {
    opacity: 1;
    color: var(--accent);
    transform: scale(1.1);
}

.control-btn.active {
    opacity: 1;
    color: var(--accent);
}

.play-btn {
    width: 70px;
    height: 70px;
    border-radius: 50%;
    background: var(--accent);
    color: white;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: 2rem;
    opacity: 1;
    box-shadow: 0 10px 20px var(--accent-glow);
}

.play-btn:hover {
    transform: scale(1.08);
    box-shadow: 0 14px 28px var(--accent-glow);
    color: white;
}

/* --- Calendar Section (Left Bottom - Under Now Playing) --- */
.calendar-card {
    grid-column: 1 / 2;
    grid-row: 2 / 3;
}

.heatmap-container {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
    flex-grow: 1;
}

.heatmap-labels {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-muted);
    padding-top: 0.5rem;
    padding-right: 0.5rem;
}

.heatmap {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18px, 1fr));
    grid-template-rows: repeat(5, 1fr);
    gap: 5px;
    flex-grow: 1;
    width: 100%;
}

:deep(.heatmap-cell) {
    aspect-ratio: 1;
    border-radius: 4px;
    background: rgba(0,0,0,0.04);
    border: 1px solid rgba(0,0,0,0.02);
    transition: all 0.2s;
    cursor: pointer;
    position: relative;
}

:deep(.heatmap-cell:hover) {
    transform: scale(1.4);
    z-index: 10;
    border-radius: 6px;
    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
}

:deep(.heatmap-cell::after) {
    content: attr(data-info);
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%) translateY(5px);
    background: #1f2937;
    color: #fff;
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 500;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: all 0.2s;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 20;
}

:deep(.heatmap-cell:hover::after) {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
}

:deep(.level-1) { background: rgba(var(--te-primary-rgb), 0.2); border-color: rgba(var(--te-primary-rgb), 0.1); }
:deep(.level-2) { background: rgba(var(--te-primary-rgb), 0.45); border-color: rgba(var(--te-primary-rgb), 0.2); }
:deep(.level-3) { background: rgba(var(--te-primary-rgb), 0.75); border-color: rgba(var(--te-primary-rgb), 0.4); }
:deep(.level-4) { background: rgb(var(--te-primary-rgb)); box-shadow: 0 0 12px var(--accent-glow); border-color: var(--accent); }

.calendar-stats {
    display: flex;
    justify-content: space-around;
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid rgba(0,0,0,0.06);
}

.stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
}

.stat-value {
    font-family: 'Outfit', sans-serif;
    font-size: 1.6rem;
    font-weight: 700;
    color: var(--text-main);
}

.stat-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

/* --- Library Overview Section (Center Top) --- */
.library-card {
    grid-column: 2 / 3;
    grid-row: 1 / 2;
}

.library-stats-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 1.5rem;
    background: rgba(0,0,0,0.02);
    padding: 1rem;
    border-radius: 16px;
}

.lib-stat { text-align: center; }
.lib-stat span { display: block; font-weight: 700; font-size: 1.1rem; color: var(--accent); }
.lib-stat label { font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; }

.section-title {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 1rem;
}

.recent-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}

.recent-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem;
    border-radius: 12px;
    transition: background 0.2s;
    cursor: pointer;
}

.recent-item:hover { background: rgba(0,0,0,0.04); }

.recent-item img {
    width: 44px;
    height: 44px;
    border-radius: 8px;
    object-fit: cover;
    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
}

.recent-info h4 {
    font-size: 0.9rem;
    font-weight: 600;
    margin-bottom: 0.2rem;
    color: var(--text-main);
}

.recent-info p {
    font-size: 0.75rem;
    color: var(--text-muted);
}

/* --- Top Tracks Section (Center Bottom) --- */
.top-tracks-card {
    grid-column: 2 / 3;
    grid-row: 2 / 3;
}

.track-list {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
}

.track-item {
    display: flex;
    align-items: center;
    gap: 1rem;
}

.track-item .rank {
    font-family: 'Outfit', sans-serif;
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-muted);
    width: 20px;
    text-align: center;
}

.track-item img {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    object-fit: cover;
    box-shadow: 0 2px 6px rgba(0,0,0,0.08);
}

.track-info { flex-grow: 1; }

.track-info h4 {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-main);
    margin-bottom: 0.1rem;
}

.track-info p {
    font-size: 0.75rem;
    color: var(--accent);
    font-weight: 500;
}

/* --- DSP Chain Section (Right - Vertical) --- */
.dsp-chain {
    grid-column: 3 / 4;
    grid-row: 1 / 3;
    padding: 1.5rem;
}

.dsp-scroll-container {
    overflow-y: auto;
    overflow-x: hidden;
    flex: 0 1 auto;
    padding-right: 0.5rem;
    margin-bottom: 0;
    scrollbar-width: thin;
    scrollbar-color: var(--accent-light) rgba(0,0,0,0.05);
}

.dsp-scroll-container::-webkit-scrollbar { width: 4px; }
.dsp-scroll-container::-webkit-scrollbar-track { background: rgba(0,0,0,0.05); border-radius: 2px; }
.dsp-scroll-container::-webkit-scrollbar-thumb { background: var(--accent-light); border-radius: 2px; }

.dsp-nodes {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    position: relative;
    padding: 0.5rem 0;
}

/* Vertical Connecting line */
.dsp-nodes::before {
    content: '';
    position: absolute;
    top: 0; bottom: 0; left: 50%;
    width: 2px;
    background: rgba(0,0,0,0.06);
    z-index: 0;
    transform: translateX(-50%);
}

.dsp-node {
    position: relative;
    z-index: 1;
    background: var(--te-card-bg);
    border: 1px solid rgba(0,0,0,0.05);
    padding: 0.8rem 1rem;
    border-radius: 14px;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.8rem;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 4px 6px rgba(0,0,0,0.02);
}

.dsp-node:hover {
    background: var(--te-card-bg);
    transform: translateX(-4px);
    box-shadow: 0 8px 15px rgba(0,0,0,0.05);
}

.dsp-node.active {
    border-color: var(--accent);
    background: var(--te-card-bg);
    box-shadow: 0 6px 16px var(--accent-glow);
}

.dsp-node i {
    font-size: 1.4rem;
    color: var(--text-muted);
    transition: color 0.3s;
}

.dsp-node.active i {
    color: var(--accent);
}

.dsp-node .name {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-main);
    line-height: 1.2;
}

.dsp-node .status-dot {
    position: absolute;
    top: 50%; right: -4px;
    transform: translateY(-50%);
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(0,0,0,0.1);
}

.dsp-node.active .status-dot {
    background: var(--success);
    box-shadow: 0 0 8px var(--success);
    right: -6px;
    width: 12px;
    height: 12px;
    border: 2px solid #fff;
}

/* --- Horizontal Spectrum Analyzer (Right to Left) --- */
.visualizer-container {
    width: 100%;
    flex: 1 1 180px;
    min-height: 160px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-top: 0.25rem;
    padding-right: 0.5rem;
}

.visualizer-canvas {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 160px;
}

/* Responsive */
@media (max-width: 1400px) {
    .dashboard {
        grid-template-columns: 1fr 280px;
    }
    .library-card, .top-tracks-card { grid-column: 2 / 3; }
    .dsp-chain { grid-column: 1 / -1; grid-row: 3 / 4; }
    .dsp-nodes { flex-direction: row; }
    .dsp-nodes::before { top: 50%; bottom: auto; left: 0; right: 0; width: 100%; height: 2px; transform: translateY(-50%); }
    .dsp-node { flex-direction: column; }
    .visualizer-container { min-height: 120px; }
    .visualizer-canvas { min-height: 120px; }
}
@media (max-width: 950px) {
    .dashboard {
        grid-template-columns: 1fr;
    }
    .library-card, .top-tracks-card, .now-playing, .calendar-card, .dsp-chain {
        grid-column: 1 / 2;
        grid-row: auto;
    }
    .now-playing {
        flex-direction: column;
        text-align: center;
    }
    .now-playing .controls { justify-content: center; }
}
</style>
