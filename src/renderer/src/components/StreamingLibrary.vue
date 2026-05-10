<script setup lang="ts">
import Card from 'primevue/card'
import Avatar from 'primevue/avatar'
import Button from 'primevue/button'
import Divider from 'primevue/divider'
import type { NcmProfile, NcmPlaylistSummary } from '../stores/useNcmStore'

const props = defineProps<{
  isLoggedIn: boolean
  profile: NcmProfile | null
  profileSignature: string
  likedSummary: { name: string; trackCount: number; cover: string | null }
  libraryLoaded: boolean
  userPlaylistEntries: NcmPlaylistSummary[]
}>()

const emit = defineEmits<{
  openUserList: [type: 'follows' | 'followers']
  openLikedTracks: []
  playLikedSongs: []
  openPlaylist: [playlist: NcmPlaylistSummary]
}>()
</script>

<template>
  <div class="library-view">
    <div class="library-hero">
      <Card class="profile-card compact-profile-card">
        <template #content>
          <div class="profile-row compact-profile-row">
            <Avatar
              v-if="profile?.avatarUrl"
              :image="profile.avatarUrl"
              shape="circle"
              size="xlarge"
            />
            <Avatar v-else icon="pi pi-user" shape="circle" size="xlarge" />
            <div class="profile-meta">
              <div class="profile-name">{{ profile?.nickname || '未登录用户' }}</div>
              <div class="profile-subtitle">网易云音乐个人音乐库</div>
              <p class="profile-signature">{{ profileSignature }}</p>

              <div v-if="isLoggedIn" class="profile-stats">
                <span class="stat-item" @click="emit('openUserList', 'follows')">
                  <span class="stat-num">{{ profile?.follows || 0 }}</span> 关注
                </span>
                <Divider layout="vertical" class="stat-divider" />
                <span class="stat-item" @click="emit('openUserList', 'followers')">
                  <span class="stat-num">{{ profile?.followeds || 0 }}</span> 粉丝
                </span>
              </div>
            </div>
          </div>
        </template>
      </Card>

      <Card class="liked-songs-card liked-songs-hero-card" @click="emit('openLikedTracks')">
        <template #content>
          <div class="liked-card-content hero-liked-card-content">
            <div class="liked-card-main">
              <div class="liked-card-badge liked-card-badge-hero">我的收藏</div>
              <h3 class="liked-card-title">{{ likedSummary.name }}</h3>
              <p class="liked-card-desc">{{ likedSummary.trackCount }} 首歌曲</p>
              <Button
                label="播放"
                icon="pi pi-play"
                rounded
                severity="contrast"
                class="liked-play-btn"
                @click.stop="emit('playLikedSongs')"
              />
            </div>
            <div class="liked-card-cover-wrap hero-liked-cover-wrap">
              <img
                v-if="likedSummary.cover"
                :src="likedSummary.cover"
                class="liked-card-cover hero-liked-card-cover"
                alt="cover"
              />
              <div
                v-else
                class="liked-card-cover-placeholder hero-liked-card-cover-placeholder"
              >
                <i class="pi pi-heart-fill"></i>
              </div>
            </div>
          </div>
        </template>
      </Card>
    </div>

    <Divider align="left">
      <span class="section-title">我的歌单</span>
    </Divider>

    <div
      v-if="libraryLoaded && userPlaylistEntries.length === 0"
      class="empty-state only-empty-state"
    >
      <p class="empty-text">暂无在线歌单</p>
      <p class="empty-hint">当前账号还没有可展示的在线歌单</p>
    </div>

    <div v-else class="playlist-list">
      <Card
        v-for="playlist in userPlaylistEntries"
        :key="playlist.id"
        class="playlist-list-item"
        @click="emit('openPlaylist', playlist)"
      >
        <template #content>
          <div class="playlist-row">
            <Avatar
              v-if="playlist.cover"
              :image="playlist.cover"
              shape="square"
              size="large"
              class="playlist-avatar"
            />
            <Avatar
              v-else
              icon="pi pi-list"
              shape="square"
              size="large"
              class="playlist-avatar"
            />
            <div class="playlist-meta">
              <div class="playlist-row-title">{{ playlist.name }}</div>
              <div class="playlist-row-subtitle">{{ playlist.trackCount }} 首</div>
            </div>
            <Button icon="pi pi-chevron-right" text rounded aria-label="打开歌单" />
          </div>
        </template>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.library-view {
  padding: 24px 40px;
}

.library-hero {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-bottom: 32px;
}

.profile-card {
  border: none;
  background: #fcfcfc;
  border-radius: 20px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.05);
  transition: all 0.3s ease;
}

.compact-profile-card {
  height: 180px;
}

.compact-profile-row {
  align-items: center;
  gap: 20px;
}

.profile-meta {
  flex: 1;
}

.profile-name {
  font-size: 20px;
  font-weight: 700;
  color: #1a1a1a;
}

.profile-subtitle {
  font-size: 13px;
  color: #999;
  margin-top: 2px;
}

.profile-signature {
  font-size: 13px;
  color: #666;
  margin: 8px 0 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.4;
}

.profile-stats {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 12px;
}

.stat-item {
  font-size: 13px;
  color: #666;
  cursor: pointer;
  transition: color 0.2s;
}

.stat-item:hover {
  color: #000;
}

.stat-num {
  font-weight: 700;
  color: #1a1a1a;
}

.stat-divider {
  height: 12px;
  margin: 0;
}

.liked-songs-card {
  border: none;
  background: linear-gradient(135deg, #1a1a1a 0%, #333 100%);
  border-radius: 20px;
  color: #fff;
  cursor: pointer;
  transition: all 0.3s ease;
  overflow: hidden;
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
}

.liked-songs-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.2);
}

.liked-songs-hero-card {
  height: 180px;
}

.hero-liked-card-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 100%;
}

.liked-card-main {
  flex: 1;
}

.liked-card-badge {
  display: inline-block;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 10px;
  backdrop-filter: blur(4px);
}

.liked-card-title {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
}

.liked-card-desc {
  font-size: 13px;
  opacity: 0.7;
  margin-top: 4px;
}

.liked-play-btn {
  margin-top: 16px;
}

.hero-liked-cover-wrap {
  position: relative;
  width: 120px;
  height: 120px;
}

.hero-liked-card-cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 12px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
}

.hero-liked-card-cover-placeholder {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #f06292 0%, #e91e63 100%);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
}

.section-title {
  font-size: 16px;
  font-weight: 700;
  color: #1a1a1a;
}

.playlist-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.playlist-list-item {
  border: none;
  background: #fcfcfc;
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.playlist-list-item:hover {
  background: #fff;
  border-color: #f0f0f0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.playlist-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.playlist-avatar {
  border-radius: 10px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
}

.playlist-meta {
  flex: 1;
}

.playlist-row-title {
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
}

.playlist-row-subtitle {
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
  background: #f9f9f9;
  border-radius: 20px;
  border: 2px dashed #eee;
}

.empty-text {
  font-size: 16px;
  font-weight: 600;
  color: #666;
}

.empty-hint {
  font-size: 13px;
  color: #999;
  margin-top: 8px;
}
</style>
