<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import type { Track } from '../types/music'
import type { NcmPlaylistSummary } from '../stores/useNcmStore'
import CoverImg from './CoverImg.vue'

interface RecSection {
  key: string
  title: string
  tracks: Track[]
  icon: string
}

interface DailyCoverEntry {
  cover: string
  coverSource?: string | null
}

const props = defineProps<{
  isLoggedIn: boolean
  recsLoading: boolean
  recsError: string
  recSections: RecSection[]
  recommendPlaylists: NcmPlaylistSummary[]
}>()

const emit = defineEmits<{
  loadRecommendations: []
  openRecSection: [section: RecSection]
  openPlaylist: [playlist: NcmPlaylistSummary]
}>()

const dailySection = computed(() => props.recSections.find((item) => item.key === 'daily') ?? null)

const dailyDesc = '根据你的音乐口味与听歌习惯，为你生成专属的今日推荐歌单。每日 06:00 更新，开启新的一天。'

const dailyCoverIndex = ref(0)
const dailyCovers = computed((): DailyCoverEntry[] =>
  (dailySection.value?.tracks ?? [])
    .map((track) => {
      if (!track.cover) return null
      return {
        cover: track.cover,
        coverSource: track.coverSource ?? null
      }
    })
    .filter((entry): entry is DailyCoverEntry => Boolean(entry))
)
const dailyCover = computed(() => dailyCovers.value[dailyCoverIndex.value] ?? null)

function showNextDailyCover(): void {
  const covers = dailyCovers.value
  if (covers.length <= 1) return
  dailyCoverIndex.value = (dailyCoverIndex.value + 1) % covers.length
}

function openDaily(): void {
  const section = dailySection.value
  if (section) {
    emit('openRecSection', section)
  }
}

const playlistRailRef = ref<HTMLElement | null>(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)

function updatePlaylistScrollState(): void {
  const el = playlistRailRef.value
  if (!el) return
  canScrollLeft.value = el.scrollLeft > 4
  canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
}

function scrollPlaylists(direction: 'left' | 'right'): void {
  const el = playlistRailRef.value
  if (!el) return
  const amount = Math.round(el.clientWidth * 0.8)
  el.scrollBy({ left: direction === 'right' ? amount : -amount, behavior: 'smooth' })
}

let playlistResizeObserver: ResizeObserver | null = null

onMounted(() => {
  updatePlaylistScrollState()
  if (playlistRailRef.value && typeof ResizeObserver !== 'undefined') {
    playlistResizeObserver = new ResizeObserver(() => updatePlaylistScrollState())
    playlistResizeObserver.observe(playlistRailRef.value)
  }
})

onBeforeUnmount(() => {
  playlistResizeObserver?.disconnect()
  playlistResizeObserver = null
})

watch(
  () => props.recommendPlaylists,
  () => {
    void nextTick(updatePlaylistScrollState)
  }
)

watch(
  dailyCovers,
  (covers) => {
    if (dailyCoverIndex.value >= covers.length) {
      dailyCoverIndex.value = 0
    }
  }
)
</script>

