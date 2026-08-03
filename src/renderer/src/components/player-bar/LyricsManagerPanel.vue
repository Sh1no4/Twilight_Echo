<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { usePlayerStore } from '../../stores/usePlayerStore'
import { useLyricsManagement } from '../../stores/lyricsManagement'
import { useSettingsStore } from '../../stores/useSettingsStore'
import type {
  LyricLayerSourceSelection,
  LyricSourcePreference,
  LyricTrackOverride
} from '../../../../shared/lyricsManagement.ts'
import type { LyricSource } from '../../types/music'
import {
  syncLegacyLyricsAppearance,
  type LyricsAppearanceSettings
} from '../../../../shared/lyricsAppearance.ts'

type LayerKey = 'original' | 'translation' | 'romanization'
type LayerSelectionKey = 'originalSelection' | 'translationSelection' | 'romanizationSelection'

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

type LyricDraft = {
  source: LyricSourcePreference
  originalSelection: LyricLayerSourceSelection
  translationSelection: LyricLayerSourceSelection
  romanizationSelection: LyricLayerSourceSelection
  offsetMs: number
  original: string
  translation: string
  romanization: string
}

const playbackStore = usePlayerStore()
const { currentTrack, lyricsLoadState } = playbackStore
const { refreshCurrentLyrics } = playbackStore
const lyricsManagement = useLyricsManagement()
const { settings, updateSettings } = useSettingsStore()
const lyricFocusLineCounts = [
  { value: 'all', label: '全部' },
  { value: 1, label: '1 行' },
  { value: 3, label: '3 行' },
  { value: 5, label: '5 行' }
] as const

const lyricSaving = ref(false)
const lyricImporting = ref(false)
const lyricWriting = ref(false)
const lyricSearching = ref(false)
const lyricManagerError = ref('')
const lyricManagerNotice = ref('')
const draftTrackOffsetMs = ref(0)
const draftSource = ref<LyricSourcePreference>('auto')
const draftOriginalSelection = ref<LyricLayerSourceSelection>('automatic')
const draftTranslationSelection = ref<LyricLayerSourceSelection>('automatic')
const draftRomanizationSelection = ref<LyricLayerSourceSelection>('automatic')
const draftOriginal = ref('')
const draftTranslation = ref('')
const draftRomanization = ref('')
const seededDraft = ref<LyricDraft | null>(null)
const seededTrackId = ref('')
const seededTrackTitle = ref('')
const onlineLyricCandidates = ref<OnlineLyricsCandidateUi[]>([])
const onlineCandidateTrackId = ref('')

const lyricVisibility = computed(() => lyricsManagement.document.value)
const activeTrackId = computed(() => currentTrack.value?.id ?? '')
const activeOverrideUpdatedAt = computed(
  () => lyricsManagement.entryFor(activeTrackId.value)?.updatedAt ?? ''
)
const isResolving = computed(
  () =>
    lyricsLoadState.value.trackId === activeTrackId.value &&
    lyricsLoadState.value.status === 'loading'
)
const draftDirty = computed(() => {
  const seeded = seededDraft.value
  if (seeded === null) return false
  return (
    seeded.source !== draftSource.value ||
    seeded.originalSelection !== draftOriginalSelection.value ||
    seeded.translationSelection !== draftTranslationSelection.value ||
    seeded.romanizationSelection !== draftRomanizationSelection.value ||
    seeded.offsetMs !== draftTrackOffsetMs.value ||
    seeded.original !== draftOriginal.value ||
    seeded.translation !== draftTranslation.value ||
    seeded.romanization !== draftRomanization.value
  )
})
// The reseed watch skips while the draft is dirty, so after an auto-advance the draft may
// still belong to the previous track — saving then would persist it under the wrong track id.
const draftTrackMismatch = computed(
  () =>
    draftDirty.value && seededTrackId.value !== '' && seededTrackId.value !== activeTrackId.value
)
const requiresResolver = computed(
  () =>
    draftOriginalSelection.value !== 'manual' ||
    draftTranslationSelection.value !== 'manual' ||
    draftRomanizationSelection.value !== 'manual'
)
const originalAutomaticSource = computed(() => lyricSourceLabel(currentTrack.value?.lyricsSource))
const translationAutomaticSource = computed(() =>
  lyricSourceLabel(currentTrack.value?.translatedLyricsSource)
)
const romanizationAutomaticSource = computed(() =>
  lyricSourceLabel(currentTrack.value?.romanizedLyricsSource)
)

