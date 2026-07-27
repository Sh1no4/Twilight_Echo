import { computed, readonly, ref } from 'vue'
import {
  DEFAULT_LYRICS_MANAGEMENT,
  clampLyricOffset,
  cloneLyricsManagementDocument,
  effectiveLyricOffsetSeconds,
  type LyricTrackOverride,
  type LyricSourcePreference,
  type LyricsManagementDocument
} from '../../../shared/lyricsManagement.ts'
import { isPersistentDataRevisionConflict } from '../../../shared/versionedPersistence.ts'

const document = ref<LyricsManagementDocument>(
  cloneLyricsManagementDocument(DEFAULT_LYRICS_MANAGEMENT)
)
const revision = ref(0)
const loading = ref<Promise<void> | null>(null)

function entryFor(trackId: string): LyricTrackOverride | undefined {
  return document.value.tracks[trackId]
}

async function ensureLoaded(): Promise<void> {
  if (loading.value) return loading.value
  loading.value = (async () => {
    const result = await Promise.race([
      window.api.data.loadLyricsManagement(),
      new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), 3_000)
      })
    ])
    if (result) {
      document.value = cloneLyricsManagementDocument(result.data)
      revision.value = result.revision
    }
  })().finally(() => {
    loading.value = null
  })
  return loading.value
}

async function persist(next: LyricsManagementDocument): Promise<void> {
  try {
    const saved = await window.api.data.saveLyricsManagement(next, revision.value)
    document.value = cloneLyricsManagementDocument(saved.data)
    revision.value = saved.revision
  } catch (error) {
    if (!isPersistentDataRevisionConflict(error)) throw error
    const current = error.current
    if (!current) throw error
    // Do not replay a whole stale document: another renderer could have edited
    // a different track after we read. Keep the authority and let the caller
    // retry its focused update against the fresh revision.
    document.value = cloneLyricsManagementDocument(current.data as LyricsManagementDocument)
    revision.value = current.revision
    throw error
  }
}

function nextDocument(): LyricsManagementDocument {
  return cloneLyricsManagementDocument(document.value)
}

function defaultOverride(): LyricTrackOverride {
  return {
    offsetMs: 0,
    source: 'auto',
    originalSelection: 'automatic',
    translationSelection: 'automatic',
    romanizationSelection: 'automatic',
    original: null,
    translation: null,
    romanization: null,
    updatedAt: new Date().toISOString()
  }
}

async function updateGlobalOffset(offsetMs: number): Promise<void> {
  await ensureLoaded()
  const next = nextDocument()
  next.globalOffsetMs = clampLyricOffset(offsetMs)
  await persist(next)
}

async function updateVisibility(
  patch: Partial<
    Pick<LyricsManagementDocument, 'showOriginal' | 'showTranslation' | 'showRomanization'>
  >
): Promise<void> {
  await ensureLoaded()
  const next = nextDocument()
  if (typeof patch.showOriginal === 'boolean') next.showOriginal = patch.showOriginal
  if (typeof patch.showTranslation === 'boolean') next.showTranslation = patch.showTranslation
  if (typeof patch.showRomanization === 'boolean') next.showRomanization = patch.showRomanization
  await persist(next)
}

async function updateTrack(
  trackId: string,
  patch: Partial<
    Pick<
      LyricTrackOverride,
      | 'offsetMs'
      | 'source'
      | 'originalSelection'
      | 'translationSelection'
      | 'romanizationSelection'
      | 'original'
      | 'translation'
      | 'romanization'
    >
  >
): Promise<void> {
  if (!trackId) return
  await ensureLoaded()
  const next = nextDocument()
  const previous = next.tracks[trackId] ?? defaultOverride()
  const override: LyricTrackOverride = {
    ...previous,
    ...patch,
    offsetMs: clampLyricOffset(patch.offsetMs ?? previous.offsetMs),
    updatedAt: new Date().toISOString()
  }
  next.tracks[trackId] = override
  await persist(next)
}

async function selectSource(trackId: string, source: LyricSourcePreference): Promise<void> {
  await updateTrack(trackId, { source })
}

export function useLyricsManagement() {
  return {
    document: readonly(document),
    globalOffsetMs: computed(() => document.value.globalOffsetMs),
    ensureLoaded,
    entryFor,
    effectiveOffsetSeconds: (trackId: string) =>
      effectiveLyricOffsetSeconds(document.value.globalOffsetMs, entryFor(trackId)?.offsetMs ?? 0),
    updateGlobalOffset,
    updateVisibility,
    updateTrack,
    selectSource
  }
}
