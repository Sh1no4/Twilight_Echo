<script setup lang="ts">
import type { MediaProviderPlaylistSummary, MediaProviderProfile } from '../providers/mediaProvider'

const props = defineProps<{
  isLoggedIn: boolean
  providerLabel?: string
  profile: MediaProviderProfile | null
  profileSignature: string
  likedSummary: { name: string; trackCount: number; cover: string | null }
  libraryLoaded: boolean
  userPlaylistEntries: MediaProviderPlaylistSummary[]
  showLikedPanel?: boolean
  showSocialStats?: boolean
  allowPinPlaylists?: boolean
  pinnedPlaylistIds?: Array<string | number>
  pinningPlaylistId?: string | number | null
}>()

const emit = defineEmits<{
  openUserList: [type: 'follows' | 'followers']
  openLikedTracks: []
  playLikedSongs: []
  openPlaylist: [playlist: MediaProviderPlaylistSummary]
  togglePinnedPlaylist: [playlist: MediaProviderPlaylistSummary]
  openRecent: []
  openRanking: []
}>()

function playlistId(playlist: MediaProviderPlaylistSummary): string {
  return String(playlist.id)
}

function isPlaylistPinned(playlist: MediaProviderPlaylistSummary): boolean {
  const playlistWithPinned = playlist as MediaProviderPlaylistSummary & { pinned?: boolean }
  return (
    playlistWithPinned.pinned === true ||
    (props.pinnedPlaylistIds ?? []).some((id) => String(id) === playlistId(playlist))
  )
}

function isPlaylistPinning(playlist: MediaProviderPlaylistSummary): boolean {
  return String(props.pinningPlaylistId ?? '') === playlistId(playlist)
}

function onPlaylistKeydown(event: KeyboardEvent, playlist: MediaProviderPlaylistSummary): void {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  emit('openPlaylist', playlist)
}
</script>

