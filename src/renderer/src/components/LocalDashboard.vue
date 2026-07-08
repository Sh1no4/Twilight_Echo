<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMusicStore } from '../stores/useMusicStore'
import { useListeningStatsStore } from '../stores/useListeningStatsStore'
import { usePlayerStore } from '../stores/usePlayerStore'
import type { Track } from '../types/music'
import { useCover } from '../utils/coverLoader'
import { resolveUnifiedRecentTracks } from '../utils/unifiedRecentTracks'
import CoverImg from './CoverImg.vue'

const emit = defineEmits<{
  (event: 'select-view', category: string, filter: string | null): void
}>()

const DEFAULT_COVER = '/icon.png'
const QUEUE_WINDOW = 200
const SHELF_SIZE = 12
const TOP_TRACK_COUNT = 8
const ALBUM_SHELF_SIZE = 10

const { tracks, albums, artists } = useMusicStore()
const { listeningStats } = useListeningStatsStore()
const { currentTrack, isPlaying, playTrack, togglePlay, setPlayMode } = usePlayerStore()

const now = ref(new Date())

const greeting = computed(() => {
  const hour = now.value.getHours()
  if (hour < 5) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
})

const greetingEn = computed(() => {
  const hour = now.value.getHours()
  if (hour < 5) return 'AFTER MIDNIGHT'
  if (hour < 11) return 'GOOD MORNING'
  if (hour < 14) return 'GOOD NOON'
  if (hour < 18) return 'GOOD AFTERNOON'
  return 'GOOD EVENING'
})

