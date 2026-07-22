<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  THEME_TOKEN_DEFINITIONS,
  TWILIGHT_DEFAULT_THEME,
  TWILIGHT_DEFAULT_THEME_ID,
  normalizeThemeTokenOverrides,
  normalizeThemeTokenValue,
  type ThemeAssetBindings,
  type ThemeAssetType,
  type ThemeProfileV1,
  type ThemeSelection,
  type ThemeTokenDefinition,
  type ThemeTokenGroup,
  type ThemeTone
} from '../../../shared/theme.ts'
import { useExtensionRegistry, type ThemeContribution } from '../extensions/registry'
import { getPluginThemeKey } from '../extensions/themeSelection'
import { useThemeStore } from '../stores/useThemeStore'

const emit = defineEmits<{ back: [] }>()
const themeStore = useThemeStore()
const { themeContributions, syncExtensions } = useExtensionRegistry()
const selectedKey = ref('builtin')
const tone = ref<ThemeTone>('pureWhite')
const group = ref<ThemeTokenGroup>('colors')
const draft = ref<ThemeProfileV1 | null>(null)
const savedDraft = ref('')
const history = ref<ThemeProfileV1[]>([])
const historyIndex = ref(-1)
const localError = ref('')
const notice = ref('')
let originalTone: ThemeTone = 'pureWhite'

const groups: Array<{ id: ThemeTokenGroup; label: string; icon: string }> = [
  { id: 'colors', label: '色彩', icon: 'ph ph-palette' },
  { id: 'typography', label: '字体', icon: 'ph ph-text-aa' },
  { id: 'materials', label: '材质', icon: 'ph ph-stack' },
  { id: 'shape', label: '形状', icon: 'ph ph-square' },
  { id: 'layout', label: '布局', icon: 'ph ph-layout' },
  { id: 'motion', label: '动效', icon: 'ph ph-wind' },
  { id: 'playback', label: '播放', icon: 'ph ph-play-circle' }
]

const definitions = computed(() =>
  THEME_TOKEN_DEFINITIONS.filter((definition) => definition.group === group.value)
)
const profiles = computed(() => themeStore.profiles.value)
const activeKey = computed(() => selectionKey(themeStore.activeTheme.value))
const isDirty = computed(() =>
  draft.value ? JSON.stringify(draft.value) !== savedDraft.value : false
)
const canUndo = computed(() => historyIndex.value > 0)
const canRedo = computed(
  () => historyIndex.value >= 0 && historyIndex.value < history.value.length - 1
)
const selectedPluginTheme = computed(() =>
  themeContributions.value.find(
    (theme) => `plugin:${getPluginThemeKey(theme)}` === selectedKey.value
  )
)
const imageAssets = computed(
  () => draft.value?.assets?.filter((asset) => asset.type === 'image') ?? []
)
const fontAssets = computed(
  () => draft.value?.assets?.filter((asset) => asset.type === 'font') ?? []
)

const backgroundBindings: Array<{ key: keyof ThemeAssetBindings; label: string }> = [
  { key: 'appBackground', label: '全局背景' },
  { key: 'localBackground', label: '本地音乐背景' },
  { key: 'settingsBackground', label: '设置背景' },
  { key: 'streamingBackground', label: '流媒体背景' },
  { key: 'playerBackground', label: '播放页背景' }
]

const fontBindings: Array<{ key: keyof ThemeAssetBindings; label: string }> = [
  { key: 'sansFont', label: '正文资源字体' },
  { key: 'displayFont', label: '标题资源字体' },
  { key: 'roundedFont', label: '歌词资源字体' }
]

function cloneProfile(profile: ThemeProfileV1): ThemeProfileV1 {
  return JSON.parse(JSON.stringify(profile)) as ThemeProfileV1
}

function selectionKey(selection: ThemeSelection): string {
  if (selection.kind === 'builtin') return 'builtin'
  if (selection.kind === 'user') return `profile:${selection.id}`
  return `plugin:${selection.pluginId}:${selection.themeId}`
}

function resetHistory(profile: ThemeProfileV1): void {
  const clone = cloneProfile(profile)
  history.value = [clone]
  historyIndex.value = 0
  savedDraft.value = JSON.stringify(clone)
}