<template>
  <div class="library-view">
    <!-- Top Cards -->
    <section class="top-cards" :class="{ 'top-cards-single': showLikedPanel === false }">
      <!-- Profile Card -->
      <div class="glass-card profile-card">
        <div class="profile-avatar-wrap">
          <img v-if="profile?.avatarUrl" :src="profile.avatarUrl" class="profile-avatar" alt="" />
          <span v-else class="profile-avatar profile-avatar-placeholder">
            <i class="pi pi-user"></i>
          </span>
        </div>
        <div class="profile-info">
          <h3>{{ providerLabel || '在线音源' }}个人音乐库</h3>
          <h1>{{ profile?.nickname || '未登录用户' }}</h1>
          <p>{{ profileSignature || '这里空空如也~' }}</p>
          <div v-if="isLoggedIn && showSocialStats !== false" class="profile-stats">
            <button type="button" class="stat-badge" @click="emit('openUserList', 'follows')">
              {{ profile?.follows || 0 }} <span>关注</span>
            </button>
            <button type="button" class="stat-badge" @click="emit('openUserList', 'followers')">
              {{ profile?.followeds || 0 }} <span>粉丝</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Favorites Card -->
      <div
        v-if="showLikedPanel !== false"
        class="glass-card favorites-card"
        role="button"
        tabindex="0"
        @click="emit('openLikedTracks')"
      >
        <div class="favorites-info">
          <span class="tag">我的收藏</span>
          <h2>{{ likedSummary.name || '我收藏的歌曲' }}</h2>
          <p>{{ likedSummary.trackCount }} 首歌曲</p>
          <button class="btn-play" @click.stop="emit('playLikedSongs')">
            <i class="pi pi-play-fill"></i>
            播放全部
          </button>
        </div>
        <div class="favorites-cover">
          <img v-if="likedSummary.cover" :src="likedSummary.cover" alt="Favorites Cover" class="liked-cover-img" />
          <span v-else class="liked-cover-img liked-card-cover-placeholder">
            <i class="pi pi-heart-fill"></i>
          </span>
          <div class="heart-icon">
            <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          </div>
        </div>
      </div>
    </section>

    <!-- Feature Cards: Recent & Ranking portals -->
    <section class="feature-cards" v-if="isLoggedIn && providerLabel !== 'Bilibili'">
      <!-- Recent Played Card -->
      <div class="glass-card feature-card recent-card" @click="emit('openRecent')">
        <div class="feature-info">
          <div class="icon-wrap">
            <i class="pi pi-history" style="font-size: 1.1rem"></i>
          </div>
          <h3>最近播放</h3>
          <p>回顾您最近的音乐足迹</p>
        </div>
        <div class="feature-preview">
          <div class="preview-image placeholder-img">
            <i class="pi pi-music"></i>
          </div>
          <div class="enter-btn">
            <i class="pi pi-chevron-right"></i>
          </div>
        </div>
      </div>

      <!-- Top Ranking Card -->
      <div class="glass-card feature-card ranking-card" @click="emit('openRanking')">
        <div class="feature-info">
          <div class="icon-wrap">
            <i class="pi pi-chart-bar" style="font-size: 1.1rem"></i>
          </div>
          <h3>听歌排行</h3>
          <p>探索您的最常播放榜单</p>
        </div>
        <div class="feature-preview">
          <div class="preview-image placeholder-img">
            <i class="pi pi-chart-line"></i>
          </div>
          <div class="enter-btn">
            <i class="pi pi-chevron-right"></i>
          </div>
        </div>
      </div>
    </section>

    <!-- Playlists Section -->
    <section class="playlist-section">
      <div class="section-header">
        <div>
          <h2>我的收藏夹</h2>
          <p>{{ userPlaylistEntries.length }} 个在线列表</p>
        </div>
      </div>

      <div v-if="libraryLoaded && userPlaylistEntries.length === 0" class="empty-state">
        <span class="empty-icon">
          <i class="pi pi-list"></i>
        </span>
        <p class="empty-text">暂无在线歌单</p>
        <p class="empty-hint">当前账号还没有可展示的在线歌单</p>
      </div>

      <div v-else class="playlist-grid">
        <article
          v-for="playlist in userPlaylistEntries"
          :key="playlist.id"
          class="playlist-item"
          role="button"
          tabindex="0"
          @click="emit('openPlaylist', playlist)"
          @keydown="onPlaylistKeydown($event, playlist)"
        >
          <img v-if="playlist.cover" :src="playlist.cover" class="playlist-item-cover" alt="" />
          <span v-else class="playlist-item-cover playlist-cover-placeholder">
            <i class="pi pi-list"></i>
          </span>
          <div class="playlist-item-info">
            <h4 class="playlist-item-title">{{ playlist.name }}</h4>
            <span class="playlist-item-count">{{ playlist.trackCount }} 首</span>
          </div>
          
          <button
            v-if="allowPinPlaylists"
            type="button"
            class="playlist-pin-button"
            :class="{ active: isPlaylistPinned(playlist) }"
            :disabled="isPlaylistPinning(playlist)"
            :title="isPlaylistPinned(playlist) ? '取消置顶收藏夹' : '置顶收藏夹'"
            @click.stop="emit('togglePinnedPlaylist', playlist)"
          >
            <i
              :class="
                isPlaylistPinning(playlist)
                  ? 'pi pi-spin pi-spinner'
                  : isPlaylistPinned(playlist)
                    ? 'pi pi-star-fill'
                    : 'pi pi-star'
              "
            ></i>
          </button>

          <div class="playlist-item-arrow">
            <i class="pi pi-chevron-right"></i>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.library-view {
  min-height: 100%;
  padding-bottom: 40px;
  animation: library-in 0.42s var(--te-ease-soft) both;
}

/* Top Cards */
.top-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 30px;
  margin-bottom: 30px;
}
.top-cards-single {
  grid-template-columns: 1fr;
}

/* Glass Card Base */
.glass-card {
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 24px;
  padding: 32px;
  box-shadow: 0 20px 40px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.9);
  position: relative;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
}
.glass-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 24px 48px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