<template>
  <div class="home-view">
    <div v-if="!isLoggedIn" class="streaming-placeholder">
      <span class="placeholder-icon">
        <i class="pi pi-home"></i>
      </span>
      <p class="placeholder-title">流媒体主页</p>
      <p class="placeholder-hint">点击右上角头像登录网易云音乐</p>
    </div>

    <div v-else-if="recsLoading" class="streaming-placeholder">
      <span class="placeholder-icon">
        <i class="pi pi-spin pi-spinner"></i>
      </span>
      <p class="placeholder-title">正在加载推荐</p>
      <p class="placeholder-hint">请稍候...</p>
    </div>

    <div v-else-if="recsError" class="streaming-placeholder">
      <span class="placeholder-icon error">
        <i class="pi pi-exclamation-triangle"></i>
      </span>
      <p class="placeholder-title">加载失败</p>
      <p class="placeholder-hint">{{ recsError }}</p>
      <button type="button" class="retry-btn" @click="emit('loadRecommendations')">
        <i class="pi pi-refresh"></i>
        重试
      </button>
    </div>

    <div v-else class="stream-home-content">
      <section class="quick-section" aria-label="快捷推荐">
        <div class="feature-strip">
          <button class="feature-card feature-hero" type="button" @click="openDaily">
            <span class="feature-hero-copy">
              <span class="feature-hero-title">每日推荐</span>
              <span class="feature-hero-subtitle">Daily Mix</span>
              <span class="feature-hero-desc">{{ dailyDesc }}</span>
              <span class="feature-hero-cta">
                <i class="pi pi-play"></i>
                播放全部
              </span>
            </span>
            <span class="feature-hero-cover" :class="{ 'is-placeholder': !dailyCover }">
              <CoverImg
                v-if="dailyCover"
                :key="`${dailyCover.cover}:${dailyCover.coverSource ?? ''}`"
                :cover="dailyCover.cover"
                :cover-source="dailyCover.coverSource"
                class="feature-hero-cover-img"
                alt=""
                @animationend="showNextDailyCover"
              />
              <template v-else>
                <i class="pi pi-calendar"></i>
              </template>
            </span>
          </button>
        </div>
      </section>

      <section class="recommend-block">
        <div class="section-heading recommend-heading">
          <div>
            <h3>推荐歌单</h3>
            <p>精选 {{ recommendPlaylists.length }} 个内容</p>
          </div>
          <button type="button" class="more-btn">
            更多
            <i class="pi pi-chevron-right"></i>
          </button>
        </div>

        <div v-if="recommendPlaylists.length > 0" class="playlist-scroller">
          <button
            v-show="canScrollLeft"
            type="button"
            class="scroll-arrow scroll-arrow-left"
            aria-label="向左查看"
            @click="scrollPlaylists('left')"
          >
            <i class="pi pi-chevron-left"></i>
          </button>
          <div
            ref="playlistRailRef"
            class="playlist-rail"
            @scroll.passive="updatePlaylistScrollState"
          >
            <button
              v-for="playlist in recommendPlaylists"
              :key="playlist.id"
              class="playlist-tile"
              type="button"
              @click="emit('openPlaylist', playlist)"
            >
              <span class="playlist-cover-wrap">
                <CoverImg
                  v-if="playlist.cover"
                  :cover="playlist.cover"
                  :cover-source="playlist.coverSource"
                  class="playlist-cover"
                  alt=""
                />
                <span v-else class="playlist-cover placeholder-cover">
                  <i class="pi pi-list"></i>
                </span>
              </span>
              <span class="playlist-name">{{ playlist.name }}</span>
              <span class="playlist-count">{{ playlist.trackCount }} 首</span>
            </button>
          </div>
          <button
            v-show="canScrollRight"
            type="button"
            class="scroll-arrow scroll-arrow-right"
            aria-label="向右查看更多"
            @click="scrollPlaylists('right')"
          >
            <i class="pi pi-chevron-right"></i>
          </button>
        </div>

        <div v-else class="empty-recommend">
          <i class="pi pi-list"></i>
          <span>暂无推荐歌单</span>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.home-view {
  min-height: 100%;
}

.stream-home-content {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 36px;
  --stream-grid-width: 900px;
  --stream-card-height: 172px;
  --stream-card-gap: 18px;
  --stream-card-radius: 12px;
  animation: page-rise 0.42s var(--te-ease-soft) both;
}

.stream-home-content::before {
  content: '';
  position: absolute;
  top: -34px;
  right: 6%;
  width: 260px;
  height: 260px;
  border-radius: 999px;
  background:
    radial-gradient(circle at 35% 32%, rgba(255, 255, 255, 0.96), transparent 28%),
    radial-gradient(circle, rgba(124, 77, 255, 0.045), transparent 68%);
  pointer-events: none;
  opacity: 0.86;
  filter: blur(4px);
}

.stream-home-content::after {
  content: '';
  position: absolute;
  left: 2%;
  top: 120px;
  width: 320px;
  height: 210px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(34, 211, 238, 0.028), transparent 70%);
  pointer-events: none;
  filter: blur(6px);
}

