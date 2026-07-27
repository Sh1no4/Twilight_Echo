<script setup lang="ts">
import { GITHUB_URL, HOMEPAGE_URL, RELEASES_URL } from './types.ts'
import type { AppUpdateProgress } from '../../../../shared/appUpdate.ts'

const props = defineProps<{
  appVersion: string
  updateCheckState: 'idle' | 'checking' | 'up-to-date' | 'available' | 'error'
  latestVersion: string
  lastUpdateCheck: string
  releaseUrl: string
  assetName: string
  hasChecksum: boolean
  updateError: string
  updateProgress: AppUpdateProgress | null
  updateActionState: 'idle' | 'downloading' | 'ready' | 'installing' | 'error'
}>()

const emit = defineEmits<{
  checkForUpdates: []
  downloadUpdate: []
  cancelUpdateDownload: []
  installUpdate: []
  openReleasePage: []
}>()

function openExternal(url: string): void {
  void window.api?.shell?.openExternal?.(url)
}

function openGithub(): void {
  openExternal(GITHUB_URL)
}

function openHomepage(): void {
  openExternal(HOMEPAGE_URL)
}

function openChangelog(): void {
  openExternal(RELEASES_URL)
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function progressLabel(): string {
  const progress = props.updateProgress
  if (!progress) return ''
  if (progress.phase === 'downloading') {
    return `${progress.percent}% · ${formatBytes(progress.receivedBytes)} / ${formatBytes(progress.totalBytes)}`
  }
  return progress.message || ''
}
</script>

<template>
  <section id="about" class="glass-card preview-section about-section">
    <div class="about-glow" aria-hidden="true"></div>
    <div class="section-title-row">
      <i class="pi pi-info-circle"></i>
      <h2>关于 (About)</h2>
    </div>

    <div class="about-hero">
      <div class="logo-shell">
        <div class="logo-mark">
          <img src="/icon.png" alt="Twilight Echo" class="logo-icon" />
        </div>
      </div>
      <div class="about-copy">
        <h3>Twilight Echo</h3>
        <span>Version {{ appVersion || '—' }}</span>
        <p>一款专为发烧友打造的现代级桌面音乐枢纽，支持海量本地高解析度音频与插件化流媒体扩展。</p>
        <p class="about-honesty">
          默认软件音量 70% 保护听感；Shared 模式会经系统混音。Source Exact + Output Perfect + Unity
          100% + 独占/直通 才是 bit-perfect。当前发布以 Windows 验证为主；macOS / Linux
          原生输出路径尚未作为发布门禁验证。
        </p>
      </div>
    </div>

    <div class="about-cards">
      <div class="update-card">
        <div class="status-icon">
          <i
            :class="
              updateActionState === 'downloading' || updateCheckState === 'checking'
                ? 'pi pi-spin pi-spinner'
                : updateCheckState === 'available' || updateActionState === 'ready'
                  ? 'pi pi-download'
                  : updateCheckState === 'error' || updateActionState === 'error'
                    ? 'pi pi-exclamation-circle'
                    : updateCheckState === 'idle'
                      ? 'pi pi-sync'
                      : 'pi pi-check-circle'
            "
          ></i>
        </div>
        <div class="update-copy">
          <strong v-if="updateCheckState === 'idle'">点击检查更新</strong>
          <strong v-else-if="updateCheckState === 'checking'">正在检查更新…</strong>
          <strong v-else-if="updateActionState === 'downloading'">正在下载更新…</strong>
          <strong v-else-if="updateActionState === 'ready'">更新包已就绪</strong>
          <strong v-else-if="updateActionState === 'installing'">正在启动安装程序…</strong>
          <strong v-else-if="updateCheckState === 'available'"
            >发现新版本 v{{ latestVersion }}</strong
          >
          <strong v-else-if="updateCheckState === 'error' || updateActionState === 'error'"
            >更新失败</strong
          >
          <strong v-else>当前已是最新版本</strong>
          <span v-if="updateError" class="update-error">{{ updateError }}</span>
          <span v-else-if="updateActionState === 'downloading' || updateActionState === 'ready'">
            {{ progressLabel() || assetName || '—' }}
            <!-- downloads are refused without a checksum, so a ready package is always verified -->
            <template v-if="updateActionState === 'ready'"> · SHA-256 已校验 </template>
          </span>
          <span v-else-if="updateCheckState === 'available' && assetName">
            {{ assetName }}{{ hasChecksum ? ' · 可校验' : ' · 无校验和' }}
          </span>
          <span v-else>上次检查：{{ lastUpdateCheck || '—' }}</span>
          <div
            v-if="updateActionState === 'downloading' && updateProgress"
            class="update-progress-track"
            aria-hidden="true"
          >
            <div
              class="update-progress-fill"
              :style="{ width: `${Math.max(0, Math.min(100, updateProgress.percent))}%` }"
            ></div>
          </div>
        </div>
        <div class="update-actions">
          <template v-if="updateActionState === 'downloading'">
            <button class="soft-button" type="button" @click="emit('cancelUpdateDownload')">
              <i class="pi pi-times"></i>
              取消
            </button>
          </template>
          <template v-else-if="updateActionState === 'ready'">
            <button class="brand-soft-button" type="button" @click="emit('installUpdate')">
              <i class="pi pi-download"></i>
              安装并退出
            </button>
            <button class="soft-button" type="button" @click="emit('openReleasePage')">
              打开发布页
            </button>
          </template>
          <template v-else-if="updateCheckState === 'available'">
            <button
              v-if="assetName"
              class="brand-soft-button"
              type="button"
              @click="emit('downloadUpdate')"
            >
              <i class="pi pi-download"></i>
              下载更新
            </button>
            <button class="soft-button" type="button" @click="emit('openReleasePage')">
              打开发布页
            </button>
          </template>
          <template v-else>
            <button
              class="soft-button"
              type="button"
              :disabled="updateCheckState === 'checking' || updateActionState === 'installing'"
              @click="emit('checkForUpdates')"
            >
              <i class="pi pi-sync"></i>
              检查更新
            </button>
          </template>
        </div>
      </div>

      <div class="sponsor-card sponsor-card-muted" aria-hidden="true" hidden>
        <i class="pi pi-heart-fill sponsor-watermark"></i>
        <div>
          <h3><i class="pi pi-heart"></i> 支持项目发展</h3>
          <p>
            Twilight Echo
            是一个由热情驱动的免费开源项目。您的慷慨赞助将直接用于服务器开销、持续更新以及给开发者的深夜咖啡。
          </p>
        </div>
        <span class="sponsor-pending">赞助入口暂未接入</span>
      </div>
    </div>

    <hr />

    <div class="about-links">
      <button type="button" @click="openGithub"><i class="pi pi-github"></i> GitHub</button>
      <button type="button" @click="openChangelog"><i class="pi pi-file-o"></i> 更新日志</button>
      <button type="button" @click="openHomepage"><i class="pi pi-heart-fill"></i> 开源致谢</button>
    </div>
  </section>
</template>
