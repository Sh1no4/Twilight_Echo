<script setup lang="ts">
import type { Track } from '../types/music'
import type { NcmPlaylistSummary, NcmArtistSummary } from '../stores/useNcmStore'

interface PageState {
  first: number
  rows: number
  page: number
  pageCount: number
}

const props = defineProps<{
  searchType: 'songs' | 'playlists' | 'artists'
  searchResults: Track[]
  searchPlaylistsResults: NcmPlaylistSummary[]
  searchArtistsResults: NcmArtistSummary[]
  searchTotal: number
  searchOffset: number
  searchLoading: boolean
  searchError: string
  currentTrack: Track | null
  likingTracks: Set<number>
  isTrackLiked: (id: number | undefined) => boolean
  formatTime: (time: number) => string
}>()

const emit = defineEmits<{
  searchTrackClick: [track: Track]
  likeTrack: [track: Track, event: MouseEvent]
  openPlaylist: [playlist: NcmPlaylistSummary]
  openArtist: [artist: NcmArtistSummary]
  pageChange: [event: PageState]
  retry: []
}>()

const pageSize = 30

function emitPage(first: number): void {
  const normalizedFirst = Math.max(0, Math.min(first, Math.max(0, props.searchTotal - pageSize)))
  emit('pageChange', {
    first: normalizedFirst,
    rows: pageSize,
    page: Math.floor(normalizedFirst / pageSize),
    pageCount: Math.max(1, Math.ceil(props.searchTotal / pageSize))
  })
}
</script>

