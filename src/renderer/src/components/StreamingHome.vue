<script setup lang="ts">
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
          <button
            v-for="card in featureCards"
            :key="card.key"
            class="feature-card"
            :class="`feature-${card.accent}`"
            type="button"
            @click="openFeature(card.key)"
          >
            <span class="feature-glow"></span>
            <span class="feature-art">
              <i :class="card.icon"></i>
            </span>
            <span class="feature-copy">
              <span class="feature-title">{{ card.title }}</span>
              <span class="feature-desc">{{ card.desc }}</span>
            </span>
          </button>
        </div>
      </section>

      <section class="recommend-block">
        <div class="section-heading recommend-heading">
          <div>
            <h3>推荐歌单</h3>
            <p>精选 {{ Math.min(recommendPlaylists.length, 8) }} 个内容</p>
          </div>
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
  min-height: 100%;
}

.stream-home-content {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 30px;
  animation: page-rise 0.42s var(--te-ease-soft) both;
}

.stream-home-content::before {
  content: '';
  position: absolute;
  top: -34px;
  right: 4%;
  width: 220px;
  height: 220px;
  border-radius: 999px;
  background:
    radial-gradient(circle at 35% 32%, rgba(255, 255, 255, 0.92), transparent 28%),
    radial-gradient(circle, rgba(124, 77, 255, 0.055), transparent 68%);
  pointer-events: none;
  opacity: 0.76;
  filter: blur(2px);
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
  font-weight: 850;
  color: var(--te-neutral-900);
  margin-top: 14px;
}

.placeholder-hint {
  max-width: 360px;
  font-size: 13px;
  font-weight: 700;
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
  background: rgba(255, 255, 255, 0.58);
  color: var(--te-neutral-900);
  font-size: 13px;
  font-weight: 850;
  cursor: pointer;
  box-shadow: 0 12px 26px rgba(86, 70, 160, 0.09);
  transition:
    transform 0.2s var(--te-ease-soft),
    box-shadow 0.2s,
    background 0.2s;
}

.retry-btn:hover {
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 16px 34px rgba(86, 70, 160, 0.13);
}

.section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 14px;
}

.section-heading h3 {
  margin: 0;
  font-size: 16px;
  line-height: 1.2;
  font-weight: 900;
  color: var(--te-neutral-900);
}

.section-heading p {
  margin: 3px 0 0;
  font-size: 11px;
  font-weight: 700;
  color: rgba(80, 88, 116, 0.58);
}

.feature-strip {
  display: grid;
  grid-template-columns: repeat(4, 138px);
  gap: 22px;
  justify-content: start;
}

.feature-card {
  position: relative;
  display: grid;
  grid-template-rows: auto 1fr;
  align-content: space-between;
  min-height: 126px;
  padding: 14px;
  border: 1px solid rgba(255, 255, 255, 0.66);
  border-radius: 8px;
  overflow: hidden;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.64), rgba(255, 255, 255, 0.22)),
    rgba(255, 255, 255, 0.24);
  text-align: left;
  cursor: pointer;
  box-shadow:
    0 18px 48px rgba(86, 70, 160, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.66);
  backdrop-filter: blur(18px) saturate(145%);
  -webkit-backdrop-filter: blur(18px) saturate(145%);
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
  padding: 1px;
  border-radius: inherit;
  background: linear-gradient(
    135deg,
    rgba(124, 77, 255, 0.42),
    rgba(34, 211, 238, 0.28),
    rgba(255, 126, 182, 0.32)
  );
  opacity: 0;
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
  transform: translateY(-4px);
  border-color: rgba(255, 255, 255, 0.82);
  box-shadow:
    0 26px 62px rgba(86, 70, 160, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.78);
  filter: saturate(1.04);
}

.feature-card:hover::before {
  opacity: 1;
}

.feature-glow {
  position: absolute;
  right: -18px;
  top: -18px;
  width: 86px;
  height: 86px;
  border-radius: 999px;
  opacity: 0.76;
  filter: blur(2px);
  transition: transform 0.32s var(--te-ease-soft);
}

