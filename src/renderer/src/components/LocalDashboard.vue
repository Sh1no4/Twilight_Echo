<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useMusicStore } from '../stores/useMusicStore'
import { getMostListenedTracks, useListeningStatsStore } from '../stores/useListeningStatsStore'
import { usePlayerStore } from '../stores/usePlayerStore'
import type { Track } from '../types/music'
import { useCover } from '../utils/coverLoader'
import { createUnifiedRecentTrackResolver } from '../utils/unifiedRecentTracks'
import CoverImg from './CoverImg.vue'

const emit = defineEmits<{
  (event: 'select-view', category: string, filter: string | null): void
}>()

const DEFAULT_COVER = '/icon.png'
const DASHBOARD_QUEUE_WINDOW = 200
const SHELF_SIZE = 6
const TOP_TRACK_COUNT = 6
const ALBUM_SHELF_SIZE = 5

const { tracks, albums, artists } = useMusicStore()
const { listeningStats } = useListeningStatsStore()
const {
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  progress,
  playTrack,
  togglePlay,
  next,
  prev,
  seek,
  formatTime,
  setPlayMode,
  audioProcessing,
  playbackInfo
} = usePlayerStore()

const now = ref(new Date())
const homeScrollRef = ref<HTMLElement | null>(null)
const homeScrollbarActive = ref(false)
let homeScrollbarHideTimer: ReturnType<typeof setTimeout> | null = null

function clearHomeScrollbarHideTimer(): void {
  if (homeScrollbarHideTimer == null) return
  clearTimeout(homeScrollbarHideTimer)
  homeScrollbarHideTimer = null
}

function revealHomeScrollbar(): void {
  homeScrollbarActive.value = true
  clearHomeScrollbarHideTimer()
  homeScrollbarHideTimer = setTimeout(() => {
    homeScrollbarActive.value = false
    homeScrollbarHideTimer = null
  }, 900)
}

function onHomeScroll(): void {
  revealHomeScrollbar()
}

onMounted(() => {
  homeScrollRef.value?.addEventListener('scroll', onHomeScroll, { passive: true })
})

onBeforeUnmount(() => {
  homeScrollRef.value?.removeEventListener('scroll', onHomeScroll)
  clearHomeScrollbarHideTimer()
})

const greeting = computed(() => {
  const hour = now.value.getHours()
  if (hour < 5) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
})

const hasLibrary = computed(() => tracks.value.length > 0)

const totalDurationText = computed(() => {
  const seconds = tracks.value.reduce((sum, track) => sum + Math.max(0, track.duration || 0), 0)
  const hours = seconds / 3600
  if (hours >= 24) return `${(hours / 24).toFixed(1)} 天`
  if (hours >= 1) return `${hours.toFixed(1)} 小时`
  return `${Math.round(seconds / 60)} 分钟`
})

interface RankedStat {
  id: string
  seconds: number
  plays: number
  title: string
  artist: string
  cover: string | null
  track: Track | null
}

const rankedStats = computed<RankedStat[]>(() => {
  const resolveRecentTrack = createUnifiedRecentTrackResolver(tracks.value)
  return getMostListenedTracks(TOP_TRACK_COUNT).map((stat) => {
    return {
      id: stat.id,
      seconds: stat.seconds,
      plays: stat.plays,
      title: stat.title,
      artist: stat.artist,
      cover: stat.cover ?? null,
      track: resolveRecentTrack(stat) ?? stat.track ?? null
    }
  })
})

const heroTrack = computed<Track | null>(() => {
  if (currentTrack.value) return currentTrack.value
  const ranked = rankedStats.value[0]
  if (ranked?.track) return ranked.track
  return tracks.value[0] ?? null
})

const heroIsCurrent = computed(
  () => !!currentTrack.value && heroTrack.value?.id === currentTrack.value.id
)

const heroCover = useCover(computed(() => heroTrack.value?.cover ?? null))
const heroCoverSrc = computed(() => heroCover.value || DEFAULT_COVER)
const nowPlayingTitle = computed(() => currentTrack.value?.title || heroTrack.value?.title)
const progressWidth = computed(() => `${Math.min(100, Math.max(0, progress.value))}%`)

const heroLabel = computed(() => {
  if (!heroTrack.value) return ''
  if (heroIsCurrent.value) return isPlaying.value ? '正在播放' : '继续播放'
  return '为你推荐'
})