<template>
  <div class="search-view">
    <div v-if="searchLoading && searchOffset === 0" class="streaming-placeholder">
      <i class="pi pi-spin pi-spinner" style="font-size: 40px; color: #999"></i>
      <p class="placeholder-title">正在搜索</p>
    </div>
    <div v-else-if="searchError" class="streaming-placeholder">
      <i class="pi pi-exclamation-triangle" style="font-size: 40px; color: #e74c3c"></i>
      <p class="placeholder-title">搜索失败</p>
      <p class="placeholder-hint">{{ searchError }}</p>
      <button type="button" class="search-action-btn" @click="emit('retry')">重试</button>
    </div>
    <div v-else-if="searchTotal === 0 && !searchLoading" class="streaming-placeholder">
      <i class="pi pi-search" style="font-size: 40px; color: #ccc"></i>
      <p class="placeholder-title">无搜索结果</p>
      <p class="placeholder-hint">换个关键词试试吧</p>
    </div>
    <div v-else class="search-results-content">
      <div v-if="searchType === 'songs'" class="detail-content">
        <div class="track-table-wrapper">
          <table class="track-table">
            <thead>
              <tr>
                <th class="col-cover-header"></th>
                <th class="col-index">#</th>
                <th class="col-info">标题</th>
                <th class="col-like-header"></th>
                <th class="col-album">专辑</th>
                <th class="col-duration">时长</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(track, index) in searchResults"
                :key="track.id"
                class="track-row"
                :class="{ 'track-playing': currentTrack?.id === track.id }"
                @click="emit('searchTrackClick', track)"
              >
                <td class="col-cover">
                  <img v-if="track.cover" :src="track.cover" class="cover-img" alt="cover" />
                  <div v-else class="cover-placeholder">
                    <i class="pi pi-wave-pulse" style="font-size: 18px; color: #bbb"></i>
                  </div>
                </td>
                <td class="col-index">
                  <span v-if="currentTrack?.id === track.id" class="playing-indicator">
                    <i class="pi pi-volume-up" style="font-size: 12px; color: #1a73e8"></i>
                  </span>
                  <span v-else>{{ index + 1 + searchOffset }}</span>
                </td>
                <td class="col-info">
                  <div class="track-title">{{ track.title }}</div>
                  <div class="track-artist">{{ track.artist }}</div>
                </td>
                <td class="col-like">
                  <button
                    class="btn-like"
                    :class="{
                      liked: isTrackLiked(track.ncmSongId),
                      loading: likingTracks.has(track.ncmSongId ?? 0)
                    }"
                    :disabled="likingTracks.has(track.ncmSongId ?? 0)"
                    title="喜欢"
                    @click.stop="emit('likeTrack', track, $event)"
                  >
                    <i
                      v-if="likingTracks.has(track.ncmSongId ?? 0)"
                      class="pi pi-spin pi-spinner"
                      style="font-size: 14px"
                    ></i>
                    <i
                      v-else
                      :class="isTrackLiked(track.ncmSongId) ? 'pi pi-heart-fill' : 'pi pi-heart'"
                      style="font-size: 14px"
                    ></i>
                  </button>
                </td>
                <td class="col-album">{{ track.album }}</td>
                <td class="col-duration">{{ formatTime(track.duration) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div
          v-if="searchTotal > 30"
          class="search-paginator"
        >
          <button
            type="button"
            class="pager-btn"
            :disabled="searchOffset <= 0"
            @click="emitPage(searchOffset - pageSize)"
          >
            上一页
          </button>
          <span class="pager-text">
            {{ Math.floor(searchOffset / pageSize) + 1 }} /
            {{ Math.ceil(searchTotal / pageSize) }}
          </span>
          <button
            type="button"
            class="pager-btn"
            :disabled="searchOffset + pageSize >= searchTotal"
            @click="emitPage(searchOffset + pageSize)"
          >
            下一页
          </button>
        </div>
      </div>
      <div v-else-if="searchType === 'playlists'" class="rec-sections">
        <div class="playlist-grid">
          <div
            v-for="playlist in searchPlaylistsResults"
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
        <div
          v-if="searchTotal > 30"
          class="search-paginator"
        >
          <button
            type="button"
            class="pager-btn"
            :disabled="searchOffset <= 0"
            @click="emitPage(searchOffset - pageSize)"
          >
            上一页
          </button>
          <span class="pager-text">
            {{ Math.floor(searchOffset / pageSize) + 1 }} /
            {{ Math.ceil(searchTotal / pageSize) }}
          </span>
          <button
            type="button"
            class="pager-btn"
            :disabled="searchOffset + pageSize >= searchTotal"
            @click="emitPage(searchOffset + pageSize)"
          >
            下一页
          </button>
        </div>
      </div>
      <div v-else-if="searchType === 'artists'" class="rec-sections">
        <div class="playlist-grid">
          <div
            v-for="artist in searchArtistsResults"
            :key="artist.id"
            class="playlist-grid-card artist-card"
            @click="emit('openArtist', artist)"
          >
            <img
              v-if="artist.picUrl"
              :src="artist.picUrl"
              class="playlist-grid-cover artist-cover"
              alt=""
            />
            <div v-else class="playlist-grid-cover-placeholder artist-cover">
              <i class="pi pi-user" style="font-size: 28px; color: #bbb"></i>
            </div>
            <div class="playlist-grid-name">{{ artist.name }}</div>
            <div class="playlist-grid-count">{{ artist.musicSize }} 首单曲</div>
          </div>
        </div>
        <div
          v-if="searchTotal > 30"
          class="search-paginator"
        >
          <button
            type="button"
            class="pager-btn"
            :disabled="searchOffset <= 0"
            @click="emitPage(searchOffset - pageSize)"
          >
            上一页
          </button>
          <span class="pager-text">
            {{ Math.floor(searchOffset / pageSize) + 1 }} /
            {{ Math.ceil(searchTotal / pageSize) }}
          </span>
          <button
            type="button"
            class="pager-btn"
            :disabled="searchOffset + pageSize >= searchTotal"
            @click="emitPage(searchOffset + pageSize)"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-view {
  padding-bottom: 32px;
}

.streaming-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.58);
  box-shadow: 0 20px 70px rgba(86, 70, 160, 0.12);
  backdrop-filter: blur(18px) saturate(145%);
  -webkit-backdrop-filter: blur(18px) saturate(145%);
}

.placeholder-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--te-neutral-900);
  margin-top: 16px;
}

.placeholder-hint {
  font-size: 14px;
  color: #999;
  margin-top: 8px;
  margin-bottom: 24px;
}

.search-results-content {
  animation: fadeIn 0.3s ease-out;
}

/* Shared styles for search results */
.rec-sections {
  padding: 0 40px;
}

.playlist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 24px;
  margin-top: 16px;
}

.playlist-grid-card {
  cursor: pointer;
  padding: 14px;
  border-radius: 16px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.52), rgba(248, 245, 255, 0.3)),
    rgba(255, 255, 255, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow: 0 18px 50px rgba(86, 70, 160, 0.1);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  transition:
    transform 0.26s var(--te-ease-soft),
    background 0.26s,
    box-shadow 0.26s;
}

