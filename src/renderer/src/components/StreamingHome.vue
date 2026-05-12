<script setup lang="ts">
import Button from 'primevue/button'
import type { Track } from '../types/music'
import type { NcmPlaylistSummary } from '../stores/useNcmStore'

interface RecSection {
  key: string
  title: string
  tracks: Track[]
  icon: string
}

interface FeatureCard {
  key: 'daily' | 'fm' | 'radar' | 'liked'
  title: string
  desc: string
  icon: string
  accent: string
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
  openLikedTracks: []
}>()

const featureCards: FeatureCard[] = [
  {
    key: 'daily',
    title: '每日推荐',
    desc: '为你精选好音乐',
    icon: 'pi pi-heart-fill',
    accent: 'lilac'
  },
  {
    key: 'fm',
    title: '私人漫游',
    desc: '基于你的音乐偏好',
    icon: 'pi pi-compass',
    accent: 'sunset'
  },
  {
    key: 'radar',
    title: '私人雷达',
    desc: '发现你可能喜欢',
    icon: 'pi pi-send',
    accent: 'aqua'
  },
  {
    key: 'liked',
    title: '我喜欢的音乐',
    desc: '已收藏的歌曲',
    icon: 'pi pi-heart-fill',
    accent: 'magenta'
  }
]

function openFeature(key: FeatureCard['key']): void {
  if (key === 'liked') {
    emit('openLikedTracks')
    return
  }

  const section = props.recSections.find((item) => item.key === key)
  if (section) {
    emit('openRecSection', section)
  }
}
</script>

<template>
  <div class="home-view">
    <div v-if="!isLoggedIn" class="streaming-placeholder">
      <i class="pi pi-home" style="font-size: 42px; color: #c8c3d8"></i>
      <p class="placeholder-title">流媒体主页</p>
      <p class="placeholder-hint">点击右上角头像登录网易云音乐</p>
    </div>

    <div v-else-if="recsLoading" class="streaming-placeholder">
      <i class="pi pi-spin pi-spinner" style="font-size: 36px; color: #a49bb8"></i>
      <p class="placeholder-title">正在加载推荐</p>
      <p class="placeholder-hint">请稍候...</p>
    </div>

    <div v-else-if="recsError" class="streaming-placeholder">
      <i class="pi pi-exclamation-triangle" style="font-size: 36px; color: #ef4444"></i>
      <p class="placeholder-title">加载失败</p>
      <p class="placeholder-hint">{{ recsError }}</p>
      <Button label="重试" severity="contrast" @click="emit('loadRecommendations')" />
    </div>

    <div v-else class="stream-home-content">
      <section class="feature-strip" aria-label="快捷推荐">
        <button
          v-for="card in featureCards"
          :key="card.key"
          class="feature-card"
          :class="`feature-${card.accent}`"
          type="button"
          @click="openFeature(card.key)"
        >
          <span class="feature-light"></span>
          <span class="feature-art">
            <i :class="card.icon"></i>
          </span>
          <span class="feature-title">{{ card.title }}</span>
          <span class="feature-desc">{{ card.desc }}</span>
        </button>
      </section>

      <section class="recommend-block">
        <div class="section-heading">
          <h3>推荐歌单</h3>
          <button type="button" class="more-btn">
            更多
            <i class="pi pi-chevron-right"></i>
          </button>
        </div>

        <div v-if="recommendPlaylists.length > 0" class="playlist-rail">
          <button
            v-for="playlist in recommendPlaylists.slice(0, 8)"
            :key="playlist.id"
            class="playlist-tile"
            type="button"
            @click="emit('openPlaylist', playlist)"
          >
            <span class="playlist-cover-wrap">
              <img v-if="playlist.cover" :src="playlist.cover" class="playlist-cover" alt="" />
              <span v-else class="playlist-cover placeholder-cover">
                <i class="pi pi-list"></i>
              </span>
              <span class="play-bubble">
                <i class="pi pi-play-fill"></i>
              </span>
            </span>
            <span class="playlist-name">{{ playlist.name }}</span>
            <span class="playlist-count">{{ playlist.trackCount }} 首</span>
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
  padding: 0;
}

.stream-home-content {
  position: relative;
  animation: page-rise 0.42s var(--te-ease-soft) both;
}

.stream-home-content::before {
  content: '';
  position: absolute;
  top: -26px;
  right: 6%;
  width: 170px;
  height: 170px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(255, 126, 182, 0.18), transparent 68%);
  filter: blur(10px);
  pointer-events: none;
}

.streaming-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  padding: 54px 20px;
  text-align: center;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.38);
  border: 1px solid rgba(255, 255, 255, 0.62);
  box-shadow: 0 20px 70px rgba(86, 70, 160, 0.12);
  backdrop-filter: blur(18px) saturate(145%);
  -webkit-backdrop-filter: blur(18px) saturate(145%);
}

.placeholder-title {
  font-size: 18px;
  font-weight: 800;
  color: var(--te-neutral-900);
  margin-top: 14px;
}

.placeholder-hint {
  font-size: 13px;
  color: #8d8a99;
  margin-top: 6px;
  margin-bottom: 22px;
}

.feature-strip {
  position: relative;
  display: grid;
  grid-template-columns: repeat(4, minmax(132px, 1fr));
  gap: 22px;
}

