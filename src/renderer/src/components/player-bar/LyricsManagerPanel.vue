<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { usePlaybackQueueStore } from '../../stores/usePlaybackQueueStore'
import { useLyricsManagement } from '../../stores/lyricsManagement'
import type { LyricSourcePreference } from '../../../../shared/lyricsManagement.ts'

const playbackStore = usePlaybackQueueStore()
const { currentTrack } = storeToRefs(playbackStore)
const { refreshCurrentLyrics } = playbackStore
const lyricsManagement = useLyricsManagement()

const lyricVisibility = computed(() => lyricsManagement.document.value)

const lyricSaving = ref(false)
const lyricImporting = ref(false)
const lyricWriting = ref(false)
const lyricSearching = ref(false)
const lyricManagerError = ref('')
const lyricManagerNotice = ref('')
const draftTrackOffsetMs = ref(0)
const draftSource = ref<LyricSourcePreference>('auto')
const draftOriginal = ref('')
const draftTranslation = ref('')
const draftRomanization = ref('')

type OnlineLyricsCandidateUi = {
  id: number | string
  title: string
  artist: string
  album: string
  durationSeconds: number | null
  score: number
  syncedLyrics: string | null
  plainLyrics: string | null
  source: string
}
const onlineLyricCandidates = ref<OnlineLyricsCandidateUi[]>([])

function seedDraftFromTrack(): void {
  const track = currentTrack.value
  if (!track) {
    draftTrackOffsetMs.value = 0
    draftSource.value = 'auto'
    draftOriginal.value = ''
    draftTranslation.value = ''
    draftRomanization.value = ''
    return
  }
  const override = lyricsManagement.entryFor(track.id)
  draftTrackOffsetMs.value = override?.offsetMs ?? 0
  draftSource.value = override?.source ?? 'auto'
  draftOriginal.value = override?.original ?? track.lyrics ?? ''
  draftTranslation.value = override?.translation ?? track.translatedLyrics ?? ''
  draftRomanization.value = override?.romanization ?? track.romanizedLyrics ?? ''
  lyricManagerError.value = ''
  lyricManagerNotice.value = ''
  onlineLyricCandidates.value = []
}

watch(
  () => currentTrack.value?.id,
  () => {
    seedDraftFromTrack()
  },
  { immediate: true }
)

async function saveLyricManager(): Promise<void> {
  const track = currentTrack.value
  if (!track || lyricSaving.value) return
  lyricSaving.value = true
  lyricManagerError.value = ''
  lyricManagerNotice.value = ''
  try {
    await lyricsManagement.updateTrack(track.id, {
      offsetMs: Number(draftTrackOffsetMs.value),
      source: draftSource.value,
      original: draftOriginal.value.trim() || null,
      translation: draftTranslation.value.trim() || null,
      romanization: draftRomanization.value.trim() || null
    })
    if (draftSource.value !== 'manual') {
      await refreshCurrentLyrics()
    }
    lyricManagerNotice.value = '歌词已保存'
  } catch (error) {
    lyricManagerError.value = error instanceof Error ? error.message : String(error)
  } finally {
    lyricSaving.value = false
  }
}

async function importLyricsIntoDraft(): Promise<void> {
  if (lyricImporting.value) return
  lyricImporting.value = true
  lyricManagerError.value = ''
  lyricManagerNotice.value = ''
  try {
    const contents = await window.api.data.importLyrics()
    if (contents != null) {
      draftOriginal.value = contents
      draftSource.value = 'manual'
    }
  } catch (error) {
    lyricManagerError.value = error instanceof Error ? error.message : String(error)
  } finally {
    lyricImporting.value = false
  }
}

async function saveDraftAsLrc(): Promise<void> {
  if (lyricWriting.value) return
  lyricWriting.value = true
  lyricManagerError.value = ''
  lyricManagerNotice.value = ''
  try {
    const path = await window.api.data.saveLyrics(draftOriginal.value)
    if (path) lyricManagerNotice.value = `Saved LRC: ${path}`
  } catch (error) {
    lyricManagerError.value = error instanceof Error ? error.message : String(error)
  } finally {
    lyricWriting.value = false
  }
}

function formatDurationDelta(candidateDuration: number | null): string {
  const trackDuration = currentTrack.value?.duration
  if (
    candidateDuration == null ||
    typeof trackDuration !== 'number' ||
    !Number.isFinite(trackDuration)
  ) {
    return '—'
  }
  const delta = Math.round(candidateDuration - trackDuration)
  if (delta === 0) return '±0s'
  return delta > 0 ? `+${delta}s` : `${delta}s`
}

