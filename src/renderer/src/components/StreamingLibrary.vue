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
  pinnedPlaylistId?: string | number | null
  pinningPlaylistId?: string | number | null
}>()

const emit = defineEmits<{
  openUserList: [type: 'follows' | 'followers']
  openLikedTracks: []
  playLikedSongs: []
  openPlaylist: [playlist: MediaProviderPlaylistSummary]
  togglePinnedPlaylist: [playlist: MediaProviderPlaylistSummary]
}>()

function playlistId(playlist: MediaProviderPlaylistSummary): string {
  return String(playlist.id)
}

function isPlaylistPinned(playlist: MediaProviderPlaylistSummary): boolean {
  const playlistWithPinned = playlist as MediaProviderPlaylistSummary & { pinned?: boolean }
  return playlistWithPinned.pinned === true || String(props.pinnedPlaylistId ?? '') === playlistId(playlist)
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
    <section class="library-hero" :class="{ 'library-hero-single': showLikedPanel === false }">
      <div class="profile-panel">
        <div class="profile-avatar-wrap">
          <img v-if="profile?.avatarUrl" :src="profile.avatarUrl" class="profile-avatar" alt="" />
          <span v-else class="profile-avatar profile-avatar-placeholder">
            <i class="pi pi-user"></i>
          </span>
        </div>

        <div class="profile-meta">
          <span class="profile-kicker">{{ providerLabel || '在线音源' }}个人音乐库</span>
          <h3 class="profile-name">{{ profile?.nickname || '未登录用户' }}</h3>
          <p class="profile-signature">{{ profileSignature }}</p>

          <div v-if="isLoggedIn && showSocialStats !== false" class="profile-stats">
            <button type="button" class="stat-item" @click="emit('openUserList', 'follows')">
              <span class="stat-num">{{ profile?.follows || 0 }}</span>
              <span class="stat-label">关注</span>
            </button>
            <button type="button" class="stat-item" @click="emit('openUserList', 'followers')">
              <span class="stat-num">{{ profile?.followeds || 0 }}</span>
              <span class="stat-label">粉丝</span>
            </button>
          </div>
        </div>
      </div>

      <button
        v-if="showLikedPanel !== false"
        type="button"
        class="liked-panel"
        @click="emit('openLikedTracks')"
      >
        <span class="liked-light"></span>
        <span class="liked-copy">
          <span class="liked-card-badge">我的收藏</span>
          <span class="liked-card-title">{{ likedSummary.name }}</span>
          <span class="liked-card-desc">{{ likedSummary.trackCount }} 首歌曲</span>
          <span class="liked-play-btn" @click.stop="emit('playLikedSongs')">
            <i class="pi pi-play-fill"></i>
            播放
          </span>
        </span>
        <span class="liked-card-cover-wrap">
          <img
            v-if="likedSummary.cover"
            :src="likedSummary.cover"
            class="liked-card-cover"
            alt="cover"
          />
          <span v-else class="liked-card-cover liked-card-cover-placeholder">
            <i class="pi pi-heart-fill"></i>
          </span>
        </span>
      </button>
    </section>

    <section class="playlist-section">
      <div class="section-heading">
        <div>
          <h3>我的收藏夹</h3>
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

      <div v-else class="playlist-list">
        <article
          v-for="playlist in userPlaylistEntries"
          :key="playlist.id"
          class="playlist-list-item"
          role="button"
          tabindex="0"
          @click="emit('openPlaylist', playlist)"
          @keydown="onPlaylistKeydown($event, playlist)"
        >
          <span class="playlist-cover-wrap">
            <img v-if="playlist.cover" :src="playlist.cover" class="playlist-cover" alt="" />
            <span v-else class="playlist-cover playlist-cover-placeholder">
              <i class="pi pi-list"></i>
            </span>
          </span>
          <span class="playlist-meta">
            <span class="playlist-row-title">{{ playlist.name }}</span>
            <span class="playlist-row-subtitle">{{ playlist.trackCount }} 首</span>
          </span>
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
          <span class="playlist-open-icon">
            <i class="pi pi-chevron-right"></i>
          </span>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.library-view {
  min-height: 100%;
  animation: library-in 0.42s var(--te-ease-soft) both;
}

.library-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(320px, 0.92fr);
  gap: 18px;
  margin-bottom: 34px;
}

.library-hero-single {
  grid-template-columns: minmax(0, 1fr);
}

