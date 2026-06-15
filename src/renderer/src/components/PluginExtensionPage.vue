<script setup lang="ts">
import { computed, ref } from 'vue'
import type { UiContribution } from '../extensions/registry'

const props = defineProps<{
  page: UiContribution
}>()

const emit = defineEmits<{
  back: []
}>()

const running = ref(false)
const error = ref('')
const lastResult = ref('')

const subtitle = computed(() => props.page.description || props.page.pluginId)

async function runPageCommand(): Promise<void> {
  if (!props.page.command || running.value) return
  running.value = true
  error.value = ''
  lastResult.value = ''
  try {
    const result = await window.api.extensions.executeCommand(props.page.command, [
      {
        source: 'sidebarPage',
        pageId: props.page.id
      }
    ])
    if (result != null) {
      lastResult.value = typeof result === 'string' ? result : JSON.stringify(result)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    running.value = false
  }
}
</script>

<template>
  <section class="plugin-extension-page">
    <header class="plugin-extension-header">
      <button class="plugin-extension-back" type="button" title="返回" @click="emit('back')">
        <i class="pi pi-arrow-left"></i>
      </button>
      <div class="plugin-extension-icon">
        <i :class="page.icon || 'pi pi-box'"></i>
      </div>
      <div class="plugin-extension-heading">
        <span>{{ page.pluginId }}</span>
        <h1>{{ page.title }}</h1>
        <p>{{ subtitle }}</p>
      </div>
      <button
        class="plugin-extension-action"
        type="button"
        :disabled="!page.command || running"
        @click="runPageCommand"
      >
        <i class="pi pi-play"></i>
        {{ running ? '执行中' : '运行' }}
      </button>
    </header>

    <div class="plugin-extension-body">
      <div class="plugin-extension-card">
        <span class="plugin-extension-kicker">受控插件页面</span>
        <h2>{{ page.title }}</h2>
        <p>{{ page.description || '该页面由插件注册，渲染入口由宿主控制。' }}</p>
        <div v-if="lastResult" class="plugin-extension-result">{{ lastResult }}</div>
        <div v-if="error" class="plugin-extension-error">{{ error }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.plugin-extension-page {
  min-height: calc(100vh - 32px);
  padding: 46px clamp(24px, 5vw, 76px) 120px;
  background: #f8fafc;
}

.plugin-extension-header {
  display: grid;
  grid-template-columns: 36px 54px minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  max-width: 960px;
  margin: 0 auto 20px;
}

.plugin-extension-back {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(17, 24, 39, 0.08);
  border-radius: 7px;
  background: #fff;
  color: var(--te-neutral-700);
  cursor: pointer;
}

.plugin-extension-icon {
  width: 54px;
  height: 54px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: #111827;
  color: #fff;
  font-size: 22px;
}

.plugin-extension-heading {
  min-width: 0;
}

.plugin-extension-heading span {
  display: block;
  color: var(--te-neutral-500);
  font-size: 12px;
  font-weight: 800;
}

.plugin-extension-heading h1 {
  margin: 3px 0;
  color: var(--te-neutral-900);
  font-size: 28px;
  line-height: 1.15;
}

.plugin-extension-heading p {
  margin: 0;
  color: var(--te-neutral-600);
  font-size: 13px;
  font-weight: 700;
}

.plugin-extension-action {
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 13px;
  border: 0;
  border-radius: 7px;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
  font-size: 13px;
  font-weight: 800;
}

.plugin-extension-action:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}

.plugin-extension-body {
  max-width: 960px;
  margin: 0 auto;
}

.plugin-extension-card {
  display: grid;
  gap: 8px;
  padding: 18px;
  border: 1px solid rgba(17, 24, 39, 0.08);
  border-radius: 8px;
  background: #fff;
}

.plugin-extension-kicker {
  color: var(--te-neutral-500);
  font-size: 11px;
  font-weight: 900;
}

.plugin-extension-card h2 {
  margin: 0;
  color: var(--te-neutral-900);
  font-size: 17px;
}

.plugin-extension-card p,
.plugin-extension-result,
.plugin-extension-error {
  margin: 0;
  color: var(--te-neutral-600);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.5;
}

.plugin-extension-result,
.plugin-extension-error {
  padding: 10px 12px;
  border-radius: 7px;
  background: #f8fafc;
}

.plugin-extension-error {
  background: #fef2f2;
  color: #b91c1c;
}
</style>
