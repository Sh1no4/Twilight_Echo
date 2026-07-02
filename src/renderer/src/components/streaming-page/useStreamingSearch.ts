import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { Track } from '../../types/music'
import type { NcmArtistSummary, NcmPlaylistSummary } from '../../stores/useNcmStore'
import type { PageState } from './types'

type SearchType = 'songs' | 'playlists' | 'artists'

type UseStreamingSearchOptions = {
  searchSongs: (
    keywords: string,
    limit?: number,
    offset?: number
  ) => Promise<{ tracks: Track[]; total: number }>
  searchPlaylists: (
    keywords: string,
    limit?: number,
    offset?: number
  ) => Promise<{ playlists: NcmPlaylistSummary[]; total: number }>
  searchArtists: (
    keywords: string,
    limit?: number,
    offset?: number
  ) => Promise<{ artists: NcmArtistSummary[]; total: number }>
  playTrack: (track: Track, queue?: Track[]) => void
}

export function useStreamingSearch({
  searchSongs,
  searchPlaylists,
  searchArtists,
  playTrack
}: UseStreamingSearchOptions): {
  searchQuery: Ref<string>
  searchType: Ref<SearchType>
  searchResults: Ref<Track[]>
  searchPlaylistsResults: Ref<NcmPlaylistSummary[]>
  searchArtistsResults: Ref<NcmArtistSummary[]>
  searchTotal: Ref<number>
  searchOffset: Ref<number>
  searchLoading: Ref<boolean>
  searchError: Ref<string>
  searchInputFocused: Ref<boolean>
  isSearching: ComputedRef<boolean>
  clearSearch: () => void
  performSearch: (keywords: string) => Promise<void>
  onPageChange: (event: PageState) => void
  onSearchTrackClick: (track: Track) => void
} {
  const searchQuery = ref('')
  const searchType = ref<SearchType>('songs')
  const searchResults = ref<Track[]>([])
  const searchPlaylistsResults = ref<NcmPlaylistSummary[]>([])
  const searchArtistsResults = ref<NcmArtistSummary[]>([])
  const searchTotal = ref(0)
  const searchOffset = ref(0)
  const searchLoading = ref(false)
  const searchError = ref('')
  const searchInputFocused = ref(false)
  const isSearching = computed(() => searchQuery.value.trim().length > 0)
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

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
        const { tracks, total } = await searchSongs(keywords.trim(), 30, searchOffset.value)
        if (searchQuery.value.trim() === keywords.trim() && searchType.value === 'songs') {
          searchResults.value = tracks
          searchTotal.value = total
        }
      } else if (searchType.value === 'playlists') {
        const { playlists, total } = await searchPlaylists(keywords.trim(), 30, searchOffset.value)
        if (searchQuery.value.trim() === keywords.trim() && searchType.value === 'playlists') {
          searchPlaylistsResults.value = playlists
          searchTotal.value = total
        }
      } else if (searchType.value === 'artists') {
        const { artists, total } = await searchArtists(keywords.trim(), 30, searchOffset.value)
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

  watch([searchQuery, searchType], ([newQuery, newType], [oldQuery, oldType]) => {
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

    if (oldQuery !== newQuery || oldType !== newType) {
      searchOffset.value = 0
      searchLoading.value = true
      searchDebounceTimer = setTimeout(() => {
        void performSearch(q)
      }, 300)
    }
  })

  function onPageChange(event: PageState): void {
    searchOffset.value = event.first
    void performSearch(searchQuery.value.trim())
  }

  function onSearchTrackClick(track: Track): void {
    playTrack(track, searchResults.value)
  }

  onBeforeUnmount(() => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  })

  return {
    searchQuery,
    searchType,
    searchResults,
    searchPlaylistsResults,
    searchArtistsResults,
    searchTotal,
    searchOffset,
    searchLoading,
    searchError,
    searchInputFocused,
    isSearching,
    clearSearch,
    performSearch,
    onPageChange,
    onSearchTrackClick
  }
}