/* User Profile Card */
.profile-card {
  display: flex;
  align-items: center;
  gap: 24px;
  cursor: default;
}
.profile-card:hover {
  transform: none;
  box-shadow: 0 20px 40px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.profile-avatar-wrap {
  position: relative;
  flex-shrink: 0;
}
.profile-avatar {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  object-fit: cover;
  border: 4px solid #fff;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
}
.profile-avatar-placeholder {
  color: var(--te-primary-500);
  background: #f3f0ff;
}

.profile-info {
  flex: 1;
  min-width: 0;
}
.profile-info h3 {
  font-size: 13px;
  color: var(--te-neutral-500, #64748b);
  font-weight: 600;
  margin: 0 0 4px 0;
}
.profile-info h1 {
  font-size: 28px;
  font-weight: 800;
  color: var(--te-neutral-900, #1e293b);
  margin: 0 0 4px 0;
  letter-spacing: -0.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.profile-info p {
  font-size: 14px;
  color: var(--te-neutral-500, #64748b);
  margin: 0 0 16px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-stats {
  display: flex;
  gap: 16px;
}
.stat-badge {
  background: rgba(15, 23, 42, 0.04);
  padding: 6px 14px;
  border-radius: 999px;
  border: none;
  font-size: 13px;
  font-weight: 600;
  color: var(--te-neutral-900, #1e293b);
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: all 0.2s;
}
.stat-badge:hover {
  background: rgba(15, 23, 42, 0.08);
}
.stat-badge span {
  color: var(--te-neutral-500, #64748b);
  font-weight: 500;
}

/* Favorites Card */
.favorites-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.8) 0%, rgba(240, 245, 255, 0.6) 100%);
}
.favorites-card::before {
  content: '';
  position: absolute;
  top: -50px;
  right: -50px;
  width: 200px;
  height: 200px;
  background: radial-gradient(circle, rgba(var(--te-primary-rgb, 99, 102, 241), 0.15) 0%, transparent 70%);
  border-radius: 50%;
  pointer-events: none;
}

.favorites-info {
  flex: 1;
  min-width: 0;
}
.favorites-info .tag {
  display: inline-block;
  background: rgba(var(--te-primary-rgb, 99, 102, 241), 0.1);
  color: var(--te-primary-500);
  font-size: 12px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 6px;
  margin-bottom: 12px;
}
.favorites-info h2 {
  font-size: 26px;
  font-weight: 800;
  color: var(--te-neutral-900, #1e293b);
  margin: 0 0 6px 0;
  letter-spacing: -0.5px;
}
.favorites-info p {
  font-size: 14px;
  color: var(--te-neutral-500, #64748b);
  font-weight: 500;
  margin: 0 0 24px 0;
}

.btn-play {
  background: linear-gradient(135deg, var(--te-primary-500, #6366f1), #818cf8);
  color: #fff;
  border: none;
  padding: 12px 32px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 10px 24px rgba(var(--te-primary-rgb, 99, 102, 241), 0.3);
  transition: all 0.3s;
  cursor: pointer;
}
.btn-play:hover {
  transform: translateY(-2px) scale(1.02);
  box-shadow: 0 14px 32px rgba(var(--te-primary-rgb, 99, 102, 241), 0.4);
}

.favorites-cover {
  position: relative;
  flex-shrink: 0;
  width: 140px;
  height: 140px;
  border-radius: 20px;
  box-shadow: 0 16px 32px rgba(15, 23, 42, 0.15);
  overflow: hidden;
  transform: perspective(1000px) rotateY(-5deg);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.favorites-card:hover .favorites-cover {
  transform: perspective(1000px) rotateY(0deg) scale(1.05);
}

.liked-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
}
.liked-card-cover-placeholder {
  color: var(--te-favorite-500, #ef4444);
  background: #f3f0ff;
}

.heart-icon {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 50px;
  height: 50px;
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.heart-icon svg {
  width: 24px;
  height: 24px;
  fill: #fff;
}

/* Feature Cards (Recent & Ranking portals) */
.feature-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 30px;
  margin-bottom: 40px;
}

.feature-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 32px;
}

.recent-card {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.8) 0%, rgba(238, 242, 255, 0.5) 100%);
}

.ranking-card {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.8) 0%, rgba(255, 241, 242, 0.5) 100%);
}

.feature-info .icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  margin-bottom: 12px;
}

.recent-card .icon-wrap {
  background: rgba(var(--te-primary-rgb, 99, 102, 241), 0.15);
  color: var(--te-primary-500, #6366f1);
}

.ranking-card .icon-wrap {
  background: rgba(244, 63, 94, 0.15);
  color: #f43f5e;
}

.feature-info h3 {
  font-size: 20px;
  font-weight: 800;
  color: var(--te-neutral-900, #1e293b);
  margin: 0 0 4px 0;
}
.feature-info p {
  font-size: 14px;
  color: var(--te-neutral-500, #64748b);
  font-weight: 500;
  margin: 0;
}

.feature-card .enter-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
  transition: all 0.3s;
  color: var(--te-neutral-500, #64748b);
  font-size: 16px;
}

.feature-card:hover .enter-btn {
  transform: scale(1.1) translateX(4px);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.1);
  color: var(--te-primary-500, #6366f1);
}

.feature-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-right: 20px;
}

.preview-image {
  width: 64px;
  height: 64px;
  border-radius: 12px;
  object-fit: cover;
  box-shadow: 0 8px 16px rgba(15, 23, 42, 0.08);
  transition: all 0.3s;
}

.feature-card:hover .preview-image {
  transform: scale(1.05);
}

.placeholder-img {
  background: #e0e7ff;
  color: #818cf8;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}
.ranking-card .placeholder-img {
  background: #ffe4e6;
  color: #fb7185;
}

/* Common Section Header */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 20px;
}

.section-header h2 {
  font-size: 22px;
  font-weight: 800;
  color: var(--te-neutral-900, #1e293b);
  margin: 0 0 4px 0;
}

.section-header p {
  font-size: 14px;
  color: var(--te-neutral-500, #64748b);
  font-weight: 500;
  margin: 0;
}

/* Playlists Section */
.playlist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 24px;
}

.playlist-item {
  display: flex;
  align-items: center;
  gap: 16px;
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.6);
  padding: 16px;
  border-radius: 20px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.02);
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}

.playlist-item:hover {
  transform: translateY(-3px);
  box-shadow: 0 16px 32px rgba(15, 23, 42, 0.06);
  background: rgba(255, 255, 255, 0.9);
}

.playlist-item-cover {
  width: 64px;
  height: 64px;
  border-radius: 12px;
  object-fit: cover;
  box-shadow: 0 8px 16px rgba(15, 23, 42, 0.1);
  transition: all 0.3s;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}
.playlist-cover-placeholder {
  background: #f3f0ff;
  color: var(--te-primary-500, #6366f1);
}

.playlist-item:hover .playlist-item-cover {
  transform: scale(1.05);
}

.playlist-item-info {
  flex: 1;
  min-width: 0;
}

.playlist-item-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--te-neutral-900, #1e293b);
  margin: 0 0 4px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.playlist-item-count {
  font-size: 13px;
  color: var(--te-neutral-500, #64748b);
  font-weight: 500;
}

.playlist-item-arrow {
  color: #cbd5e1;
  transition: all 0.3s;
  width: 24px;
  display: flex;
  justify-content: flex-end;
}

.playlist-item:hover .playlist-item-arrow {
  color: var(--te-primary-500, #6366f1);
  transform: translateX(4px);
}

.playlist-pin-button {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: 1px solid rgba(80, 88, 116, 0.1);
  border-radius: 50%;
  background: #fff;
  color: #94a3b8;
  cursor: pointer;
  transition: all 0.2s;
  margin-right: -4px;
}

.playlist-pin-button:hover,
.playlist-pin-button.active {
  border-color: #fed7aa;
  background: #fff7ed;
  color: #d97706;
}

.playlist-pin-button:hover {
  transform: scale(1.1);
}

.playlist-pin-button:disabled {
  cursor: wait;
  opacity: 0.68;
  transform: none;
}

.empty-state {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 42px 20px;
  text-align: center;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 20px;
  border: 1px dashed rgba(80, 88, 116, 0.2);
}

.empty-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  color: var(--te-primary-500, #6366f1);
  background: #f3f0ff;
  font-size: 20px;
}

.empty-text {
  margin: 14px 0 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--te-neutral-900, #1e293b);
}

.empty-hint {
  margin: 6px 0 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--te-neutral-500, #64748b);
}

@keyframes library-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 1080px) {
  .top-cards, .feature-cards {
    grid-template-columns: 1fr;
    gap: 20px;
  }
}

@media (max-width: 720px) {
  .profile-card,
  .favorites-card,
  .feature-card {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }

  .favorites-cover {
    width: 96px;
    height: 96px;
    align-self: center;
    transform: rotateY(0);
  }
  
  .feature-preview {
    align-self: flex-end;
  }
}
</style>
