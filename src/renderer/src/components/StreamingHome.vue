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
  key: 'daily' | 'fm' | 'radar'
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
  }
]

function openFeature(key: FeatureCard['key']): void {
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

.recommend-heading {
  width: min(100%, var(--stream-grid-width));
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
  background: linear-gradient(135deg, rgba(124, 77, 255, 0.26), rgba(34, 211, 238, 0.16), rgba(255, 126, 182, 0.18));
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

.feature-glow {
  position: absolute;
  right: -22px;
  top: -24px;
  width: 112px;
  height: 112px;
  border-radius: 999px;
  opacity: 0.82;
  filter: blur(5px);
  transition: transform 0.32s var(--te-ease-soft);
}

.feature-card:hover .feature-glow {
  transform: translate3d(-8px, 8px, 0) scale(1.08);
}

.feature-lilac .feature-glow {
  background:
    radial-gradient(circle at 40% 35%, rgba(255, 255, 255, 0.62), transparent 22%),
    radial-gradient(circle, rgba(124, 77, 255, 0.16), transparent 72%);
}

.feature-sunset .feature-glow {
  background:
    radial-gradient(circle at 40% 35%, rgba(255, 255, 255, 0.62), transparent 22%),
    radial-gradient(circle, rgba(255, 126, 182, 0.15), transparent 72%);
}

.feature-aqua .feature-glow {
  background:
    radial-gradient(circle at 40% 35%, rgba(255, 255, 255, 0.62), transparent 22%),
    radial-gradient(circle, rgba(34, 211, 238, 0.13), transparent 72%);
}

.feature-magenta .feature-glow {
  background:
    radial-gradient(circle at 40% 35%, rgba(255, 255, 255, 0.62), transparent 22%),
    radial-gradient(circle, rgba(232, 67, 147, 0.13), transparent 72%);
}

.feature-art,
.feature-copy {
  position: relative;
  z-index: 1;
}

.feature-art {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 10px;
  color: var(--te-primary-500);
  background:
    radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.92), transparent 36%),
    linear-gradient(135deg, rgba(124, 77, 255, 0.15), rgba(34, 211, 238, 0.09));
  box-shadow:
    0 14px 30px rgba(86, 70, 160, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.66);
}

.feature-art i {
  font-size: 17px;
}

.feature-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin-top: 24px;
}

.feature-title {
  font-size: 15px;
  line-height: 1.25;
  font-weight: 900;
  color: var(--te-neutral-900);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.feature-desc {
  margin-top: 6px;
  font-size: 12px;
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
  background: linear-gradient(135deg, rgba(124, 77, 255, 0.2), rgba(34, 211, 238, 0.13), rgba(255, 126, 182, 0.15));
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
  background: rgba(255, 255, 255, 0.34);
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
  font-weight: 900;
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

.feature-glow {
  right: -18px;
  top: -20px;
  width: 88px;
  height: 88px;
  opacity: 0.72;
}

.feature-art {
  width: 42px;
  height: 42px;
  border-radius: 8px;
}

.feature-copy {
  margin-top: 18px;
}

.feature-title,
.playlist-name {
  color: #232743;
}

.feature-desc,
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
  background: rgba(255, 255, 255, 0.58);
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
  border-radius: 8px;
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
  background: #fff;
  border: 1px solid #eef1f6;
  box-shadow: 0 14px 32px rgba(34, 42, 68, 0.07);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.feature-card::before,
.feature-card::after,
.feature-glow {
  display: none;
}

.feature-strip {
  gap: 22px;
}

.feature-card {
  min-height: 190px;
  padding: 0;
  overflow: hidden;
}

.feature-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 18px 38px rgba(34, 42, 68, 0.1);
}

.feature-art {
  width: 100%;
  height: 116px;
  border-radius: 0;
  background:
    radial-gradient(circle at 52% 50%, rgba(255, 255, 255, 0.58), transparent 18%),
    linear-gradient(135deg, #eee6ff, #e8f7ff);
  box-shadow: none;
}

.feature-sunset .feature-art {
  background:
    radial-gradient(circle at 52% 50%, rgba(255, 255, 255, 0.58), transparent 18%),
    linear-gradient(135deg, #e6e6ff, #ffe7ee);
}

.feature-aqua .feature-art {
  background:
    radial-gradient(circle at 52% 50%, rgba(255, 255, 255, 0.58), transparent 18%),
    linear-gradient(135deg, #dff8fb, #e2f7ff);
}

.feature-magenta .feature-art {
  background:
    radial-gradient(circle at 52% 50%, rgba(255, 255, 255, 0.58), transparent 18%),
    linear-gradient(135deg, #f5cbff, #e2b5fa);
}

.feature-art i {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 999px;
  color: #fff;
  background: rgba(124, 77, 255, 0.52);
}

.feature-copy {
  margin: 0;
  padding: 14px 16px 16px;
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
  background: #fff;
  border-color: #eef1f6;
  box-shadow: 0 8px 18px rgba(34, 42, 68, 0.05);
}

@media (max-width: 920px) {
  .feature-card {
    min-height: 176px;
  }
}
</style>