const dateLine = computed(() =>
  now.value.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
)

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
  const entries = Object.entries(listeningStats.value.tracks)
    .sort(([, a], [, b]) => b.seconds - a.seconds)
    .slice(0, TOP_TRACK_COUNT)
    .map(([id, stat]) => ({ id, ...stat }))
  return entries.map((stat) => {
    const resolved = resolveUnifiedRecentTracks({
      recentStats: [stat],
      localTracks: tracks.value
    })
    return {
      id: stat.id,
      seconds: stat.seconds,
      plays: stat.plays,
      title: stat.title,
      artist: stat.artist,
      cover: stat.cover ?? null,
      track: resolved[0] ?? stat.track ?? null
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

function playWithQueue(track: Track | null | undefined): void {
  if (!track) return
  const sourceIndex = tracks.value.findIndex((item) => item.id === track.id)
  if (sourceIndex < 0) {
    playTrack(track, [track])
    return
  }
  const halfWindow = Math.floor(QUEUE_WINDOW / 2)
  const start = Math.max(0, sourceIndex - halfWindow)
  const end = Math.min(tracks.value.length, start + QUEUE_WINDOW)
  const queueStart = Math.max(0, end - QUEUE_WINDOW)
  playTrack(track, tracks.value.slice(queueStart, end))
}

function handleHeroPlay(): void {
  if (heroIsCurrent.value) {
    togglePlay()
    return
  }
  playWithQueue(heroTrack.value)
}

function shuffleAll(): void {
  if (tracks.value.length === 0) return
  const index = Math.floor(Math.random() * tracks.value.length)
  setPlayMode('shuffle')
  playWithQueue(tracks.value[index])
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
</script>

<template>
  <div class="home">
    <div class="ambient" aria-hidden="true">
      <span class="blob blob-a"></span>
      <span class="blob blob-b"></span>
      <span class="blob blob-c"></span>
    </div>
    <div class="home-inner">
      <!-- Masthead -->
      <header class="masthead">
        <div class="masthead-text">
          <p class="date-line">
            <span class="date-dot"></span>
            {{ dateLine }} · {{ greetingEn }}
          </p>
          <h1 class="greeting">{{ greeting }}</h1>
        </div>
        <div v-if="hasLibrary" class="library-pulse">
          <button class="pulse-item" @click="emit('select-view', 'allSongs', null)">
            <span class="pulse-num">{{ tracks.length }}</span>
            <span class="pulse-label">首歌曲</span>
          </button>
          <button class="pulse-item" @click="emit('select-view', 'albums', null)">
            <span class="pulse-num">{{ albums.length }}</span>
            <span class="pulse-label">张专辑</span>
          </button>
          <button class="pulse-item" @click="emit('select-view', 'artists', null)">
            <span class="pulse-num">{{ artists.length }}</span>
            <span class="pulse-label">位艺术家</span>
          </button>
          <div class="pulse-item is-static">
            <span class="pulse-num">{{ totalDurationText }}</span>
            <span class="pulse-label">总时长</span>
          </div>
        </div>
      </header>

      <!-- Empty state -->
      <section v-if="!hasLibrary" class="empty-hero">
        <div class="empty-art">
          <i class="ph ph-vinyl-record"></i>
        </div>
        <h2>你的音乐库还是空的</h2>
        <p>在「设置 → 音乐库」中添加本地文件夹，你收藏的音乐就会在这里出现。</p>
      </section>

      <!-- Hero -->
      <section v-else class="hero">
        <div class="hero-backdrop">
          <img :src="heroCoverSrc" alt="" aria-hidden="true" />
        </div>
        <div class="hero-grain" aria-hidden="true"></div>
        <div class="hero-content">
          <div class="hero-cover-wrap">
            <div class="hero-cover" :class="{ spinning: heroIsCurrent && isPlaying }">
              <img :src="heroCoverSrc" alt="封面" />
              <div class="hero-cover-hole"></div>
            </div>
            <div class="hero-cover-shadow" aria-hidden="true"></div>
          </div>
          <div class="hero-info">
            <span class="hero-eyebrow">
              <span v-if="heroIsCurrent && isPlaying" class="eq" aria-hidden="true">
                <i></i><i></i><i></i>
              </span>
              {{ heroLabel }}
            </span>
            <h2 class="hero-title">{{ heroTrack?.title }}</h2>
            <p class="hero-artist">{{ heroTrack?.artist || '未知艺术家' }}</p>
            <p v-if="heroMeta" class="hero-meta">{{ heroMeta }}</p>
            <div class="hero-actions">
              <button class="btn-play" @click="handleHeroPlay">
                <i :class="heroIsCurrent && isPlaying ? 'ph ph-pause' : 'ph ph-play'"></i>
                {{ heroIsCurrent ? (isPlaying ? '暂停' : '继续播放') : '播放' }}
              </button>
              <button class="btn-ghost" @click="shuffleAll">
                <i class="ph ph-shuffle"></i>
                随机畅听
              </button>
            </div>
          </div>
        </div>
      </section>

      <template v-if="hasLibrary">
        <!-- Recently added shelf -->
        <section class="shelf-section">
          <div class="section-head">
            <span class="section-index">01</span>
            <h3>最近添加</h3>
            <span class="section-rule" aria-hidden="true"></span>
            <button class="link-all" @click="emit('select-view', 'allSongs', null)">
              查看全部 <i class="ph ph-arrow-right"></i>
            </button>
          </div>
          <div class="shelf">
            <button
              v-for="track in recentlyAdded"
              :key="track.id"
              class="shelf-card"
              @click="playWithQueue(track)"
            >
              <div class="shelf-cover">
                <CoverImg :cover="track.cover" :fallback="DEFAULT_COVER" :alt="track.title" />
                <span class="shelf-play"><i class="ph ph-play"></i></span>
              </div>
              <span class="shelf-title">{{ track.title }}</span>
              <span class="shelf-sub">{{ track.artist || '未知艺术家' }}</span>
            </button>
          </div>
        </section>

        <!-- Top tracks -->
        <section class="top-section">
          <div class="section-head">
            <span class="section-index">02</span>
            <h3>常听歌曲</h3>
            <span class="section-rule" aria-hidden="true"></span>
            <button class="link-all" @click="emit('select-view', 'recent', null)">
              最近播放 <i class="ph ph-arrow-right"></i>
            </button>
          </div>
          <div class="top-grid">
            <button
              v-for="(entry, index) in topTracks"
              :key="entry.id"
              class="top-row"
              @click="playWithQueue(entry.track)"
            >
              <span class="top-rank" :class="{ podium: index < 3 }">{{ index + 1 }}</span>
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
                  <span class="top-bar-fill" :style="{ width: statPercent(entry) + '%' }"></span>
                </span>
              </span>
              <span class="top-plays">{{ formatPlays(entry) }}</span>
            </button>
          </div>
        </section>

        <!-- Album shelf -->
        <section v-if="albumShelf.length > 0" class="shelf-section">
          <div class="section-head">
            <span class="section-index">03</span>
            <h3>专辑精选</h3>
            <span class="section-rule" aria-hidden="true"></span>
            <button class="link-all" @click="emit('select-view', 'albums', null)">
              查看全部 <i class="ph ph-arrow-right"></i>
            </button>
          </div>
          <div class="shelf album-shelf">
            <button
              v-for="album in albumShelf"
              :key="album.name"
              class="album-tile"
              @click="playAlbum(album.name)"
            >
              <CoverImg :cover="album.cover" :fallback="DEFAULT_COVER" :alt="album.name" />
              <span class="album-veil" aria-hidden="true"></span>
              <span class="album-text">
                <span class="album-name">{{ album.name }}</span>
                <span class="album-count"
                  >{{ album.trackCount }} 首 · {{ album.artist || '' }}</span
                >
              </span>
              <span class="album-play"><i class="ph ph-play"></i></span>
            </button>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.home {
  --home-text: #1c1a27;
  --home-muted: #74718a;
  --home-soft: rgba(28, 26, 39, 0.06);
  --home-card: rgba(255, 255, 255, 0.68);
  --home-border: rgba(255, 255, 255, 0.8);
  --home-accent: var(--te-primary-500, #7c4dff);
  --home-accent-2: var(--te-primary-400, #9575ff);
  --home-accent-soft: rgba(var(--te-primary-rgb, 124, 77, 255), 0.12);

  position: relative;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  box-sizing: border-box;
  color: var(--home-text);
  background-color: var(--te-local-bg);
  background-image: var(--te-local-bg-image);
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
  font-family: var(--te-font-sans, 'Inter', sans-serif);
}

/* ---------- Ambient aurora ---------- */
.ambient {
  position: sticky;
  top: 0;
  height: 0;
  z-index: 0;
  pointer-events: none;
}

.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(70px);
  opacity: 0.5;
}

.blob-a {
  width: 460px;
  height: 460px;
  top: -180px;
  left: -120px;
  background: radial-gradient(
    circle,
    rgba(var(--te-primary-rgb, 124, 77, 255), 0.35),
    transparent 70%
  );
  animation: drift-a 26s ease-in-out infinite alternate;
}

.blob-b {
  width: 380px;
  height: 380px;
  top: -80px;
  right: -140px;
  background: radial-gradient(circle, rgba(255, 158, 100, 0.28), transparent 70%);
  animation: drift-b 32s ease-in-out infinite alternate;
}

.blob-c {
  width: 300px;
  height: 300px;
  top: 380px;
  left: 42%;
  background: radial-gradient(circle, rgba(90, 200, 250, 0.2), transparent 70%);
  animation: drift-a 38s ease-in-out infinite alternate-reverse;
}

@keyframes drift-a {
  from {
    transform: translate(0, 0) scale(1);
  }
  to {
    transform: translate(60px, 40px) scale(1.15);
  }
}

@keyframes drift-b {
  from {
    transform: translate(0, 0) scale(1.1);
  }
  to {
    transform: translate(-70px, 60px) scale(0.95);
  }
}

.home-inner {
  position: relative;
  z-index: 1;
  max-width: 1240px;
  margin: 0 auto;
  padding: 2.6rem 2.6rem 4.5rem;
  display: flex;
  flex-direction: column;
  gap: 2.8rem;
}

/* ---------- Masthead ---------- */
.masthead {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.5rem;
  flex-wrap: wrap;
}

.date-line {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--home-muted);
}

.date-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--home-accent);
  box-shadow: 0 0 0 4px var(--home-accent-soft);
}

.greeting {
  margin: 0;
  font-family: var(--te-font-display, 'Outfit', sans-serif);
  font-size: clamp(2.6rem, 5vw, 4rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.02;
  background: linear-gradient(115deg, var(--home-text) 42%, var(--home-accent) 82%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.library-pulse {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
}

.pulse-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  min-width: 84px;
  padding: 0.75rem 1rem;
  border-radius: 18px;
  border: 1px solid var(--home-border);
  background: var(--home-card);
  backdrop-filter: blur(16px) saturate(130%);
  -webkit-backdrop-filter: blur(16px) saturate(130%);
  box-shadow: 0 8px 26px rgba(20, 16, 44, 0.07);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    transform 0.25s var(--te-ease-soft, ease),
    box-shadow 0.25s ease,
    border-color 0.25s ease;
}

.pulse-item.is-static {
  cursor: default;
}

.pulse-item:not(.is-static):hover {
  transform: translateY(-3px);
  border-color: rgba(var(--te-primary-rgb, 124, 77, 255), 0.45);
  box-shadow: 0 14px 30px rgba(var(--te-primary-rgb, 124, 77, 255), 0.16);
}

.pulse-num {
  font-family: var(--te-font-display, 'Outfit', sans-serif);
  font-size: 1.18rem;
  font-weight: 800;
  line-height: 1.15;
  color: var(--home-text);
}

.pulse-label {
  font-size: 0.72rem;
  color: var(--home-muted);
}

/* ---------- Hero ---------- */
.hero {
  position: relative;
  border-radius: 32px;
  overflow: hidden;
  border: 1px solid var(--home-border);
  box-shadow: 0 28px 72px rgba(20, 16, 44, 0.16);
  isolation: isolate;
}

.hero-backdrop {
  position: absolute;
  inset: 0;
  z-index: -1;
}

.hero-backdrop img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1.35);
  filter: blur(60px) saturate(160%) brightness(1.05);
}

.hero-backdrop::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    rgba(255, 255, 255, 0.88) 0%,
    rgba(255, 255, 255, 0.6) 46%,
    rgba(255, 255, 255, 0.22) 100%
  );
}

