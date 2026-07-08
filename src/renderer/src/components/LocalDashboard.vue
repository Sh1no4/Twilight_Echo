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
</script>

<template>
  <div class="home">
    <div class="home-inner">
      <!-- Masthead -->
      <header class="masthead">
        <div class="masthead-text">
          <p class="date-line">{{ dateLine }}</p>
          <h1 class="greeting">{{ greeting }}</h1>
        </div>
        <div v-if="hasLibrary" class="library-pulse">
          <div class="pulse-item">
            <span class="pulse-num">{{ tracks.length }}</span>
            <span class="pulse-label">首歌曲</span>
          </div>
          <div class="pulse-divider"></div>
          <div class="pulse-item">
            <span class="pulse-num">{{ albums.length }}</span>
            <span class="pulse-label">张专辑</span>
          </div>
          <div class="pulse-divider"></div>
          <div class="pulse-item">
            <span class="pulse-num">{{ artists.length }}</span>
            <span class="pulse-label">位艺术家</span>
          </div>
          <div class="pulse-divider"></div>
          <div class="pulse-item">
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
        <div class="hero-content">
          <div class="hero-cover" :class="{ spinning: heroIsCurrent && isPlaying }">
            <img :src="heroCoverSrc" alt="封面" />
            <div class="hero-cover-hole"></div>
          </div>
          <div class="hero-info">
            <span class="hero-eyebrow">{{ heroLabel }}</span>
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
            <h3>最近添加</h3>
            <button class="link-all" @click="emit('select-view', 'allSongs', null)">
              查看全部 <i class="ph ph-caret-right"></i>
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
            <h3>常听歌曲</h3>
            <button class="link-all" @click="emit('select-view', 'recent', null)">
              最近播放 <i class="ph ph-caret-right"></i>
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
              </span>
              <span class="top-plays">{{ formatPlays(entry) }}</span>
            </button>
          </div>
        </section>

        <!-- Album shelf -->
        <section v-if="albumShelf.length > 0" class="shelf-section">
          <div class="section-head">
            <h3>专辑精选</h3>
            <button class="link-all" @click="emit('select-view', 'albums', null)">
              查看全部 <i class="ph ph-caret-right"></i>
            </button>
          </div>
          <div class="shelf">
            <button
              v-for="album in albumShelf"
              :key="album.name"
              class="shelf-card album-card"
              @click="playAlbum(album.name)"
            >
              <div class="shelf-cover">
                <CoverImg :cover="album.cover" :fallback="DEFAULT_COVER" :alt="album.name" />
                <span class="shelf-play"><i class="ph ph-play"></i></span>
              </div>
              <span class="shelf-title">{{ album.name }}</span>
              <span class="shelf-sub">{{ album.trackCount }} 首</span>
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
  --home-accent-soft: rgba(var(--te-primary-rgb, 124, 77, 255), 0.12);

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

.home-inner {
  max-width: 1240px;
  margin: 0 auto;
  padding: 2.4rem 2.6rem 4rem;
  display: flex;
  flex-direction: column;
  gap: 2.4rem;
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
  margin: 0 0 0.3rem;
  font-size: 0.88rem;
  letter-spacing: 0.14em;
  color: var(--home-muted);
}

.greeting {
  margin: 0;
  font-family: var(--te-font-display, 'Outfit', sans-serif);
  font-size: clamp(2.2rem, 4vw, 3.2rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.05;
  background: linear-gradient(120deg, var(--home-text) 30%, var(--home-accent));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.library-pulse {
  display: flex;
  align-items: center;
  gap: 1.1rem;
  padding: 0.85rem 1.4rem;
  border-radius: 999px;
  background: var(--home-card);
  border: 1px solid var(--home-border);
  backdrop-filter: blur(16px) saturate(130%);
  -webkit-backdrop-filter: blur(16px) saturate(130%);
  box-shadow: 0 10px 32px rgba(20, 16, 44, 0.08);
}

.pulse-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 52px;
}

.pulse-num {
  font-family: var(--te-font-display, 'Outfit', sans-serif);
  font-size: 1.08rem;
  font-weight: 800;
  line-height: 1.2;
}

.pulse-label {
  font-size: 0.72rem;
  color: var(--home-muted);
}

.pulse-divider {
  width: 1px;
  height: 26px;
  background: var(--home-soft);
}

/* ---------- Hero ---------- */
.hero {
  position: relative;
  border-radius: 30px;
  overflow: hidden;
  border: 1px solid var(--home-border);
  box-shadow: 0 24px 64px rgba(20, 16, 44, 0.14);
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
  transform: scale(1.3);
  filter: blur(56px) saturate(150%) brightness(1.06);
}

.hero-backdrop::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    rgba(255, 255, 255, 0.86) 0%,
    rgba(255, 255, 255, 0.62) 46%,
    rgba(255, 255, 255, 0.28) 100%
  );
}