.profile-panel,
.liked-panel,
.playlist-list-item,
.empty-state {
  position: relative;
  overflow: hidden;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.66);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.66), rgba(255, 255, 255, 0.28)),
    rgba(255, 255, 255, 0.2);
  box-shadow:
    0 22px 66px rgba(86, 70, 160, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(22px) saturate(152%);
  -webkit-backdrop-filter: blur(22px) saturate(152%);
}

.profile-panel::before,
.liked-panel::before,
.playlist-list-item::before,
.empty-state::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.62), transparent 42%);
  opacity: 0.72;
}

.profile-panel {
  min-height: 188px;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 22px;
}

.profile-avatar-wrap,
.profile-meta,
.liked-copy,
.liked-card-cover-wrap,
.playlist-cover-wrap,
.playlist-meta,
.playlist-open-icon,
.empty-icon,
.empty-text,
.empty-hint {
  position: relative;
  z-index: 1;
}

.profile-avatar-wrap {
  flex-shrink: 0;
}

.profile-avatar {
  display: grid;
  place-items: center;
  width: 86px;
  height: 86px;
  border-radius: 999px;
  object-fit: cover;
  border: 3px solid rgba(255, 255, 255, 0.72);
  box-shadow: 0 18px 38px rgba(86, 70, 160, 0.14);
}

.profile-avatar-placeholder {
  color: var(--te-primary-500);
  background:
    radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.92), transparent 36%),
    linear-gradient(135deg, rgba(124, 77, 255, 0.18), rgba(34, 211, 238, 0.12));
}

.profile-avatar-placeholder i {
  font-size: 28px;
}

.profile-meta {
  min-width: 0;
  flex: 1;
}

.profile-kicker {
  display: inline-flex;
  font-size: 12px;
  font-weight: 800;
  color: rgba(80, 88, 116, 0.58);
}

.profile-name {
  margin: 5px 0 0;
  font-size: 24px;
  line-height: 1.18;
  font-weight: 800;
  color: var(--te-neutral-900);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-signature {
  max-width: 560px;
  margin: 8px 0 0;
  font-size: 13px;
  font-weight: 700;
  color: rgba(80, 88, 116, 0.66);
  line-height: 1.48;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.profile-stats {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
}

.stat-item {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  min-width: 82px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.68);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.38);
  color: rgba(80, 88, 116, 0.68);
  cursor: pointer;
  box-shadow: 0 10px 24px rgba(86, 70, 160, 0.06);
  transition:
    transform 0.2s var(--te-ease-soft),
    background 0.2s,
    color 0.2s,
    box-shadow 0.2s;
}

.stat-item:hover {
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.72);
  color: var(--te-primary-500);
  box-shadow: 0 14px 30px rgba(86, 70, 160, 0.1);
}

.stat-num {
  font-size: 15px;
  font-weight: 800;
  color: var(--te-neutral-900);
}

.stat-label {
  font-size: 12px;
  font-weight: 800;
}

.liked-panel {
  min-height: 188px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 22px;
  color: var(--te-neutral-900);
  text-align: left;
  cursor: pointer;
  transition:
    transform 0.26s var(--te-ease-soft),
    border-color 0.26s,
    box-shadow 0.26s,
    filter 0.26s;
}

.liked-panel::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 84% 22%, rgba(232, 67, 147, 0.09), transparent 30%),
    radial-gradient(circle at 26% 86%, rgba(34, 211, 238, 0.07), transparent 34%);
}

.liked-panel:hover {
  transform: translateY(-4px);
  border-color: rgba(255, 255, 255, 0.82);
  box-shadow:
    0 30px 76px rgba(86, 70, 160, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.78);
  filter: saturate(1.04);
}

.liked-light {
  position: absolute;
  right: -28px;
  top: -28px;
  width: 140px;
  height: 140px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(232, 67, 147, 0.14), transparent 68%);
  pointer-events: none;
  transition: transform 0.34s var(--te-ease-soft);
}

.liked-panel:hover .liked-light {
  transform: translate3d(-14px, 12px, 0) scale(1.08);
}

.liked-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.liked-card-badge {
  width: fit-content;
  padding: 5px 10px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.42);
  color: var(--te-primary-500);
  font-size: 11px;
  font-weight: 700;
}