function pushHistory(profile: ThemeProfileV1): void {
  history.value = history.value.slice(0, historyIndex.value + 1)
  history.value.push(cloneProfile(profile))
  if (history.value.length > 50) history.value.shift()
  historyIndex.value = history.value.length - 1
}

async function selectBuiltIn(): Promise<void> {
  selectedKey.value = 'builtin'
  draft.value = null
  history.value = []
  historyIndex.value = -1
  await themeStore.previewTheme({ kind: 'builtin', id: TWILIGHT_DEFAULT_THEME_ID })
}

async function selectProfile(profile: ThemeProfileV1): Promise<void> {
  selectedKey.value = `profile:${profile.id}`
  draft.value = cloneProfile(profile)
  resetHistory(draft.value)
  await themeStore.preview(draft.value)
}

async function selectPlugin(theme: ThemeContribution): Promise<void> {
  selectedKey.value = `plugin:${getPluginThemeKey(theme)}`
  draft.value = null
  history.value = []
  historyIndex.value = -1
  await themeStore.previewTheme({ kind: 'plugin', pluginId: theme.pluginId, themeId: theme.id })
}

function createProfileFromPlugin(theme: ThemeContribution): ThemeProfileV1 {
  const profile = themeStore.createProfile(`${theme.name} 副本`)
  for (const currentTone of ['pureWhite', 'dark'] as const) {
    const structured = theme.structured?.variants[currentTone]?.tokens
    if (structured) profile.overrides[currentTone] = normalizeThemeTokenOverrides(structured)
  }
  const byVariable = new Map(
    THEME_TOKEN_DEFINITIONS.map((definition) => [definition.cssVariable, definition.id])
  )
  for (const [variable, value] of Object.entries(theme.variables ?? {})) {
    const id = byVariable.get(variable as `--te-${string}`)
    if (!id) continue
    const normalized = normalizeThemeTokenValue(id, value)
    if (!normalized) continue
    profile.overrides.pureWhite[id] = normalized
    profile.overrides.dark[id] = normalized
  }
  return profile
}

async function duplicateSelected(): Promise<void> {
  const sourceProfileId = draft.value?.id
  const source = draft.value
    ? cloneProfile(draft.value)
    : selectedPluginTheme.value
      ? createProfileFromPlugin(selectedPluginTheme.value)
      : null
  const profile = themeStore.createProfile(source ? `${source.name} 副本` : '自定义主题', source)
  selectedKey.value = `profile:${profile.id}`
  draft.value = profile
  resetHistory(profile)
  savedDraft.value = ''
  if (sourceProfileId && source?.assets?.length) {
    await themeStore.copyAssets(sourceProfileId, profile.id)
  }
  await themeStore.preview(profile)
}

async function importAsset(type: ThemeAssetType): Promise<void> {
  if (!draft.value) return
  try {
    const asset = await themeStore.importAsset(draft.value.id, type)
    if (!asset) return
    updateDraft((profile) => {
      const assets = profile.assets ?? []
      profile.assets = [...assets.filter((entry) => entry.id !== asset.id), asset]
    })
  } catch (cause) {
    localError.value = cause instanceof Error ? cause.message : '主题资源导入失败'
  }
}

function updateAssetBinding(key: keyof ThemeAssetBindings, event: Event): void {
  const assetId = (event.target as HTMLSelectElement).value
  updateDraft((profile) => {
    const bindings = { ...(profile.assetBindings ?? {}) }
    if (assetId) bindings[key] = assetId
    else delete bindings[key]
    profile.assetBindings = Object.keys(bindings).length > 0 ? bindings : undefined
  })
}

function valueFor(definition: ThemeTokenDefinition): string {
  return (
    draft.value?.overrides[tone.value][definition.id] ??
    TWILIGHT_DEFAULT_THEME.variants[tone.value].tokens[definition.id] ??
    definition.defaults[tone.value]
  )
}

function updateDraft(mutator: (profile: ThemeProfileV1) => void): void {
  if (!draft.value) return
  const next = cloneProfile(draft.value)
  mutator(next)
  next.updatedAt = new Date().toISOString()
  draft.value = next
  pushHistory(next)
  void themeStore.preview(next)
}

function updateToken(definition: ThemeTokenDefinition, raw: string): void {
  const normalized = normalizeThemeTokenValue(definition.id, raw)
  if (!normalized) {
    localError.value = `${definition.label}的值无效`
    return
  }
  localError.value = ''
  updateDraft((profile) => {
    profile.overrides[tone.value][definition.id] = normalized
  })
}

