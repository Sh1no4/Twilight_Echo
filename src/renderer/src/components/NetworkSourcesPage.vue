<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { usePlayerStore } from '../stores/usePlayerStore'
import type { Track } from '../types/music'
import type {
  NetworkEntry,
  NetworkPlaybackPlan,
  NetworkSourceProfileSummary
} from '../../../shared/networkSources.ts'

defineEmits<{ back: [] }>()

const networkSourcesApi = window.api?.networkSources

const profiles = ref<NetworkSourceProfileSummary[]>([])
const loading = ref(false)
const error = ref('')
const notice = ref('')
const showCreateForm = ref(false)

const creating = ref(false)
const form = ref({
  protocol: 'webdav' as 'webdav' | 'ftp' | 'ftps',
  name: '',
  host: '',
  port: '',
  rootPath: '/',
  username: '',
  authKind: 'anonymous' as 'anonymous' | 'password',
  password: ''
})

const browsingProfile = ref<NetworkSourceProfileSummary | null>(null)
const currentPath = ref('/')
const entries = ref<NetworkEntry[]>([])
const browsing = ref(false)
const scanning = ref(false)
const browsingError = ref('')

const viewMode = ref<'profiles' | 'library'>('profiles')
const libraryQuery = ref('')
const libraryEntries = ref<Array<{ profileName: string; entry: NetworkEntry }>>([])
const libraryLoading = ref(false)

const breadcrumbs = computed(() => {
  const parts = currentPath.value.split('/').filter(Boolean)
  const crumbs: Array<{ label: string; path: string }> = [{ label: '根目录', path: '/' }]
  let acc = ''
  for (const part of parts) {
    acc += `/${part}`
    crumbs.push({ label: part, path: acc })
  }
  return crumbs
})

const audioEntries = computed(() => entries.value.filter((entry) => entry.kind === 'audio'))

function setError(message: string): void {
  error.value = message
}

function setNotice(message: string): void {
  notice.value = message
  window.setTimeout(() => {
    if (notice.value === message) notice.value = ''
  }, 4000)
}