.feature-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-height: 148px;
  padding: 24px 18px 18px;
  border: 1px solid rgba(255, 255, 255, 0.62);
  border-radius: 14px;
  overflow: hidden;
  text-align: left;
  cursor: pointer;
  box-shadow:
    0 18px 48px rgba(94, 77, 150, 0.11),
    inset 0 1px 0 rgba(255, 255, 255, 0.58);
  transition:
    transform 0.24s var(--te-ease-soft),
    box-shadow 0.24s,
    filter 0.24s;
}

.feature-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 84% 16%, rgba(255, 255, 255, 0.42), transparent 16%),
    linear-gradient(180deg, transparent 48%, rgba(255, 255, 255, 0.56));
  pointer-events: none;
}

.feature-light {
  position: absolute;
  top: 22px;
  left: 50%;
  width: 84px;
  height: 84px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.26);
  filter: blur(1px);
  transform: translateX(-50%);
  animation: soft-pulse 3.8s ease-in-out infinite;
}

.feature-card:hover {
  transform: translateY(-5px);
  box-shadow:
    0 26px 64px rgba(94, 77, 150, 0.17),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
  filter: saturate(1.04);
}

.feature-lilac {
  background: linear-gradient(135deg, #ece8ff 0%, #f5dfff 100%);
}

.feature-sunset {
  background: linear-gradient(135deg, #dedfff 0%, #ffd8e0 100%);
}

.feature-aqua {
  background: linear-gradient(135deg, #d8f8ff 0%, #d8f4fb 100%);
}

.feature-magenta {
  background: linear-gradient(135deg, #eea8ff 0%, #d86bff 100%);
}

.feature-art {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 58px;
  height: 58px;
  margin: 2px auto 16px;
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.94);
  background: rgba(255, 255, 255, 0.18);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.48),
    0 12px 30px rgba(124, 77, 255, 0.12);
}

.feature-art i {
  font-size: 18px;
}

.feature-title,
.feature-desc {
  position: relative;
  z-index: 1;
}

.feature-title {
  font-size: 14px;
  font-weight: 850;
  color: #24212f;
}

.feature-desc {
  margin-top: 5px;
  font-size: 12px;
  font-weight: 650;
  color: rgba(60, 55, 78, 0.62);
}

.recommend-block {
  position: relative;
  margin-top: 36px;
  padding: 2px 2px 10px;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.section-heading h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 900;
  color: var(--te-neutral-900);
}

.more-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: #8d8a99;
  font-size: 13px;
  font-weight: 750;
  cursor: pointer;
  transition:
    color 0.18s,
    transform 0.18s var(--te-ease-soft);
}

.more-btn:hover {
  color: var(--te-primary-500);
  transform: translateX(2px);
}

.playlist-rail {
  display: grid;
  grid-template-columns: repeat(5, minmax(104px, 1fr));
  gap: 28px;
}

.playlist-tile {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  padding: 0;
}

.playlist-cover-wrap {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 13px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.32);
  box-shadow: 0 18px 38px rgba(86, 70, 160, 0.15);
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
    radial-gradient(circle at 70% 20%, rgba(255, 255, 255, 0.28), transparent 28%),
    linear-gradient(180deg, transparent 54%, rgba(255, 255, 255, 0.24));
  pointer-events: none;
}

.playlist-tile:hover .playlist-cover-wrap {
  transform: translateY(-5px);
  box-shadow: 0 26px 58px rgba(86, 70, 160, 0.22);
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
  color: rgba(255, 255, 255, 0.86);
  background: linear-gradient(135deg, #c5b7ff 0%, #ffc4da 100%);
}

.play-bubble {
  position: absolute;
  inset: 50% auto auto 50%;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.24);
  border: 1px solid rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transform: translate(-50%, -50%);
  transition:
    transform 0.24s var(--te-ease-soft),
    background 0.2s;
}

.playlist-tile:hover .play-bubble {
  background: rgba(255, 255, 255, 0.32);
  transform: translate(-50%, -50%) scale(1.06);
}

.play-bubble i {
  font-size: 15px;
  transform: translateX(1px);
}

.playlist-name {
  margin-top: 14px;
  font-size: 13px;
  font-weight: 850;
  color: var(--te-neutral-900);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-count {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 700;
  color: #9692a3;
}

.empty-recommend {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 110px;
  border-radius: 18px;
  color: #9692a3;
  background: rgba(255, 255, 255, 0.34);
  border: 1px solid rgba(255, 255, 255, 0.58);
  backdrop-filter: blur(16px) saturate(145%);
  -webkit-backdrop-filter: blur(16px) saturate(145%);
}

@media (max-width: 1180px) {
  .feature-strip {
    gap: 16px;
  }

  .playlist-rail {
    grid-template-columns: repeat(4, minmax(104px, 1fr));
  }
}

@media (max-width: 920px) {
  .feature-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .playlist-rail {
    grid-template-columns: repeat(3, minmax(0, 1fr));
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

@keyframes soft-pulse {
  0%,
  100% {
    opacity: 0.72;
    transform: translateX(-50%) scale(0.96);
  }
  50% {
    opacity: 1;
    transform: translateX(-50%) scale(1.04);
  }
}
</style>