const heroMeta = computed(() => {
  const track = heroTrack.value
  if (!track) return ''
  const parts: string[] = []
  if (track.album) parts.push(track.album)
  if (track.format) parts.push(track.format.toUpperCase())
  if (track.sampleRate) parts.push(`${Math.round(track.sampleRate / 1000)}kHz`)
  return parts.join(' · ')
})

const recentlyAdded = computed(() => tracks.value.slice(-SHELF_SIZE).reverse())

const topTracks = computed<RankedStat[]>(() => {
  if (rankedStats.value.length > 0) return rankedStats.value
  return tracks.value.slice(0, TOP_TRACK_COUNT).map((track) => ({
    id: track.id,
    seconds: 0,
    plays: 0,
    title: track.title,
    artist: track.artist,
    cover: track.cover,
    track
  }))
})

const topMaxSeconds = computed(() =>
  topTracks.value.reduce((max, stat) => Math.max(max, stat.seconds), 0)
)

const albumShelf = computed(() =>
  [...albums.value].sort((a, b) => b.trackCount - a.trackCount).slice(0, ALBUM_SHELF_SIZE)
)

function playDashboardTrack(track: Track | null | undefined): void {
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

function handleHeroPlay(): void {
  if (heroIsCurrent.value) {
    togglePlay()
    return
  }
  playDashboardTrack(heroTrack.value)
}

function shuffleAll(): void {
  if (tracks.value.length === 0) return
  const index = Math.floor(Math.random() * tracks.value.length)
  setPlayMode('shuffle')
  playDashboardTrack(tracks.value[index])
}

function handleHeroSeek(event: MouseEvent): void {
  if (!heroIsCurrent.value || duration.value <= 0) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  seek(duration.value * ratio)
}

function playAlbum(albumName: string): void {
  const albumTracks = tracks.value.filter((track) => (track.album || '未知专辑') === albumName)
  if (albumTracks.length === 0) return
  playTrack(albumTracks[0], albumTracks)
}

function formatPlays(stat: RankedStat): string {
  if (stat.plays <= 0) return '还未播放'
  const hours = stat.seconds / 3600
  const time =
    hours >= 1 ? `${hours.toFixed(1)} 小时` : `${Math.max(1, Math.round(stat.seconds / 60))} 分钟`
  return `${stat.plays} 次 · ${time}`
}

function statPercent(stat: RankedStat): number {
  if (topMaxSeconds.value <= 0) return 0
  return Math.max(6, Math.round((stat.seconds / topMaxSeconds.value) * 100))
}

// ---------- Listening calendar ----------
const CAL_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

interface CalendarCell {
  key: string
  day: number
  seconds: number
  level: number
  isToday: boolean
  isFuture: boolean
}

const calCursor = ref(new Date(now.value.getFullYear(), now.value.getMonth(), 1))

const calMonthLabel = computed(() =>
  calCursor.value.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })
)

const calAtCurrentMonth = computed(
  () =>
    calCursor.value.getFullYear() === now.value.getFullYear() &&
    calCursor.value.getMonth() === now.value.getMonth()
)

function shiftCalMonth(delta: number): void {
  const next = new Date(calCursor.value.getFullYear(), calCursor.value.getMonth() + delta, 1)
  if (next > now.value) return
  calCursor.value = next
}

function calDayKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const calendarCells = computed<(CalendarCell | null)[]>(() => {
  const year = calCursor.value.getFullYear()
  const month = calCursor.value.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const leadingBlanks = (new Date(year, month, 1).getDay() + 6) % 7
  const days = listeningStats.value.days
  let monthMax = 0
  for (let day = 1; day <= daysInMonth; day += 1) {
    monthMax = Math.max(monthMax, days[calDayKey(year, month, day)] ?? 0)
  }
  const today = now.value
  const cells: (CalendarCell | null)[] = Array.from({ length: leadingBlanks }, () => null)
  for (let day = 1; day <= daysInMonth; day += 1) {
    const seconds = days[calDayKey(year, month, day)] ?? 0
    const cellDate = new Date(year, month, day)
    cells.push({
      key: calDayKey(year, month, day),
      day,
      seconds,
      level: seconds <= 0 || monthMax <= 0 ? 0 : Math.max(1, Math.ceil((seconds / monthMax) * 4)),
      isToday:
        year === today.getFullYear() && month === today.getMonth() && day === today.getDate(),
      isFuture: cellDate > new Date(today.getFullYear(), today.getMonth(), today.getDate())
    })
  }
  return cells
})

