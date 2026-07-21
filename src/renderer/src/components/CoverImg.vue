<template>
  <img
    v-if="displayCover"
    :src="displayCover"
    :alt="alt"
    :class="$attrs.class"
    loading="lazy"
    @error="onImageError"
  />
  <slot v-else name="placeholder">
    <img v-if="fallback" :src="fallback" :alt="alt" :class="$attrs.class" />
  </slot>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import {
  clearRemoteCoverGrantCache,
  invalidateRemoteCoverGrant,
  resolveCover,
  useCover
} from '../utils/coverLoader'

const props = defineProps<{
  cover: string | null | undefined
  /** Durable remote origin used to re-grant expired twilight-media handles. */
  coverSource?: string | null | undefined
  alt?: string
  fallback?: string
}>()

const emit = defineEmits<{ error: [event: Event] }>()

const coverRef = toRef(props, 'cover')
const coverSourceRef = toRef(props, 'coverSource')
const resolvedCover = useCover(
  computed(() => coverRef.value),
  computed(() => coverSourceRef.value)
)
const overrideCover = ref<string | null>(null)
const failed = ref(false)

const displayCover = computed(() => {
  if (failed.value) return null
  return overrideCover.value ?? resolvedCover.value
})

watch([() => props.cover, () => props.coverSource], () => {
  overrideCover.value = null
  failed.value = false
})

async function onImageError(event: Event): Promise<void> {
  const source =
    (typeof props.coverSource === 'string' && props.coverSource.trim()) ||
    (typeof props.cover === 'string' && /^https?:\/\//i.test(props.cover.trim())
      ? props.cover.trim()
      : '')
  if (source && !overrideCover.value) {
    invalidateRemoteCoverGrant(source)
    clearRemoteCoverGrantCache()
    const next = await resolveCover(null, source)
    if (next && next !== resolvedCover.value) {
      overrideCover.value = next
      return
    }
  }
  failed.value = true
  emit('error', event)
}
</script>