function updateRange(definition: ThemeTokenDefinition, event: Event): void {
  const value = (event.target as HTMLInputElement).value
  updateToken(definition, `${value}${definition.unit ?? ''}`)
}

function removeOverride(definition: ThemeTokenDefinition): void {
  updateDraft((profile) => {
    delete profile.overrides[tone.value][definition.id]
  })
}

function resetGroup(): void {
  updateDraft((profile) => {
    for (const definition of definitions.value) delete profile.overrides[tone.value][definition.id]
  })
}

function undo(): void {
  if (!canUndo.value) return
  historyIndex.value -= 1
  draft.value = cloneProfile(history.value[historyIndex.value])
  void themeStore.preview(draft.value)
}

function redo(): void {
  if (!canRedo.value) return
  historyIndex.value += 1
  draft.value = cloneProfile(history.value[historyIndex.value])
  void themeStore.preview(draft.value)
}

async function applySelected(): Promise<void> {
  localError.value = ''
  notice.value = ''
  try {
    if (draft.value) {
      await themeStore.saveProfile(draft.value)
      await themeStore.setActive({ kind: 'user', id: draft.value.id })
      savedDraft.value = JSON.stringify(draft.value)
      selectedKey.value = `profile:${draft.value.id}`
    } else if (selectedPluginTheme.value) {
      await themeStore.setActive({
        kind: 'plugin',
        pluginId: selectedPluginTheme.value.pluginId,
        themeId: selectedPluginTheme.value.id
      })
    } else {
      await themeStore.setActive({ kind: 'builtin', id: TWILIGHT_DEFAULT_THEME_ID })
    }
    notice.value = '主题已应用'
  } catch (cause) {
    localError.value = cause instanceof Error ? cause.message : '主题保存失败'
  }
}

async function deleteSelected(): Promise<void> {
  if (!draft.value || !profiles.value.some((profile) => profile.id === draft.value?.id)) return
  if (!window.confirm(`删除主题“${draft.value.name}”？`)) return
  try {
    await themeStore.deleteProfile(draft.value.id)
    await selectBuiltIn()
  } catch (cause) {
    localError.value = cause instanceof Error ? cause.message : '主题删除失败'
  }
}

async function importTheme(): Promise<void> {
  try {
    const next = await themeStore.importTheme()
    const imported = next?.data.profiles.at(-1)
    if (imported) await selectProfile(imported)
  } catch (cause) {
    localError.value = cause instanceof Error ? cause.message : '主题导入失败'
  }
}

async function exportTheme(): Promise<void> {
  if (!draft.value || !profiles.value.some((profile) => profile.id === draft.value?.id)) return
  try {
    const output = await themeStore.exportTheme(draft.value.id)
    if (output) notice.value = '主题已导出'
  } catch (cause) {
    localError.value = cause instanceof Error ? cause.message : '主题导出失败'
  }
}

async function toggleWindowInheritance(key: 'miniPlayer' | 'desktopLyrics'): Promise<void> {
  const current = themeStore.snapshot.value?.data.windowInheritance
  if (!current) return
  await themeStore.setWindowInheritance({ ...current, [key]: !current[key] })
}

function changeName(event: Event): void {
  const name = (event.target as HTMLInputElement).value.trim().slice(0, 80)
  if (!name) return
  updateDraft((profile) => {
    profile.name = name
  })
}

function rangeNumber(definition: ThemeTokenDefinition): number {
  return Number.parseFloat(valueFor(definition))
}

function supportsColorPicker(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value)
}

function setTone(nextTone: ThemeTone): void {
  tone.value = nextTone
  document.documentElement.dataset.theme = nextTone
  if (draft.value) {
    void themeStore.preview(draft.value)
    return
  }
  if (selectedPluginTheme.value) {
    void themeStore.previewTheme({
      kind: 'plugin',
      pluginId: selectedPluginTheme.value.pluginId,
      themeId: selectedPluginTheme.value.id
    })
    return
  }
  void themeStore.previewTheme({ kind: 'builtin', id: TWILIGHT_DEFAULT_THEME_ID })
}

