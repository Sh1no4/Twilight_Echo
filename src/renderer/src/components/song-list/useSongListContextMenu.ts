import { nextTick, onMounted, onUnmounted, ref, type ComputedRef, type Ref } from 'vue'
import type { Track } from '../../types/music'
import type { PlaylistActions } from './types'

type UseSongListContextMenuOptions = PlaylistActions & {
  currentPlaylistName: ComputedRef<string | null>
}

export function useSongListContextMenu({
  currentPlaylistName,
  removeTrack,
  addToPlaylist,
  removeFromPlaylist,
  createPlaylist,
  deletePlaylist
}: UseSongListContextMenuOptions): {
  showContextMenu: Ref<boolean>
  menuX: Ref<number>
  menuY: Ref<number>
  selectedTrack: Ref<Track | null>
  showPlaylistSubmenu: Ref<boolean>
  showCreatePlaylistDialog: Ref<boolean>
  newPlaylistName: Ref<string>
  onContextMenu: (event: MouseEvent, track: Track) => void
  closeContextMenu: () => void
  handleDelete: () => void
  handleOpenFolder: () => Promise<void>
  handleAddToPlaylist: (playlistName: string) => void
  handleRemoveFromCurrentPlaylist: () => void
  openCreatePlaylistDialog: (track?: Track) => void
  handleCreatePlaylist: () => void
  handleCreatePlaylistFromMenu: () => void
  handleDeletePlaylist: (playlistId: string, event: MouseEvent) => void
} {
  const showContextMenu = ref(false)
  const menuX = ref(0)
  const menuY = ref(0)
  const selectedTrack = ref<Track | null>(null)
  const showPlaylistSubmenu = ref(false)
  const showCreatePlaylistDialog = ref(false)
  const newPlaylistName = ref('')
  const createPlaylistForTrack = ref<Track | null>(null)

  function onContextMenu(event: MouseEvent, track: Track): void {
    event.preventDefault()
    selectedTrack.value = track
    menuX.value = event.clientX
    menuY.value = event.clientY
    showContextMenu.value = true
    showPlaylistSubmenu.value = false

    nextTick(() => {
      const menu = document.querySelector('.context-menu') as HTMLElement
      if (menu) {
        const rect = menu.getBoundingClientRect()
        if (rect.right > window.innerWidth) {
          menuX.value -= rect.width
        }
        if (rect.bottom > window.innerHeight) {
          menuY.value -= rect.height
        }
      }
    })
  }

  function closeContextMenu(): void {
    showContextMenu.value = false
    showPlaylistSubmenu.value = false
  }

  function handleDelete(): void {
    if (selectedTrack.value) {
      removeTrack(selectedTrack.value.id)
      closeContextMenu()
    }
  }

  async function handleOpenFolder(): Promise<void> {
    if (selectedTrack.value) {
      await window.api.shell.showItemInFolder(selectedTrack.value.filePath)
      closeContextMenu()
    }
  }

  function handleAddToPlaylist(playlistName: string): void {
    if (selectedTrack.value) {
      addToPlaylist(playlistName, selectedTrack.value.id)
      closeContextMenu()
    }
  }

  function handleRemoveFromCurrentPlaylist(): void {
    const playlistName = currentPlaylistName.value
    if (!playlistName || !selectedTrack.value) return
    removeFromPlaylist(playlistName, selectedTrack.value.id)
    closeContextMenu()
  }

  function openCreatePlaylistDialog(track?: Track): void {
    createPlaylistForTrack.value = track ?? null
    newPlaylistName.value = ''
    showCreatePlaylistDialog.value = true
    closeContextMenu()
  }

  function handleCreatePlaylist(): void {
    const name = newPlaylistName.value.trim()
    if (!name) return
    createPlaylist(name)
    if (createPlaylistForTrack.value) {
      addToPlaylist(name, createPlaylistForTrack.value.id)
    }
    showCreatePlaylistDialog.value = false
    createPlaylistForTrack.value = null
    newPlaylistName.value = ''
  }

  function handleCreatePlaylistFromMenu(): void {
    openCreatePlaylistDialog(selectedTrack.value ?? undefined)
  }

  function handleDeletePlaylist(playlistId: string, event: MouseEvent): void {
    event.stopPropagation()
    deletePlaylist(playlistId)
  }

  onMounted(() => {
    window.addEventListener('click', closeContextMenu)
  })

  onUnmounted(() => {
    window.removeEventListener('click', closeContextMenu)
  })

  return {
    showContextMenu,
    menuX,
    menuY,
    selectedTrack,
    showPlaylistSubmenu,
    showCreatePlaylistDialog,
    newPlaylistName,
    onContextMenu,
    closeContextMenu,
    handleDelete,
    handleOpenFolder,
    handleAddToPlaylist,
    handleRemoveFromCurrentPlaylist,
    openCreatePlaylistDialog,
    handleCreatePlaylist,
    handleCreatePlaylistFromMenu,
    handleDeletePlaylist
  }
}
