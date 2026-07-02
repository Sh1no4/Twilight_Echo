import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef, type Ref } from 'vue'

export function useFloatingPanels(shellRef: Ref<HTMLElement | null>): {
  volumeOpen: Ref<boolean>
  playlistOpen: Ref<boolean>
  moreOpen: Ref<boolean>
  floatingPanelOpen: ComputedRef<boolean>
  closeFloatingPanels: () => void
  dismissFloatingPanels: () => void
  onDocumentPointerDown: (event: PointerEvent) => void
  toggleVolume: () => void
  togglePlaylist: () => void
  toggleMore: () => void
} {
  const volumeOpen = ref(false)
  const playlistOpen = ref(false)
  const moreOpen = ref(false)
  const floatingPanelOpen = computed(() => volumeOpen.value || playlistOpen.value || moreOpen.value)

  function closeFloatingPanels(): void {
    volumeOpen.value = false
    playlistOpen.value = false
    moreOpen.value = false
  }

  function dismissFloatingPanels(): void {
    closeFloatingPanels()
  }

  function onDocumentPointerDown(event: PointerEvent): void {
    if (!volumeOpen.value && !playlistOpen.value && !moreOpen.value) return
    const target = event.target
    if (target instanceof Node && shellRef.value?.contains(target)) return
    closeFloatingPanels()
  }

  function toggleVolume(): void {
    volumeOpen.value = !volumeOpen.value
    if (volumeOpen.value) {
      playlistOpen.value = false
      moreOpen.value = false
    }
  }

  function togglePlaylist(): void {
    playlistOpen.value = !playlistOpen.value
    if (playlistOpen.value) {
      volumeOpen.value = false
      moreOpen.value = false
    }
  }

  function toggleMore(): void {
    moreOpen.value = !moreOpen.value
    if (moreOpen.value) {
      volumeOpen.value = false
      playlistOpen.value = false
    }
  }

  onMounted(() => {
    document.addEventListener('pointerdown', onDocumentPointerDown)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onDocumentPointerDown)
  })

  return {
    volumeOpen,
    playlistOpen,
    moreOpen,
    floatingPanelOpen,
    closeFloatingPanels,
    dismissFloatingPanels,
    onDocumentPointerDown,
    toggleVolume,
    togglePlaylist,
    toggleMore
  }
}
