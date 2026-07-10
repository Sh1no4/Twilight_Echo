<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { cloneMiniPlayerSettings, type MiniPlayerSettings } from '../../../../shared/miniPlayer'
import { useSettingsStore } from '../../stores/useSettingsStore'
import MiniPlayerCustomizer from '../../mini-player/MiniPlayerCustomizer.vue'
import { useMiniPlayerCustomizationDraft } from '../../mini-player/useMiniPlayerCustomizationDraft'

const { settings, updateSettings, chooseBackgroundImage } = useSettingsStore()
const open = ref(false)
let localPersistenceCount = 0

const customization = useMiniPlayerCustomizationDraft({
  initial: cloneMiniPlayerSettings(settings.value.miniPlayer),
  persist
})

async function persist(miniPlayer: MiniPlayerSettings): Promise<MiniPlayerSettings> {
  localPersistenceCount += 1
  try {
    const next = await updateSettings({ miniPlayer })
    return next.miniPlayer
  } finally {
    localPersistenceCount -= 1
  }
}

async function pickBackgroundImage(): Promise<string | null> {
  return await chooseBackgroundImage()
}

async function toggleOpen(): Promise<void> {
  if (!open.value) {
    customization.beginSession()
    open.value = true
    return
  }

  try {
    await customization.flush()
    open.value = false
  } catch {
    // Keep the editor open so the persistence error remains visible.
  }
}

watch(
  () => settings.value.miniPlayer,
  (next) => {
    if (localPersistenceCount === 0) customization.acceptConfirmed(next)
  },
  { deep: true, flush: 'sync' }
)

onBeforeUnmount(() => {
  const pendingFlush = customization.flush()
  customization.dispose()
  void pendingFlush.catch(() => undefined)
})
</script>

<template>
  <div class="mini-player-settings-section">
    <button
      type="button"
      class="mini-player-settings-trigger"
      :class="{ open }"
      :aria-expanded="open"
      @click="toggleOpen"
    >
      <span>
        <i class="ph ph-device-mobile-speaker"></i>
        <strong>迷你播放器</strong>
      </span>
      <i class="ph ph-caret-down"></i>
    </button>

    <MiniPlayerCustomizer
      v-if="open"
      :settings="customization.settings.value"
      mode="inline"
      :saving="customization.saving.value"
      :error="customization.error.value"
      :pick-background-image="pickBackgroundImage"
      @update:settings="customization.replaceSettings"
      @undo="customization.undoSession"
      @reset="customization.resetActiveTheme"
      @flush="customization.flush"
    />
  </div>
</template>

<style scoped>
.mini-player-settings-section {
  min-width: 0;
  padding-top: 12px;
  border-top: 1px solid var(--te-card-border, rgba(27, 32, 52, 0.12));
}

.mini-player-settings-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 42px;
  padding: 0 4px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.mini-player-settings-trigger > span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.mini-player-settings-trigger > i:last-child {
  transition: transform 160ms ease;
}

.mini-player-settings-trigger.open > i:last-child {
  transform: rotate(180deg);
}

.mini-player-settings-trigger:focus-visible {
  outline: 2px solid var(--te-accent, #5966d9);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .mini-player-settings-trigger > i:last-child {
    transition-duration: 0.01ms;
  }
}
</style>
