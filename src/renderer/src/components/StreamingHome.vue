<script setup lang="ts">

import Divider from 'primevue/divider'
import Button from 'primevue/button'
import type { Track } from '../types/music'
import type { NcmPlaylistSummary } from '../stores/useNcmStore'

interface RecSection {
  key: string
  title: string
  tracks: Track[]
  icon: string
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
</script>

<template>
  <div class="home-view">
    <div v-if="!isLoggedIn" class="streaming-placeholder">
      <i class="pi pi-home" style="font-size: 48px; color: #ccc"></i>
      <p class="placeholder-title">流媒体主页</p>
      <p class="placeholder-hint">点击左上角头像登录网易云音乐</p>
    </div>
    <div v-else-if="recsLoading" class="streaming-placeholder">
      <i class="pi pi-spin pi-spinner" style="font-size: 40px; color: #999"></i>
      <p class="placeholder-title">正在加载推荐</p>
      <p class="placeholder-hint">请稍候...</p>
    </div>
    <div v-else-if="recsError" class="streaming-placeholder">
      <i class="pi pi-exclamation-triangle" style="font-size: 40px; color: #e74c3c"></i>
      <p class="placeholder-title">加载失败</p>
      <p class="placeholder-hint">{{ recsError }}</p>
      <Button label="重试" severity="contrast" @click="emit('loadRecommendations')" />
    </div>
    <div v-else class="rec-sections">
      <Divider align="left">
        <span class="section-title main-section-title">个人推荐</span>
      </Divider>
      <div class="playlist-grid">
        <div
          v-for="section in recSections"
          :key="section.key"
          class="playlist-grid-card"
          @click="emit('openRecSection', section)"
        >
          <img
            v-if="section.tracks.length > 0 && section.tracks[0].cover"
            :src="section.tracks[0].cover"
            class="playlist-grid-cover"
            alt=""
          />
          <div v-else class="playlist-grid-cover-placeholder">
            <i :class="section.icon" style="font-size: 28px; color: #bbb"></i>
          </div>
          <div class="playlist-grid-name">{{ section.title }}</div>
          <div class="playlist-grid-count">{{ section.tracks.length || '暂无' }} 首</div>
        </div>
      </div>

      <Divider align="left" style="margin-top: 32px">
        <span class="section-title main-section-title">歌单推荐</span>
      </Divider>
      <div class="playlist-grid">
        <div
          v-for="playlist in recommendPlaylists"
          :key="playlist.id"
          class="playlist-grid-card"
          @click="emit('openPlaylist', playlist)"
        >
          <img
            v-if="playlist.cover"
            :src="playlist.cover"
            class="playlist-grid-cover"
            alt=""
          />
          <div v-else class="playlist-grid-cover-placeholder">
            <i class="pi pi-list" style="font-size: 28px; color: #bbb"></i>
          </div>
          <div class="playlist-grid-name">{{ playlist.name }}</div>
          <div class="playlist-grid-count">{{ playlist.trackCount }} 首</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home-view {
  padding: 24px 40px;
}

.streaming-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.placeholder-title {
  font-size: 18px;
  font-weight: 600;
  color: #333;
  margin-top: 16px;
}

.placeholder-hint {
  font-size: 14px;
  color: #999;
  margin-top: 8px;
  margin-bottom: 24px;
}

.rec-sections {
  animation: fadeIn 0.4s ease-out;
}

.section-title {
  font-size: 16px;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: 0.5px;
}

.main-section-title {
  font-size: 18px;
}

.playlist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 24px;
  margin-top: 16px;
}

.playlist-grid-card {
  cursor: pointer;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.playlist-grid-card:hover {
  transform: translateY(-8px);
}

.playlist-grid-cover {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 12px;
  object-fit: cover;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.playlist-grid-cover-placeholder {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 12px;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.playlist-grid-name {
  margin-top: 12px;
  font-size: 14px;
  font-weight: 600;
  color: #333;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.playlist-grid-count {
  margin-top: 4px;
  font-size: 12px;
  color: #999;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
