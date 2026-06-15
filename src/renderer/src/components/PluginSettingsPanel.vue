<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

type PluginStatus = 'installed' | 'enabled' | 'disabled' | 'invalid' | 'failed'

interface PluginDescriptor {
  id: string
  name: string
  version: string
  description: string
  author: string
  license: string
  type: string[]
  main?: string
  dependencies?: Record<string, string>
  permissions: string[]
  status: PluginStatus
  enabled: boolean
  builtIn: boolean
  error: string | null
  isDsp: boolean
  source: 'directory' | 'tep' | 'bundled' | 'scan'
  installedAt: string | null
  updatedAt: string | null
  paths: {
    versionRoot: string
    dataDir: string
    logPath: string
  }
}

const plugins = ref<PluginDescriptor[]>([])
const loading = ref(false)
const busyId = ref<string | null>(null)
const error = ref('')
const selectedLog = ref('')
const selectedLogPlugin = ref('')
let removePluginListener: (() => void) | null = null

const enabledCount = computed(() => plugins.value.filter((plugin) => plugin.enabled).length)

async function refreshPlugins(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    plugins.value = await window.api.plugins.list()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function installPlugin(): Promise<void> {
  error.value = ''
  const result = await window.api.plugins.chooseAndInstall()
  if (result) {
    await refreshPlugins()
  }
}

async function togglePlugin(plugin: PluginDescriptor): Promise<void> {
  busyId.value = plugin.id
  error.value = ''
  try {
    if (plugin.enabled) {
      await window.api.plugins.disable(plugin.id)
    } else {
      await window.api.plugins.enable(plugin.id)
    }
    await refreshPlugins()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    await refreshPlugins()
  } finally {
    busyId.value = null
  }
}

async function uninstallPlugin(plugin: PluginDescriptor): Promise<void> {
  const removeData = window.confirm(`卸载 ${plugin.name}？\n\n选择“确定”会同时清除插件私有数据。选择“取消”仅卸载插件文件。`)
  busyId.value = plugin.id
  error.value = ''
  try {
    await window.api.plugins.uninstall(plugin.id, { removeData })
    await refreshPlugins()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busyId.value = null
  }
}

async function openLog(plugin: PluginDescriptor): Promise<void> {
  await window.api.plugins.openLog(plugin.id)
}

async function previewLog(plugin: PluginDescriptor): Promise<void> {
  selectedLogPlugin.value = plugin.name
  selectedLog.value = await window.api.plugins.getLog(plugin.id)
}

function statusLabel(status: PluginStatus): string {
  const labels: Record<PluginStatus, string> = {
    installed: '已安装',
    enabled: '已启用',
    disabled: '已停用',
    invalid: '无效',
    failed: '失败'
  }
  return labels[status]
}

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    provider: '音源',
    tool: '工具',
    ui: '界面',
    theme: '主题',
    dsp: 'DSP'
  }
  return labels[type] ?? type
}

function dependencyEntries(plugin: PluginDescriptor): [string, string][] {
  return Object.entries(plugin.dependencies ?? {})
}