.hero-grain {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0.35;
  mix-blend-mode: soft-light;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E");
}

.hero-content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 3rem;
  padding: 2.8rem 3.2rem;
}

.hero-cover-wrap {
  position: relative;
  flex-shrink: 0;
}

.hero-cover {
  position: relative;
  width: 216px;
  height: 216px;
  border-radius: 50%;
  overflow: hidden;
  box-shadow:
    0 18px 48px rgba(20, 16, 44, 0.3),
    0 0 0 10px rgba(255, 255, 255, 0.55),
    0 0 0 11px rgba(20, 16, 44, 0.05);
}

.hero-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hero-cover-hole {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 34px;
  height: 34px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: rgba(252, 252, 255, 0.94);
  box-shadow: inset 0 0 0 4px rgba(20, 16, 44, 0.18);
}

.hero-cover-shadow {
  position: absolute;
  left: 10%;
  right: 10%;
  bottom: -18px;
  height: 26px;
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(20, 16, 44, 0.28), transparent 70%);
  filter: blur(6px);
}

.hero-cover.spinning {
  animation: hero-spin 22s linear infinite;
}

@keyframes hero-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.hero-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.hero-eyebrow {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.9rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--home-accent);
  background: rgba(255, 255, 255, 0.65);
  border: 1px solid rgba(var(--te-primary-rgb, 124, 77, 255), 0.25);
}

