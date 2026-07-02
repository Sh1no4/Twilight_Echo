import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useFavoriteButton } from './useFavoriteButton.ts'
import type { Track } from '../../types/music.ts'

const localTrack: Track = {
  id: 'local:moon',
  title: 'Moon River',
  artist: 'Audrey',
  album: 'Breakfast',
  duration: 180,
  filePath: 'D:/Music/Moon River.flac',
  cover: null,
  lyrics: null,
  source: 'local'
}

const providerVariant: Track = {
  ...localTrack,
  id: 'ncm:123',
  filePath: 'ncm:123',
  source: 'ncm',
  ncmSongId: 123
}

test('favorite button can use logical favorite state across source variants', async () => {
  const currentTrack = ref<Track | null>(providerVariant)
  const playlists = ref([
    {
      id: 'pl_favorites',
      name: '我收藏的音乐',
      isDefault: true,
      trackIds: [localTrack.id],
      createdAt: new Date().toISOString()
    }
  ])
  const calls: string[] = []

  const button = useFavoriteButton({
    currentTrack,
    playlists,
    mediaProviders: {
      get: () => null
    } as never,
    addToPlaylist: (playlistName, trackId) => calls.push(`legacy-add:${playlistName}:${trackId}`),
    removeFromPlaylist: (playlistName, trackId) => calls.push(`legacy-remove:${playlistName}:${trackId}`),
    createPlaylist: (name) => calls.push(`legacy-create:${name}`),
    isFavoriteTrack: (track) => track.title === localTrack.title && track.artist === localTrack.artist,
    addFavoriteTrack: (track) => calls.push(`logical-add:${track.id}`),
    removeFavoriteTrack: (track) => calls.push(`logical-remove:${track.id}`)
  })

  assert.equal(button.favoriteButtonLiked.value, true)

  await button.toggleFavorite()

  assert.deepEqual(calls, ['logical-remove:ncm:123'])
})
