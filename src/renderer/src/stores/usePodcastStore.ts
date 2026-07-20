import { computed, readonly, ref } from 'vue'
import {
  DEFAULT_PODCAST_SUBSCRIPTIONS,
  clonePodcastSubscriptionsDocument,
  podcastEpisodeProgressRatio,
  parsePodcastTrackId,
  type PodcastEpisode,
  type PodcastSubscription,
  type PodcastSubscriptionsDocument
} from '../../../shared/podcastSubscriptions.ts'
import { isPersistentDataRevisionConflict } from '../../../shared/versionedPersistence.ts'
import type { Track } from '../types/music'

const document = ref<PodcastSubscriptionsDocument>(
  clonePodcastSubscriptionsDocument(DEFAULT_PODCAST_SUBSCRIPTIONS)
)
const revision = ref(0)
const loading = ref<Promise<void> | null>(null)
const error = ref('')
const busy = ref(false)

async function ensureLoaded(): Promise<void> {
  if (loading.value) return loading.value
  loading.value = (async () => {
    try {
      const result = await window.api.podcast.loadSubscriptions()
      if (result?.data) {
        document.value = clonePodcastSubscriptionsDocument(result.data)
        revision.value = result.revision
      }
      error.value = ''
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    }
  })().finally(() => {
    loading.value = null
  })
  return loading.value
}

function applyDocument(next: PodcastSubscriptionsDocument, nextRevision: number): void {
  document.value = clonePodcastSubscriptionsDocument(next)
  revision.value = nextRevision
}

export { parsePodcastTrackId }

export function podcastEpisodeToTrack(
  subscription: PodcastSubscription,
  episode: PodcastEpisode
): Track {
  return {
    id: `podcast:${subscription.id}:${episode.guid}`,
    title: episode.title,
    artist: subscription.author || subscription.title || '播客',
    album: subscription.title,
    filePath: episode.mediaUrl,
    fileName: episode.title,
    duration: episode.durationSeconds || 0,
    size: 0,
    cover: episode.coverUrl ?? subscription.coverUrl ?? null,
    lyrics: null,
    source: 'podcast',
    streamUrl: episode.mediaUrl
  }
}

const PODCAST_DEFAULT_RATE_KEY = 'twilight.podcast.defaultPlaybackRate'

export function getPodcastDefaultPlaybackRate(): number {
  try {
    const raw = localStorage.getItem(PODCAST_DEFAULT_RATE_KEY)
    if (!raw) return 1
    const n = Number(raw)
    if (!Number.isFinite(n)) return 1
    return Math.min(2, Math.max(0.5, Math.round(n * 100) / 100))
  } catch {
    return 1
  }
}

export function setPodcastDefaultPlaybackRate(rate: number): void {
  const rounded = Math.min(2, Math.max(0.5, Math.round(rate * 100) / 100))
  try {
    localStorage.setItem(PODCAST_DEFAULT_RATE_KEY, String(rounded))
  } catch {
    // ignore quota / private mode
  }
}

export function usePodcastStore() {
  const subscriptions = computed(() => document.value.subscriptions)

  async function subscribe(feedUrl: string): Promise<PodcastSubscription> {
    busy.value = true
    error.value = ''
    try {
      await ensureLoaded()
      const result = await window.api.podcast.subscribe(feedUrl.trim())
      applyDocument(result.document, result.revision)
      return result.subscription
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      busy.value = false
    }
  }

  async function unsubscribe(subscriptionId: string): Promise<void> {
    await ensureLoaded()
    const next = clonePodcastSubscriptionsDocument(document.value)
    next.subscriptions = next.subscriptions.filter((sub) => sub.id !== subscriptionId)
    try {
      const saved = await window.api.podcast.saveSubscriptions(next, revision.value)
      applyDocument(saved.data, saved.revision)
    } catch (err) {
      if (isPersistentDataRevisionConflict(err) && err.current) {
        applyDocument(err.current.data as PodcastSubscriptionsDocument, err.current.revision)
      }
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    }
  }

  async function refresh(subscriptionId: string): Promise<void> {
    busy.value = true
    error.value = ''
    try {
      const result = await window.api.podcast.refresh(subscriptionId)
      applyDocument(result.document, result.revision)
    } catch (err) {
      const payload = err as {
        document?: PodcastSubscriptionsDocument
        revision?: number
        message?: string
      }
      if (payload?.document && typeof payload.revision === 'number') {
        applyDocument(payload.document, payload.revision)
      }
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      busy.value = false
    }
  }

  async function refreshAll(): Promise<void> {
    busy.value = true
    error.value = ''
    try {
      const next = await window.api.podcast.refreshAll()
      document.value = clonePodcastSubscriptionsDocument(next)
      // refreshAll mutates via per-sub saves; reload revision from disk
      const loaded = await window.api.podcast.loadSubscriptions()
      if (loaded) {
        applyDocument(loaded.data, loaded.revision)
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      busy.value = false
    }
  }

  async function updateEpisodeProgress(
    subscriptionId: string,
    episodeGuid: string,
    progressSeconds: number
  ): Promise<void> {
    await ensureLoaded()
    const next = clonePodcastSubscriptionsDocument(document.value)
    const sub = next.subscriptions.find((item) => item.id === subscriptionId)
    if (!sub) return
    const episode = sub.episodes.find((item) => item.guid === episodeGuid)
    if (!episode) return
    episode.progressSeconds = Math.max(0, progressSeconds)
    sub.updatedAt = new Date().toISOString()
    try {
      const saved = await window.api.podcast.saveSubscriptions(next, revision.value)
      applyDocument(saved.data, saved.revision)
    } catch (err) {
      if (isPersistentDataRevisionConflict(err) && err.current) {
        applyDocument(err.current.data as PodcastSubscriptionsDocument, err.current.revision)
      }
    }
  }

  async function pinEpisode(subscriptionId: string, episodeGuid: string) {
    await ensureLoaded()
    const trackId = `podcast:${subscriptionId}:${episodeGuid}`
    return window.api.podcast.pinEpisode(trackId)
  }

  return {
    subscriptions,
    revision: readonly(revision),
    error: readonly(error),
    busy: readonly(busy),
    ensureLoaded,
    subscribe,
    unsubscribe,
    refresh,
    refreshAll,
    updateEpisodeProgress,
    pinEpisode,
    podcastEpisodeToTrack,
    podcastEpisodeProgressRatio,
    parsePodcastTrackId,
    getPodcastDefaultPlaybackRate,
    setPodcastDefaultPlaybackRate
  }
}
