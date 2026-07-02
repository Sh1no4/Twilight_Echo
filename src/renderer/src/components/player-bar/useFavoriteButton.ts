import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { Track } from '../../types/music.ts'
import { getNcmSongId, syncPluginProviders } from '../../providers/index.ts'
import type { MediaProviderRegistry } from '../../providers/mediaProvider.ts'

const DEFAULT_FAVORITE_PLAYLIST_NAME = '我收藏的音乐'

type FavoritePlaylist = {
  id: string
  name: string
  trackIds: string[]
  isDefault?: boolean
}

type UseFavoriteButtonOptions = {
  currentTrack: ComputedRef<Track | null> | Ref<Track | null>
  playlists: ComputedRef<FavoritePlaylist[]> | Ref<FavoritePlaylist[]>
  mediaProviders: MediaProviderRegistry
  addToPlaylist: (playlistName: string, trackId: string) => void
  removeFromPlaylist: (playlistName: string, trackId: string) => void
  createPlaylist: (name: string) => void
  isFavoriteTrack?: (track: Track) => boolean
  addFavoriteTrack?: (track: Track) => void
  removeFavoriteTrack?: (track: Track) => void
}

function isNcmTrack(track: Pick<Track, 'id' | 'source' | 'ncmSongId'>): boolean {
  return track.source === 'ncm' || track.id.startsWith('ncm:') || getNcmSongId(track) != null
}

function isLocalTrack(track: Pick<Track, 'id' | 'source'>): boolean {
  return !track.source || track.source === 'local' || track.id.startsWith('local:')
}

export function useFavoriteButton({
  currentTrack,
  playlists,
  mediaProviders,
  addToPlaylist,
  removeFromPlaylist,
  createPlaylist,
  isFavoriteTrack,
  addFavoriteTrack,
  removeFavoriteTrack
}: UseFavoriteButtonOptions): {
  favoriteButtonVisible: ComputedRef<boolean>
  favoriteButtonLiked: ComputedRef<boolean>
  favoriteButtonLoading: ComputedRef<boolean>
  favoriteButtonTitle: ComputedRef<string>
  toggleFavorite: () => Promise<void>
} {
  const ncmFavoriteLoading = ref(false)
  const ncmFavoriteLiked = ref(false)
  let ncmFavoriteRequestId = 0

  const defaultFavoritePlaylist = computed(() =>
    playlists.value.find((playlist) => playlist.isDefault) ??
    playlists.value.find((playlist) => playlist.name === DEFAULT_FAVORITE_PLAYLIST_NAME) ??
    null
  )

  const localFavoriteLiked = computed(() => {
    const track = currentTrack.value
    if (track && isFavoriteTrack) return isFavoriteTrack(track)
    const playlist = defaultFavoritePlaylist.value
    return !!track && !!playlist && playlist.trackIds.includes(track.id)
  })

  const favoriteButtonVisible = computed(() => {
    const track = currentTrack.value
    if (!track) return false
    return isLocalTrack(track) || isNcmTrack(track) || Boolean(addFavoriteTrack && removeFavoriteTrack)
  })

  const favoriteButtonLiked = computed(() => {
    const track = currentTrack.value
    if (!track) return false
    if (localFavoriteLiked.value) return true
    if (isNcmTrack(track)) return ncmFavoriteLiked.value
    return localFavoriteLiked.value
  })

  const favoriteButtonLoading = computed(() => {
    const track = currentTrack.value
    return !!track && isNcmTrack(track) && ncmFavoriteLoading.value
  })

  const favoriteButtonTitle = computed(() =>
    favoriteButtonLiked.value ? '取消收藏' : '添加到收藏'
  )

  async function refreshNcmFavoriteState(track: Track | null | undefined): Promise<void> {
    const requestId = ++ncmFavoriteRequestId
    ncmFavoriteLiked.value = false
    if (!track || !isNcmTrack(track)) return

    const songId = getNcmSongId(track)
    if (songId == null) return

    if (typeof window === 'undefined' || !window.api?.providers) return

    await syncPluginProviders()
    if (requestId !== ncmFavoriteRequestId) return

    const provider = mediaProviders.get('ncm')
    if (!provider?.isTrackLiked) return

    try {
      const liked = await provider.isTrackLiked(songId)
      if (requestId === ncmFavoriteRequestId) {
        ncmFavoriteLiked.value = liked
      }
    } catch (error) {
      console.warn('Failed to read NetEase favorite state', error)
    }
  }

  function toggleLocalFavorite(track: Track): void {
    if (isFavoriteTrack && addFavoriteTrack && removeFavoriteTrack) {
      if (isFavoriteTrack(track)) {
        removeFavoriteTrack(track)
      } else {
        addFavoriteTrack(track)
      }
      return
    }

    let playlist = defaultFavoritePlaylist.value
    if (!playlist) {
      createPlaylist(DEFAULT_FAVORITE_PLAYLIST_NAME)
      playlist = defaultFavoritePlaylist.value
    }
    if (!playlist) return

    if (playlist.trackIds.includes(track.id)) {
      removeFromPlaylist(playlist.name, track.id)
    } else {
      addToPlaylist(playlist.name, track.id)
    }
  }

  async function toggleNcmFavorite(track: Track): Promise<void> {
    if (ncmFavoriteLoading.value) return
    const songId = getNcmSongId(track)
    if (songId == null) return

    const trackId = track.id
    await syncPluginProviders()
    const provider = mediaProviders.get('ncm')
    if (!provider?.likeTrack) return

    const nextLiked = !ncmFavoriteLiked.value
    ncmFavoriteLoading.value = true
    try {
      await provider.likeTrack(songId, nextLiked)
      if (currentTrack.value?.id === trackId) {
        ncmFavoriteLiked.value = nextLiked
      }
    } catch (error) {
      console.warn('Failed to toggle NetEase favorite state', error)
    } finally {
      ncmFavoriteLoading.value = false
    }
  }

  async function toggleFavorite(): Promise<void> {
    const track = currentTrack.value
    if (!track) return

    if (isFavoriteTrack && addFavoriteTrack && removeFavoriteTrack) {
      if (isFavoriteTrack(track)) {
        removeFavoriteTrack(track)
      } else {
        addFavoriteTrack(track)
      }
      return
    }

    if (isNcmTrack(track)) {
      await toggleNcmFavorite(track)
      return
    }

    if (isLocalTrack(track)) {
      toggleLocalFavorite(track)
    }
  }

  watch(
    () => [currentTrack.value?.id, currentTrack.value?.source, currentTrack.value?.ncmSongId] as const,
    () => {
      void refreshNcmFavoriteState(currentTrack.value)
    },
    { immediate: true }
  )

  return {
    favoriteButtonVisible,
    favoriteButtonLiked,
    favoriteButtonLoading,
    favoriteButtonTitle,
    toggleFavorite
  }
}
