<script setup lang="ts">
import { onMounted, ref } from 'vue'

const props = defineProps<{
  profileId: string
  entryId: string
}>()

const src = ref('')

onMounted(async () => {
  const url = await window.api?.networkSources?.coverDataUrl(props.profileId, props.entryId)
  if (url) src.value = url
})
</script>

<template>
  <img v-if="src" :src="src" class="network-cover-thumb" alt="" loading="lazy" />
  <span v-else class="network-cover-placeholder"><i class="pi pi-music"></i></span>
</template>

<style scoped>
.network-cover-thumb {
  width: 30px;
  height: 30px;
  border-radius: 6px;
  object-fit: cover;
}

.network-cover-placeholder {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: rgba(var(--te-primary-rgb), 0.08);
  color: var(--te-settings-text-muted, #8a8f98);
  font-size: 12px;
}
</style>