const calSummary = computed(() => {
  const active = calendarCells.value.filter((cell) => cell && cell.seconds > 0)
  if (active.length === 0) return '本月还没有听歌记录'
  const totalSeconds = active.reduce((sum, cell) => sum + (cell?.seconds ?? 0), 0)
  return `${active.length} 天在听 · 共 ${formatListenDuration(totalSeconds)}`
})

function formatListenDuration(seconds: number): string {
  const hours = seconds / 3600
  if (hours >= 1) return `${hours.toFixed(1)} 小时`
  return `${Math.max(1, Math.round(seconds / 60))} 分钟`
}

function calCellTitle(cell: CalendarCell): string {
  if (cell.seconds <= 0) return `${cell.key} · 无记录`
  return `${cell.key} · ${formatListenDuration(cell.seconds)}`
}

// ---------- DSP chain ----------
interface DspNode {
  id: string
  label: string
  icon: string
  active: boolean
  detail: string
}

const VOLUME_NORM_LABELS: Record<string, string> = {
  track: '单曲增益',
  album: '专辑增益',
  loudnorm: '响度标准化'
}

const dspNodes = computed<DspNode[]>(() => {
  const ap = audioProcessing.value
  const info = playbackInfo.value
  const on = ap.dspEnabled
  return [
    {
      id: 'eq',
      label: '均衡器',
      icon: 'ph ph-faders',
      active: info ? info.eqActive : on && ap.eqEnabled,
      detail: ap.eqMode === 'parametric' ? '参数 EQ' : '图示 EQ'
    },
    {
      id: 'gain',
      label: '音量均衡',
      icon: 'ph ph-wave-sine',
      active: info ? info.replayGainActive : on && ap.volumeNormalization !== 'off',
      detail: VOLUME_NORM_LABELS[ap.volumeNormalization] ?? '回放增益'
    },
    {
      id: 'crossfeed',
      label: '交叉馈送',
      icon: 'ph ph-headphones',
      active: info ? info.crossfeedActive : on && ap.crossfeedEnabled,
      detail: '耳机声场'
    },
    {
      id: 'convolver',
      label: '卷积混响',
      icon: 'ph ph-waveform',
      active: info ? info.convolverActive : on && ap.convolverEnabled,
      detail: '脌冲响应'
    }
  ]
})

const dspEngineOn = computed(() => audioProcessing.value.dspEnabled)

const dspStatusText = computed(() => {
  if (!dspEngineOn.value) return '直通输出 · Bypass'
  return playbackInfo.value?.dspActive ? '处理链运行中' : '处理链待命'
})

const dspSourceDetail = computed(() => {
  const info = playbackInfo.value
  if (info && info.sourceSampleRate > 0) {
    const codec = info.codec ? info.codec.toUpperCase() : ''
    return `${codec} ${Math.round(info.sourceSampleRate / 1000)}kHz`.trim()
  }
  const track = currentTrack.value
  if (track?.format) return track.format.toUpperCase()
  return '未在播放'
})

const dspOutputDetail = computed(() => {
  const info = playbackInfo.value
  if (info && info.actualSampleRate > 0) {
    const depth = info.actualBitDepth > 0 ? `${info.actualBitDepth}bit / ` : ''
    return `${depth}${Math.round(info.actualSampleRate / 1000)}kHz`
  }
  return '等待输出'
})

const activeDspCount = computed(() => dspNodes.value.filter((node) => node.active).length)
</script>

