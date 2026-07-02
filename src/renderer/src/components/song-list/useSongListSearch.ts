import { onUnmounted, ref, watch, type Ref } from 'vue'

export function useSongListSearch(): {
  searchQuery: Ref<string>
  debouncedSearchQuery: Ref<string>
  searchInputFocused: Ref<boolean>
} {
  const searchQuery = ref('')
  const debouncedSearchQuery = ref('')
  const searchInputFocused = ref(false)
  let searchDebounceTimer: number | null = null

  watch(searchQuery, (value) => {
    if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer)
    searchDebounceTimer = window.setTimeout(() => {
      debouncedSearchQuery.value = value
      searchDebounceTimer = null
    }, 180)
  })

  onUnmounted(() => {
    if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer)
  })

  return {
    searchQuery,
    debouncedSearchQuery,
    searchInputFocused
  }
}