function lyricSourceLabel(source: LyricSource | null | undefined): string {
  if (source === 'embedded') return '内嵌'
  if (source === 'local') return '本地 LRC'
  if (source === 'provider') return 'Provider'
  if (source === 'online') return '在线匹配'
  if (source === 'manual') return '手写'
  return '未加载'
}

function layerSelection(
  override: LyricTrackOverride | undefined,
  key: LayerSelectionKey
): LyricLayerSourceSelection {
  const value = override?.[key]
  if (value === 'automatic' || value === 'local' || value === 'provider' || value === 'manual') {
    return value
  }
  return override?.source === 'manual' ? 'manual' : 'automatic'
}

function currentDraft(): LyricDraft {
  return {
    source: draftSource.value,
    originalSelection: draftOriginalSelection.value,
    translationSelection: draftTranslationSelection.value,
    romanizationSelection: draftRomanizationSelection.value,
    offsetMs: draftTrackOffsetMs.value,
    original: draftOriginal.value,
    translation: draftTranslation.value,
    romanization: draftRomanization.value
  }
}

function seedDraftFromTrack(): void {
  const track = currentTrack.value
  if (!track) {
    draftTrackOffsetMs.value = 0
    draftSource.value = 'auto'
    draftOriginalSelection.value = 'automatic'
    draftTranslationSelection.value = 'automatic'
    draftRomanizationSelection.value = 'automatic'
    draftOriginal.value = ''
    draftTranslation.value = ''
    draftRomanization.value = ''
    seededDraft.value = null
    seededTrackId.value = ''
    seededTrackTitle.value = ''
    onlineLyricCandidates.value = []
    onlineCandidateTrackId.value = ''
    return
  }

  const override = lyricsManagement.entryFor(track.id)
  draftTrackOffsetMs.value = override?.offsetMs ?? 0
  draftSource.value = override?.source ?? 'auto'
  draftOriginalSelection.value = layerSelection(override, 'originalSelection')
  draftTranslationSelection.value = layerSelection(override, 'translationSelection')
  draftRomanizationSelection.value = layerSelection(override, 'romanizationSelection')
  draftOriginal.value = override?.original ?? track.lyrics ?? ''
  draftTranslation.value = override?.translation ?? track.translatedLyrics ?? ''
  draftRomanization.value = override?.romanization ?? track.romanizedLyrics ?? ''
  seededDraft.value = currentDraft()
  seededTrackId.value = track.id
  seededTrackTitle.value = track.title
  lyricManagerError.value = ''
  lyricManagerNotice.value = ''
  onlineLyricCandidates.value = []
  onlineCandidateTrackId.value = ''
}

watch(
  [activeTrackId, activeOverrideUpdatedAt],
  () => {
    if (!draftDirty.value) seedDraftFromTrack()
  },
  { immediate: true }
)

function useManualLayer(layer: LayerKey): void {
  if (layer === 'original') draftOriginalSelection.value = 'manual'
  if (layer === 'translation') draftTranslationSelection.value = 'manual'
  if (layer === 'romanization') draftRomanizationSelection.value = 'manual'
  lyricManagerNotice.value = ''
}

function automaticLayerLabel(selection: LyricLayerSourceSelection, source: string): string {
  if (selection === 'local') return '本地 LRC'
  if (selection === 'provider') return 'Provider'
  if (selection === 'manual') return '手写内容'
  return `自动 · ${source}`
}

function persistedSource(): LyricSourcePreference {
  if (
    draftOriginalSelection.value === 'manual' &&
    draftTranslationSelection.value === 'manual' &&
    draftRomanizationSelection.value === 'manual'
  ) {
    return 'manual'
  }
  return draftSource.value === 'manual' ? 'auto' : draftSource.value
}