function applyOnlineCandidate(candidate: OnlineLyricsCandidateUi): void {
  const text = candidate.syncedLyrics ?? candidate.plainLyrics ?? null
  if (!text) {
    lyricManagerNotice.value = '该候选没有可用歌词正文'
    return
  }
  draftOriginal.value = text
  draftSource.value = 'manual'
  lyricManagerNotice.value = `已填入在线歌词：${candidate.title} - ${candidate.artist}`
}

async function searchOnlineIntoDraft(): Promise<void> {
  const track = currentTrack.value
  if (!track || lyricSearching.value) return
  lyricSearching.value = true
  lyricManagerError.value = ''
  lyricManagerNotice.value = ''
  onlineLyricCandidates.value = []
  try {
    const result = await window.api.data.searchOnlineLyrics({
      title: track.title,
      artist: track.artist,
      album: track.album || undefined,
      durationSeconds:
        typeof track.duration === 'number' && Number.isFinite(track.duration)
          ? track.duration
          : undefined
    })
    const candidates = Array.isArray(result.candidates) ? result.candidates : []
    onlineLyricCandidates.value = candidates.slice(0, 12)
    if (candidates.length === 0) {
      lyricManagerNotice.value = '未找到匹配的在线歌词'
      return
    }
    lyricManagerNotice.value = `找到 ${candidates.length} 条候选，点击选用`
  } catch (error) {
    lyricManagerError.value = error instanceof Error ? error.message : String(error)
  } finally {
    lyricSearching.value = false
  }
}

async function updateGlobalLyricOffset(event: Event): Promise<void> {
  const value = Number((event.target as HTMLInputElement).value)
  lyricManagerError.value = ''
  try {
    await lyricsManagement.updateGlobalOffset(value)
  } catch (error) {
    lyricManagerError.value = error instanceof Error ? error.message : String(error)
  }
}