.quick-section,
.recommend-block {
  position: relative;
  z-index: 1;
}

.streaming-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  padding: 54px 20px;
  text-align: center;
  border-radius: 10px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.64), rgba(255, 255, 255, 0.28)),
    rgba(255, 255, 255, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.66);
  box-shadow:
    0 22px 68px rgba(86, 70, 160, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(20px) saturate(148%);
  -webkit-backdrop-filter: blur(20px) saturate(148%);
}

.placeholder-icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 8px;
  color: var(--te-primary-500);
  background:
    radial-gradient(circle at 36% 28%, rgba(255, 255, 255, 0.9), transparent 36%),
    linear-gradient(135deg, rgba(124, 77, 255, 0.14), rgba(34, 211, 238, 0.1));
  box-shadow: 0 16px 32px rgba(86, 70, 160, 0.1);
}

.placeholder-icon i {
  font-size: 22px;
}

.placeholder-icon.error {
  color: #ef4444;
  background:
    radial-gradient(circle at 36% 28%, rgba(255, 255, 255, 0.9), transparent 36%),
    linear-gradient(135deg, rgba(239, 68, 68, 0.13), rgba(255, 126, 182, 0.1));
}

.placeholder-title {
  font-size: 18px;
  font-weight: 800;
  color: var(--te-neutral-900);
  margin-top: 14px;
}

.placeholder-hint {
  max-width: 360px;
  font-size: 13px;
  font-weight: 500;
  color: rgba(80, 88, 116, 0.62);
  margin-top: 6px;
  margin-bottom: 22px;
}

.retry-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 14px;
  border: 1px solid rgba(255, 255, 255, 0.74);
  border-radius: 8px;
  background: var(--te-card-bg);
  color: var(--te-neutral-900);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 12px 26px rgba(86, 70, 160, 0.09);
  transition:
    transform 0.2s var(--te-ease-soft),
    box-shadow 0.2s,
    background 0.2s;
}

.retry-btn:hover {
  transform: translateY(-1px);
  background: var(--te-card-bg);
  box-shadow: 0 16px 34px rgba(86, 70, 160, 0.13);
}

.section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 14px;
}

.recommend-heading {
  width: min(100%, var(--stream-grid-width));
}

.section-heading h3 {
  margin: 0;
  font-size: 16px;
  line-height: 1.2;
  font-weight: 800;
  color: var(--te-neutral-900);
}

.section-heading p {
  margin: 3px 0 0;
  font-size: 11px;
  font-weight: 500;
  color: rgba(80, 88, 116, 0.58);
}

.feature-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--stream-card-gap);
  justify-content: start;
  width: min(100%, var(--stream-grid-width));
}

.feature-card {
  position: relative;
  display: grid;
  grid-template-rows: auto 1fr;
  align-content: space-between;
  min-height: var(--stream-card-height);
  padding: 18px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: var(--stream-card-radius);
  overflow: hidden;
  background:
    radial-gradient(circle at 22% 16%, rgba(255, 255, 255, 0.88), transparent 28%),
    linear-gradient(145deg, rgba(255, 255, 255, 0.62), rgba(255, 255, 255, 0.26)),
    rgba(255, 255, 255, 0.22);
  text-align: left;
  cursor: pointer;
  box-shadow:
    0 20px 58px rgba(86, 70, 160, 0.09),
    0 0 0 1px rgba(255, 255, 255, 0.34) inset,
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  transition:
    transform 0.24s var(--te-ease-soft),
    border-color 0.24s,
    box-shadow 0.24s,
    filter 0.24s;
}

.feature-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.58), transparent 42%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.26), transparent 64%);
  opacity: 0.9;
  pointer-events: none;
}

.feature-card::after {
  content: '';
  position: absolute;
  inset: 0;
  padding: 1px;
  border-radius: inherit;
  background: linear-gradient(
    135deg,
    rgba(124, 77, 255, 0.26),
    rgba(34, 211, 238, 0.16),
    rgba(255, 126, 182, 0.18)
  );
  opacity: 0.34;
  pointer-events: none;
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
  -webkit-mask-composite: xor;
  transition: opacity 0.24s;
}