.playlist-grid-card:hover {
  transform: translateY(-6px) scale(1.01);
  box-shadow: 0 24px 70px rgba(86, 70, 160, 0.18);
}

.playlist-grid-cover {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 12px;
  object-fit: cover;
  box-shadow: 0 18px 32px rgba(86, 70, 160, 0.14);
}

.playlist-grid-cover-placeholder {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 12px;
  background:
    radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.86), transparent 34%),
    linear-gradient(135deg, rgba(124, 77, 255, 0.22), rgba(34, 211, 238, 0.12));
  display: flex;
  align-items: center;
  justify-content: center;
}

.playlist-grid-name {
  margin-top: 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--te-neutral-900);
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

.artist-card {
  text-align: center;
}

.artist-cover {
  border-radius: 50% !important;
}

.search-paginator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 24px;
}

.search-action-btn,
.pager-btn {
  min-height: 34px;
  padding: 0 16px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 999px;
  background:
    linear-gradient(135deg, rgba(124, 77, 255, 0.14), rgba(34, 211, 238, 0.1)),
    rgba(255, 255, 255, 0.54);
  color: rgba(52, 61, 87, 0.86);
  font-size: 13px;
  font-weight: 850;
  cursor: pointer;
  box-shadow: 0 10px 24px rgba(86, 70, 160, 0.08);
  transition:
    transform 0.2s var(--te-ease-soft),
    box-shadow 0.2s,
    opacity 0.2s;
}

.search-action-btn:hover,
.pager-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 14px 30px rgba(86, 70, 160, 0.12);
}

.pager-btn:disabled {
  cursor: not-allowed;
  opacity: 0.46;
}

.pager-text {
  min-width: 72px;
  text-align: center;
  color: rgba(80, 88, 116, 0.64);
  font-size: 12px;
  font-weight: 850;
  font-variant-numeric: tabular-nums;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* ===== Reference-style Search Refresh ===== */
.search-view {
  color: #242946;
}

.streaming-placeholder,
.playlist-grid-card {
  border-radius: 8px;
  border-color: rgba(255, 255, 255, 0.72);
  background:
    radial-gradient(circle at 18% 12%, rgba(255, 255, 255, 0.8), transparent 30%),
    linear-gradient(145deg, rgba(255, 255, 255, 0.64), rgba(249, 246, 255, 0.3)),
    rgba(255, 255, 255, 0.26);
  box-shadow:
    0 20px 58px rgba(86, 70, 160, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.76);
  backdrop-filter: blur(22px) saturate(150%);
  -webkit-backdrop-filter: blur(22px) saturate(150%);
}

.placeholder-title {
  color: #242946;
  font-weight: 900;
}

.placeholder-hint,
.playlist-grid-count,
.pager-text {
  color: rgba(82, 90, 122, 0.62);
  font-weight: 750;
}

.rec-sections {
  padding: 0;
}

.playlist-grid {
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 18px;
  margin-top: 0;
}

.playlist-grid-card {
  padding: 12px;
}

.playlist-grid-card:hover {
  transform: translateY(-4px);
  box-shadow:
    0 24px 64px rgba(86, 70, 160, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.82);
}

.playlist-grid-cover,
.playlist-grid-cover-placeholder {
  border-radius: 8px;
}

.playlist-grid-name {
  color: #242946;
  font-weight: 900;
}

.search-action-btn,
.pager-btn {
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.58);
  border-color: rgba(255, 255, 255, 0.72);
}

.pager-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(124, 77, 255, 0.16), rgba(255, 126, 182, 0.1));
}

/* ===== White Card Search Refinement ===== */
.streaming-placeholder,
.playlist-grid-card,
.search-action-btn,
.pager-btn {
  background: #fff;
  border-color: #eef1f6;
  box-shadow: 0 14px 32px rgba(34, 42, 68, 0.07);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.playlist-grid-card:hover {
  box-shadow: 0 18px 38px rgba(34, 42, 68, 0.1);
}

.playlist-grid-cover-placeholder {
  background: #f3f0ff;
}

.pager-btn:hover:not(:disabled),
.search-action-btn:hover {
  background: #f7f5ff;
}
</style>