async function toggleLyricVisibility(
  key: 'showOriginal' | 'showTranslation' | 'showRomanization'
): Promise<void> {
  lyricManagerError.value = ''
  try {
    await lyricsManagement.updateVisibility({ [key]: !lyricVisibility.value[key] })
  } catch (error) {
    lyricManagerError.value = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template>
  <section class="lyric-manager lyric-manager--panel" aria-label="Lyrics management">
    <div class="lyric-manager-heading">
      <h2>歌词管理</h2>
      <span class="lyric-manager-heading-hint">{{
        currentTrack ? `${currentTrack.title} · ${currentTrack.artist}` : '当前无曲目'
      }}</span>
    </div>
    <div class="lyric-manager-row">
      <label
        >Global offset (ms)<input
          type="number"
          min="-120000"
          max="120000"
          step="50"
          :value="lyricVisibility.globalOffsetMs"
          :disabled="!currentTrack"
          @change="updateGlobalLyricOffset"
      /></label>
      <label
        >Track offset (ms)<input
          v-model.number="draftTrackOffsetMs"
          type="number"
          min="-120000"
          max="120000"
          step="50"
          :disabled="!currentTrack"
      /></label>
      <label
        >Source<select v-model="draftSource" :disabled="!currentTrack">
          <option value="auto">Auto</option>
          <option value="local">Local LRC</option>
          <option value="provider">Provider</option>
          <option value="manual">Manual</option>
        </select></label
      >
    </div>
    <div class="lyric-manager-row lyric-manager-toggles">
      <button
        type="button"
        :aria-pressed="lyricVisibility.showOriginal"
        :disabled="!currentTrack"
        @click="toggleLyricVisibility('showOriginal')"
      >
        Original
      </button>
      <button
        type="button"
        :aria-pressed="lyricVisibility.showTranslation"
        :disabled="!currentTrack"
        @click="toggleLyricVisibility('showTranslation')"
      >
        Translation
      </button>
      <button
        type="button"
        :aria-pressed="lyricVisibility.showRomanization"
        :disabled="!currentTrack"
        @click="toggleLyricVisibility('showRomanization')"
      >
        Romanization
      </button>
      <button type="button" :disabled="!currentTrack || lyricImporting" @click="importLyricsIntoDraft">
        {{ lyricImporting ? 'Importing...' : 'Import LRC' }}
      </button>
      <button type="button" :disabled="!currentTrack || lyricSearching" @click="searchOnlineIntoDraft">
        {{ lyricSearching ? 'Searching...' : 'Search online' }}
      </button>
    </div>
    <div v-if="onlineLyricCandidates.length" class="online-lyric-candidates">
      <div class="online-lyric-candidates__title">在线候选</div>
      <button
        v-for="candidate in onlineLyricCandidates"
        :key="`${candidate.source}-${candidate.id}`"
        type="button"
        class="online-lyric-candidate"
        @click="applyOnlineCandidate(candidate)"
      >
        <div class="online-lyric-candidate__meta">
          <strong>{{ candidate.title }}</strong>
          <span>{{ candidate.artist }}</span>
          <span v-if="candidate.album">{{ candidate.album }}</span>
        </div>
        <div class="online-lyric-candidate__stats">
          <span>{{ candidate.source }}</span>
          <span>score {{ candidate.score.toFixed(2) }}</span>
          <span>时长差 {{ formatDurationDelta(candidate.durationSeconds) }}</span>
          <span>{{ candidate.syncedLyrics ? 'LRC' : '纯文本' }}</span>
        </div>
        <p class="online-lyric-candidate__preview">
          {{
            (candidate.syncedLyrics || candidate.plainLyrics || '')
              .split('\n')
              .slice(0, 2)
              .join(' / ')
              .slice(0, 120)
          }}
        </p>
      </button>
    </div>
    <label class="lyric-editor-label"
      >Original<textarea
        v-model="draftOriginal"
        rows="4"
        spellcheck="false"
        :disabled="!currentTrack"
      ></textarea>
    </label>
    <label class="lyric-editor-label"
      >Translation<textarea
        v-model="draftTranslation"
        rows="3"
        spellcheck="false"
        :disabled="!currentTrack"
      ></textarea>
    </label>
    <label class="lyric-editor-label"
      >Romanization<textarea
        v-model="draftRomanization"
        rows="3"
        spellcheck="false"
        :disabled="!currentTrack"
      ></textarea>
    </label>
    <p v-if="lyricManagerError" class="lyric-manager-error">{{ lyricManagerError }}</p>
    <p v-if="lyricManagerNotice" class="lyric-manager-notice">{{ lyricManagerNotice }}</p>
    <div class="lyric-manager-actions">
      <button type="button" :disabled="!currentTrack || lyricWriting" @click="saveDraftAsLrc">
        {{ lyricWriting ? 'Writing LRC...' : 'Save LRC' }}
      </button>
      <button type="button" :disabled="!currentTrack || lyricSaving" @click="saveLyricManager">
        {{ lyricSaving ? 'Saving...' : 'Save lyrics' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.lyric-manager {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 12px;
  background: rgba(5, 9, 16, 0.35);
}

.lyric-manager--panel {
  width: 100%;
}

.lyric-manager-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.lyric-manager-heading h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.lyric-manager-heading-hint {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
}

.lyric-manager-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.lyric-manager label,
.lyric-editor-label {
  display: grid;
  gap: 4px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
}

.lyric-manager input,
.lyric-manager select,
.lyric-manager textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 100px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.24);
  color: #fff;
  font: inherit;
}

.lyric-manager textarea {
  min-height: 58px;
  padding: 6px;
  resize: vertical;
}

.lyric-manager button {
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.18);
  color: rgba(255, 255, 255, 0.82);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.lyric-manager button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.lyric-manager-toggles button,
.lyric-manager-actions button {
  padding: 6px 9px;
}

.lyric-manager-toggles button[aria-pressed='true'] {
  border-color: color-mix(in srgb, var(--te-primary-500, #6366f1) 70%, white);
  background: color-mix(in srgb, var(--te-primary-500, #6366f1) 32%, transparent);
}

.lyric-manager-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.lyric-manager-error {
  margin: 0;
  color: #ffb4ab;
  font-size: 12px;
}

.lyric-manager-notice {
  margin: 0;
  color: #b9e9c2;
  font-size: 12px;
}

.online-lyric-candidates {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 180px;
  overflow: auto;
  margin: 4px 0 8px;
  padding: 8px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.18);
}

.online-lyric-candidates__title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.55);
}

.online-lyric-candidate {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  padding: 8px 10px;
  cursor: pointer;
}

.online-lyric-candidate:hover {
  border-color: color-mix(in srgb, var(--te-primary-500, #6366f1) 45%, transparent);
}

.online-lyric-candidate__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  font-size: 12px;
}

.online-lyric-candidate__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}

.online-lyric-candidate__preview {
  margin: 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
