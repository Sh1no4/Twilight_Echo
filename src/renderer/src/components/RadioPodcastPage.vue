<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRadioStore, radioStationToTrack } from '../stores/useRadioStore'
import { usePodcastStore, podcastEpisodeToTrack } from '../stores/usePodcastStore'
import { usePlayerStore } from '../stores/usePlayerStore'
import { useOfflineDownloads } from '../stores/useOfflineDownloads.ts'
import { isInsecureHttpUrl } from '../../../shared/radioStations.ts'
import type { PodcastSubscription } from '../../../shared/podcastSubscriptions.ts'

const emit = defineEmits<{
  back: []
}>()

const radio = useRadioStore()
const podcast = usePodcastStore()
const offline = useOfflineDownloads()
const { playTrack, playTrackFromPosition } = usePlayerStore()

const tab = ref<'radio' | 'podcast'>('radio')
const stationName = ref('')
const stationUrl = ref('')
const allowHttp = ref(false)
const formError = ref('')
const formBusy = ref(false)
const playlistText = ref('')
const directoryQuery = ref('')
const directoryResults = ref<
  Array<{
    stationuuid: string
    name: string
    url: string
    urlResolved: string
    homepage?: string
    favicon?: string
    tags: string[]
    countryCode?: string
    bitrate?: number
    codec?: string
  }>
>([])
const directoryBusy = ref(false)
const feedUrl = ref('')
const selectedPodcastId = ref<string | null>(null)
const pinBusyGuid = ref<string | null>(null)

const selectedPodcast = computed<PodcastSubscription | null>(() => {
  if (!selectedPodcastId.value) return null
  return podcast.subscriptions.value.find((sub) => sub.id === selectedPodcastId.value) ?? null
})

onMounted(() => {
  void radio.ensureLoaded()
  void podcast.ensureLoaded()
})

async function addStation(): Promise<void> {
  formError.value = ''
  formBusy.value = true
  try {
    const url = stationUrl.value.trim()
    if (isInsecureHttpUrl(url) && !allowHttp.value) {
      formError.value = '该电台使用 HTTP 明文流，请勾选“允许 HTTP”后再添加'
      return
    }
    await radio.addStation({
      name: stationName.value,
      streamUrl: url,
      allowInsecureHttp: allowHttp.value
    })
    stationName.value = ''
    stationUrl.value = ''
    allowHttp.value = false
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error)
  } finally {
    formBusy.value = false
  }
}

async function importPlaylist(): Promise<void> {
  formError.value = ''
  formBusy.value = true
  try {
    const count = await radio.importPlaylistText(playlistText.value, {
      fileNameHint: 'import.m3u',
      allowInsecureHttp: allowHttp.value
    })
    playlistText.value = ''
    if (count === 0) formError.value = '未导入任何有效电台（HTTP 条目需勾选允许）'
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error)
  } finally {
    formBusy.value = false
  }
}

async function searchDirectory(): Promise<void> {
  formError.value = ''
  directoryBusy.value = true
  try {
    directoryResults.value = await radio.searchDirectory(directoryQuery.value, { limit: 20 })
    if (directoryResults.value.length === 0) {
      formError.value = '未找到匹配电台'
    }
  } catch (error) {
    directoryResults.value = []
    formError.value = error instanceof Error ? error.message : String(error)
  } finally {
    directoryBusy.value = false
  }
}

async function addDirectoryStation(row: {
  name: string
  urlResolved: string
  homepage?: string
  tags: string[]
}): Promise<void> {
  formError.value = ''
  formBusy.value = true
  try {
    const streamUrl = row.urlResolved
    if (isInsecureHttpUrl(streamUrl) && !allowHttp.value) {
      formError.value = '该目录电台使用 HTTP 明文流，请勾选“允许 HTTP”后再添加'
      return
    }
    await radio.addStation({
      name: row.name,
      streamUrl,
      homepage: row.homepage,
      tags: row.tags,
      allowInsecureHttp: allowHttp.value
    })
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error)
  } finally {
    formBusy.value = false
  }
}

function playStation(id: string): void {
  const station = radio.stations.value.find((item) => item.id === id)
  if (!station) return
  playTrack(radioStationToTrack(station), [radioStationToTrack(station)])
}

async function removeStation(id: string): Promise<void> {
  await radio.removeStation(id)
}

async function subscribeFeed(): Promise<void> {
  formError.value = ''
  formBusy.value = true
  try {
    const sub = await podcast.subscribe(feedUrl.value)
    feedUrl.value = ''
    selectedPodcastId.value = sub.id
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error)
  } finally {
    formBusy.value = false
  }
}

