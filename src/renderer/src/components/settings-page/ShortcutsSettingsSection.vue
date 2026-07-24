<script setup lang="ts">
import type { PlayerShortcutStatus } from '../../types/settings'

const props = defineProps<{
  globalShortcuts: boolean
  shortcutStatuses: PlayerShortcutStatus[]
}>()

const emit = defineEmits<{
  'update:globalShortcuts': [value: boolean]
}>()

function onToggle(): void {
  emit('update:globalShortcuts', !props.globalShortcuts)
}
</script>

<template>
  <section id="shortcuts" class="glass-card preview-section">
    <div class="section-title-row">
      <i class="pi pi-keyboard"></i>
      <h2>快捷键</h2>
    </div>
    <div class="setting-list">
      <div class="setting-item">
        <div class="setting-copy">
          <strong>全局快捷键 (Global Shortcuts)</strong>
          <span>在应用位于后台时，依然响应系统媒体播放快捷键。</span>
        </div>
        <span
          class="toggle-switch"
          :class="{ active: globalShortcuts, inactive: !globalShortcuts }"
          role="switch"
          :aria-checked="globalShortcuts"
          @click="onToggle"
        ></span>
      </div>
      <hr />
      <div v-if="shortcutStatuses.length > 0" class="shortcut-grid">
        <div v-for="shortcut in shortcutStatuses" :key="JSON.stringify(shortcut.action)">
          <span>{{ shortcut.label }}</span>
          <kbd>{{ shortcut.accelerator }}</kbd>
        </div>
      </div>
      <div v-else class="shortcut-grid">
        <div><span>快捷键状态</span><kbd>读取中</kbd></div>
      </div>
      <div v-if="shortcutStatuses.length > 0" class="shortcut-status-list">
        <div
          v-for="shortcut in shortcutStatuses"
          :key="`${shortcut.action}:status`"
          class="shortcut-status-row"
          :class="{
            registered: globalShortcuts && shortcut.registered,
            failed: globalShortcuts && !shortcut.registered
          }"
        >
          <span>
            <i
              :class="
                !globalShortcuts
                  ? 'pi pi-minus-circle'
                  : shortcut.registered
                    ? 'pi pi-check-circle'
                    : 'pi pi-exclamation-circle'
              "
            ></i>
            {{ shortcut.label }}
          </span>
          <small>
            {{
              !globalShortcuts
                ? '未启用'
                : shortcut.registered
                  ? '已注册'
                  : shortcut.error || '注册失败'
            }}
          </small>
        </div>
      </div>
    </div>
  </section>
</template>