<template>
  <div
    ref="homeScrollRef"
    class="home dashboard-wrapper te-auto-scrollbar"
    :class="{ 'is-scrollbar-active': homeScrollbarActive }"
  >
    <div class="ambient" aria-hidden="true">
      <span class="blob blob-a"></span>
      <span class="blob blob-b"></span>
      <span class="blob blob-c"></span>
    </div>

    <main class="home-inner">
      <header class="masthead">
        <div class="masthead-copy">
          <h1 class="greeting">{{ greeting }}，<span>让熟悉的旋律陪你一会儿。</span></h1>
        </div>
        <button v-if="hasLibrary" class="shuffle-shortcut" @click="shuffleAll">
          <span class="shuffle-icon"><i class="ph ph-shuffle"></i></span>
          <span>
            <strong>随机漫游</strong>
            <small>从音乐库里随便挑一首</small>
          </span>
          <i class="ph ph-arrow-up-right"></i>
        </button>
      </header>

      <section v-if="!hasLibrary" class="empty-state">
        <div class="empty-visual" aria-hidden="true">
          <span class="empty-record"><i class="ph ph-music-note"></i></span>
          <span class="empty-sleeve"></span>
          <i class="ph ph-sparkle empty-sparkle sparkle-a"></i>
          <i class="ph ph-sparkle empty-sparkle sparkle-b"></i>
        </div>
        <div class="empty-copy">
          <h2>这里还很安静</h2>
          <p>前往「设置 → 音乐库」添加本地文件夹，封面、专辑和听歌足迹都会自动在这里汇聚。</p>
          <div class="empty-features">
            <span><i class="ph ph-folder-simple-plus"></i> 批量扫描</span>
            <span><i class="ph ph-disc"></i> 无损格式</span>
            <span><i class="ph ph-chart-line-up"></i> 聆听统计</span>
          </div>
        </div>
      </section>

      <template v-else>
        <section class="hero-grid" aria-label="音乐库概览">
          <article class="feature-card">
            <div class="feature-backdrop" aria-hidden="true">
              <img :src="heroCoverSrc" alt="" />
            </div>
            <div class="feature-glow" aria-hidden="true"></div>

            <div class="feature-layout">
              <div class="feature-copy">
                <span class="hero-eyebrow">
                  <span v-if="heroIsCurrent && isPlaying" class="eq" aria-hidden="true">
                    <i></i><i></i><i></i>
                  </span>
                  <i v-else class="ph ph-sparkle"></i>
                  {{ heroLabel }}
                </span>

                <div class="hero-heading">
                  <h2>{{ nowPlayingTitle }}</h2>
                  <p>{{ heroTrack?.artist || '未知艺术家' }}</p>
                </div>

                <div class="hero-meta-row">
                  <span><i class="ph ph-disc"></i> {{ heroMeta || '本地音乐' }}</span>
                </div>

                <div v-if="heroIsCurrent" class="hero-progress">
                  <button
                    class="hero-progress-track"
                    title="点击跳转播放进度"
                    aria-label="播放进度"
                    @click="handleHeroSeek"
                  >
                    <span :style="{ width: progressWidth }"></span>
                  </button>
                  <div class="hero-time">
                    <span>{{ formatTime(currentTime) }}</span>
                    <span>{{ formatTime(duration) }}</span>
                  </div>
                </div>

                <div v-if="heroIsCurrent" class="transport-controls">
                  <button class="transport-button" title="上一首" aria-label="上一首" @click="prev">
                    <i class="ph ph-skip-back"></i>
                  </button>
                  <button
                    class="transport-button transport-play"
                    :title="isPlaying ? '暂停' : '播放'"
                    :aria-label="isPlaying ? '暂停' : '播放'"
                    @click="togglePlay"
                  >
                    <i :class="isPlaying ? 'ph ph-pause' : 'ph ph-play'"></i>
                  </button>
                  <button class="transport-button" title="下一首" aria-label="下一首" @click="next">
                    <i class="ph ph-skip-forward"></i>
                  </button>
                  <button class="hero-secondary-action" @click="shuffleAll">
                    <i class="ph ph-shuffle"></i>
                    随机畅听
                  </button>
                </div>

                <div v-else class="transport-controls">
                  <button class="hero-primary-action" @click="handleHeroPlay">
                    <i class="ph ph-play"></i>
                    播放这首
                  </button>
                  <button class="hero-secondary-action" @click="shuffleAll">
                    <i class="ph ph-shuffle"></i>
                    随机畅听
                  </button>
                </div>
              </div>

              <div class="hero-art" aria-hidden="true">
                <div class="hero-vinyl" :class="{ spinning: heroIsCurrent && isPlaying }">
                  <img :src="heroCoverSrc" alt="" />
                  <span></span>
                </div>
                <div class="hero-sleeve">
                  <img :src="heroCoverSrc" alt="" />
                  <span class="sleeve-shine"></span>
                </div>
              </div>
            </div>
          </article>

          <div class="summary-stack">
            <aside class="overview-card surface-card">
              <div class="compact-card-head">
                <div>
                  <h2>收藏概览</h2>
                </div>
                <button
                  class="round-link"
                  title="查看全部歌曲"
                  aria-label="查看全部歌曲"
                  @click="emit('select-view', 'allSongs', null)"
                >
                  <i class="ph ph-arrow-up-right"></i>
                </button>
              </div>

              <div class="overview-grid">
                <button class="overview-stat" @click="emit('select-view', 'allSongs', null)">
                  <span class="stat-icon"><i class="ph ph-music-notes-simple"></i></span>
                  <strong>{{ tracks.length }}</strong>
                  <small>首歌曲</small>
                </button>
                <button class="overview-stat" @click="emit('select-view', 'albums', null)">
                  <span class="stat-icon"><i class="ph ph-disc"></i></span>
                  <strong>{{ albums.length }}</strong>
                  <small>张专辑</small>
                </button>
                <button class="overview-stat" @click="emit('select-view', 'artists', null)">
                  <span class="stat-icon"><i class="ph ph-microphone-stage"></i></span>
                  <strong>{{ artists.length }}</strong>
                  <small>位艺术家</small>
                </button>
                <div class="overview-stat is-static">
                  <span class="stat-icon"><i class="ph ph-clock"></i></span>
                  <strong>{{ totalDurationText }}</strong>
                  <small>收藏时长</small>
                </div>
              </div>
            </aside>

            <aside class="signal-card surface-card">
              <div class="signal-head">
                <div>
                  <h2>播放链路</h2>
                </div>
                <span class="dsp-state" :class="{ on: dspEngineOn, live: playbackInfo?.dspActive }">
                  <span class="dsp-state-dot" aria-hidden="true"></span>
                  {{ dspStatusText }}
                </span>
              </div>

              <div class="signal-route">
                <div class="signal-endpoint">
                  <span><i class="ph ph-music-notes"></i></span>
                  <div>
                    <small>INPUT</small><strong>{{ dspSourceDetail }}</strong>
                  </div>
                </div>
                <div class="signal-line" :class="{ active: dspEngineOn }" aria-hidden="true">
                  <i></i><i></i><i></i>
                  <em>{{ activeDspCount }}/{{ dspNodes.length }}</em>
                </div>
                <div class="signal-endpoint is-output">
                  <span><i class="ph ph-speaker-hifi"></i></span>
                  <div>
                    <small>OUTPUT</small><strong>{{ dspOutputDetail }}</strong>
                  </div>
                </div>
              </div>

              <div class="dsp-mini-grid">
                <div
                  v-for="node in dspNodes"
                  :key="node.id"
                  class="dsp-mini-node"
                  :class="{ active: node.active }"
                  :title="`${node.label} · ${node.active ? node.detail : 'Bypass'}`"
                >
                  <i :class="node.icon"></i>
                  <span>{{ node.label }}</span>
                </div>
              </div>
            </aside>
          </div>
        </section>

        <section class="content-section recent-section">
          <div class="section-head modern-section-head">
            <div class="section-heading-copy">
              <h3>最近添加</h3>
              <p>刚刚加入收藏的声音，值得先听一遍。</p>
            </div>
            <button class="link-all" @click="emit('select-view', 'allSongs', null)">
              全部歌曲 <i class="ph ph-arrow-right"></i>
            </button>
          </div>

          <div class="recent-grid">
            <button
              v-for="track in recentlyAdded"
              :key="track.id"
              class="track-card"
              @click="playDashboardTrack(track)"
            >
              <span class="track-cover">
                <CoverImg :cover="track.cover" :fallback="DEFAULT_COVER" :alt="track.title" />
                <span v-if="track.format" class="format-badge">{{
                  track.format.toUpperCase()
                }}</span>
                <span class="track-play"><i class="ph ph-play"></i></span>
              </span>
              <span class="track-card-copy">
                <strong>{{ track.title }}</strong>
                <small>{{ track.artist || '未知艺术家' }}</small>
              </span>
            </button>
          </div>
        </section>

        <section class="content-section footprint-section">
          <div class="section-head modern-section-head">
            <div class="section-heading-copy">
              <h3>聆听足迹</h3>
              <p>每一次重播，都在慢慢画出你的音乐偏好。</p>
            </div>
            <button class="link-all" @click="emit('select-view', 'recent', null)">
              最近播放 <i class="ph ph-arrow-right"></i>
            </button>
          </div>

          <div class="insight-grid">
            <article class="top-panel surface-card">
              <div class="panel-head">
                <div>
                  <i class="ph ph-chart-bar"></i>
                  <span>常听曲目</span>
                </div>
                <small>按累计聆听时长排序</small>
              </div>
              <div class="top-grid">
                <button
                  v-for="(entry, index) in topTracks"
                  :key="entry.id"
                  class="top-row"
                  @click="playDashboardTrack(entry.track)"
                >
                  <span class="top-rank" :class="{ podium: index < 3 }">{{
                    String(index + 1).padStart(2, '0')
                  }}</span>
                  <CoverImg
                    :cover="entry.track?.cover || entry.cover"
                    :fallback="DEFAULT_COVER"
                    :alt="entry.title"
                    class="top-cover"
                  />
                  <span class="top-text">
                    <span class="top-title">{{ entry.track?.title || entry.title }}</span>
                    <span class="top-artist">{{
                      entry.track?.artist || entry.artist || '未知艺术家'
                    }}</span>
                    <span class="top-bar" aria-hidden="true">
                      <span
                        class="top-bar-fill"
                        :style="{ width: statPercent(entry) + '%' }"
                      ></span>
                    </span>
                  </span>
                  <span class="top-plays">{{ formatPlays(entry) }}</span>
                </button>
              </div>
            </article>

            <aside class="cal-card surface-card">
              <div class="cal-head">
                <span class="cal-title">
                  <i class="ph ph-calendar-heart"></i>
                  听歌日历
                </span>
                <div class="cal-nav">
                  <button class="cal-nav-btn" title="上个月" @click="shiftCalMonth(-1)">
                    <i class="ph ph-caret-left"></i>
                  </button>
                  <span class="cal-month">{{ calMonthLabel }}</span>
                  <button
                    class="cal-nav-btn"
                    title="下个月"
                    :disabled="calAtCurrentMonth"
                    @click="shiftCalMonth(1)"
                  >
                    <i class="ph ph-caret-right"></i>
                  </button>
                </div>
              </div>
              <div class="cal-weekdays" aria-hidden="true">
                <span v-for="weekday in CAL_WEEKDAYS" :key="weekday">{{ weekday }}</span>
              </div>
              <div class="cal-grid">
                <span
                  v-for="(cell, index) in calendarCells"
                  :key="cell?.key ?? `blank-${index}`"
                  class="cal-cell"
                  :class="[
                    cell ? `lv-${cell.level}` : 'is-blank',
                    { 'is-today': cell?.isToday, 'is-future': cell?.isFuture }
                  ]"
                  :title="cell ? calCellTitle(cell) : undefined"
                >
                  {{ cell?.day ?? '' }}
                </span>
              </div>
              <div class="cal-foot">
                <span class="cal-summary">{{ calSummary }}</span>
                <span class="cal-legend" aria-hidden="true">
                  少
                  <i v-for="level in 5" :key="level" :class="`lv-${level - 1}`"></i>
                  多
                </span>
              </div>
            </aside>
          </div>
        </section>

        <section v-if="albumShelf.length > 0" class="content-section album-section">
          <div class="section-head modern-section-head">
            <div class="section-heading-copy">
              <h3>专辑精选</h3>
              <p>从头到尾听完一张专辑，是留给音乐最温柔的时间。</p>
            </div>
            <button class="link-all" @click="emit('select-view', 'albums', null)">
              全部专辑 <i class="ph ph-arrow-right"></i>
            </button>
          </div>

          <div class="album-grid">
            <button
              v-for="album in albumShelf"
              :key="album.name"
              class="album-tile"
              @click="playAlbum(album.name)"
            >
              <CoverImg :cover="album.cover" :fallback="DEFAULT_COVER" :alt="album.name" />
              <span class="album-veil" aria-hidden="true"></span>
              <span class="album-number">{{ String(album.trackCount).padStart(2, '0') }}</span>
              <span class="album-text">
                <span class="album-name">{{ album.name }}</span>
                <span class="album-count"
                  >{{ album.trackCount }} 首 · {{ album.artist || '未知艺术家' }}</span
                >
              </span>
              <span class="album-play"><i class="ph ph-play"></i></span>
            </button>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>

<style scoped src="./LocalDashboard.css"></style>
