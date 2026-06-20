<template>
  <img
    v-if="cover"
    :src="cover"
    :alt="alt"
    :class="$attrs.class"
    loading="lazy"
    @error="$emit('error', $event)"
  />
  <slot v-else name="placeholder">
    <img v-if="fallback" :src="fallback" :alt="alt" :class="$attrs.class" />
  </slot>
</template>

<script setup lang="ts">
defineProps<{
  cover: string | null | undefined
  alt?: string
  fallback?: string
}>()

defineEmits<{ error: [event: Event] }>()
</script>