.eq {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 12px;
}

.eq i {
  width: 3px;
  border-radius: 2px;
  background: var(--home-accent);
  animation: eq-bounce 1s ease-in-out infinite;
}

.eq i:nth-child(1) {
  height: 60%;
  animation-delay: 0s;
}

.eq i:nth-child(2) {
  height: 100%;
  animation-delay: 0.2s;
}

.eq i:nth-child(3) {
  height: 45%;
  animation-delay: 0.4s;
}

@keyframes eq-bounce {
  0%,
  100% {
    transform: scaleY(0.5);
  }
  50% {
    transform: scaleY(1);
  }
}

.hero-title {
  margin: 0.45rem 0 0;
  font-family: var(--te-font-display, 'Outfit', sans-serif);
  font-size: clamp(1.9rem, 3.4vw, 2.9rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.08;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.hero-artist {
  margin: 0;
  font-size: 1.08rem;
  font-weight: 600;
  color: var(--home-muted);
}

.hero-meta {
  margin: 0;
  font-size: 0.82rem;
  letter-spacing: 0.04em;
  color: var(--home-muted);
  opacity: 0.85;
}

.hero-actions {
  display: flex;
  gap: 0.8rem;
  margin-top: 1.2rem;
}

.btn-play,
.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.74rem 1.7rem;
  border-radius: 999px;
  border: none;
  font-size: 0.95rem;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition:
    transform 0.25s var(--te-ease-soft, ease),
    box-shadow 0.25s ease,
    background 0.25s ease;
}

.btn-play {
  color: #fff;
  background: linear-gradient(120deg, var(--home-accent), var(--home-accent-2));
  box-shadow: 0 10px 26px rgba(var(--te-primary-rgb, 124, 77, 255), 0.4);
}

.btn-play:hover {
  transform: translateY(-2px) scale(1.02);
  box-shadow: 0 16px 34px rgba(var(--te-primary-rgb, 124, 77, 255), 0.5);
}

.btn-ghost {
  color: var(--home-text);
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid var(--home-border);
}

.btn-ghost:hover {
  transform: translateY(-2px);
  background: rgba(255, 255, 255, 0.95);
}

.btn-play i,
.btn-ghost i {
  font-size: 1.1rem;
}

/* ---------- Sections ---------- */
.section-head {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-bottom: 1.2rem;
}

.section-index {
  font-family: var(--te-font-display, 'Outfit', sans-serif);
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--home-accent);
  padding: 0.22rem 0.55rem;
  border-radius: 8px;
  background: var(--home-accent-soft);
}

