<script setup lang="ts">
import { computed, ref } from 'vue'
import type { GlobalShortcutSettings, PlayerShortcutStatus } from '../../types/settings'

type BindingKey = keyof GlobalShortcutSettings

const props = defineProps<{
  globalShortcuts: boolean
  shortcutStatuses: PlayerShortcutStatus[]
  shortcutBindings: GlobalShortcutSettings
}>()

const emit = defineEmits<{
  'update:globalShortcuts': [value: boolean]
  'update:shortcutBindings': [patch: Partial<GlobalShortcutSettings>]
}>()

const EDITABLE_BINDINGS: { key: BindingKey; label: string; hint: string }[] = [
  { key: 'previous', label: '上一首', hint: '默认 Ctrl+Alt+←' },
  { key: 'next', label: '下一首', hint: '默认 Ctrl+Alt+→' },
  { key: 'playPause', label: '播放 / 暂停', hint: '默认 Ctrl+Alt+空格' },
  { key: 'toggleDesktopLyrics', label: '桌面歌词', hint: '默认 Ctrl+Alt+D' }
]

const EDIT_HINT =
  '点击输入框后直接按下组合键即可保存；支持 Ctrl / Alt / Shift / Meta 与 字母、数字、F1-F24、方向键、空格等。'

const focusedBinding = ref<BindingKey | null>(null)
const conflictBinding = ref<BindingKey | null>(null)

const bindingValues = computed<Record<BindingKey, string>>(() => ({
  previous: props.shortcutBindings.previous,
  next: props.shortcutBindings.next,
  playPause: props.shortcutBindings.playPause,
  toggleDesktopLyrics: props.shortcutBindings.toggleDesktopLyrics
}))

function onToggle(): void {
  emit('update:globalShortcuts', !props.globalShortcuts)
}

function findConflict(key: BindingKey, accelerator: string): BindingKey | null {
  for (const [otherKey, value] of Object.entries(bindingValues.value) as [BindingKey, string][]) {
    if (otherKey === key) continue
    if (value === accelerator) return otherKey
  }
  return null
}

function handleShortcutKeydown(key: BindingKey, event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()

  const parts: string[] = []
  if (event.ctrlKey) parts.push('CommandOrControl')
  if (event.metaKey && !event.ctrlKey) parts.push('CommandOrControl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')

  const keyName = event.key
  if (
    keyName === 'Control' ||
    keyName === 'Meta' ||
    keyName === 'Alt' ||
    keyName === 'Shift' ||
    keyName === 'CapsLock'
  ) {
    return
  }

  let mainKey: string
  if (keyName === ' ') {
    mainKey = 'Space'
  } else if (keyName === 'ArrowLeft') {
    mainKey = 'Left'
  } else if (keyName === 'ArrowRight') {
    mainKey = 'Right'
  } else if (keyName === 'ArrowUp') {
    mainKey = 'Up'
  } else if (keyName === 'ArrowDown') {
    mainKey = 'Down'
  } else if (keyName.startsWith('F') && /^F\d{1,2}$/.test(keyName)) {
    mainKey = keyName
  } else if (keyName.length === 1) {
    mainKey = keyName.toUpperCase()
  } else {
    mainKey = keyName
  }

  if (!/^[A-Za-z0-9]$/.test(mainKey) && !/^(F\d{1,2}|Left|Right|Up|Down|Space)$/.test(mainKey)) {
    // Unsupported key; skip silently
    return
  }

  const accelerator = [...parts, mainKey].join('+')
  onBindingChange(key, accelerator)
}

function onBindingChange(key: BindingKey, value: string): void {
  const trimmed = value.trim()
  if (!trimmed) return
  const conflict = findConflict(key, trimmed)
  conflictBinding.value = conflict
  if (conflict) return
  if (bindingValues.value[key] === trimmed) return
  emit('update:shortcutBindings', { [key]: trimmed })
}

function onBindingInputFocus(key: BindingKey): void {
  focusedBinding.value = key
  conflictBinding.value = null
}

function onBindingInputBlur(key: BindingKey): void {
  if (focusedBinding.value === key) {
    focusedBinding.value = null
  }
}
</script>

<template>
  <section id="shortcuts" class="glass-card preview-section">
    <div class="section-title-row">
      <i class="pi pi-key"></i>
      <h2>快捷键</h2>
    </div>
    <div class="setting-list">
      <div class="setting-item">
        <div class="setting-copy">
          <strong>全局快捷键 (Global Shortcuts)</strong>
          <span> 在应用位于后台时，依然响应系统媒体播放快捷键。下方可自定义各动作的组合键。 </span>
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
      <div class="shortcut-bindings">
        <p class="shortcut-hint">{{ EDIT_HINT }}</p>
        <div v-for="item in EDITABLE_BINDINGS" :key="item.key" class="shortcut-binding-row">
          <div class="shortcut-binding-label">
            <span>{{ item.label }}</span>
            <small>{{ item.hint }}</small>
          </div>
          <input
            class="shortcut-input"
            :class="{ conflict: conflictBinding === item.key }"
            :value="bindingValues[item.key]"
            :aria-label="`自定义全局快捷键：${item.label}`"
            @focus="onBindingInputFocus(item.key)"
            @blur="onBindingInputBlur(item.key)"
            @keydown="handleShortcutKeydown(item.key, $event)"
            @input="onBindingChange(item.key, ($event.target as HTMLInputElement).value)"
          />
        </div>
        <p v-if="conflictBinding" class="shortcut-conflict-tip">与其他快捷键冲突，已保留原值</p>
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

<style scoped>
.shortcut-bindings {
  display: grid;
  gap: 10px;
}

.shortcut-hint {
  margin: 0;
  color: var(--te-settings-text-muted, #8a8f98);
  font-size: 12px;
  line-height: 1.6;
}

.shortcut-binding-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 44px;
}

.shortcut-binding-label {
  display: grid;
  gap: 2px;
}

.shortcut-binding-label span {
  color: var(--te-settings-text, #1a1a1a);
  font-size: 13px;
  font-weight: 600;
}

.shortcut-binding-label small {
  color: var(--te-settings-text-muted, #8a8f98);
  font-size: 11px;
}

.shortcut-input {
  width: 220px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  outline: none;
  background: var(--te-card-bg);
  color: #374151;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  font-weight: 650;
  text-align: center;
}

.shortcut-input:focus {
  border-color: var(--te-primary-400, #3b82f6);
}

.shortcut-input.conflict {
  border-color: color-mix(in srgb, var(--te-danger-soft-fg) 50%, transparent);
}

.shortcut-conflict-tip {
  margin: 0;
  color: #dc2626;
  font-size: 11px;
}

@media (max-width: 760px) {
  .shortcut-binding-row {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }

  .shortcut-input {
    width: 100%;
  }
}
</style>