.feature-card:hover {
  transform: translateY(-5px) scale(1.01);
  border-color: rgba(255, 255, 255, 0.82);
  box-shadow:
    0 28px 72px rgba(86, 70, 160, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.78);
  filter: saturate(1.04);
}

.feature-card:hover::after {
  opacity: 0.72;
}

.more-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.68);
  border-radius: 8px;
  background: var(--te-subtle-bg);
  color: rgba(80, 88, 116, 0.72);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 10px 24px rgba(86, 70, 160, 0.07);
  transition:
    color 0.18s,
    transform 0.18s var(--te-ease-soft),
    background 0.18s;
}

.more-btn:hover {
  color: var(--te-primary-500);
  background: var(--te-hover-bg);
  transform: translateX(2px);
}

.playlist-rail {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--stream-card-gap);
  width: min(100%, var(--stream-grid-width));
}

.playlist-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-width: 0;
  min-height: var(--stream-card-height);
  padding: 14px;
  border: 1px solid rgba(255, 255, 255, 0.68);
  border-radius: var(--stream-card-radius);
  background:
    radial-gradient(circle at 18% 12%, rgba(255, 255, 255, 0.86), transparent 30%),
    linear-gradient(145deg, rgba(255, 255, 255, 0.6), rgba(255, 255, 255, 0.24)),
    rgba(255, 255, 255, 0.2);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  box-shadow:
    0 20px 58px rgba(86, 70, 160, 0.08),
    0 0 0 1px rgba(255, 255, 255, 0.32) inset,
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  transition:
    transform 0.24s var(--te-ease-soft),
    border-color 0.24s,
    background 0.24s,
    box-shadow 0.24s;
}

.playlist-tile::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.52), transparent 44%),
    radial-gradient(circle at 86% 12%, rgba(124, 77, 255, 0.055), transparent 34%);
}

.playlist-tile::after {
  content: '';
  position: absolute;
  inset: 0;
  padding: 1px;
  border-radius: inherit;
  background: linear-gradient(
    135deg,
    rgba(124, 77, 255, 0.2),
    rgba(34, 211, 238, 0.13),
    rgba(255, 126, 182, 0.15)
  );
  opacity: 0.28;
  pointer-events: none;
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
  -webkit-mask-composite: xor;
  transition: opacity 0.24s;
}

.playlist-tile:hover {
  transform: translateY(-5px) scale(1.01);
  border-color: rgba(255, 255, 255, 0.82);
  background:
    radial-gradient(circle at 18% 12%, rgba(255, 255, 255, 0.9), transparent 30%),
    linear-gradient(145deg, rgba(255, 255, 255, 0.66), rgba(255, 255, 255, 0.28)),
    rgba(255, 255, 255, 0.24);
  box-shadow:
    0 28px 72px rgba(86, 70, 160, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.78);
}

.playlist-tile:hover::after {
  opacity: 0.66;
}

.playlist-cover-wrap {
  position: relative;
  display: block;
  width: 64px;
  height: 64px;
  border-radius: 10px;
  overflow: hidden;
  background: var(--te-subtle-bg);
  box-shadow:
    0 16px 34px rgba(86, 70, 160, 0.13),
    inset 0 1px 0 rgba(255, 255, 255, 0.42);
  transition:
    transform 0.24s var(--te-ease-soft),
    box-shadow 0.24s,
    filter 0.24s;
}

.playlist-cover-wrap::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 74% 18%, rgba(255, 255, 255, 0.24), transparent 26%),
    linear-gradient(180deg, transparent 58%, rgba(255, 255, 255, 0.22));
  pointer-events: none;
}

.playlist-tile:hover .playlist-cover-wrap {
  transform: translateY(-1px);
  box-shadow: 0 22px 46px rgba(86, 70, 160, 0.18);
  filter: saturate(1.05);
}