.liked-card-title {
  margin-top: 13px;
  font-size: 22px;
  line-height: 1.2;
  font-weight: 800;
  color: var(--te-neutral-900);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.liked-card-desc {
  margin-top: 5px;
  font-size: 13px;
  font-weight: 700;
  color: rgba(80, 88, 116, 0.62);
}

.liked-play-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: fit-content;
  height: 34px;
  margin-top: 18px;
  padding: 0 14px;
  border-radius: 999px;
  color: #fff;
  background: linear-gradient(135deg, var(--te-primary-500), var(--te-primary-300));
  font-size: 13px;
  font-weight: 800;
  box-shadow: 0 14px 30px rgba(124, 77, 255, 0.18);
  transition:
    transform 0.2s var(--te-ease-soft),
    box-shadow 0.2s;
}

.liked-play-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 18px 38px rgba(124, 77, 255, 0.24);
}

.liked-play-btn i {
  font-size: 12px;
  transform: translateX(1px);
}

.liked-card-cover-wrap {
  flex-shrink: 0;
  width: 116px;
  height: 116px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 18px 38px rgba(86, 70, 160, 0.16);
}

.liked-card-cover {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.liked-card-cover-placeholder {
  color: var(--te-favorite-500);
  background:
    radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.9), transparent 36%),
    linear-gradient(135deg, rgba(232, 67, 147, 0.18), rgba(124, 77, 255, 0.1));
}

.liked-card-cover-placeholder i {
  font-size: 34px;
}

.playlist-section {
  position: relative;
}

.section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.section-heading h3 {
  margin: 0;
  font-size: 19px;
  line-height: 1.15;
  font-weight: 800;
  color: var(--te-neutral-900);
}

.section-heading p {
  margin: 5px 0 0;
  font-size: 12px;
  font-weight: 700;
  color: rgba(80, 88, 116, 0.58);
}

.playlist-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(286px, 1fr));
  gap: 12px;
}

.playlist-list-item {
  display: flex;
  align-items: center;
  gap: 13px;
  min-width: 0;
  min-height: 74px;
  padding: 11px 12px;
  text-align: left;
  cursor: pointer;
  color: inherit;
  transition:
    transform 0.24s var(--te-ease-soft),
    border-color 0.24s,
    box-shadow 0.24s,
    filter 0.24s;
}

.playlist-list-item:hover {
  transform: translateY(-2px);
  border-color: rgba(255, 255, 255, 0.82);
  box-shadow:
    0 24px 58px rgba(86, 70, 160, 0.13),
    inset 0 1px 0 rgba(255, 255, 255, 0.78);
  filter: saturate(1.04);
}

.playlist-cover-wrap {
  flex-shrink: 0;
  width: 52px;
  height: 52px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 12px 24px rgba(86, 70, 160, 0.12);
}

.playlist-cover {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.playlist-cover-placeholder {
  color: var(--te-primary-500);
  background:
    radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.9), transparent 36%),
    linear-gradient(135deg, rgba(124, 77, 255, 0.16), rgba(34, 211, 238, 0.1));
}

.playlist-meta {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.playlist-row-title {
  font-size: 14px;
  line-height: 1.35;
  font-weight: 700;
  color: var(--te-neutral-900);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.playlist-row-subtitle {
  font-size: 12px;
  font-weight: 700;
  color: rgba(80, 88, 116, 0.58);
}

.playlist-open-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: rgba(80, 88, 116, 0.54);
  background: rgba(255, 255, 255, 0.36);
  transition:
    transform 0.22s var(--te-ease-soft),
    color 0.22s,
    background 0.22s;
}

.playlist-pin-button {
  position: relative;
  z-index: 1;
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid rgba(80, 88, 116, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.52);
  color: rgba(80, 88, 116, 0.46);
  cursor: pointer;
  transition:
    background 0.18s,
    border-color 0.18s,
    color 0.18s,
    transform 0.18s;
}

.playlist-pin-button:hover,
.playlist-pin-button.active {
  border-color: rgba(245, 158, 11, 0.32);
  background: #fff7ed;
  color: #d97706;
}

.playlist-pin-button:hover {
  transform: translateY(-1px);
}

.playlist-pin-button:disabled {
  cursor: wait;
  opacity: 0.68;
  transform: none;
}

.playlist-list-item:hover .playlist-open-icon {
  color: var(--te-primary-500);
  background: rgba(255, 255, 255, 0.72);
  transform: translateX(2px);
}

.empty-state {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 42px 20px;
  text-align: center;
  border-style: dashed;
}

.empty-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 8px;
  color: var(--te-primary-500);
  background:
    radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.9), transparent 36%),
    linear-gradient(135deg, rgba(124, 77, 255, 0.14), rgba(34, 211, 238, 0.1));
  box-shadow: 0 14px 30px rgba(86, 70, 160, 0.1);
}