.hero-content {
  display: flex;
  align-items: center;
  gap: 2.6rem;
  padding: 2.6rem 3rem;
}

.hero-cover {
  position: relative;
  width: 208px;
  height: 208px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  box-shadow:
    0 18px 44px rgba(20, 16, 44, 0.28),
    0 0 0 10px rgba(255, 255, 255, 0.5);
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
  background: rgba(252, 252, 255, 0.92);
  box-shadow: inset 0 0 0 4px rgba(20, 16, 44, 0.18);
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
  padding: 0.28rem 0.85rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--home-accent);
  background: var(--home-accent-soft);
}

.hero-title {
  margin: 0.4rem 0 0;
  font-family: var(--te-font-display, 'Outfit', sans-serif);
  font-size: clamp(1.7rem, 3vw, 2.5rem);
  font-weight: 800;
  letter-spacing: -0.015em;
  line-height: 1.12;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.hero-artist {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--home-muted);
}

.hero-meta {
  margin: 0;
  font-size: 0.82rem;
  color: var(--home-muted);
  opacity: 0.85;
}

.hero-actions {
  display: flex;
  gap: 0.8rem;
  margin-top: 1.1rem;
}

.btn-play,
.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.72rem 1.6rem;
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
  background: linear-gradient(120deg, var(--home-accent), var(--te-primary-400, #9575ff));
  box-shadow: 0 10px 26px rgba(var(--te-primary-rgb, 124, 77, 255), 0.4);
}

.btn-play:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 32px rgba(var(--te-primary-rgb, 124, 77, 255), 0.5);
}

.btn-ghost {
  color: var(--home-text);
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid var(--home-border);
}

.btn-ghost:hover {
  transform: translateY(-2px);
  background: rgba(255, 255, 255, 0.92);
}

.btn-play i,
.btn-ghost i {
  font-size: 1.1rem;
}

/* ---------- Sections ---------- */
.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 1.1rem;
}

.section-head h3 {
  margin: 0;
  font-family: var(--te-font-display, 'Outfit', sans-serif);
  font-size: 1.35rem;
  font-weight: 800;
  letter-spacing: -0.01em;
}

.link-all {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  border: none;
  background: none;
  padding: 0.3rem 0.5rem;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  font-family: inherit;
  color: var(--home-muted);
  cursor: pointer;
  transition:
    color 0.2s ease,
    background 0.2s ease;
}

.link-all:hover {
  color: var(--home-accent);
  background: var(--home-accent-soft);
}

/* ---------- Shelf (horizontal scroll) ---------- */
.shelf {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 148px;
  gap: 1.1rem;
  overflow-x: auto;
  padding: 0.3rem 0.2rem 0.9rem;
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
  width: 148px;
  height: 148px;
  border-radius: 18px;
  overflow: hidden;
  margin-bottom: 0.55rem;
  box-shadow: 0 10px 26px rgba(20, 16, 44, 0.14);
  transition:
    transform 0.3s var(--te-ease-soft, ease),
    box-shadow 0.3s ease;
}

.shelf-cover :deep(img),
.shelf-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.shelf-play {
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 1rem;
  background: rgba(var(--te-primary-rgb, 124, 77, 255), 0.92);
  box-shadow: 0 6px 18px rgba(20, 16, 44, 0.3);
  opacity: 0;
  transform: translateY(6px);
  transition:
    opacity 0.25s ease,
    transform 0.25s var(--te-ease-soft, ease);
}

.shelf-card:hover .shelf-cover {
  transform: translateY(-4px);
  box-shadow: 0 16px 34px rgba(20, 16, 44, 0.2);
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
  gap: 0.5rem 1.4rem;
}

.top-row {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 0.6rem 0.8rem;
  border: none;
  border-radius: 16px;
  background: none;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;
  transition: background 0.2s ease;
}

.top-row:hover {
  background: var(--home-card);
}

.top-rank {
  width: 1.6rem;
  flex-shrink: 0;
  font-family: var(--te-font-display, 'Outfit', sans-serif);
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--home-muted);
  text-align: center;
}

.top-rank.podium {
  color: var(--home-accent);
}

.top-cover {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  object-fit: cover;
  flex-shrink: 0;
  box-shadow: 0 6px 16px rgba(20, 16, 44, 0.14);
}

.top-text {
  display: flex;
  flex-direction: column;
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

.top-plays {
  flex-shrink: 0;
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--home-muted);
}

/* ---------- Empty state ---------- */
.empty-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  padding: 4.5rem 2rem;
  border-radius: 30px;
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
}
</style>