.feature-card:hover .feature-glow {
  transform: translate3d(-8px, 8px, 0) scale(1.08);
}

.feature-lilac .feature-glow {
  background: radial-gradient(circle, rgba(124, 77, 255, 0.16), transparent 70%);
}

.feature-sunset .feature-glow {
  background: radial-gradient(circle, rgba(255, 126, 182, 0.16), transparent 70%);
}

.feature-aqua .feature-glow {
  background: radial-gradient(circle, rgba(34, 211, 238, 0.14), transparent 70%);
}

.feature-magenta .feature-glow {
  background: radial-gradient(circle, rgba(232, 67, 147, 0.14), transparent 70%);
}

.feature-art,
.feature-copy {
  position: relative;
  z-index: 1;
}

.feature-art {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  color: var(--te-primary-500);
  background:
    radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.9), transparent 36%),
    linear-gradient(135deg, rgba(124, 77, 255, 0.16), rgba(34, 211, 238, 0.1));
  box-shadow: 0 12px 26px rgba(86, 70, 160, 0.1);
}

.feature-art i {
  font-size: 15px;
}

.feature-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin-top: 16px;
}

.feature-title {
  font-size: 13px;
  line-height: 1.25;
  font-weight: 900;
  color: var(--te-neutral-900);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.feature-desc {
  margin-top: 4px;
  font-size: 11px;
  font-weight: 700;
  color: rgba(80, 88, 116, 0.62);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.more-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.68);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.42);
  color: rgba(80, 88, 116, 0.72);
  font-size: 12px;
  font-weight: 850;
  cursor: pointer;
  box-shadow: 0 10px 24px rgba(86, 70, 160, 0.07);
  transition:
    color 0.18s,
    transform 0.18s var(--te-ease-soft),
    background 0.18s;
}

.more-btn:hover {
  color: var(--te-primary-500);
  background: rgba(255, 255, 255, 0.72);
  transform: translateX(2px);
}

.playlist-rail {
  display: grid;
  grid-template-columns: repeat(5, minmax(112px, 1fr));
  gap: 22px;
}

.playlist-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition:
    transform 0.24s var(--te-ease-soft),
    border-color 0.24s,
    background 0.24s,
    box-shadow 0.24s;
}

.playlist-tile:hover {
  transform: translateY(-4px);
  border-color: rgba(255, 255, 255, 0.66);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.58), rgba(255, 255, 255, 0.22)),
    rgba(255, 255, 255, 0.18);
  box-shadow: 0 22px 52px rgba(86, 70, 160, 0.1);
  backdrop-filter: blur(18px) saturate(145%);
  -webkit-backdrop-filter: blur(18px) saturate(145%);
}

.playlist-cover-wrap {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.34);
  box-shadow: 0 16px 34px rgba(86, 70, 160, 0.13);
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
  box-shadow: 0 24px 52px rgba(86, 70, 160, 0.18);
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

.play-bubble {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  color: var(--te-primary-500);
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid rgba(255, 255, 255, 0.68);
  box-shadow: 0 10px 22px rgba(86, 70, 160, 0.12);
  backdrop-filter: blur(10px) saturate(145%);
  -webkit-backdrop-filter: blur(10px) saturate(145%);
  transform: translateY(6px) scale(0.94);
  opacity: 0;
  transition:
    transform 0.24s var(--te-ease-soft),
    opacity 0.2s,
    background 0.2s;
}

.playlist-tile:hover .play-bubble {
  opacity: 1;
  background: rgba(255, 255, 255, 0.78);
  transform: translateY(0) scale(1);
}

.play-bubble i {
  font-size: 13px;
  transform: translateX(1px);
}

.playlist-name {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.35;
  font-weight: 850;
  color: var(--te-neutral-900);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-count {
  margin-top: 4px;
  font-size: 11px;
  font-weight: 700;
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
  .feature-strip {
    gap: 16px;
  }

  .playlist-rail {
    grid-template-columns: repeat(4, minmax(112px, 1fr));
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
</style>