async function refreshSelected(): Promise<void> {
  if (!selectedPodcastId.value) return
  formError.value = ''
  try {
    await podcast.refresh(selectedPodcastId.value)
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error)
  }
}

function playEpisode(subscription: PodcastSubscription, guid: string): void {
  const episode = subscription.episodes.find((item) => item.guid === guid)
  if (!episode) return
  const track = podcastEpisodeToTrack(subscription, episode)
  const list = subscription.episodes.map((item) => podcastEpisodeToTrack(subscription, item))
  const progress = episode.progressSeconds ?? 0
  const duration = episode.durationSeconds || 0
  // Resume when progress is meaningful and not essentially finished.
  const nearEnd = duration > 0 && progress >= duration * 0.95
  if (progress >= 5 && !nearEnd) {
    playTrackFromPosition(track, progress, list)
    return
  }
  playTrack(track, list)
}

function episodePinStatus(subscriptionId: string, guid: string): string {
  const trackId = `podcast:${subscriptionId}:${guid}`
  const record = offline.records.value.find(
    (item) => item.providerId === 'podcast' && item.trackId === trackId
  )
  return record?.status ?? ''
}

async function pinEpisode(subscription: PodcastSubscription, guid: string): Promise<void> {
  formError.value = ''
  pinBusyGuid.value = guid
  try {
    await podcast.pinEpisode(subscription.id, guid)
    await offline.refresh()
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error)
  } finally {
    pinBusyGuid.value = null
  }
}