async function saveLyricManager(): Promise<void> {
  const track = currentTrack.value
  if (!track || lyricSaving.value) return
  if (draftTrackMismatch.value) {
    lyricManagerError.value = `草稿来自「${seededTrackTitle.value}」，当前曲目已切换。请撤销草稿，或切回原曲目后再保存。`
    return
  }
  const trackId = track.id
  const needsResolver = requiresResolver.value
  lyricSaving.value = true
  lyricManagerError.value = ''
  lyricManagerNotice.value = ''
  try {
    await lyricsManagement.updateTrack(trackId, {
      offsetMs: Number(draftTrackOffsetMs.value),
      source: persistedSource(),
      originalSelection: draftOriginalSelection.value,
      translationSelection: draftTranslationSelection.value,
      romanizationSelection: draftRomanizationSelection.value,
      original: draftOriginal.value.trim() || null,
      translation: draftTranslation.value.trim() || null,
      romanization: draftRomanization.value.trim() || null
    })
    if (currentTrack.value?.id !== trackId) return
    if (needsResolver) await refreshCurrentLyrics()
    if (currentTrack.value?.id !== trackId) return
    seededDraft.value = currentDraft()
    lyricManagerNotice.value = '歌词组合已保存'
  } catch (error) {
    lyricManagerError.value = error instanceof Error ? error.message : String(error)
  } finally {
    lyricSaving.value = false
  }
}

function discardDraft(): void {
  seedDraftFromTrack()
}

async function restoreAutomaticLyrics(): Promise<void> {
  const track = currentTrack.value
  if (!track || lyricSaving.value) return
  const trackId = track.id
  lyricSaving.value = true
  lyricManagerError.value = ''
  lyricManagerNotice.value = ''
  try {
    await lyricsManagement.updateTrack(trackId, {
      source: 'auto',
      originalSelection: 'automatic',
      translationSelection: 'automatic',
      romanizationSelection: 'automatic',
      original: null,
      translation: null,
      romanization: null
    })
    if (currentTrack.value?.id !== trackId) return
    await refreshCurrentLyrics()
    if (currentTrack.value?.id !== trackId) return
    seedDraftFromTrack()
    lyricManagerNotice.value = '已恢复自动歌词'
  } catch (error) {
    lyricManagerError.value = error instanceof Error ? error.message : String(error)
  } finally {
    lyricSaving.value = false
  }
}

async function importLyricsIntoDraft(): Promise<void> {
  const trackId = activeTrackId.value
  if (!trackId || lyricImporting.value) return
  lyricImporting.value = true
  lyricManagerError.value = ''
  lyricManagerNotice.value = ''
  try {
    const contents = await window.api.data.importLyrics()
    if (currentTrack.value?.id !== trackId || contents == null) return
    draftOriginal.value = contents
    draftOriginalSelection.value = 'manual'
    draftSource.value = 'manual'
    lyricManagerNotice.value = '已导入到原文草稿'
  } catch (error) {
    lyricManagerError.value = error instanceof Error ? error.message : String(error)
  } finally {
    lyricImporting.value = false
  }
}

async function saveDraftAsLrc(): Promise<void> {
  if (!activeTrackId.value || lyricWriting.value) return
  lyricWriting.value = true
  lyricManagerError.value = ''
  lyricManagerNotice.value = ''
  try {
    const path = await window.api.data.saveLyrics(draftOriginal.value)
    if (path) lyricManagerNotice.value = `已导出：${path}`
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
    return '--'
  }
  const delta = Math.round(candidateDuration - trackDuration)
  if (delta === 0) return '0s'
  return delta > 0 ? `+${delta}s` : `${delta}s`
}