.empty-text {
  margin: 14px 0 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--te-neutral-900);
}

.empty-hint {
  margin: 6px 0 0;
  font-size: 13px;
  font-weight: 700;
  color: rgba(80, 88, 116, 0.58);
}

@media (max-width: 1080px) {
  .library-hero {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .profile-panel,
  .liked-panel {
    align-items: flex-start;
  }

  .profile-panel {
    flex-direction: column;
  }

  .liked-card-cover-wrap {
    width: 96px;
    height: 96px;
  }
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

/* ===== Reference-style Library Refresh ===== */
.library-view {
  color: #242946;
}

.library-hero {
  gap: 16px;
  margin-bottom: 32px;
}

.profile-panel,
.liked-panel,
.playlist-list-item,
.empty-state {
  border-radius: 8px;
  border-color: rgba(255, 255, 255, 0.72);
  background:
    radial-gradient(circle at 18% 12%, rgba(255, 255, 255, 0.8), transparent 30%),
    linear-gradient(145deg, rgba(255, 255, 255, 0.64), rgba(249, 246, 255, 0.3)),
    rgba(255, 255, 255, 0.26);
  box-shadow:
    0 20px 58px rgba(86, 70, 160, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.76);
}

.profile-panel,
.liked-panel {
  min-height: 178px;
}

.profile-name,
.liked-card-title,
.section-heading h3,
.playlist-row-title,
.empty-text {
  color: #242946;
}

.profile-kicker,
.profile-signature,
.liked-card-desc,
.section-heading p,
.playlist-row-subtitle,
.empty-hint {
  color: rgba(82, 90, 122, 0.62);
}

.profile-avatar,
.liked-card-cover-wrap,
.playlist-cover-wrap {
  border-radius: 8px;
}

.profile-avatar {
  border-radius: 999px;
}

.stat-item,
.liked-card-badge,
.playlist-open-icon,
.playlist-pin-button {
  border-radius: 8px;
  border-color: rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.5);
}

.liked-panel::after {
  background:
    radial-gradient(circle at 82% 18%, rgba(232, 67, 147, 0.1), transparent 30%),
    radial-gradient(circle at 28% 88%, rgba(34, 211, 238, 0.08), transparent 34%),
    linear-gradient(120deg, rgba(238, 228, 255, 0.34), transparent 58%);
}

.liked-play-btn {
  border-radius: 8px;
  background: linear-gradient(135deg, #7c4dff, #b469f4);
}

.playlist-list {
  gap: 10px;
}

.playlist-list-item {
  min-height: 76px;
}

.playlist-list-item:hover,
.liked-panel:hover {
  transform: translateY(-3px);
  box-shadow:
    0 26px 66px rgba(86, 70, 160, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.82);
}

@media (max-width: 720px) {
  .liked-panel {
    flex-direction: column-reverse;
  }
}

/* ===== White Card Library Refinement ===== */
.profile-panel,
.liked-panel,
.playlist-list-item,
.empty-state,
.stat-item,
.liked-card-badge,
.playlist-open-icon {
  background: #fff;
  border-color: #eef1f6;
  box-shadow: 0 14px 32px rgba(34, 42, 68, 0.07);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.profile-panel::before,
.liked-panel::before,
.playlist-list-item::before,
.empty-state::before,
.liked-panel::after,
.liked-light {
  display: none;
}

.stat-item,
.liked-card-badge,
.playlist-open-icon,
.playlist-pin-button {
  box-shadow: none;
}

.playlist-pin-button.active {
  border-color: #fed7aa;
  background: #fff7ed;
  color: #d97706;
}

.liked-play-btn {
  background: #7c4dff;
  box-shadow: 0 12px 24px rgba(124, 77, 255, 0.18);
}

.playlist-list-item:hover,
.liked-panel:hover {
  box-shadow: 0 18px 38px rgba(34, 42, 68, 0.1);
}

.profile-avatar-placeholder,
.liked-card-cover-placeholder,
.playlist-cover-placeholder,
.empty-icon {
  background: #f3f0ff;
}
</style>
