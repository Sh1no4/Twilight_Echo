<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MediaProviderPlaylistSummary, MediaProviderProfile } from '../providers/mediaProvider'
import {
  buildProviderHealthPresentation,
  type ProviderHealthInput
} from '../utils/providerHealthPresentation'

interface ProviderOption {
  id: string
  name: string
  icon: string
  health?: ProviderHealthInput
  loggedIn?: boolean
}

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
  showFeatureCards?: boolean
  allowPinPlaylists?: boolean
  pinnedPlaylistIds?: Array<string | number>
  pinningPlaylistId?: string | number | null
  availableProviders?: ProviderOption[]
  activeProvider?: string
}>()

const emit = defineEmits<{
  openUserList: [type: 'follows' | 'followers']
  openLikedTracks: []
  playLikedSongs: []
  openPlaylist: [playlist: MediaProviderPlaylistSummary]
  togglePinnedPlaylist: [playlist: MediaProviderPlaylistSummary]
  openRecent: []
  openRanking: []
  switchProvider: [id: string]
}>()

// ─── Provider switcher (music library toggle) ───────────────────────────
// Only renders when more than one library provider is available, so the
// toggle button appears once a second provider (e.g. ytmusic) is loaded and
// disappears when it is gone.
const providerMenuOpen = ref(false)

const providerOptions = computed<ProviderOption[]>(() => props.availableProviders ?? [])
const canSwitchProvider = computed(() => providerOptions.value.length > 1)

const activeProviderName = computed(() => {
  const active = providerOptions.value.find((p) => p.id === props.activeProvider)
  return active?.name ?? props.providerLabel ?? '在线音源'
})

const activeProviderIcon = computed(() => {
  const active = providerOptions.value.find((p) => p.id === props.activeProvider)
  return active?.icon ?? 'pi pi-music'
})

const activeProviderHealth = computed(() => {
  const active = providerOptions.value.find((p) => p.id === props.activeProvider)
  return buildProviderHealthPresentation({
    health: active?.health,
    loggedIn: active?.loggedIn ?? props.isLoggedIn
  })
})

const activeProviderHealthState = computed(() =>
  activeProviderHealth.value.state
)

const activeProviderHealthLabel = computed(() =>
  activeProviderHealth.value.label
)

const activeProviderHealthDetail = computed(() =>
  activeProviderHealth.value.detail
)

function onProviderMenuBlur(): void {
  // Defer so a menu-item click can register before the menu closes.
  setTimeout(() => {
    providerMenuOpen.value = false
  }, 120)
}

function selectProvider(id: string): void {
  providerMenuOpen.value = false
  emit('switchProvider', id)
}

function providerMenuHealthLabel(provider: ProviderOption): string {
  return buildProviderHealthPresentation({
    health: provider.health,
    loggedIn: provider.loggedIn ?? props.isLoggedIn
  }).label
}

