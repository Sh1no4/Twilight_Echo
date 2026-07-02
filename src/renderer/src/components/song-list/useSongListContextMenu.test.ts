import assert from 'node:assert/strict'
import test from 'node:test'
import { computed, effectScope } from 'vue'

const { useSongListContextMenu } = (await import(
  new URL('./useSongListContextMenu.ts', import.meta.url).href
)) as typeof import('./useSongListContextMenu')

const providerTrack = {
  id: 'ncm:expired',
  title: 'Online Song',
  artist: 'Remote Artist',
  album: 'Remote Album',
  filePath: 'ncm:expired',
  fileName: 'Online Song',
  duration: 180,
  size: 0,
  cover: null,
  lyrics: null,
  source: 'ncm'
}

const localTrack = {
  ...providerTrack,
  id: 'local:hash',
  filePath: 'D:\\Music\\Online Song.flac',
  source: 'local'
}

function createMenu(overrides: {
  rematchTrack?: (track: typeof providerTrack) => Promise<void> | void
} = {}): ReturnType<typeof useSongListContextMenu> {
  ;(globalThis as Record<string, unknown>).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    innerWidth: 1200,
    innerHeight: 800,
    api: {
      shell: {
        showItemInFolder: async (): Promise<void> => {}
      }
    }
  }
  ;(globalThis as Record<string, unknown>).document = {
    querySelector: () => null
  }
  const scope = effectScope()
  const menu = scope.run(() => useSongListContextMenu({
    currentPlaylistName: computed(() => null),
    removeTrack: () => {},
    addToPlaylist: () => {},
    removeFromPlaylist: () => {},
    createPlaylist: () => 'playlist-id',
    deletePlaylist: () => {},
    rematchTrack: overrides.rematchTrack
  }))
  if (!menu) throw new Error('context menu setup failed')
  return menu
}

test('context menu exposes rematch action for provider tracks', async () => {
  let rematchedTrackId = ''
  const menu = createMenu({
    rematchTrack: (track) => {
      rematchedTrackId = track.id
    }
  })
  menu.selectedTrack.value = providerTrack

  assert.equal(menu.canRematchSelectedTrack.value, true)

  await menu.handleRematchTrack()

  assert.equal(rematchedTrackId, 'ncm:expired')
  assert.equal(menu.showContextMenu.value, false)
})

test('context menu does not expose rematch action for local tracks', () => {
  const menu = createMenu()
  menu.selectedTrack.value = localTrack

  assert.equal(menu.canRematchSelectedTrack.value, false)
})