async function loadProfiles(): Promise<void> {
  if (!networkSourcesApi) return
  loading.value = true
  error.value = ''
  try {
    profiles.value = await networkSourcesApi.listProfiles()
  } catch (err) {
    setError(`读取网络源列表失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    loading.value = false
  }
}

async function createProfile(): Promise<void> {
  if (!networkSourcesApi) return
  creating.value = true
  error.value = ''
  try {
    const port = form.value.port.trim() ? Number(form.value.port) : null
    await networkSourcesApi.createProfile({
      protocol: form.value.protocol,
      name: form.value.name.trim(),
      host: form.value.host.trim(),
      port,
      rootPath: form.value.rootPath.trim() || '/',
      username: form.value.username.trim() || undefined,
      auth:
        form.value.authKind === 'password'
          ? { kind: 'password', password: form.value.password }
          : { kind: 'anonymous' }
    })
    showCreateForm.value = false
    form.value = {
    protocol: 'webdav',
      name: '',
      host: '',
      port: '',
      rootPath: '/',
      username: '',
      authKind: 'anonymous',
      password: ''
    }
    await loadProfiles()
    setNotice('网络源已添加')
  } catch (err) {
    setError(`添加失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    creating.value = false
  }
}

async function deleteProfile(id: string): Promise<void> {
  if (!networkSourcesApi) return
  if (!window.confirm('确定删除该网络源吗？（不会删除远程文件）')) return
  try {
    await networkSourcesApi.deleteProfile(id)
    await loadProfiles()
    setNotice('已删除')
  } catch (err) {
    setError(`删除失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

async function testConnection(id: string): Promise<void> {
  if (!networkSourcesApi) return
  try {
    const result = await networkSourcesApi.testConnection(id)
    if (result.ok) {
      setNotice('连接成功')
    } else {
      setError(`连接失败：${result.errorCode ?? 'unknown'}`)
    }
  } catch (err) {
    setError(`连接测试失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

async function enterBrowse(profile: NetworkSourceProfileSummary): Promise<void> {
  browsingProfile.value = profile
  currentPath.value = profile.rootPath
  entries.value = []
  browsingError.value = ''
  await navigateTo(profile.rootPath)
}

async function navigateTo(path: string): Promise<void> {
  if (!networkSourcesApi || !browsingProfile.value) return
  browsing.value = true
  browsingError.value = ''
  try {
    currentPath.value = path
    entries.value = await networkSourcesApi.listDirectory(browsingProfile.value.id, path)
  } catch (err) {
    browsingError.value = `读取目录失败：${err instanceof Error ? err.message : String(err)}`
    entries.value = []
  } finally {
    browsing.value = false
  }
}

function leaveBrowse(): void {
  browsingProfile.value = null
  currentPath.value = '/'
  entries.value = []
  browsingError.value = ''
}

function formatBytes(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024
    unit = units[index]
  }
  return `${value.toFixed(1)} ${unit}`
}

function buildTrack(entry: NetworkEntry, plan: NetworkPlaybackPlan): Track {
  const extension = entry.name.includes('.') ? entry.name.split('.').pop() ?? '' : ''
  return {
    id: entry.id,
    title: entry.name.replace(/\.[^.]+$/, ''),
    artist: browsingProfile.value?.name ?? '网络源',
    album: browsingProfile.value?.name ?? '网络源',
    filePath: plan.kind === 'direct-url' ? plan.url ?? '' : plan.cacheFilePath ?? '',
    fileName: entry.name,
    duration: 0,
    size: entry.sizeBytes ?? 0,
    cover: null,
    lyrics: null,
    source: 'network',
    format: extension
  }
}

async function resolvePlan(
  profileId: string,
  entry: NetworkEntry
): Promise<NetworkPlaybackPlan | null> {
  if (!networkSourcesApi) return null
  return networkSourcesApi.resolvePlayback(profileId, entry)
}

async function playEntry(entry: NetworkEntry): Promise<void> {
  const { playTrack } = usePlayerStore()
  const profileId = browsingProfile.value?.id ?? entry.profileId
  const plan = await resolvePlan(profileId, entry)
  if (!plan) return
  const track = buildTrack(entry, plan)
  playTrack(track, [track])
}

async function enqueueEntry(entry: NetworkEntry): Promise<void> {
  const { enqueueTrack } = usePlayerStore()
  const profileId = browsingProfile.value?.id ?? entry.profileId
  const plan = await resolvePlan(profileId, entry)
  if (!plan) return
  enqueueTrack(buildTrack(entry, plan))
}

async function playAllInDirectory(): Promise<void> {
  const { playTrack } = usePlayerStore()
  const profileId = browsingProfile.value?.id
  if (!profileId) return
  const tracks: Track[] = []
  browsing.value = true
  try {
    for (const entry of audioEntries.value) {
      const plan = await resolvePlan(profileId, entry)
      if (plan) tracks.push(buildTrack(entry, plan))
    }
  } catch (err) {
    setError(`解析播放失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    browsing.value = false
  }
  if (tracks.length > 0) {
    playTrack(tracks[0], tracks)
    setNotice(`开始播放 ${tracks.length} 首`)
  }
}

async function importCurrentDirectory(): Promise<void> {
  if (!networkSourcesApi || !browsingProfile.value) return
  scanning.value = true
  browsingError.value = ''
  try {
    const result = await networkSourcesApi.scanDirectory(browsingProfile.value.id, currentPath.value)
    setNotice(`入库完成：新增 ${result.added} 首，当前共 ${result.total} 首`)
  } catch (err) {
    browsingError.value = `入库失败：${err instanceof Error ? err.message : String(err)}`
  } finally {
    scanning.value = false
  }
}

async function loadLibrary(): Promise<void> {
  if (!networkSourcesApi) return
  libraryLoading.value = true
  error.value = ''
  try {
    const items: Array<{ profileName: string; entry: NetworkEntry }> = []
    for (const profile of profiles.value) {
      const entriesForProfile = await networkSourcesApi.listLibrary(profile.id, libraryQuery.value)
      for (const entry of entriesForProfile) {
        items.push({ profileName: profile.name, entry })
      }
    }
    libraryEntries.value = items
  } catch (err) {
    setError(`读取媒体库失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    libraryLoading.value = false
  }
}

async function removeLibraryEntry(entry: NetworkEntry): Promise<void> {
  if (!networkSourcesApi) return
  try {
    await networkSourcesApi.removeLibraryEntry(entry.profileId, entry.id)
    libraryEntries.value = libraryEntries.value.filter((item) => item.entry.id !== entry.id)
    setNotice('已从媒体库移除')
  } catch (err) {
    setError(`移除失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

async function switchView(mode: 'profiles' | 'library'): Promise<void> {
  viewMode.value = mode
  if (mode === 'library') {
    if (profiles.value.length === 0) await loadProfiles()
    await loadLibrary()
  }
}

onMounted(() => {
  void loadProfiles()
})
</script>

<template>
  <div class="network-sources-page">
    <header class="network-sources-header">
      <button type="button" class="soft-button network-back" @click="$emit('back')">
        ← 返回
      </button>
      <h1>网络源</h1>
      <p class="network-hint">浏览 NAS / 远程服务器上的音乐，直接播放或加入队列。</p>
      <div class="network-view-toggle">
        <button
          type="button"
          class="soft-button"
          :class="{ active: viewMode === 'profiles' }"
          @click="switchView('profiles')"
        >
          网络源
        </button>
        <button
          type="button"
          class="soft-button"
          :class="{ active: viewMode === 'library' }"
          @click="switchView('library')"
        >
          媒体库
        </button>
      </div>
    </header>

    <div v-if="error" class="network-inline-error" role="alert">{{ error }}</div>
    <div v-if="notice" class="network-inline-notice" role="status">{{ notice }}</div>

    <section v-if="browsingProfile" class="network-browser glass-card">
      <div class="network-browser-head">
        <strong>{{ browsingProfile.name }}</strong>
        <button type="button" class="soft-button" @click="leaveBrowse">返回列表</button>
      </div>
      <nav class="network-breadcrumbs" aria-label="目录">
        <button
          v-for="crumb in breadcrumbs"
          :key="crumb.path"
          type="button"
          class="network-crumb"
          :class="{ active: crumb.path === currentPath }"
          @click="navigateTo(crumb.path)"
        >
          {{ crumb.label }}
        </button>
      </nav>
      <div class="network-browser-toolbar">
        <button
          type="button"
          class="brand-soft-button"
          :disabled="audioEntries.length === 0 || browsing"
          @click="playAllInDirectory"
        >
          播放全部（{{ audioEntries.length }}）
        </button>
        <button
          type="button"
          class="soft-button"
          :disabled="scanning"
          @click="importCurrentDirectory"
        >
          {{ scanning ? '入库中…' : '入库此目录' }}
        </button>
        <span v-if="browsing" class="network-browsing" aria-live="polite">加载中…</span>
      </div>
      <div v-if="browsingError" class="network-inline-error" role="alert">
        {{ browsingError }}
      </div>
      <ul v-if="entries.length > 0" class="network-entry-list">
        <li v-for="entry in entries" :key="entry.id" class="network-entry">
          <span class="network-entry-kind">
            <i
              class="pi"
              :class="
                entry.kind === 'directory'
                  ? 'pi-folder'
                  : entry.kind === 'audio'
                    ? 'pi-music'
                    : 'pi-file'
              "
            ></i>
          </span>
          <button
            type="button"
            class="network-entry-name"
            :class="{ directory: entry.kind === 'directory' }"
            @click="entry.kind === 'directory' ? navigateTo(entry.path) : playEntry(entry)"
          >
            {{ entry.name }}
          </button>
          <span class="network-entry-meta">{{ formatBytes(entry.sizeBytes) }}</span>
          <span v-if="entry.kind === 'audio'" class="network-entry-actions">
            <button type="button" class="pill-action" @click="playEntry(entry)">播放</button>
            <button type="button" class="pill-action" @click="enqueueEntry(entry)">加队列</button>
          </span>
        </li>
      </ul>
      <p v-else-if="!browsing && !browsingError" class="network-empty">该目录为空</p>
    </section>

    <section v-else-if="viewMode === 'library'" class="network-library glass-card">
      <div class="network-browser-toolbar">
        <input
          v-model="libraryQuery"
          type="text"
          class="network-search-input"
          placeholder="搜索媒体库…"
          @input="loadLibrary"
        />
        <span v-if="libraryLoading" class="network-browsing" aria-live="polite">加载中…</span>
      </div>
      <ul v-if="libraryEntries.length > 0" class="network-entry-list">
        <li v-for="item in libraryEntries" :key="item.entry.id" class="network-entry">
          <span class="network-entry-kind"><i class="pi pi-music"></i></span>
          <button type="button" class="network-entry-name" @click="playEntry(item.entry)">
            {{ item.entry.name }}
          </button>
          <span class="network-entry-meta">{{ item.profileName }}</span>
          <span class="network-entry-actions">
            <button type="button" class="pill-action" @click="playEntry(item.entry)">播放</button>
            <button type="button" class="pill-action" @click="enqueueEntry(item.entry)">加队列</button>
            <button type="button" class="pill-action" @click="removeLibraryEntry(item.entry)">
              移除
            </button>
          </span>
        </li>
      </ul>
      <p v-else-if="!libraryLoading" class="network-empty">
        媒体库为空：先在「网络源」里浏览目录并点击「入库此目录」。
      </p>
    </section>

    <section v-else class="network-profiles">
      <div class="network-toolbar">
        <button type="button" class="brand-soft-button" @click="showCreateForm = !showCreateForm">
          {{ showCreateForm ? '收起' : '添加网络源' }}
        </button>
      </div>

      <form v-if="showCreateForm" class="network-create-form glass-card" @submit.prevent="createProfile">
        <div class="network-form-grid">
          <label>
            名称
            <input v-model.trim="form.name" type="text" required maxlength="64" placeholder="我的 NAS" />
          </label>
          <label>
            协议
            <select v-model="form.protocol">
              <option value="webdav">WebDAV</option>
              <option value="ftp">FTP</option>
              <option value="ftps">FTPS（显式 TLS）</option>
              <option value="sftp" disabled>SFTP / SCP（依赖待定）</option>
              <option value="smb" disabled>SMB / NFS（即将支持）</option>
            </select>
          </label>
          <label>
            地址
            <input v-model.trim="form.host" type="text" required maxlength="253" placeholder="nas.local 或 192.168.1.10" />
          </label>
          <label>
            端口（可选）
            <input v-model.trim="form.port" type="number" min="1" max="65535" placeholder="默认 80/443" />
          </label>
          <label>
            根路径
            <input v-model.trim="form.rootPath" type="text" required placeholder="/music" />
          </label>
          <label>
            认证方式
            <select v-model="form.authKind">
              <option value="anonymous">匿名</option>
              <option value="password">用户名 + 密码</option>
            </select>
          </label>
          <label v-if="form.authKind === 'password'">
            用户名
            <input v-model.trim="form.username" type="text" autocomplete="username" />
          </label>
          <label v-if="form.authKind === 'password'">
            密码
            <input v-model="form.password" type="password" autocomplete="current-password" />
          </label>
        </div>
        <div class="network-form-actions">
          <button type="submit" class="brand-soft-button" :disabled="creating || loading">
            {{ creating ? '保存中…' : '保存并测试' }}
          </button>
        </div>
      </form>

      <div v-if="loading" class="network-loading">加载中…</div>
      <ul v-else-if="profiles.length > 0" class="network-profile-list">
        <li v-for="profile in profiles" :key="profile.id" class="network-profile-item glass-card">
          <div class="network-profile-info">
            <strong>{{ profile.name }}</strong>
            <span>{{ profile.protocol }} · {{ profile.host }}{{ profile.port ? `:${profile.port}` : '' }}</span>
            <small>{{ profile.rootPath }} · {{ profile.credentialKind === 'anonymous' ? '匿名' : '需认证' }}</small>
          </div>
          <div class="network-profile-actions">
            <button type="button" class="brand-soft-button" @click="enterBrowse(profile)">浏览</button>
            <button type="button" class="soft-button" @click="testConnection(profile.id)">测试</button>
            <button type="button" class="dashed-button" @click="deleteProfile(profile.id)">删除</button>
          </div>
        </li>
      </ul>
      <p v-else class="network-empty">还没有网络源，点击「添加网络源」开始。</p>
    </section>
  </div>
</template>

<style scoped>
.network-sources-page {
  display: flex;
  width: min(100%, 960px);
  flex-direction: column;
  gap: 14px;
  margin: 0 auto;
  padding: 24px 20px 40px;
}

.network-sources-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.network-sources-header h1 {
  margin: 0;
  font-size: 22px;
}

.network-hint {
  margin: 0;
  color: var(--te-settings-text-muted, #8a8f98);
  font-size: 13px;
}

.network-view-toggle {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.network-view-toggle .active {
  border-color: rgba(var(--te-primary-rgb), 0.34);
  background: rgba(var(--te-primary-rgb), 0.1);
  color: var(--brand-600);
}

.network-search-input {
  min-height: 36px;
  width: min(320px, 100%);
  padding: 0 12px;
  border: 1px solid var(--te-settings-control-border, rgba(15, 23, 42, 0.12));
  border-radius: 9px;
  background: transparent;
  color: inherit;
  font: inherit;
}

.network-back {
  align-self: center;
}

.network-inline-error,
.network-inline-notice {
  padding: 9px 12px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
}

.network-inline-error {
  border: 1px solid rgba(239, 68, 68, 0.28);
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
}

.network-inline-notice {
  border: 1px solid rgba(16, 185, 129, 0.28);
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
}

.network-toolbar,
.network-browser-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.network-create-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
}

.network-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.network-form-grid label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--te-settings-text-muted, #8a8f98);
}

.network-form-grid input,
.network-form-grid select {
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid var(--te-settings-control-border, rgba(15, 23, 42, 0.12));
  border-radius: 9px;
  background: transparent;
  color: inherit;
  font: inherit;
}

.network-form-actions {
  display: flex;
  justify-content: flex-end;
}

.network-profile-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.network-profile-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 16px;
}

.network-profile-info {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.network-profile-info span,
.network-profile-info small {
  color: var(--te-settings-text-muted, #8a8f98);
  font-size: 12px;
}

.network-profile-actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}

.network-browser {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}

.network-browser-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.network-breadcrumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.network-crumb {
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--te-settings-text-muted, #8a8f98);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}

.network-crumb:hover,
.network-crumb.active {
  border-color: rgba(var(--te-primary-rgb), 0.34);
  background: rgba(var(--te-primary-rgb), 0.1);
  color: var(--brand-600);
}

.network-browsing {
  color: var(--te-settings-text-muted, #8a8f98);
  font-size: 12px;
}

.network-entry-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.network-entry {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 4px 6px;
  border-radius: 9px;
}

.network-entry:hover {
  background: rgba(var(--te-primary-rgb), 0.06);
}

.network-entry-kind {
  color: var(--te-settings-text-muted, #8a8f98);
  text-align: center;
}

.network-entry-name {
  overflow: hidden;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.network-entry-name.directory {
  font-weight: 600;
}

.network-entry-meta {
  color: var(--te-settings-text-muted, #8a8f98);
  font-size: 12px;
}

.network-entry-actions {
  display: flex;
  gap: 6px;
}

.network-empty,
.network-loading {
  padding: 20px 0;
  color: var(--te-settings-text-muted, #8a8f98);
  font-size: 13px;
  text-align: center;
}
</style>