function providerMenuHealthDetail(provider: ProviderOption): string {
  return buildProviderHealthPresentation({
    health: provider.health,
    loggedIn: provider.loggedIn ?? props.isLoggedIn
  }).detail
}

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
          <div class="profile-title-row">
            <h3>{{ providerLabel || '在线音源' }}个人音乐库</h3>
            <div v-if="canSwitchProvider" class="provider-switcher">
              <button
                type="button"
                class="provider-switch-btn"
                :class="{ active: providerMenuOpen }"
                :title="`切换音源（当前：${activeProviderName}）`"
                @click="providerMenuOpen = !providerMenuOpen"
                @blur="onProviderMenuBlur"
              >
                <i :class="activeProviderIcon"></i>
                <span class="provider-switch-name">{{ activeProviderName }}</span>
                <i class="pi pi-chevron-down provider-switch-caret"></i>
              </button>
              <div v-if="providerMenuOpen" class="provider-menu">
                <button
                  v-for="provider in providerOptions"
                  :key="provider.id"
                  type="button"
                  class="provider-menu-item"
                  :class="{ active: provider.id === activeProvider }"
                  :title="providerMenuHealthDetail(provider)"
                  @mousedown.prevent="selectProvider(provider.id)"
                >
                  <i :class="provider.icon"></i>
                  <span>
                    {{ provider.name }}
                    <small class="provider-menu-health">
                      {{ providerMenuHealthLabel(provider) }}
                    </small>
                  </span>
                  <i
                    v-if="provider.id === activeProvider"
                    class="pi pi-check provider-menu-check"
                  ></i>
                </button>
              </div>
            </div>
          </div>
          <h1>{{ profile?.nickname || '未登录用户' }}</h1>
          <p>{{ profileSignature || '这里空空如也~' }}</p>
          <div
            class="provider-health-strip"
            :class="activeProviderHealthState"
            :title="activeProviderHealthDetail"
          >
            <i
              :class="
                activeProviderHealthState === 'ok'
                  ? 'pi pi-check-circle'
                  : activeProviderHealthState === 'warning'
                    ? 'pi pi-exclamation-triangle'
                    : 'pi pi-times-circle'
              "
            ></i>
            <span>{{ activeProviderHealthLabel }}</span>
            <small>{{ activeProviderHealthDetail }}</small>
          </div>
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

    <!-- Feature Cards: Recent & Ranking portals (ncm only — external providers don't implement these) -->
    <section class="feature-cards" v-if="isLoggedIn && showFeatureCards !== false">
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
  background: var(--te-glass-bg-strong);
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

/* Provider switcher (music library toggle) */
.profile-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}
.profile-title-row h3 {
  margin: 0;
  min-width: 0;
}
.provider-switcher {
  position: relative;
  flex-shrink: 0;
}
.provider-switch-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  background: var(--te-subtle-bg);
  color: var(--te-neutral-700, #334155);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.provider-switch-btn:hover,
.provider-switch-btn.active {
  background: rgba(var(--te-primary-rgb, 99, 102, 241), 0.1);
  border-color: rgba(var(--te-primary-rgb, 99, 102, 241), 0.3);
  color: var(--te-primary-500, #6366f1);
}
.provider-switch-btn i:first-child {
  font-size: 13px;
}
.provider-switch-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.provider-switch-caret {
  font-size: 10px;
  transition: transform 0.2s;
}
.provider-switch-btn.active .provider-switch-caret {
  transform: rotate(180deg);
}
.provider-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 180px;
  background: var(--te-card-bg);
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 14px;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.14);
  padding: 6px;
  z-index: 20;
  animation: provider-menu-in 0.16s ease both;
}
.provider-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 12px;
  border: none;
  background: transparent;
  border-radius: 10px;
  color: var(--te-neutral-700, #334155);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  text-align: left;
}
.provider-menu-item:hover {
  background: rgba(15, 23, 42, 0.04);
}
.provider-menu-item.active {
  color: var(--te-primary-500, #6366f1);
  background: rgba(var(--te-primary-rgb, 99, 102, 241), 0.08);
}
.provider-menu-item span {
  flex: 1;
  min-width: 0;
}
.provider-menu-check {
  font-size: 12px;
}
.provider-menu-health {
  display: block;
  margin-top: 2px;
  color: var(--te-neutral-500, #64748b);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
}
@keyframes provider-menu-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
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

.provider-health-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(100%, 560px);
  min-height: 30px;
  margin: 0 0 14px;
  padding: 6px 10px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.035);
  color: var(--te-neutral-700, #334155);
}
.provider-health-strip i {
  flex-shrink: 0;
  font-size: 13px;
}
.provider-health-strip span {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 800;
}
.provider-health-strip small {
  min-width: 0;
  overflow: hidden;
  color: var(--te-neutral-500, #64748b);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.provider-health-strip.ok {
  border-color: rgba(16, 185, 129, 0.18);
  background: rgba(16, 185, 129, 0.08);
}
.provider-health-strip.ok i {
  color: #059669;
}
.provider-health-strip.warning {
  border-color: rgba(245, 158, 11, 0.24);
  background: rgba(245, 158, 11, 0.1);
}
.provider-health-strip.warning i {
  color: #d97706;
}
.provider-health-strip.error {
  border-color: rgba(225, 29, 72, 0.18);
  background: rgba(225, 29, 72, 0.08);
}
.provider-health-strip.error i {
  color: #e11d48;
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
  background: var(--te-card-bg);
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
  background: var(--te-subtle-bg);
}

.heart-icon {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 50px;
  height: 50px;
  background: var(--te-glass-bg);
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
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 24px;
  min-height: 120px;
  padding: 24px 32px;
}

.feature-info {
  min-width: 0;
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
  overflow-wrap: anywhere;
  font-size: 20px;
  font-weight: 800;
  color: var(--te-neutral-900, #1e293b);
  margin: 0 0 4px 0;
}
.feature-info p {
  overflow-wrap: anywhere;
  font-size: 14px;
  color: var(--te-neutral-500, #64748b);
  font-weight: 500;
  margin: 0;
}

.feature-card .enter-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--te-card-bg);
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
  background: var(--te-glass-bg-strong);
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
  background: var(--te-hover-bg);
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
  background: var(--te-card-bg);
  color: #94a3b8;
  cursor: pointer;
  transition: all 0.2s;
  margin-right: -4px;
}

.playlist-pin-button:hover,
.playlist-pin-button.active {
  border-color: #fed7aa;
  background: var(--te-warning-soft-bg);
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
  background: var(--te-card-bg);
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

:global(html[data-theme='dark'] .library-view .glass-card),
:global(html[data-theme='dark'] .library-view .playlist-item),
:global(html[data-theme='dark'] .library-view .empty-state) {
  background: var(--te-glass-bg-strong);
  border-color: var(--te-glass-border);
  box-shadow: var(--te-glass-shadow), inset 0 1px 0 rgba(255, 255, 255, 0.045);
}

:global(html[data-theme='dark'] .library-view .glass-card:hover),
:global(html[data-theme='dark'] .library-view .playlist-item:hover) {
  background: #202020;
  box-shadow: 0 22px 56px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.055);
}

:global(html[data-theme='dark'] .library-view .profile-card:hover) {
  box-shadow: var(--te-glass-shadow), inset 0 1px 0 rgba(255, 255, 255, 0.045);
}

:global(html[data-theme='dark'] .library-view .profile-avatar) {
  border-color: #242424;
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.32);
}

:global(html[data-theme='dark'] .library-view .profile-avatar-placeholder),
:global(html[data-theme='dark'] .library-view .playlist-cover-placeholder),
:global(html[data-theme='dark'] .library-view .empty-icon) {
  background: #242016;
  color: var(--te-primary-400);
}

:global(html[data-theme='dark'] .library-view .provider-switch-btn),
:global(html[data-theme='dark'] .library-view .stat-badge),
:global(html[data-theme='dark'] .library-view .playlist-pin-button) {
  background: #141414;
  border-color: var(--te-card-border);
  color: var(--te-neutral-700);
}

:global(html[data-theme='dark'] .library-view .provider-switch-btn:hover),
:global(html[data-theme='dark'] .library-view .provider-switch-btn.active),
:global(html[data-theme='dark'] .library-view .provider-menu-item.active) {
  background: rgba(245, 158, 11, 0.11);
  border-color: rgba(var(--te-primary-rgb), 0.32);
  color: var(--te-primary-400);
}

:global(html[data-theme='dark'] .library-view .provider-health-strip) {
  border-color: var(--te-card-border);
  background: rgba(255, 255, 255, 0.045);
}

:global(html[data-theme='dark'] .library-view .provider-health-strip.ok) {
  border-color: rgba(16, 185, 129, 0.22);
  background: rgba(16, 185, 129, 0.1);
}

:global(html[data-theme='dark'] .library-view .provider-health-strip.warning) {
  border-color: rgba(var(--te-primary-rgb), 0.26);
  background: rgba(var(--te-primary-rgb), 0.1);
}

:global(html[data-theme='dark'] .library-view .provider-health-strip.error) {
  border-color: rgba(225, 29, 72, 0.28);
  background: rgba(225, 29, 72, 0.11);
}

:global(html[data-theme='dark'] .library-view .provider-menu) {
  background: #181818;
  border-color: var(--te-card-border);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.44);
}