.section-head h3 {
  margin: 0;
  font-family: var(--te-font-display, 'Outfit', sans-serif);
  font-size: 1.4rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.section-rule {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--home-soft), transparent);
}

.link-all {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border: none;
  background: none;
  padding: 0.32rem 0.6rem;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  font-family: inherit;
  color: var(--home-muted);
  cursor: pointer;
  white-space: nowrap;
  transition:
    color 0.2s ease,
    background 0.2s ease,
    gap 0.2s ease;
}

.link-all:hover {
  color: var(--home-accent);
  background: var(--home-accent-soft);
  gap: 0.5rem;
}

/* ---------- Shelf (horizontal scroll) ---------- */
.shelf {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 152px;
  gap: 1.15rem;
  overflow-x: auto;
  padding: 0.3rem 0.2rem 1rem;
  scrollbar-width: thin;
}

.shelf-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.14rem;
  padding: 0;
  border: none;
  background: none;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.shelf-cover {
  position: relative;
  width: 152px;
  height: 152px;
  border-radius: 20px;
  overflow: hidden;
  margin-bottom: 0.6rem;
  box-shadow: 0 10px 26px rgba(20, 16, 44, 0.14);
  transition:
    transform 0.35s var(--te-ease-soft, ease),
    box-shadow 0.35s ease;
}

.shelf-cover :deep(img),
.shelf-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.45s var(--te-ease-soft, ease);
}

.shelf-play {
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 1.05rem;
  background: rgba(var(--te-primary-rgb, 124, 77, 255), 0.94);
  box-shadow: 0 6px 18px rgba(20, 16, 44, 0.3);
  opacity: 0;
  transform: translateY(8px);
  transition:
    opacity 0.25s ease,
    transform 0.25s var(--te-ease-soft, ease);
}

.shelf-card:hover .shelf-cover {
  transform: translateY(-5px) rotate(-1deg);
  box-shadow: 0 20px 40px rgba(20, 16, 44, 0.22);
}

.shelf-card:hover .shelf-cover :deep(img),
.shelf-card:hover .shelf-cover img {
  transform: scale(1.06);
}

.shelf-card:hover .shelf-play {
  opacity: 1;
  transform: translateY(0);
}

