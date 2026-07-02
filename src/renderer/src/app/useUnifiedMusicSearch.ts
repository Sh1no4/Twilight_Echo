import { ref, type Ref } from 'vue'
import { useMediaProviders } from '../providers/index.ts'
import { useMusicStore } from '../stores/useMusicStore.ts'
import type { Track } from '../types/music'
import type {
  LogicalMusicItem,
  UnifiedSearchProviderHealth,
  UnifiedSearchResult,
  UnifiedSearchTrackItem
} from '../utils/unifiedMusicSearch.ts'

export interface UnifiedMusicSearchDependencies {
  getLocalTracks: () => Track[]
  searchAllSongs: (options: {
    query: string
    localTracks: Track[]
    limit?: number
    offset?: number
  }) => Promise<UnifiedSearchResult>
}

export interface UnifiedMusicSearchState {
  query: Ref<string>
  items: Ref<UnifiedSearchTrackItem[]>
  logicalItems: Ref<LogicalMusicItem[]>
  providerHealth: Ref<Record<string, UnifiedSearchProviderHealth>>
  loading: Ref<boolean>
  error: Ref<string>
  search: (query: string, options?: { limit?: number; offset?: number }) => Promise<void>
  clear: () => void
}

export function useUnifiedMusicSearch(): UnifiedMusicSearchState {
  const musicStore = useMusicStore()
  const providers = useMediaProviders()
  return createUnifiedMusicSearch({
    getLocalTracks: () => musicStore.tracks.value,
    searchAllSongs: (options) => providers.searchAllSongs(options)
  })
}

export function createUnifiedMusicSearch(
  dependencies: UnifiedMusicSearchDependencies
): UnifiedMusicSearchState {
  const query = ref('')
  const items = ref<UnifiedSearchTrackItem[]>([])
  const logicalItems = ref<LogicalMusicItem[]>([])
  const providerHealth = ref<Record<string, UnifiedSearchProviderHealth>>({})
  const loading = ref(false)
  const error = ref('')

  function clear(): void {
    query.value = ''
    items.value = []
    logicalItems.value = []
    providerHealth.value = {}
    loading.value = false
    error.value = ''
  }

  async function search(nextQuery: string, options: { limit?: number; offset?: number } = {}): Promise<void> {
    const normalizedQuery = nextQuery.trim()
    query.value = nextQuery
    if (!normalizedQuery) {
      clear()
      return
    }

    loading.value = true
    error.value = ''
    try {
      const result = await dependencies.searchAllSongs({
        query: normalizedQuery,
        localTracks: dependencies.getLocalTracks(),
        limit: options.limit,
        offset: options.offset
      })
      if (query.value.trim() !== normalizedQuery) return
      items.value = result.items
      logicalItems.value = result.logicalItems
      providerHealth.value = result.health
    } catch (caught) {
      if (query.value.trim() !== normalizedQuery) return
      error.value = caught instanceof Error ? caught.message : '统一搜索失败'
      items.value = []
      logicalItems.value = []
      providerHealth.value = {}
    } finally {
      if (query.value.trim() === normalizedQuery) {
        loading.value = false
      }
    }
  }

  return {
    query,
    items,
    logicalItems,
    providerHealth,
    loading,
    error,
    search,
    clear
  }
}
