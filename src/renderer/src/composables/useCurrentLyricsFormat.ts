import { computed } from 'vue'
import { projectManagedLyrics } from '../../../shared/lyricsManagement.ts'
import { useLyricsManagement } from '../stores/lyricsManagement.ts'
import { usePlayerStore } from '../stores/usePlayerStore.ts'
import { isAmlTtml } from '../utils/amllTtml.ts'

export function useCurrentLyricsFormat() {
  const playbackStore = usePlayerStore()
  const lyricsManagement = useLyricsManagement()
  const managedLyrics = computed(() => {
    const track = playbackStore.currentTrack.value
    return projectManagedLyrics(
      {
        original: track?.lyrics,
        translation: track?.translatedLyrics,
        romanization: track?.romanizedLyrics,
        originalSource: track?.lyricsSource,
        translationSource: track?.translatedLyricsSource,
        romanizationSource: track?.romanizedLyricsSource
      },
      lyricsManagement.entryFor(track?.id ?? '')
    )
  })

  return {
    isCurrentTtml: computed(() => isAmlTtml(managedLyrics.value.original))
  }
}