function closeStudio(): void {
  if (isDirty.value && !window.confirm('放弃尚未应用的主题修改？')) return
  document.documentElement.dataset.theme = originalTone
  void themeStore.previewTheme(null)
  emit('back')
}

onMounted(async () => {
  await Promise.all([themeStore.load(), syncExtensions()])
  originalTone = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'pureWhite'
  tone.value = originalTone
  const active = themeStore.activeTheme.value
  if (active.kind === 'user') {
    const profile = profiles.value.find((entry) => entry.id === active.id)
    if (profile) await selectProfile(profile)
  } else if (active.kind === 'plugin') {
    const theme = themeContributions.value.find(
      (entry) => entry.pluginId === active.pluginId && entry.id === active.themeId
    )
    if (theme) await selectPlugin(theme)
  } else {
    await selectBuiltIn()
  }
})

onBeforeUnmount(() => {
  document.documentElement.dataset.theme = originalTone
  void themeStore.previewTheme(null)
})
</script>

<template>
  <div class="theme-studio-page" data-te-surface="theme-studio">
    <header class="theme-studio-header">
      <button
        type="button"
        class="studio-icon-button"
        title="返回"
        aria-label="返回"
        @click="closeStudio"
      >
        <i class="ph ph-arrow-left"></i>
      </button>
      <div>
        <h1>主题工作室</h1>
        <span>{{ isDirty ? '有未应用的修改' : '所有修改已同步' }}</span>
      </div>
      <div class="theme-studio-actions">
        <button
          type="button"
          class="studio-icon-button"
          title="撤销"
          aria-label="撤销"
          :disabled="!canUndo"
          @click="undo"
        >
          <i class="ph ph-arrow-counter-clockwise"></i>
        </button>
        <button
          type="button"
          class="studio-icon-button"
          title="重做"
          aria-label="重做"
          :disabled="!canRedo"
          @click="redo"
        >
          <i class="ph ph-arrow-clockwise"></i>
        </button>
        <button type="button" class="studio-command ghost" @click="duplicateSelected">
          <i class="ph ph-copy"></i><span>创建副本</span>
        </button>
        <button
          type="button"
          class="studio-command primary"
          :disabled="themeStore.saving.value"
          @click="applySelected"
        >
          <i :class="themeStore.saving.value ? 'pi pi-spin pi-spinner' : 'ph ph-check'"></i
          ><span>应用</span>
        </button>
      </div>
    </header>

    <div class="theme-studio-workspace">
      <aside class="theme-library-pane" aria-label="主题库">
        <div class="pane-heading">
          <strong>主题库</strong>
          <div>
            <button
              type="button"
              class="studio-icon-button"
              title="导入主题"
              aria-label="导入主题"
              @click="importTheme"
            >
              <i class="ph ph-download-simple"></i>
            </button>
            <button
              type="button"
              class="studio-icon-button"
              title="新建主题"
              aria-label="新建主题"
              @click="duplicateSelected"
            >
              <i class="ph ph-plus"></i>
            </button>
          </div>
        </div>

        <button
          type="button"
          class="theme-library-item"
          :class="{ selected: selectedKey === 'builtin', active: activeKey === 'builtin' }"
          @click="selectBuiltIn"
        >
          <span class="theme-swatch default-swatch"></span>
          <span><strong>Twilight Echo 默认主题</strong><small>内置 · 只读</small></span>
          <i v-if="activeKey === 'builtin'" class="ph ph-check"></i>
        </button>

        <button
          v-for="profile in profiles"
          :key="profile.id"
          type="button"
          class="theme-library-item"
          :class="{
            selected: selectedKey === `profile:${profile.id}`,
            active: activeKey === `profile:${profile.id}`
          }"
          @click="selectProfile(profile)"
        >
          <span
            class="theme-swatch"
            :style="{ background: profile.overrides.pureWhite['color.primary.500'] || '#2563eb' }"
          ></span>
          <span
            ><strong>{{ profile.name }}</strong
            ><small>个人主题</small></span
          >
          <i v-if="activeKey === `profile:${profile.id}`" class="ph ph-check"></i>
        </button>

        <div v-if="themeContributions.length" class="library-section-label">插件主题</div>
        <button
          v-for="theme in themeContributions"
          :key="getPluginThemeKey(theme)"
          type="button"
          class="theme-library-item"
          :class="{
            selected: selectedKey === `plugin:${getPluginThemeKey(theme)}`,
            active: activeKey === `plugin:${getPluginThemeKey(theme)}`
          }"
          @click="selectPlugin(theme)"
        >
          <span class="theme-swatch plugin-swatch"><i class="ph ph-puzzle-piece"></i></span>
          <span
            ><strong>{{ theme.name }}</strong
            ><small>{{ theme.pluginId }}</small></span
          >
          <i v-if="activeKey === `plugin:${getPluginThemeKey(theme)}`" class="ph ph-check"></i>
        </button>

        <div class="window-inheritance">
          <label>
            <span>迷你播放器</span>
            <input
              type="checkbox"
              :checked="themeStore.snapshot.value?.data.windowInheritance.miniPlayer"
              @change="toggleWindowInheritance('miniPlayer')"
            />
          </label>
          <label>
            <span>桌面歌词</span>
            <input
              type="checkbox"
              :checked="themeStore.snapshot.value?.data.windowInheritance.desktopLyrics"
              @change="toggleWindowInheritance('desktopLyrics')"
            />
          </label>
        </div>
      </aside>

      <main class="theme-preview-pane">
        <div class="preview-toolbar">
          <strong>实时预览</strong>
          <div class="studio-segment">
            <button
              type="button"
              :class="{ active: tone === 'pureWhite' }"
              @click="setTone('pureWhite')"
            >
              <i class="ph ph-sun"></i><span>浅色</span>
            </button>
            <button type="button" :class="{ active: tone === 'dark' }" @click="setTone('dark')">
              <i class="ph ph-moon"></i><span>深色</span>
            </button>
          </div>
        </div>

        <section class="theme-preview-stage">
          <div class="preview-titlebar">
            <i class="ph ph-list"></i><span>Twilight Echo</span><i class="ph ph-gear"></i>
          </div>
          <div class="preview-app-shell">
            <nav class="preview-sidebar">
              <strong>音乐库</strong>
              <span class="active"><i class="ph ph-house"></i>主页</span>
              <span><i class="ph ph-music-notes"></i>全部歌曲</span>
              <span><i class="ph ph-disc"></i>专辑</span>
            </nav>
            <div class="preview-content">
              <div class="preview-heading">
                <div>
                  <small>本地音乐</small>
                  <h2>晚上好</h2>
                </div>
                <button><i class="ph ph-play"></i>播放全部</button>
              </div>
              <div class="preview-cards">
                <article>
                  <span class="preview-cover violet"></span><strong>夜间播放</strong
                  ><small>24 首歌曲</small>
                </article>
                <article>
                  <span class="preview-cover cyan"></span><strong>最近添加</strong
                  ><small>12 首歌曲</small>
                </article>
                <article>
                  <span class="preview-cover rose"></span><strong>我的收藏</strong
                  ><small>86 首歌曲</small>
                </article>
              </div>
              <div class="preview-song-row">
                <span>01</span><span class="preview-song-art"></span
                ><span><strong>Twilight Echo</strong><small>Theme Studio</small></span
                ><i class="ph ph-heart"></i><span>4:12</span>
              </div>
            </div>
          </div>
          <div class="preview-playerbar">
            <span class="preview-song-art"></span
            ><span><strong>Twilight Echo</strong><small>Theme Studio</small></span
            ><i class="ph ph-skip-back"></i><button><i class="ph ph-pause"></i></button
            ><i class="ph ph-skip-forward"></i><span class="preview-progress"></span
            ><i class="ph ph-speaker-high"></i>
          </div>
        </section>
      </main>

      <aside class="theme-editor-pane" aria-label="主题编辑器">
        <div class="pane-heading">
          <strong>编辑</strong>
          <div>
            <button
              type="button"
              class="studio-icon-button"
              title="导出主题"
              aria-label="导出主题"
              :disabled="!draft"
              @click="exportTheme"
            >
              <i class="ph ph-upload-simple"></i>
            </button>
            <button
              type="button"
              class="studio-icon-button danger"
              title="删除主题"
              aria-label="删除主题"
              :disabled="!draft"
              @click="deleteSelected"
            >
              <i class="ph ph-trash"></i>
            </button>
          </div>
        </div>

        <input
          v-if="draft"
          class="theme-name-input"
          :value="draft.name"
          maxlength="80"
          aria-label="主题名称"
          @change="changeName"
        />
        <div v-else class="read-only-theme">
          <i class="ph ph-lock"></i><span>创建副本后编辑</span>
        </div>

        <nav class="editor-tabs" aria-label="主题令牌分组">
          <button
            v-for="item in groups"
            :key="item.id"
            type="button"
            :title="item.label"
            :aria-label="item.label"
            :class="{ active: group === item.id }"
            @click="group = item.id"
          >
            <i :class="item.icon"></i>
          </button>
        </nav>

        <section v-if="group === 'materials'" class="asset-editor">
          <div class="asset-editor-heading">
            <span>本地背景资源</span>
            <button type="button" :disabled="!draft" @click="importAsset('image')">
              <i class="ph ph-image-square"></i><span>导入图片</span>
            </button>
          </div>
          <label v-for="binding in backgroundBindings" :key="binding.key">
            <span>{{ binding.label }}</span>
            <select
              :value="draft?.assetBindings?.[binding.key] ?? ''"
              :disabled="!draft"
              @change="updateAssetBinding(binding.key, $event)"
            >
              <option value="">不使用资源</option>
              <option v-for="asset in imageAssets" :key="asset.id" :value="asset.id">
                {{ asset.path }}
              </option>
            </select>
          </label>
        </section>

        <section v-if="group === 'typography'" class="asset-editor">
          <div class="asset-editor-heading">
            <span>本地字体资源</span>
            <button type="button" :disabled="!draft" @click="importAsset('font')">
              <i class="ph ph-file-woff"></i><span>导入 WOFF2</span>
            </button>
          </div>
          <label v-for="binding in fontBindings" :key="binding.key">
            <span>{{ binding.label }}</span>
            <select
              :value="draft?.assetBindings?.[binding.key] ?? ''"
              :disabled="!draft"
              @change="updateAssetBinding(binding.key, $event)"
            >
              <option value="">使用令牌字体</option>
              <option v-for="asset in fontAssets" :key="asset.id" :value="asset.id">
                {{ asset.path }}
              </option>
            </select>
          </label>
        </section>

        <div class="token-editor-list" :class="{ disabled: !draft }">
          <div v-for="definition in definitions" :key="definition.id" class="token-editor-row">
            <div>
              <strong>{{ definition.label }}</strong
              ><small>{{ definition.surface }}</small>
            </div>
            <div class="token-control">
              <template v-if="definition.min != null && definition.max != null">
                <input
                  type="range"
                  :min="definition.min"
                  :max="definition.max"
                  :step="definition.step || 1"
                  :value="rangeNumber(definition)"
                  :disabled="!draft"
                  @input="updateRange(definition, $event)"
                />
                <code>{{ valueFor(definition) }}</code>
              </template>
              <template
                v-else-if="definition.kind === 'color' && supportsColorPicker(valueFor(definition))"
              >
                <input
                  type="color"
                  :value="valueFor(definition)"
                  :disabled="!draft"
                  @input="updateToken(definition, ($event.target as HTMLInputElement).value)"
                />
                <input
                  type="text"
                  :value="valueFor(definition)"
                  :disabled="!draft"
                  @change="updateToken(definition, ($event.target as HTMLInputElement).value)"
                />
              </template>
              <input
                v-else
                type="text"
                :value="valueFor(definition)"
                :disabled="!draft"
                @change="updateToken(definition, ($event.target as HTMLInputElement).value)"
              />
              <button
                type="button"
                class="studio-icon-button"
                title="恢复默认"
                aria-label="恢复默认"
                :disabled="!draft || !draft.overrides[tone][definition.id]"
                @click="removeOverride(definition)"
              >
                <i class="ph ph-arrow-u-up-left"></i>
              </button>
            </div>
          </div>
        </div>

        <button type="button" class="reset-group-button" :disabled="!draft" @click="resetGroup">
          <i class="ph ph-arrow-counter-clockwise"></i><span>恢复当前分组</span>
        </button>
        <p v-if="localError || themeStore.error.value" class="studio-message error">
          {{ localError || themeStore.error.value }}
        </p>
        <p v-else-if="notice" class="studio-message">{{ notice }}</p>
      </aside>
    </div>
  </div>
</template>

<style src="./theme-studio/ThemeStudioPage.css"></style>
