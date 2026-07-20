import { computed, readonly, ref } from 'vue'
import {
  DEFAULT_RADIO_STATIONS,
  MAX_RADIO_STATIONS,
  cloneRadioStationsDocument,
  isInsecureHttpUrl,
  isHttpOrHttpsUrl,
  type RadioStation,
  type RadioStationsDocument
} from '../../../shared/radioStations.ts'
import { isPersistentDataRevisionConflict } from '../../../shared/versionedPersistence.ts'
import type { Track } from '../types/music'

const document = ref<RadioStationsDocument>(cloneRadioStationsDocument(DEFAULT_RADIO_STATIONS))
const revision = ref(0)
const loading = ref<Promise<void> | null>(null)
const error = ref('')

async function ensureLoaded(): Promise<void> {
  if (loading.value) return loading.value
  loading.value = (async () => {
    try {
      const result = await window.api.radio.loadStations()
      if (result?.data) {
        document.value = cloneRadioStationsDocument(result.data)
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

async function persist(next: RadioStationsDocument): Promise<void> {
  try {
    const saved = await window.api.radio.saveStations(next, revision.value)
    document.value = cloneRadioStationsDocument(saved.data)
    revision.value = saved.revision
    error.value = ''
  } catch (err) {
    if (!isPersistentDataRevisionConflict(err)) {
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    }
    const current = err.current
    if (!current) throw err
    document.value = cloneRadioStationsDocument(current.data as RadioStationsDocument)
    revision.value = current.revision
    throw err
  }
}

export function radioStationToTrack(station: RadioStation): Track {
  return {
    id: station.id,
    title: station.name,
    artist: '网络电台',
    album: 'Radio',
    filePath: station.streamUrl,
    fileName: station.name,
    duration: 0,
    size: 0,
    cover: station.favicon ?? null,
    lyrics: null,
    source: 'radio',
    streamUrl: station.streamUrl
  }
}

export function useRadioStore() {
  const stations = computed(() => document.value.stations)

  async function addStation(input: {
    name: string
    streamUrl: string
    homepage?: string
    tags?: string[]
    allowInsecureHttp?: boolean
  }): Promise<RadioStation> {
    await ensureLoaded()
    const streamUrl = input.streamUrl.trim()
    if (!isHttpOrHttpsUrl(streamUrl)) throw new Error('电台地址无效')
    if (isInsecureHttpUrl(streamUrl) && !input.allowInsecureHttp) {
      throw new Error('HTTP 电台需要先确认允许明文流')
    }
    const now = new Date().toISOString()
    const station: RadioStation = {
      id: `radio_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      name: input.name.trim().slice(0, 120) || '未命名电台',
      streamUrl,
      homepage: input.homepage?.trim() || undefined,
      tags: input.tags,
      allowInsecureHttp: isInsecureHttpUrl(streamUrl) ? true : Boolean(input.allowInsecureHttp),
      createdAt: now,
      updatedAt: now
    }
    const next = cloneRadioStationsDocument(document.value)
    next.stations = [station, ...next.stations].slice(0, MAX_RADIO_STATIONS)
    await persist(next)
    return station
  }

  async function removeStation(id: string): Promise<void> {
    await ensureLoaded()
    const next = cloneRadioStationsDocument(document.value)
    next.stations = next.stations.filter((station) => station.id !== id)
    await persist(next)
  }

  async function importPlaylistText(
    text: string,
    options: { fileNameHint?: string; allowInsecureHttp?: boolean } = {}
  ): Promise<number> {
    await ensureLoaded()
    const imported = await window.api.radio.importPlaylist({
      text,
      fileNameHint: options.fileNameHint,
      allowInsecureHttp: options.allowInsecureHttp
    })
    if (imported.length === 0) return 0
    const next = cloneRadioStationsDocument(document.value)
    const existingUrls = new Set(next.stations.map((station) => station.streamUrl))
    for (const station of imported) {
      if (existingUrls.has(station.streamUrl)) continue
      next.stations.unshift(station)
      existingUrls.add(station.streamUrl)
    }
    next.stations = next.stations.slice(0, MAX_RADIO_STATIONS)
    await persist(next)
    return imported.length
  }

  return {
    stations,
    revision: readonly(revision),
    error: readonly(error),
    ensureLoaded,
    addStation,
    removeStation,
    importPlaylistText,
    radioStationToTrack
  }
}