:global(html[data-theme='dark'] .library-view .provider-menu-item:hover),
:global(html[data-theme='dark'] .library-view .stat-badge:hover) {
  background: rgba(255, 255, 255, 0.065);
}

:global(html[data-theme='dark'] .library-view .favorites-card::before) {
  background: radial-gradient(circle, rgba(var(--te-primary-rgb), 0.11) 0%, transparent 70%);
}

:global(html[data-theme='dark'] .library-view .favorites-info .tag) {
  background: rgba(var(--te-primary-rgb), 0.13);
  color: var(--te-primary-400);
}

:global(html[data-theme='dark'] .feature-card .feature-info .icon-wrap) {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: #07080a !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 10px 24px rgba(0, 0, 0, 0.26);
}

:global(html[data-theme='dark'] .recent-card .feature-info .icon-wrap) {
  color: var(--te-primary-400) !important;
}

:global(html[data-theme='dark'] .ranking-card .feature-info .icon-wrap) {
  color: #fb7185 !important;
}

:global(html[data-theme='dark'] .library-view .btn-play) {
  background: linear-gradient(135deg, var(--te-primary-500), var(--te-primary-400));
  color: #111111;
  box-shadow: 0 10px 24px rgba(var(--te-primary-rgb), 0.22);
}

:global(html[data-theme='dark'] .library-view .btn-play:hover) {
  box-shadow: 0 14px 32px rgba(var(--te-primary-rgb), 0.3);
}