.shelf-title {
  width: 100%;
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--home-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.shelf-sub {
  width: 100%;
  font-size: 0.78rem;
  color: var(--home-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---------- Top tracks ---------- */
.top-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem 1.6rem;
}

.top-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.65rem 0.9rem;
  border: 1px solid transparent;
  border-radius: 18px;
  background: none;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    transform 0.2s ease;
}

.top-row:hover {
  background: var(--home-card);
  border-color: var(--home-border);
  transform: translateX(4px);
}

.top-rank {
  width: 2.2rem;
  flex-shrink: 0;
  font-family: var(--te-font-display, 'Outfit', sans-serif);
  font-size: 1.7rem;
  font-weight: 800;
  font-style: italic;
  color: rgba(28, 26, 39, 0.16);
  text-align: center;
  line-height: 1;
}

.top-rank.podium {
  background: linear-gradient(160deg, var(--home-accent), var(--home-accent-2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.top-cover {
  width: 50px;
  height: 50px;
  border-radius: 14px;
  object-fit: cover;
  flex-shrink: 0;
  box-shadow: 0 6px 16px rgba(20, 16, 44, 0.16);
}

.top-text {
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  min-width: 0;
  flex: 1;
}

.top-title {
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--home-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.top-artist {
  font-size: 0.78rem;
  color: var(--home-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.top-bar {
  width: 100%;
  height: 3px;
  border-radius: 2px;
  background: var(--home-soft);
  overflow: hidden;
}

.top-bar-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--home-accent), var(--home-accent-2));
  transition: width 0.6s var(--te-ease-soft, ease);
}

.top-plays {
  flex-shrink: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--home-muted);
}

/* ---------- Album tiles ---------- */
.album-shelf {
  grid-auto-columns: 196px;
}

.album-tile {
  position: relative;
  width: 196px;
  height: 196px;
  border-radius: 22px;
  overflow: hidden;
  border: none;
  padding: 0;
  background: none;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 12px 30px rgba(20, 16, 44, 0.16);
  transition:
    transform 0.35s var(--te-ease-soft, ease),
    box-shadow 0.35s ease;
}

.album-tile :deep(img),
.album-tile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.5s var(--te-ease-soft, ease);
}

.album-veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 42%, rgba(12, 10, 24, 0.78) 100%);
}

.album-text {
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.album-name {
  font-size: 0.95rem;
  font-weight: 800;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
}

.album-count {
  font-size: 0.74rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.78);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.album-play {
  position: absolute;
  right: 12px;
  top: 12px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 1.05rem;
  background: rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.4);
  opacity: 0;
  transform: scale(0.85);
  transition:
    opacity 0.25s ease,
    transform 0.25s var(--te-ease-soft, ease),
    background 0.25s ease;
}

.album-tile:hover {
  transform: translateY(-5px);
  box-shadow: 0 22px 44px rgba(20, 16, 44, 0.26);
}

.album-tile:hover :deep(img),
.album-tile:hover img {
  transform: scale(1.07);
}

.album-tile:hover .album-play {
  opacity: 1;
  transform: scale(1);
}

.album-play:hover {
  background: rgba(var(--te-primary-rgb, 124, 77, 255), 0.9);
}

/* ---------- Empty state ---------- */
.empty-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  padding: 4.5rem 2rem;
  border-radius: 32px;
  border: 1px dashed rgba(var(--te-primary-rgb, 124, 77, 255), 0.35);
  background: var(--home-card);
  text-align: center;
}

.empty-art {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2.6rem;
  color: var(--home-accent);
  background: var(--home-accent-soft);
  margin-bottom: 0.6rem;
}

.empty-hero h2 {
  margin: 0;
  font-family: var(--te-font-display, 'Outfit', sans-serif);
  font-size: 1.5rem;
  font-weight: 800;
}

.empty-hero p {
  margin: 0;
  font-size: 0.92rem;
  color: var(--home-muted);
}

/* ---------- Responsive ---------- */
@media (max-width: 980px) {
  .hero-content {
    flex-direction: column;
    align-items: flex-start;
    padding: 2rem;
  }

  .top-grid {
    grid-template-columns: 1fr;
  }

  .home-inner {
    padding: 1.8rem 1.4rem 3rem;
  }

  .library-pulse {
    flex-wrap: wrap;
  }
}
</style>
