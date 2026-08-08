import { ref, type Ref } from 'vue'
import { useMediaProviders } from '../providers/index.ts'
import { useMusicStore } from '../stores/useMusicStore.ts'
import type { Track } from '../types/music'
import type { NetworkEntry } from '../../../shared/networkSources.ts'
import type {
  LogicalMusicItem,
  UnifiedSearchProviderHealth,
  UnifiedSearchResult,
  UnifiedSearchTrackItem
} from '../utils/unifiedMusicSearch.ts'

export interface UnifiedMusicSearchDependencies {
  getLocalTracks: () => Track[]
  searchNetworkLibrary?: (
    query: string
  ) => Promise<Array<{ profileName: string; entry: NetworkEntry }>>
  searchAllSongs: (options: {
    query: string
    localTracks: Track[]
    networkEntries?: Array<{ profileName: string; entry: NetworkEntry }>
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
    searchNetworkLibrary: async (query) => {
      if (!window.api?.networkSources) return []
      return window.api.networkSources.searchLibrary(query)
    },
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
  let latestRequestId = 0

  function clear(): void {
    latestRequestId += 1
    query.value = ''
    items.value = []
    logicalItems.value = []
    providerHealth.value = {}
    loading.value = false
    error.value = ''
  }

  async function search(
    nextQuery: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<void> {
    const normalizedQuery = nextQuery.trim()
    query.value = nextQuery
    if (!normalizedQuery) {
      clear()
      return
    }

    const requestId = ++latestRequestId
    const snapshot = {
      query: normalizedQuery,
      limit: options.limit,
      offset: options.offset
    }
    loading.value = true
    error.value = ''
    try {
      const networkEntries = dependencies.searchNetworkLibrary
        ? await dependencies.searchNetworkLibrary(normalizedQuery).catch(() => [])
        : []
      const result = await dependencies.searchAllSongs({
        query: snapshot.query,
        localTracks: dependencies.getLocalTracks(),
        networkEntries,
        limit: snapshot.limit,
        offset: snapshot.offset
      })
      if (requestId !== latestRequestId) return
      items.value = result.items
      logicalItems.value = result.logicalItems
      providerHealth.value = result.health
    } catch (caught) {
      if (requestId !== latestRequestId) return
      error.value = caught instanceof Error ? caught.message : '统一搜索失败'
      items.value = []
      logicalItems.value = []
      providerHealth.value = {}
    } finally {
      if (requestId === latestRequestId) {
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