:global(html[data-theme='dark'] .library-view .recent-card),
:global(html[data-theme='dark'] .library-view .ranking-card) {
  background: linear-gradient(135deg, rgba(31, 31, 31, 0.96) 0%, rgba(24, 24, 24, 0.84) 100%);
}

:global(html[data-theme='dark'] .library-view .feature-card .enter-btn) {
  background: #141414;
  color: var(--te-neutral-500);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
}

:global(html[data-theme='dark'] .library-view .feature-card:hover .enter-btn),
:global(html[data-theme='dark'] .library-view .playlist-item:hover .playlist-item-arrow) {
  color: var(--te-primary-400);
}

:global(html[data-window-transparent='on'] .library-view .glass-card),
:global(html[data-window-transparent='on'] .library-view .playlist-item),
:global(html[data-window-transparent='on'] .library-view .empty-state),
:global(html[data-window-transparent='on'] .library-view .provider-menu),
:global(html[data-window-transparent='on'] .library-view .provider-switch-btn),
:global(html[data-window-transparent='on'] .library-view .stat-badge),
:global(html[data-window-transparent='on'] .library-view .playlist-pin-button),
:global(html[data-window-transparent='on'] .library-view .feature-card .enter-btn) {
  background: var(--te-tp-card) !important;
  background-image: none !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
  box-shadow:
    0 18px 48px rgba(0, 0, 0, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.06) !important;
  backdrop-filter: blur(var(--te-tp-card-blur)) saturate(145%) !important;
  -webkit-backdrop-filter: blur(var(--te-tp-card-blur)) saturate(145%) !important;
}

:global(html[data-window-transparent='on'] .library-view .glass-card:hover),
:global(html[data-window-transparent='on'] .library-view .playlist-item:hover) {
  background: var(--te-tp-card) !important;
  box-shadow:
    0 22px 56px rgba(0, 0, 0, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.07) !important;
}

:global(html[data-window-transparent='on'] .library-view .recent-card),
:global(html[data-window-transparent='on'] .library-view .ranking-card) {
  background: var(--te-tp-card) !important;
}

:global(html[data-window-transparent='on'] .library-view .heart-icon) {
  background: rgba(255, 255, 255, 0.1) !important;
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
    align-items: flex-start;
    gap: 16px;
  }

  .feature-card {
    grid-template-columns: 1fr;
  }

  .profile-card,
  .favorites-card {
    flex-direction: column;
  }

  .favorites-cover {
    width: 96px;
    height: 96px;
    align-self: center;
    transform: rotateY(0);
  }
  
  .feature-preview {
    align-self: flex-end;
    min-width: 0;
  }
}
</style>