.playlist-cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.placeholder-cover {
  display: grid;
  place-items: center;
  color: var(--te-primary-500);
  background:
    radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.9), transparent 36%),
    linear-gradient(135deg, rgba(124, 77, 255, 0.16), rgba(34, 211, 238, 0.1));
}

.playlist-name {
  position: relative;
  z-index: 1;
  margin-top: auto;
  padding-top: 18px;
  font-size: 14px;
  line-height: 1.35;
  font-weight: 800;
  color: var(--te-neutral-900);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-count {
  position: relative;
  z-index: 1;
  margin-top: 4px;
  font-size: 12px;
  font-weight: 500;
  color: rgba(80, 88, 116, 0.58);
}

.empty-recommend {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 112px;
  border-radius: 8px;
  color: rgba(80, 88, 116, 0.62);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.54), rgba(255, 255, 255, 0.22)),
    rgba(255, 255, 255, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.58);
  backdrop-filter: blur(16px) saturate(145%);
  -webkit-backdrop-filter: blur(16px) saturate(145%);
}

@media (max-width: 1180px) {
  .stream-home-content {
    --stream-grid-width: 840px;
    --stream-card-gap: 16px;
  }
}

@media (max-width: 920px) {
  .stream-home-content {
    --stream-grid-width: 100%;
    --stream-card-height: 164px;
  }

  .feature-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .playlist-rail {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@keyframes page-rise {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ===== Reference-style Streaming Home Refresh ===== */
.stream-home-content {
  gap: 34px;
  --stream-grid-width: min(100%, 980px);
  --stream-card-height: 124px;
  --stream-card-gap: 16px;
  --stream-card-radius: 8px;
}

.stream-home-content::before,
.stream-home-content::after {
  display: none;
}

.feature-strip,
.playlist-rail,
.recommend-heading {
  width: min(100%, var(--stream-grid-width));
}

.feature-strip {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.feature-card,
.playlist-tile,
.streaming-placeholder,
.empty-recommend {
  border-radius: 8px;
  background:
    radial-gradient(circle at 18% 12%, rgba(255, 255, 255, 0.8), transparent 30%),
    linear-gradient(145deg, rgba(255, 255, 255, 0.62), rgba(250, 247, 255, 0.32)),
    rgba(255, 255, 255, 0.28);
  border-color: rgba(255, 255, 255, 0.72);
  box-shadow:
    0 18px 50px rgba(86, 70, 160, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.76);
}

.feature-card {
  min-height: 128px;
  padding: 16px;
}

.feature-card:hover,
.playlist-tile:hover {
  transform: translateY(-4px);
  box-shadow:
    0 24px 62px rgba(86, 70, 160, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.playlist-name {
  color: #232743;
}

.playlist-count,
.section-heading p {
  color: rgba(82, 90, 122, 0.62);
}

.recommend-block {
  padding-bottom: 4px;
}

.section-heading h3 {
  font-size: 18px;
}

.more-btn,
.retry-btn {
  border-radius: 8px;
  background: var(--te-card-bg);
}

.playlist-rail {
  grid-template-columns: repeat(6, minmax(0, 1fr));
  align-items: start;
}

.playlist-tile {
  min-height: 0;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.playlist-tile::before,
.playlist-tile::after {
  display: none;
}

.playlist-cover-wrap {
  width: 100%;
  height: auto;
  aspect-ratio: 1;
  border-radius: 16px;
  box-shadow: 0 16px 32px rgba(86, 70, 160, 0.14);
}

.playlist-cover-wrap::after {
  background:
    radial-gradient(circle at 54% 50%, rgba(255, 255, 255, 0.3), transparent 22%),
    linear-gradient(180deg, transparent 52%, rgba(36, 28, 70, 0.18));
}

.playlist-name {
  margin-top: 10px;
  padding-top: 0;
  font-size: 13px;
  line-height: 1.35;
  white-space: normal;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}

@media (max-width: 1180px) {
  .playlist-rail {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 920px) {
  .feature-strip,
  .playlist-rail {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* ===== White Card Streaming Home Refinement ===== */
.stream-home-content {
  gap: 42px;
  --stream-grid-width: 100%;
  --stream-card-height: 176px;
}

.feature-card,
.streaming-placeholder,
.empty-recommend {
  background: var(--te-card-bg);
  border: 1px solid #eef1f6;
  box-shadow: 0 14px 32px rgba(34, 42, 68, 0.07);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.feature-card::before,
.feature-card::after {
  display: none;
}

.feature-strip {
  gap: 22px;
}

.feature-card {
  min-height: 230px;
  padding: 0;
  overflow: hidden;
}

.feature-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 18px 38px rgba(34, 42, 68, 0.1);
}

.playlist-rail {
  gap: 26px;
}

.playlist-cover-wrap {
  box-shadow: 0 12px 26px rgba(34, 42, 68, 0.12);
}

.playlist-cover-wrap::after {
  background: linear-gradient(180deg, transparent 58%, rgba(35, 39, 67, 0.14));
}

.more-btn,
.retry-btn {
  background: var(--te-card-bg);
  border-color: #eef1f6;
  box-shadow: 0 8px 18px rgba(34, 42, 68, 0.05);
}

/* ===== Daily Recommendation Hero Card ===== */
.feature-strip {
  display: block;
  width: min(100%, var(--stream-grid-width));
}

.feature-hero {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  width: 100%;
  height: clamp(260px, 28vw, 316px);
  min-height: 0;
  padding: 0;
  border-radius: 24px;
  overflow: hidden;
  text-align: left;
  box-shadow: 0 12px 28px rgba(34, 42, 68, 0.06);
}

.feature-hero-copy {
  flex: 0 0 46%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  min-width: 0;
  padding: 30px 28px 30px 46px;
}

.feature-hero-title {
  font-family: var(--te-font-display);
  font-size: clamp(34px, 4.4vw, 56px);
  line-height: 0.98;
  font-weight: 950;
  letter-spacing: 0;
  color: #11131f;
}

.feature-hero-subtitle {
  margin-top: 4px;
  font-family: var(--te-font-display);
  font-size: clamp(32px, 4.1vw, 52px);
  line-height: 0.96;
  font-weight: 900;
  letter-spacing: 0;
  color: #11131f;
}

.feature-hero-desc {
  max-width: 460px;
  margin-top: 24px;
  font-size: clamp(14px, 1.45vw, 17px);
  line-height: 1.65;
  font-weight: 700;
  color: rgba(64, 68, 88, 0.8);
}

.feature-hero-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-width: 136px;
  height: 48px;
  margin-top: 30px;
  padding: 0 24px;
  border-radius: 999px;
  background: linear-gradient(135deg, #ff675f 0%, #ff8b4a 100%);
  box-shadow: 0 18px 34px rgba(255, 103, 95, 0.24);
  font-size: 15px;
  font-weight: 800;
  color: #fff;
}

.feature-hero-cta i {
  font-size: 12px;
  transition: transform 0.24s var(--te-ease-soft);
}

.feature-hero-cover {
  position: relative;
  flex: 1 1 0;
  display: grid;
  place-items: center;
  align-self: stretch;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}

.feature-hero-cover-img {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
  animation: daily-cover-preview 42s ease-out 1 forwards;
  transition: transform 0.42s var(--te-ease-soft);
  will-change: object-position, transform;
}

/* Left-edge fade so the text/image boundary feels designed. */
.feature-hero-cover::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.92) 0%, rgba(255, 255, 255, 0) 14%);
  pointer-events: none;
  z-index: 1;
}

/* No-cover fallback: lilac gradient panel + calendar icon placeholder. */
.feature-hero-cover.is-placeholder {
  background:
    radial-gradient(circle at 30% 28%, rgba(255, 255, 255, 0.5), transparent 42%),
    linear-gradient(135deg, #7c4dff 0%, #b388ff 46%, #5e35b1 100%);
}

.feature-hero-cover.is-placeholder::after {
  background:
    radial-gradient(circle at 80% 84%, rgba(34, 211, 238, 0.18), transparent 55%),
    radial-gradient(circle at 20% 80%, rgba(255, 126, 182, 0.12), transparent 52%);
}

.feature-hero-cover.is-placeholder i {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  border-radius: 999px;
  font-size: 30px;
  color: #fff;
  background: rgba(255, 255, 255, 0.18);
  box-shadow:
    0 18px 40px rgba(56, 36, 120, 0.32),
    inset 0 1px 0 rgba(255, 255, 255, 0.42);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.feature-hero:hover {
  transform: translateY(-4px);
  box-shadow: 0 14px 32px rgba(34, 42, 68, 0.075);
}

.feature-hero:hover .feature-hero-cta i {
  transform: translateX(4px);
}

@keyframes daily-cover-preview {
  from {
    object-position: center top;
    transform: scale(1.03);
  }
  to {
    object-position: center 75%;
    transform: scale(1.03);
  }
}

@media (prefers-reduced-motion: reduce) {
  .feature-hero-cover-img {
    animation: none;
    height: 100%;
    transform: none;
  }
}

@media (max-width: 920px) {
  .feature-hero {
    flex-direction: column;
    height: auto;
    min-height: 0;
  }

  /* Copy on top, cover below — text is the primary content on mobile. */
  .feature-hero-copy {
    flex: 0 0 auto;
    padding: 28px 24px 24px;
  }

  .feature-hero-title {
    font-size: clamp(32px, 9vw, 44px);
  }

  .feature-hero-subtitle {
    font-size: clamp(30px, 8.4vw, 42px);
  }

  .feature-hero-desc {
    margin-top: 18px;
    font-size: 14px;
    line-height: 1.55;
  }

  .feature-hero-cta {
    height: 44px;
    margin-top: 22px;
    padding: 0 20px;
    font-size: 14px;
  }

  .feature-hero-cover {
    flex: 0 0 auto;
    width: 100%;
    height: 196px;
  }
}

/* ===== Featured playlists horizontal scroller ===== */
.playlist-scroller {
  position: relative;
  width: min(100%, var(--stream-grid-width));
  --playlist-tile-width: 168px;
  --playlist-tile-gap: 20px;
}

.playlist-rail {
  display: flex;
  flex-wrap: nowrap;
  align-items: flex-start;
  grid-template-columns: none;
  gap: var(--playlist-tile-gap);
  width: 100%;
  margin: 0;
  padding: 6px 2px 12px;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-behavior: smooth;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.playlist-rail::-webkit-scrollbar {
  display: none;
}

.playlist-tile {
  flex: 0 0 var(--playlist-tile-width);
  width: var(--playlist-tile-width);
  max-width: var(--playlist-tile-width);
}

.scroll-arrow {
  position: absolute;
  top: calc(6px + var(--playlist-tile-width) / 2);
  transform: translateY(-50%);
  z-index: 6;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  background: var(--te-glass-bg);
  backdrop-filter: blur(10px) saturate(150%);
  -webkit-backdrop-filter: blur(10px) saturate(150%);
  color: var(--te-neutral-900);
  font-size: 15px;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  box-shadow: 0 10px 24px rgba(34, 42, 68, 0.16);
  transition:
    opacity 0.22s var(--te-ease-soft),
    background 0.22s,
    transform 0.22s var(--te-ease-soft);
}

.playlist-scroller:hover .scroll-arrow {
  opacity: 0.92;
  pointer-events: auto;
}

.scroll-arrow-right {
  right: 2px;
}

.scroll-arrow-left {
  left: 2px;
}

.scroll-arrow:hover {
  background: var(--te-glass-bg-strong);
  transform: translateY(-50%) scale(1.06);
}

.scroll-arrow:focus-visible {
  outline: 2px solid var(--te-primary-500);
  outline-offset: 2px;
}

@media (max-width: 1180px) {
  .playlist-scroller {
    --playlist-tile-width: 150px;
  }
}

@media (max-width: 920px) {
  .playlist-scroller {
    --playlist-tile-width: 132px;
    --playlist-tile-gap: 14px;
  }

  .scroll-arrow {
    width: 34px;
    height: 34px;
    font-size: 14px;
  }
}
</style>