function applyOnlineCandidate(candidate: OnlineLyricsCandidateUi): void {
  if (onlineCandidateTrackId.value !== activeTrackId.value) return
  const text = candidate.syncedLyrics ?? candidate.plainLyrics ?? null
  if (!text) {
    lyricManagerNotice.value = '该候选没有可用歌词正文'
    return
  }
  draftOriginal.value = text
  draftOriginalSelection.value = 'manual'
  draftSource.value = 'manual'
  lyricManagerNotice.value = `已填入：${candidate.title} - ${candidate.artist}`
}

async function searchOnlineIntoDraft(): Promise<void> {
  const track = currentTrack.value
  if (!track || lyricSearching.value) return
  const trackId = track.id
  lyricSearching.value = true
  lyricManagerError.value = ''
  lyricManagerNotice.value = ''
  onlineLyricCandidates.value = []
  onlineCandidateTrackId.value = ''
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
    if (currentTrack.value?.id !== trackId) return
    const candidates = Array.isArray(result.candidates) ? result.candidates : []
    onlineLyricCandidates.value = candidates.slice(0, 12)
    onlineCandidateTrackId.value = trackId
    lyricManagerNotice.value =
      candidates.length === 0 ? '未找到匹配歌词' : `找到 ${candidates.length} 条候选`
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

function updateLyricsAppearance<K extends keyof LyricsAppearanceSettings>(
  key: K,
  value: LyricsAppearanceSettings[K]
): void {
  const legacyKeys = new Set<keyof LyricsAppearanceSettings>([
    'fontFamily',
    'fontSize',
    'fontWeight',
    'lineHeight',
    'align',
    'colorMode',
    'textColor',
    'activeColor',
    'karaokeColor'
  ])
  const lyricsAppearance = legacyKeys.has(key)
    ? syncLegacyLyricsAppearance(settings.value.lyricsAppearance, {
        [key]: value
      } as Partial<LyricsAppearanceSettings>)
    : { ...settings.value.lyricsAppearance, [key]: value }
  void updateSettings({ lyricsAppearance })
}
</script>

<template>
  <section class="lyric-manager lyric-manager--panel" aria-label="歌词工作台">
    <header class="lyric-manager-heading">
      <div>
        <h2>歌词管理</h2>
        <p>
          {{ currentTrack ? `${currentTrack.title} · ${currentTrack.artist}` : '当前没有播放歌曲' }}
        </p>
      </div>
      <span class="lyric-status" :class="{ pending: isResolving }">
        {{
          isResolving
            ? '解析中'
            : draftTrackMismatch
              ? '草稿属其他曲目'
              : draftDirty
                ? '未保存'
                : '已同步'
        }}
      </span>
    </header>

    <section class="lyric-style-controls" aria-label="歌词样式">
      <div class="lyric-style-heading">
        <strong>歌词样式</strong>
        <span>主播放页快捷设置</span>
      </div>
      <div class="lyric-style-grid">
        <label class="lyric-range-field">
          <span
            >字号 <strong>{{ settings.lyricsAppearance.fontSize }}px</strong></span
          >
          <input
            type="range"
            min="14"
            max="32"
            step="1"
            :value="settings.lyricsAppearance.fontSize"
            @change="
              updateLyricsAppearance('fontSize', Number(($event.target as HTMLInputElement).value))
            "
          />
        </label>
        <label class="lyric-range-field">
          <span
            >行距 <strong>{{ settings.lyricsAppearance.lineHeight.toFixed(2) }}</strong></span
          >
          <input
            type="range"
            min="1.2"
            max="2.6"
            step="0.05"
            :value="settings.lyricsAppearance.lineHeight"
            @change="
              updateLyricsAppearance(
                'lineHeight',
                Number(($event.target as HTMLInputElement).value)
              )
            "
          />
        </label>
        <label class="lyric-range-field">
          <span
            >未播放暗度 <strong>{{ settings.lyricsAppearance.inactiveOpacity }}%</strong></span
          >
          <input
            type="range"
            min="10"
            max="100"
            step="5"
            :value="settings.lyricsAppearance.inactiveOpacity"
            @change="
              updateLyricsAppearance(
                'inactiveOpacity',
                Number(($event.target as HTMLInputElement).value)
              )
            "
          />
        </label>
        <label class="lyric-field lyric-weight-field">
          <span>字重</span>
          <select
            :value="settings.lyricsAppearance.fontWeight"
            aria-label="歌词字重"
            @change="
              updateLyricsAppearance(
                'fontWeight',
                Number(($event.target as HTMLSelectElement).value)
              )
            "
          >
            <option :value="400">标准</option>
            <option :value="500">中等</option>
            <option :value="600">半粗</option>
            <option :value="700">粗体</option>
          </select>
        </label>
        <div class="lyric-style-choice">
          <span>对齐</span>
          <div class="lyric-segment-control" role="group" aria-label="歌词对齐">
            <button
              type="button"
              :aria-pressed="settings.lyricsAppearance.align === 'left'"
              @click="updateLyricsAppearance('align', 'left')"
            >
              左对齐
            </button>
            <button
              type="button"
              :aria-pressed="settings.lyricsAppearance.align === 'center'"
              @click="updateLyricsAppearance('align', 'center')"
            >
              居中
            </button>
          </div>
        </div>
        <div class="lyric-style-choice">
          <span>聚焦行数</span>
          <div class="lyric-segment-control" role="group" aria-label="歌词聚焦行数">
            <button
              v-for="option in lyricFocusLineCounts"
              :key="option.value"
              type="button"
              :aria-pressed="settings.lyricsAppearance.focusLineCount === option.value"
              @click="updateLyricsAppearance('focusLineCount', option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
        <button
          type="button"
          class="lyric-karaoke-toggle"
          :aria-pressed="settings.lyricsAppearance.karaokeEnabled"
          @click="
            updateLyricsAppearance('karaokeEnabled', !settings.lyricsAppearance.karaokeEnabled)
          "
        >
          <i
            :class="
              settings.lyricsAppearance.karaokeEnabled
                ? 'ph ph-highlighter-circle'
                : 'ph ph-highlighter-circle-slash'
            "
            aria-hidden="true"
          ></i>
          逐字高亮
        </button>
      </div>
    </section>

    <details class="lyric-editor-disclosure">
      <summary>
        <span class="lyric-disclosure-title">
          <i class="ph ph-pencil-simple" aria-hidden="true"></i>
          自定义歌词
        </span>
        <span class="lyric-disclosure-meta">
          {{ draftDirty ? '有未保存更改' : currentTrack ? '已同步' : '暂无曲目' }}
          <i class="ph ph-caret-down" aria-hidden="true"></i>
        </span>
      </summary>

      <div class="lyric-editor-content">
        <div class="lyric-source-grid">
          <label class="lyric-field">
            <span>自动解析</span>
            <select v-model="draftSource" :disabled="!currentTrack">
              <option value="auto">自动</option>
              <option value="local">本地 LRC</option>
              <option value="provider">Provider</option>
              <option value="manual">仅手写</option>
            </select>
          </label>
          <label class="lyric-field">
            <span>全局偏移 (ms)</span>
            <input
              type="number"
              min="-120000"
              max="120000"
              step="50"
              :value="lyricVisibility.globalOffsetMs"
              :disabled="!currentTrack"
              @change="updateGlobalLyricOffset"
            />
          </label>
          <label class="lyric-field">
            <span>本曲偏移 (ms)</span>
            <input
              v-model.number="draftTrackOffsetMs"
              type="number"
              min="-120000"
              max="120000"
              step="50"
              :disabled="!currentTrack"
            />
          </label>
        </div>

        <div class="lyric-layer-grid">
          <label class="lyric-layer-source">
            <span>原文</span>
            <select v-model="draftOriginalSelection" :disabled="!currentTrack">
              <option value="automatic">
                {{ automaticLayerLabel('automatic', originalAutomaticSource) }}
              </option>
              <option value="local">本地 LRC</option>
              <option value="provider">Provider</option>
              <option value="manual">手写内容</option>
            </select>
          </label>
          <label class="lyric-layer-source">
            <span>翻译</span>
            <select v-model="draftTranslationSelection" :disabled="!currentTrack">
              <option value="automatic">
                {{ automaticLayerLabel('automatic', translationAutomaticSource) }}
              </option>
              <option value="local">本地</option>
              <option value="provider">Provider</option>
              <option value="manual">手写内容</option>
            </select>
          </label>
          <label class="lyric-layer-source">
            <span>音译</span>
            <select v-model="draftRomanizationSelection" :disabled="!currentTrack">
              <option value="automatic">
                {{ automaticLayerLabel('automatic', romanizationAutomaticSource) }}
              </option>
              <option value="local">本地</option>
              <option value="provider">Provider</option>
              <option value="manual">手写内容</option>
            </select>
          </label>
        </div>

        <div class="lyric-manager-toggles" aria-label="歌词显示图层">
          <button
            type="button"
            :aria-pressed="lyricVisibility.showOriginal"
            :disabled="!currentTrack"
            @click="toggleLyricVisibility('showOriginal')"
          >
            原文
          </button>
          <button
            type="button"
            :aria-pressed="lyricVisibility.showTranslation"
            :disabled="!currentTrack"
            @click="toggleLyricVisibility('showTranslation')"
          >
            翻译
          </button>
          <button
            type="button"
            :aria-pressed="lyricVisibility.showRomanization"
            :disabled="!currentTrack"
            @click="toggleLyricVisibility('showRomanization')"
          >
            音译
          </button>
          <span class="lyric-toggle-spacer"></span>
          <button
            type="button"
            :disabled="!currentTrack || lyricImporting"
            @click="importLyricsIntoDraft"
          >
            <i class="ph ph-file-arrow-up" aria-hidden="true"></i
            >{{ lyricImporting ? '导入中…' : '导入 LRC' }}
          </button>
          <button
            type="button"
            :disabled="!currentTrack || lyricSearching"
            @click="searchOnlineIntoDraft"
          >
            <i class="ph ph-magnifying-glass" aria-hidden="true"></i
            >{{ lyricSearching ? '搜索中…' : '在线搜索' }}
          </button>
        </div>

        <div v-if="onlineLyricCandidates.length" class="online-lyric-candidates">
          <button
            v-for="candidate in onlineLyricCandidates"
            :key="`${candidate.source}-${candidate.id}`"
            type="button"
            class="online-lyric-candidate"
            @click="applyOnlineCandidate(candidate)"
          >
            <strong>{{ candidate.title }} · {{ candidate.artist }}</strong>
            <span
              >{{ candidate.source }} · {{ formatDurationDelta(candidate.durationSeconds) }} ·
              {{ candidate.score.toFixed(2) }}</span
            >
            <em>{{
              (candidate.syncedLyrics || candidate.plainLyrics || '').split('\n')[0]?.slice(0, 90)
            }}</em>
          </button>
        </div>

        <label class="lyric-editor-label">
          <span>原文手写内容</span>
          <textarea
            v-model="draftOriginal"
            rows="4"
            spellcheck="false"
            :disabled="!currentTrack"
            @input="useManualLayer('original')"
          ></textarea>
        </label>
        <label class="lyric-editor-label">
          <span>翻译手写内容</span>
          <textarea
            v-model="draftTranslation"
            rows="3"
            spellcheck="false"
            :disabled="!currentTrack"
            @input="useManualLayer('translation')"
          ></textarea>
        </label>
        <label class="lyric-editor-label">
          <span>音译手写内容</span>
          <textarea
            v-model="draftRomanization"
            rows="3"
            spellcheck="false"
            :disabled="!currentTrack"
            @input="useManualLayer('romanization')"
          ></textarea>
        </label>

        <p v-if="draftTrackMismatch" class="lyric-manager-error">
          未保存的草稿来自「{{
            seededTrackTitle
          }}」，当前曲目已切换。可撤销草稿，或切回原曲目后保存。
        </p>
        <p v-if="lyricManagerError" class="lyric-manager-error">{{ lyricManagerError }}</p>
        <p v-if="lyricManagerNotice" class="lyric-manager-notice">{{ lyricManagerNotice }}</p>
        <div class="lyric-manager-actions">
          <button type="button" :disabled="!currentTrack || lyricWriting" @click="saveDraftAsLrc">
            <i class="ph ph-download-simple" aria-hidden="true"></i
            >{{ lyricWriting ? '导出中…' : '导出 LRC' }}
          </button>
          <button type="button" :disabled="!currentTrack || !draftDirty" @click="discardDraft">
            撤销草稿
          </button>
          <button
            type="button"
            :disabled="!currentTrack || lyricSaving"
            @click="restoreAutomaticLyrics"
          >
            恢复自动
          </button>
          <button
            type="button"
            class="lyric-save-button"
            :disabled="!currentTrack || lyricSaving || !draftDirty || draftTrackMismatch"
            @click="saveLyricManager"
          >
            <i
              :class="lyricSaving ? 'pi pi-spin pi-spinner' : 'ph ph-check'"
              aria-hidden="true"
            ></i>
            {{ lyricSaving ? '保存中…' : '保存歌词' }}
          </button>
        </div>
      </div>
    </details>
  </section>
</template>

<style scoped>
.lyric-manager {
  display: grid;
  gap: 12px;
  min-width: 0;
  color: var(--d-ink, rgba(255, 255, 255, 0.9));
}

.lyric-manager-heading,
.lyric-manager-actions,
.lyric-manager-toggles,
.lyric-style-controls,
.lyric-layer-grid,
.lyric-source-grid {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.lyric-manager-heading {
  justify-content: space-between;
}

.lyric-manager-heading h2,
.lyric-manager-heading p,
.lyric-manager-error,
.lyric-manager-notice {
  margin: 0;
}

.lyric-manager-heading h2 {
  font-size: 14px;
  font-weight: 650;
}

.lyric-manager-heading p {
  margin-top: 2px;
  max-width: 280px;
  overflow: hidden;
  color: var(--d-muted, rgba(255, 255, 255, 0.5));
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lyric-status {
  flex: 0 0 auto;
  border: 1px solid var(--d-line, rgba(255, 255, 255, 0.14));
  border-radius: 999px;
  padding: 3px 7px;
  color: var(--d-muted, rgba(255, 255, 255, 0.5));
  font-size: 10px;
}

.lyric-status.pending {
  color: var(--d-accent, #818cf8);
}

.lyric-source-grid {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr;
}

.lyric-layer-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.lyric-field,
.lyric-layer-source,
.lyric-editor-label,
.lyric-range-field {
  display: grid;
  gap: 5px;
  min-width: 0;
  color: var(--d-muted, rgba(255, 255, 255, 0.58));
  font-size: 11px;
}

.lyric-manager select,
.lyric-manager input:not([type='range']),
.lyric-manager textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  border: 1px solid var(--d-line, rgba(255, 255, 255, 0.16));
  border-radius: 6px;
  background: var(--d-well, rgba(0, 0, 0, 0.2));
  color: var(--d-ink, #fff);
  font: inherit;
}

.lyric-manager select,
.lyric-manager input:not([type='range']) {
  height: 30px;
  padding: 0 8px;
}

.lyric-manager textarea {
  min-height: 60px;
  padding: 8px;
  line-height: 1.45;
  resize: vertical;
}

.lyric-manager button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 30px;
  border: 1px solid var(--d-line, rgba(255, 255, 255, 0.16));
  border-radius: 6px;
  background: var(--d-well, rgba(0, 0, 0, 0.2));
  color: var(--d-ink, rgba(255, 255, 255, 0.86));
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.lyric-manager button:hover:not(:disabled) {
  border-color: var(--d-accent-line, rgba(129, 140, 248, 0.5));
  color: var(--d-accent, #a5b4fc);
}

.lyric-manager button:disabled,
.lyric-manager input:disabled,
.lyric-manager select:disabled,
.lyric-manager textarea:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}

.lyric-manager-toggles {
  flex-wrap: wrap;
}

.lyric-manager-toggles button,
.lyric-manager-actions button,
.lyric-segment-control button,
.lyric-karaoke-toggle {
  padding: 5px 8px;
}

.lyric-manager-toggles button[aria-pressed='true'],
.lyric-segment-control button[aria-pressed='true'],
.lyric-karaoke-toggle[aria-pressed='true'] {
  border-color: var(--d-accent-line, rgba(129, 140, 248, 0.5));
  background: var(--d-accent-soft, rgba(129, 140, 248, 0.12));
  color: var(--d-accent, #a5b4fc);
}

.lyric-toggle-spacer {
  flex: 1;
}

.online-lyric-candidates {
  display: grid;
  gap: 6px;
  max-height: 190px;
  overflow: auto;
  padding-right: 2px;
}

.online-lyric-candidate {
  display: grid !important;
  justify-items: start !important;
  gap: 3px !important;
  padding: 8px 9px;
  text-align: left;
}

.online-lyric-candidate span,
.online-lyric-candidate em {
  overflow: hidden;
  max-width: 100%;
  color: var(--d-muted, rgba(255, 255, 255, 0.5));
  font-size: 10px;
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lyric-style-controls {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--d-line);
  border-radius: 6px;
  background: var(--d-well);
}

.lyric-style-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  color: var(--d-muted);
  font-size: 11px;
}

.lyric-style-heading strong {
  color: var(--d-ink);
  font-size: 12px;
  font-weight: 650;
}

.lyric-style-heading span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lyric-style-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  align-items: end;
}

.lyric-range-field span {
  display: flex;
  justify-content: space-between;
  gap: 6px;
}

.lyric-range-field strong {
  color: var(--d-ink);
  font-weight: 550;
}

.lyric-range-field input {
  width: 100%;
  accent-color: var(--d-accent);
}

.lyric-style-choice {
  display: grid;
  gap: 5px;
  min-width: 0;
  color: var(--d-muted);
  font-size: 11px;
}

.lyric-segment-control {
  display: flex;
  min-width: 0;
}

.lyric-segment-control button {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
}

.lyric-segment-control button + button {
  margin-left: -1px;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}

.lyric-segment-control button:first-child {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.lyric-karaoke-toggle {
  align-self: end;
  white-space: nowrap;
}

.lyric-editor-disclosure {
  min-width: 0;
  border: 1px solid var(--d-line);
  border-radius: 6px;
  background: var(--d-well);
  overflow: hidden;
}

.lyric-editor-disclosure summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 42px;
  padding: 0 12px;
  color: var(--d-ink);
  cursor: pointer;
  list-style: none;
}

.lyric-editor-disclosure summary::-webkit-details-marker {
  display: none;
}

.lyric-editor-disclosure[open] summary {
  border-bottom: 1px solid var(--d-line);
}

.lyric-disclosure-title,
.lyric-disclosure-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.lyric-disclosure-title {
  font-size: 12px;
  font-weight: 650;
}

.lyric-disclosure-meta {
  flex: 0 0 auto;
  color: var(--d-muted);
  font-size: 10px;
}

.lyric-disclosure-meta i {
  transition: transform 160ms ease;
}

.lyric-editor-disclosure[open] .lyric-disclosure-meta i {
  transform: rotate(180deg);
}

.lyric-editor-content {
  display: grid;
  gap: 12px;
  padding: 12px;
}

.lyric-manager-error {
  color: #ef8f86;
  font-size: 11px;
}

.lyric-manager-notice {
  color: #7bdca0;
  font-size: 11px;
}

.lyric-manager-actions {
  justify-content: flex-end;
  flex-wrap: wrap;
}

.lyric-save-button {
  border-color: var(--d-accent-line, rgba(129, 140, 248, 0.5)) !important;
  background: var(--d-accent-soft, rgba(129, 140, 248, 0.12)) !important;
  color: var(--d-accent, #a5b4fc) !important;
}

@media (max-width: 520px) {
  .lyric-source-grid,
  .lyric-layer-grid {
    grid-template-columns: 1fr;
  }

  .lyric-style-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 2px;
  }

  .lyric-style-grid {
    grid-template-columns: 1fr;
  }
}
</style>
