import { computed, ref } from 'vue'
import type {
  OfflineDownloadRecord,
  OfflineStorageSummary
} from '../../../shared/offlineDownloads.ts'
import { useMediaProviders } from '../providers'
import { getTrackProviderId } from '../providers/mediaProvider'
import type { Track } from '../types/music'

const records = ref<OfflineDownloadRecord[]>([])
const pinnedBytes = ref(0)
const availableBytes = ref<number | null>(null)
const error = ref('')
const loading = ref(false)
let started = false

function applySummary(summary: OfflineStorageSummary): void {
  records.value = summary.records
  pinnedBytes.value = summary.pinnedBytes
  availableBytes.value = summary.availableBytes
}

function applyRecord(record: OfflineDownloadRecord): void {
  const index = records.value.findIndex((item) => item.id === record.id)
  if (index < 0) records.value = [...records.value, record]
  else records.value.splice(index, 1, record)
  if (
    record.status === 'completed' ||
    record.status === 'failed' ||
    record.status === 'cancelled'
  ) {
    void refresh()
  }
}

async function refresh(): Promise<void> {
  loading.value = true
  try {
    applySummary(await window.api.offline.list())
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Unable to load offline downloads'
  } finally {
    loading.value = false
  }
}

function ensureStarted(): void {
  if (started) return
  started = true
  window.api.offline.onChanged((record) => applyRecord(record))
  void refresh()
}

export function useOfflineDownloads() {
  ensureStarted()
  const completedCount = computed(
    () => records.value.filter((record) => record.status === 'completed').length
  )

  async function pinTrack(track: Track): Promise<void> {
    // Podcast pins go through main-side ownership check + grant (no bare HTTP).
    if (track.source === 'podcast' || track.id.startsWith('podcast:')) {
      const record = await window.api.podcast.pinEpisode(track.id)
      applyRecord(record)
      error.value = ''
      return
    }
    const providerId = getTrackProviderId(track)
    if (!providerId) throw new Error('Only online provider tracks can be made available offline')
    if (providerId === 'radio') {
      throw new Error('Live radio streams cannot be pinned offline')
    }
    const provider = useMediaProviders()
    const url = await provider.resolvePlaybackUrl(track, {
      quality: track.streamQuality ?? 'auto',
      force: true
    })
    if (!url) throw new Error('The provider did not return a downloadable stream')
    const record = await window.api.offline.queue({
      providerId,
      trackId: track.id,
      title: track.title || track.id,
      quality: track.streamQuality ?? 'auto',
      url
    })
    applyRecord(record)
    error.value = ''
  }

  async function pinTracks(tracks: Track[]): Promise<void> {
    const provider = useMediaProviders()
    const requests = await Promise.all(
      tracks.map(async (track) => {
        const providerId = getTrackProviderId(track)
        if (!providerId)
          throw new Error('Only online provider tracks can be made available offline')
        const url = await provider.resolvePlaybackUrl(track, {
          quality: track.streamQuality ?? 'auto',
          force: true
        })
        if (!url)
          throw new Error(`The provider did not return a downloadable stream for ${track.title}`)
        return {
          providerId,
          trackId: track.id,
          title: track.title || track.id,
          quality: track.streamQuality ?? 'auto',
          url
        }
      })
    )
    const queued = await window.api.offline.queueMany(requests)
    for (const record of queued) applyRecord(record)
  }

  async function retry(record: OfflineDownloadRecord, track: Track): Promise<void> {
    if (record.providerId !== getTrackProviderId(track) || record.trackId !== track.id) {
      throw new Error('The selected track no longer matches this offline download')
    }
    await pinTrack(track)
  }

  async function cancel(record: OfflineDownloadRecord): Promise<void> {
    const next = await window.api.offline.cancel(record.id)
    if (!next) throw new Error('The offline download no longer exists or cannot be cancelled')
    applyRecord(next)
  }

  async function unpin(record: OfflineDownloadRecord): Promise<void> {
    if (!(await window.api.offline.unpin(record.id))) {
      throw new Error('The offline pin no longer exists and was not removed')
    }
    records.value = records.value.filter((item) => item.id !== record.id)
  }

  return {
    records,
    pinnedBytes,
    availableBytes,
    error,
    loading,
    completedCount,
    refresh,
    pinTrack,
    pinTracks,
    retry,
    cancel,
    unpin
  }
}
