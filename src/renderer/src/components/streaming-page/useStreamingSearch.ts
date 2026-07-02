import { computed, getCurrentInstance, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { Track } from '../../types/music'
import type {
  MediaProviderArtistSummary,
  MediaProviderPlaylistSummary
} from '../../providers/mediaProvider'
import type { PageState } from './types'

export type SearchType = 'songs' | 'playlists' | 'artists'
export type SearchSource = 'all' | 'local' | string

export interface SearchSourceOption {
  id: SearchSource
  label: string
  icon?: string
  available: boolean
  supportedTypes: SearchType[]
}

type UseStreamingSearchOptions = {
  searchSongs: (
    keywords: string,
    limit?: number,
    offset?: number
  ) => Promise<{ tracks: Track[]; total: number }>
  searchUnifiedSongs?: (
    keywords: string,
    limit?: number,
    offset?: number
  ) => Promise<{ tracks: Track[]; total: number }>
  searchPlaylists: (
    keywords: string,
    limit?: number,
    offset?: number
  ) => Promise<{ playlists: MediaProviderPlaylistSummary[]; total: number }>
  searchArtists: (
    keywords: string,
    limit?: number,
    offset?: number
  ) => Promise<{ artists: MediaProviderArtistSummary[]; total: number }>
  searchProviderSongs?: (
    providerId: string,
    keywords: string,
    limit?: number,
    offset?: number
  ) => Promise<{ tracks: Track[]; total: number }>
  searchProviderPlaylists?: (
    providerId: string,
    keywords: string,
    limit?: number,
    offset?: number
  ) => Promise<{ playlists: MediaProviderPlaylistSummary[]; total: number }>
  searchProviderArtists?: (
    providerId: string,
    keywords: string,
    limit?: number,
    offset?: number
  ) => Promise<{ artists: MediaProviderArtistSummary[]; total: number }>
  searchLocalSongs?: (
    keywords: string,
    limit?: number,
    offset?: number
  ) => Promise<{ tracks: Track[]; total: number }>
  searchLocalPlaylists?: (
    keywords: string,
    limit?: number,
    offset?: number
  ) => Promise<{ playlists: MediaProviderPlaylistSummary[]; total: number }>
  searchLocalArtists?: (
    keywords: string,
    limit?: number,
    offset?: number
  ) => Promise<{ artists: MediaProviderArtistSummary[]; total: number }>
  searchSources: Ref<SearchSourceOption[]>
  playTrack: (track: Track, queue?: Track[]) => void
}

export function useStreamingSearch({
  searchSongs,
  searchUnifiedSongs,
  searchPlaylists,
  searchArtists,
  searchProviderSongs,
  searchProviderPlaylists,
  searchProviderArtists,
  searchLocalSongs,
  searchLocalPlaylists,
  searchLocalArtists,
  searchSources,
  playTrack
}: UseStreamingSearchOptions): {
  searchQuery: Ref<string>
  searchType: Ref<SearchType>
  searchSource: Ref<SearchSource>
  searchResults: Ref<Track[]>
  searchPlaylistsResults: Ref<MediaProviderPlaylistSummary[]>
  searchArtistsResults: Ref<MediaProviderArtistSummary[]>
  searchTotal: Ref<number>
  searchOffset: Ref<number>
  searchLoading: Ref<boolean>
  searchError: Ref<string>
  searchInputFocused: Ref<boolean>
  isSearching: ComputedRef<boolean>
  availableSearchTypes: ComputedRef<SearchType[]>
  clearSearch: () => void
  performSearch: (keywords: string) => Promise<void>
  onPageChange: (event: PageState) => void
  onSearchTrackClick: (track: Track) => void
} {
  const searchQuery = ref('')
  const searchType = ref<SearchType>('songs')
  const searchSource = ref<SearchSource>('ncm')
  const searchResults = ref<Track[]>([])
  const searchPlaylistsResults = ref<MediaProviderPlaylistSummary[]>([])
  const searchArtistsResults = ref<MediaProviderArtistSummary[]>([])
  const searchTotal = ref(0)
  const searchOffset = ref(0)
  const searchLoading = ref(false)
  const searchError = ref('')
  const searchInputFocused = ref(false)
  const isSearching = computed(() => searchQuery.value.trim().length > 0)
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

  const availableSearchTypes = computed<SearchType[]>(() => {
    const source = searchSources.value.find((s) => s.id === searchSource.value)
    return source?.supportedTypes ?? ['songs']
  })

  function clearSearch(): void {
    searchQuery.value = ''
    searchResults.value = []
    searchPlaylistsResults.value = []
    searchArtistsResults.value = []
    searchTotal.value = 0
    searchOffset.value = 0
    searchLoading.value = false
    searchError.value = ''
  }

  async function resolveSongsSearch(
    keywords: string,
    limit: number,
    offset: number
  ): Promise<{ tracks: Track[]; total: number }> {
    const source = searchSource.value
    if (source === 'all') {
      return (searchUnifiedSongs ?? searchSongs)(keywords, limit, offset)
    }
    if (source === 'local') {
      if (searchLocalSongs) return searchLocalSongs(keywords, limit, offset)
      return { tracks: [], total: 0 }
    }
    if (searchProviderSongs) return searchProviderSongs(source, keywords, limit, offset)
    return { tracks: [], total: 0 }
  }

  async function resolvePlaylistsSearch(
    keywords: string,
    limit: number,
    offset: number
  ): Promise<{ playlists: MediaProviderPlaylistSummary[]; total: number }> {
    const source = searchSource.value
    if (source === 'all') {
      return searchPlaylists(keywords, limit, offset)
    }
    if (source === 'local') {
      if (searchLocalPlaylists) return searchLocalPlaylists(keywords, limit, offset)
      return { playlists: [], total: 0 }
    }
    if (searchProviderPlaylists) return searchProviderPlaylists(source, keywords, limit, offset)
    return { playlists: [], total: 0 }
  }

  async function resolveArtistsSearch(
    keywords: string,
    limit: number,
    offset: number
  ): Promise<{ artists: MediaProviderArtistSummary[]; total: number }> {
    const source = searchSource.value
    if (source === 'all') {
      return searchArtists(keywords, limit, offset)
    }
    if (source === 'local') {
      if (searchLocalArtists) return searchLocalArtists(keywords, limit, offset)
      return { artists: [], total: 0 }
    }
    if (searchProviderArtists) return searchProviderArtists(source, keywords, limit, offset)
    return { artists: [], total: 0 }
  }

  async function performSearch(keywords: string): Promise<void> {
    if (!keywords.trim()) {
      searchResults.value = []
      searchPlaylistsResults.value = []
      searchArtistsResults.value = []
      searchTotal.value = 0
      return
    }
    searchLoading.value = true
    searchError.value = ''
    try {
      if (searchType.value === 'songs') {
        const { tracks, total } = await resolveSongsSearch(
          keywords.trim(),
          30,
          searchOffset.value
        )
        if (searchQuery.value.trim() === keywords.trim() && searchType.value === 'songs') {
          searchResults.value = tracks
          searchTotal.value = total
        }
      } else if (searchType.value === 'playlists') {
        const { playlists, total } = await resolvePlaylistsSearch(
          keywords.trim(),
          30,
          searchOffset.value
        )
        if (searchQuery.value.trim() === keywords.trim() && searchType.value === 'playlists') {
          searchPlaylistsResults.value = playlists
          searchTotal.value = total
        }
      } else if (searchType.value === 'artists') {
        const { artists, total } = await resolveArtistsSearch(
          keywords.trim(),
          30,
          searchOffset.value
        )
        if (searchQuery.value.trim() === keywords.trim() && searchType.value === 'artists') {
          searchArtistsResults.value = artists
          searchTotal.value = total
        }
      }
    } catch (e) {
      if (searchQuery.value.trim() === keywords.trim()) {
        searchError.value = e instanceof Error ? e.message : '搜索失败'
        searchResults.value = []
        searchPlaylistsResults.value = []
        searchArtistsResults.value = []
        searchTotal.value = 0
      }
    } finally {
      if (searchQuery.value.trim() === keywords.trim()) {
        searchLoading.value = false
      }
    }
  }

  watch(
    [searchQuery, searchType, searchSource],
    ([newQuery, newType, newSource], [oldQuery, oldType, oldSource]) => {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
      const q = newQuery.trim()
      if (!q) {
        searchResults.value = []
        searchPlaylistsResults.value = []
        searchArtistsResults.value = []
        searchTotal.value = 0
        searchOffset.value = 0
        searchLoading.value = false
        searchError.value = ''
        return
      }

      if (oldQuery !== newQuery || oldType !== newType || oldSource !== newSource) {
        searchOffset.value = 0
        searchLoading.value = true
        searchDebounceTimer = setTimeout(() => {
          void performSearch(q)
        }, 300)
      }
    }
  )

  // Ensure searchType is valid for the current source
  watch(availableSearchTypes, (types) => {
    if (types.length > 0 && !types.includes(searchType.value)) {
      searchType.value = types[0]
    }
  })

  function onPageChange(event: PageState): void {
    searchOffset.value = event.first
    void performSearch(searchQuery.value.trim())
  }

  function onSearchTrackClick(track: Track): void {
    playTrack(track, searchResults.value)
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
    })
  }

  return {
    searchQuery,
    searchType,
    searchSource,
    searchResults,
    searchPlaylistsResults,
    searchArtistsResults,
    searchTotal,
    searchOffset,
    searchLoading,
    searchError,
    searchInputFocused,
    isSearching,
    availableSearchTypes,
    clearSearch,
    performSearch,
    onPageChange,
    onSearchTrackClick
  }
}