function formatDate(value: string | null): string {
  if (!value) return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

onMounted(() => {
  void refreshPlugins()
  removePluginListener = window.api.plugins.onChanged(() => {
    void refreshPlugins()
  })
})

onUnmounted(() => {
  removePluginListener?.()
})
</script>

<template>
  <div class="plugin-panel">
    <div class="plugin-hero">
      <div>
        <span class="plugin-kicker">Trust-based plugin runtime</span>
        <h3>插件系统</h3>
        <p>安装前会展示权限；启用后的 JS 插件运行在独立 utilityProcess，不会直接 import 宿主内部模块。</p>
      </div>
      <div class="plugin-actions">
        <button class="text-button" :disabled="loading" @click="refreshPlugins">
          <i class="pi pi-sync"></i>
          刷新
        </button>
        <button class="primary-button" @click="installPlugin">
          <i class="pi pi-plus"></i>
          安装目录 / .tep
        </button>
      </div>
    </div>

    <div class="plugin-summary">
      <span>已安装 {{ plugins.length }}</span>
      <span>已启用 {{ enabledCount }}</span>
      <span>日志：logs/plugins/&lt;id&gt;.log</span>
    </div>

    <div v-if="error" class="plugin-error">{{ error }}</div>

    <div v-if="plugins.length === 0 && !loading" class="plugin-empty">
      暂无插件。可以安装官方 hello-world 示例或本地 .tep 包。
    </div>

    <div class="plugin-list">
      <article
        v-for="plugin in plugins"
        :key="`${plugin.id}:${plugin.version}`"
        class="plugin-card"
        :class="{ failed: plugin.status === 'failed' || plugin.status === 'invalid' }"
      >
        <div class="plugin-card-main">
          <div class="plugin-title-row">
            <h4>{{ plugin.name }}</h4>
            <span class="plugin-pill" :class="plugin.status">{{ statusLabel(plugin.status) }}</span>
            <span v-if="plugin.builtIn" class="plugin-pill builtin">自带基础插件</span>
            <span v-if="plugin.isDsp" class="plugin-pill native">原生 DSP 风险</span>
          </div>
          <p>{{ plugin.description || '没有描述' }}</p>
          <div class="plugin-meta">
            <span>{{ plugin.id }}</span>
            <span>v{{ plugin.version }}</span>
            <span>{{ plugin.author }}</span>
            <span>更新 {{ formatDate(plugin.updatedAt) }}</span>
          </div>
          <div class="plugin-tags">
            <span v-for="type in plugin.type" :key="type">{{ typeLabel(type) }}</span>
          </div>
          <div v-if="dependencyEntries(plugin).length > 0" class="plugin-dependencies">
            <strong>依赖</strong>
            <code v-for="[dependencyId, range] in dependencyEntries(plugin)" :key="dependencyId">
              {{ dependencyId }} {{ range }}
            </code>
          </div>
          <div class="plugin-permissions">
            <strong>权限</strong>
            <span v-if="plugin.permissions.length === 0">无</span>
            <code v-for="permission in plugin.permissions" :key="permission">{{ permission }}</code>
          </div>
          <div v-if="plugin.error" class="plugin-card-error">{{ plugin.error }}</div>
        </div>
        <div class="plugin-card-actions">
          <button
            class="text-button"
            :disabled="busyId === plugin.id || plugin.status === 'invalid' || (plugin.isDsp && !plugin.main)"
            @click="togglePlugin(plugin)"
          >
            {{ plugin.enabled ? '停用' : '启用' }}
          </button>
          <button class="text-button" @click="previewLog(plugin)">查看日志</button>
          <button class="icon-button subtle" title="打开日志文件" @click="openLog(plugin)">
            <i class="pi pi-external-link"></i>
          </button>
          <button
            class="danger-button"
            :disabled="busyId === plugin.id || plugin.builtIn"
            :title="plugin.builtIn ? '自带插件不能卸载，可停用' : '卸载插件'"
            @click="uninstallPlugin(plugin)"
          >
            卸载
          </button>
        </div>
      </article>
    </div>

    <div v-if="selectedLogPlugin" class="plugin-log">
      <div class="plugin-log-head">
        <strong>{{ selectedLogPlugin }} 日志</strong>
        <button class="icon-button subtle" @click="selectedLogPlugin = ''; selectedLog = ''">
          <i class="pi pi-times"></i>
        </button>
      </div>
      <pre>{{ selectedLog || '暂无日志' }}</pre>
    </div>
  </div>
</template>

<style scoped>
.plugin-panel,
.plugin-list {
  display: grid;
  gap: 12px;
}

.plugin-hero,
.plugin-card,
.plugin-log {
  border: 1px solid rgba(17, 24, 39, 0.08);
  border-radius: 10px;
  background: #fff;
}

.plugin-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 20px;
  padding: 18px;
}

.plugin-kicker {
  color: var(--te-neutral-500);
  font-size: 12px;
  font-weight: 900;
}

.plugin-hero h3,
.plugin-card h4 {
  margin: 0;
  color: var(--te-neutral-900);
}

.plugin-hero p,
.plugin-card p {
  margin: 6px 0 0;
  color: var(--te-neutral-600);
  font-size: 13px;
  line-height: 1.5;
}

.plugin-actions,
.plugin-card-actions,
.plugin-title-row,
.plugin-meta,
.plugin-tags,
.plugin-dependencies,
.plugin-permissions,
.plugin-summary,
.plugin-log-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.plugin-summary,
.plugin-empty,
.plugin-error {
  padding: 10px 14px;
  border-radius: 8px;
  background: #f8fafc;
  color: var(--te-neutral-600);
  font-size: 12px;
  font-weight: 800;
}

.plugin-error,
.plugin-card-error {
  background: #fef2f2;
  color: #dc2626;
}

.plugin-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  padding: 16px;
}

.plugin-card.failed {
  border-color: rgba(220, 38, 38, 0.22);
}

.plugin-meta,
.plugin-tags,
.plugin-dependencies,
.plugin-permissions {
  margin-top: 10px;
  color: var(--te-neutral-500);
  font-size: 12px;
}

.plugin-tags span,
.plugin-pill,
.plugin-dependencies code,
.plugin-permissions code {
  border-radius: 999px;
  padding: 4px 8px;
  background: #f1f5f9;
  color: var(--te-neutral-600);
  font-size: 11px;
  font-weight: 900;
}

.plugin-pill.enabled {
  background: #ecfdf5;
  color: #047857;
}

.plugin-pill.failed,
.plugin-pill.invalid,
.plugin-pill.native {
  background: #fff7ed;
  color: #c2410c;
}

.plugin-pill.builtin {
  background: #eff6ff;
  color: #1d4ed8;
}

.plugin-card-error {
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
}

.plugin-card-actions {
  justify-content: flex-end;
}

.plugin-log {
  overflow: hidden;
}

.plugin-log-head {
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(17, 24, 39, 0.08);
}

.plugin-log pre {
  max-height: 260px;
  margin: 0;
  overflow: auto;
  padding: 14px;
  background: #0f172a;
  color: #dbeafe;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}

@media (max-width: 820px) {
  .plugin-hero,
  .plugin-card {
    grid-template-columns: 1fr;
  }

  .plugin-card-actions {
    justify-content: flex-start;
  }
}
</style>