function progressLabel(episode: { durationSeconds: number; progressSeconds?: number }): string {
  const ratio = podcast.podcastEpisodeProgressRatio({
    guid: '',
    title: '',
    mediaUrl: 'https://example.test/a.mp3',
    durationSeconds: episode.durationSeconds,
    progressSeconds: episode.progressSeconds
  })
  if (ratio === null) return ''
  if (ratio <= 0) return ''
  if (ratio >= 0.95) return '已听完'
  return `进度 ${Math.round(ratio * 100)}%`
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
</script>

<template>
  <div class="radio-podcast-page">
    <header class="page-header">
      <button type="button" class="back-btn" @click="emit('back')">
        <i class="pi pi-arrow-left"></i>
        <span>返回</span>
      </button>
      <h1>电台 / 播客</h1>
      <div class="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          :aria-selected="tab === 'radio'"
          :class="{ active: tab === 'radio' }"
          @click="tab = 'radio'"
        >
          电台
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="tab === 'podcast'"
          :class="{ active: tab === 'podcast' }"
          @click="tab = 'podcast'"
        >
          播客
        </button>
      </div>
    </header>

    <p v-if="formError || radio.error.value || podcast.error.value" class="page-error" role="alert">
      {{ formError || radio.error.value || podcast.error.value }}
    </p>

    <section v-if="tab === 'radio'" class="panel">
      <div class="form-card">
        <h2>添加电台</h2>
        <label>
          名称
          <input v-model="stationName" type="text" placeholder="例如：BBC Radio 1" maxlength="120" />
        </label>
        <label>
          流地址
          <input
            v-model="stationUrl"
            type="url"
            placeholder="https://… 或 http://…"
            maxlength="2048"
          />
        </label>
        <label class="checkbox">
          <input v-model="allowHttp" type="checkbox" />
          允许 HTTP 明文流（仅用户显式确认时使用）
        </label>
        <div class="form-actions">
          <button type="button" class="primary" :disabled="formBusy" @click="addStation">添加</button>
        </div>
        <label>
          导入 M3U / PLS
          <textarea
            v-model="playlistText"
            rows="4"
            placeholder="#EXTM3U&#10;#EXTINF:-1,Station&#10;https://example/stream"
          ></textarea>
        </label>
        <button type="button" :disabled="formBusy || !playlistText.trim()" @click="importPlaylist">
          导入列表
        </button>
        <h2>目录搜索（radio-browser.info）</h2>
        <label>
          关键词
          <input
            v-model="directoryQuery"
            type="search"
            placeholder="例如：jazz / 古典 / BBC"
            maxlength="120"
            @keydown.enter.prevent="searchDirectory"
          />
        </label>
        <div class="form-actions">
          <button
            type="button"
            class="primary"
            :disabled="directoryBusy || !directoryQuery.trim()"
            @click="searchDirectory"
          >
            {{ directoryBusy ? '搜索中…' : '搜索目录' }}
          </button>
        </div>
        <ul v-if="directoryResults.length > 0" class="directory-results">
          <li v-for="row in directoryResults" :key="row.stationuuid">
            <div>
              <strong>{{ row.name }}</strong>
              <small>
                <span v-if="row.countryCode">{{ row.countryCode }}</span>
                <span v-if="row.bitrate">{{ row.bitrate }} kbps</span>
                <span v-if="row.codec">{{ row.codec }}</span>
                <span v-if="row.tags?.length">{{ row.tags.slice(0, 3).join(', ') }}</span>
              </small>
            </div>
            <button type="button" :disabled="formBusy" @click="addDirectoryStation(row)">添加</button>
          </li>
        </ul>
      </div>

      <div class="station-grid">
        <article v-for="station in radio.stations.value" :key="station.id" class="station-card">
          <div class="station-main">
            <strong>{{ station.name }}</strong>
            <small>{{ station.streamUrl }}</small>
            <span v-if="station.allowInsecureHttp" class="badge http">HTTP</span>
          </div>
          <div class="station-actions">
            <button type="button" class="primary" @click="playStation(station.id)">播放</button>
            <button type="button" @click="removeStation(station.id)">删除</button>
          </div>
        </article>
        <p v-if="radio.stations.value.length === 0" class="empty">还没有收藏的电台</p>
      </div>
    </section>

    <section v-else class="panel podcast-panel">
      <div class="form-card">
        <h2>订阅播客</h2>
        <label>
          RSS / Atom 地址
          <input v-model="feedUrl" type="url" placeholder="https://example.com/feed.xml" />
        </label>
        <div class="form-actions">
          <button type="button" class="primary" :disabled="formBusy || podcast.busy.value" @click="subscribeFeed">
            订阅
          </button>
          <button type="button" :disabled="podcast.busy.value" @click="podcast.refreshAll()">
            刷新全部
          </button>
        </div>
      </div>

      <div class="podcast-layout">
        <ul class="subscription-list">
          <li
            v-for="sub in podcast.subscriptions.value"
            :key="sub.id"
            :class="{ active: selectedPodcastId === sub.id }"
            @click="selectedPodcastId = sub.id"
          >
            <strong>{{ sub.title }}</strong>
            <small>{{ sub.episodes.length }} 集</small>
            <button
              type="button"
              class="linkish"
              @click.stop="podcast.unsubscribe(sub.id); if (selectedPodcastId === sub.id) selectedPodcastId = null"
            >
              取消订阅
            </button>
          </li>
          <li v-if="podcast.subscriptions.value.length === 0" class="empty">还没有订阅</li>
        </ul>

        <div v-if="selectedPodcast" class="episode-panel">
          <div class="episode-header">
            <div>
              <h2>{{ selectedPodcast.title }}</h2>
              <p v-if="selectedPodcast.author">{{ selectedPodcast.author }}</p>
              <p v-if="selectedPodcast.lastError" class="page-error">{{ selectedPodcast.lastError }}</p>
            </div>
            <button type="button" :disabled="podcast.busy.value" @click="refreshSelected">刷新</button>
          </div>
          <ul class="episode-list">
            <li v-for="episode in selectedPodcast.episodes" :key="episode.guid">
              <div>
                <strong>{{ episode.title }}</strong>
                <small>
                  {{ formatDuration(episode.durationSeconds) }}
                  <span v-if="progressLabel(episode)" class="badge progress">{{
                    progressLabel(episode)
                  }}</span>
                  <span
                    v-if="episodePinStatus(selectedPodcast.id, episode.guid)"
                    class="badge pin"
                    >{{ episodePinStatus(selectedPodcast.id, episode.guid) }}</span
                  >
                </small>
              </div>
              <div class="episode-actions">
                <button
                  type="button"
                  class="primary"
                  @click="playEpisode(selectedPodcast, episode.guid)"
                >
                  播放
                </button>
                <button
                  type="button"
                  :disabled="
                    pinBusyGuid === episode.guid ||
                    episodePinStatus(selectedPodcast.id, episode.guid) === 'completed' ||
                    episodePinStatus(selectedPodcast.id, episode.guid) === 'downloading' ||
                    episodePinStatus(selectedPodcast.id, episode.guid) === 'queued'
                  "
                  :title="'固定供离线播放'"
                  @click="pinEpisode(selectedPodcast, episode.guid)"
                >
                  {{
                    pinBusyGuid === episode.guid
                      ? '固定中…'
                      : episodePinStatus(selectedPodcast.id, episode.guid) === 'completed'
                        ? '已离线'
                        : '离线'
                  }}
                </button>
              </div>
            </li>
            <li v-if="selectedPodcast.episodes.length === 0" class="empty">暂无剧集，请刷新订阅</li>
          </ul>
          <p class="hint">离线固定会下载当前剧集音频到本机缓存；电台直播流不支持固定。</p>
        </div>
        <p v-else class="empty episode-panel">选择左侧订阅以查看剧集</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.radio-podcast-page {
  padding: 24px 28px 96px;
  max-width: 1100px;
  margin: 0 auto;
  color: var(--te-text, #0f172a);
}
.page-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 18px;
  margin-bottom: 18px;
}
.page-header h1 {
  margin: 0;
  font-size: 1.4rem;
  flex: 1;
}
.back-btn,
.tabs button,
.form-card button,
.station-actions button,
.episode-header button,
.episode-list button,
.subscription-list .linkish {
  border: 1px solid rgba(15, 23, 42, 0.12);
  background: rgba(255, 255, 255, 0.72);
  border-radius: 10px;
  padding: 8px 12px;
  cursor: pointer;
}
.episode-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.badge.pin {
  margin-left: 6px;
  text-transform: lowercase;
  opacity: 0.85;
}
.directory-results {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
  max-height: 280px;
  overflow: auto;
}
.directory-results li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.45);
}
.directory-results small {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  opacity: 0.75;
  margin-top: 4px;
}
.tabs {
  display: flex;
  gap: 8px;
}
.tabs button.active,
button.primary {
  background: #2563eb;
  color: #fff;
  border-color: transparent;
}
.page-error {
  color: #b91c1c;
  margin: 0 0 12px;
}
.panel {
  display: grid;
  gap: 18px;
}
.form-card {
  display: grid;
  gap: 10px;
  padding: 16px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(15, 23, 42, 0.06);
}
.form-card h2 {
  margin: 0;
  font-size: 1rem;
}
.form-card label {
  display: grid;
  gap: 6px;
  font-size: 0.85rem;
}
.form-card label.checkbox {
  grid-template-columns: auto 1fr;
  align-items: center;
}
.form-card input[type='text'],
.form-card input[type='url'],
.form-card textarea {
  width: 100%;
  border-radius: 10px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.9);
}
.form-actions {
  display: flex;
  gap: 8px;
}
.station-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.station-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(15, 23, 42, 0.06);
  min-height: 120px;
}
.station-main {
  display: grid;
  gap: 4px;
}
.station-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.7;
}
.station-actions {
  display: flex;
  gap: 8px;
}
.badge {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 0.72rem;
  background: rgba(37, 99, 235, 0.12);
  color: #1d4ed8;
}
.badge.http {
  background: rgba(245, 158, 11, 0.18);
  color: #b45309;
}
.badge.progress {
  margin-left: 6px;
}
.podcast-layout {
  display: grid;
  grid-template-columns: minmax(200px, 280px) 1fr;
  gap: 14px;
  min-height: 360px;
}
.subscription-list,
.episode-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
  align-content: start;
}
.subscription-list li,
.episode-list li {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(15, 23, 42, 0.06);
  cursor: pointer;
}
.subscription-list li.active {
  border-color: rgba(37, 99, 235, 0.45);
  box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.2);
}
.subscription-list .linkish {
  font-size: 0.75rem;
  padding: 4px 8px;
}
.episode-panel {
  padding: 12px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.45);
  border: 1px solid rgba(15, 23, 42, 0.06);
}
.episode-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.episode-header h2 {
  margin: 0 0 4px;
  font-size: 1.05rem;
}
.episode-header p {
  margin: 0;
  opacity: 0.7;
  font-size: 0.85rem;
}
.empty {
  opacity: 0.65;
  padding: 18px;
}
.hint {
  margin: 12px 0 0;
  font-size: 0.8rem;
  opacity: 0.65;
}
:global(html[data-theme='dark'] .radio-podcast-page) {
  color: #e2e8f0;
}
:global(html[data-theme='dark'] .form-card),
:global(html[data-theme='dark'] .station-card),
:global(html[data-theme='dark'] .subscription-list li),
:global(html[data-theme='dark'] .episode-list li),
:global(html[data-theme='dark'] .episode-panel) {
  background: rgba(15, 23, 42, 0.55);
  border-color: rgba(148, 163, 184, 0.12);
}
:global(html[data-theme='dark'] .back-btn),
:global(html[data-theme='dark'] .tabs button),
:global(html[data-theme='dark'] .form-card button),
:global(html[data-theme='dark'] .station-actions button),
:global(html[data-theme='dark'] .episode-header button),
:global(html[data-theme='dark'] .episode-list button),
:global(html[data-theme='dark'] .subscription-list .linkish) {
  background: rgba(30, 41, 59, 0.9);
  color: #e2e8f0;
  border-color: rgba(148, 163, 184, 0.18);
}
:global(html[data-theme='dark'] .tabs button.active),
:global(html[data-theme='dark'] button.primary) {
  background: #3b82f6;
  color: #fff;
}
@media (max-width: 840px) {
  .podcast-layout {
    grid-template-columns: 1fr;
  }
}
</style>
