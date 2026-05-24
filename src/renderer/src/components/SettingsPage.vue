<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { usePlayerStore } from '../stores/usePlayerStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import type { AppSettings } from '../types/settings'

defineEmits<{
  back: []
}>()

const tabs = [
  { key: 'general', label: '常规', icon: 'pi pi-sliders-h' },
  { key: 'playback', label: '播放', icon: 'pi pi-volume-up' },
  { key: 'cache', label: '缓存', icon: 'pi pi-database' },
  { key: 'performance', label: '性能', icon: 'pi pi-bolt' },
  { key: 'appearance', label: '外观', icon: 'pi pi-palette' },
  { key: 'shortcuts', label: '快捷键', icon: 'pi pi-keyboard' },
  { key: 'about', label: '关于', icon: 'pi pi-info-circle' }
] as const

type TabKey = (typeof tabs)[number]['key']
type BooleanSettingKey =
  | 'autoCheckLogin'
  | 'minimizeToTray'
  | 'launchAtLogin'
  | 'hardwareAcceleration'
  | 'blurEffect'
  | 'useCoverTheme'

const activeTab = ref<TabKey>('general')

const {
  settings,
  paths,
  appVersion,
  loading,
  saving,
  clearingCache,
  formattedCacheSize,
  restartRequired,
  restartReasons,
  loadSettings,
  updateSettings,
  chooseCacheFolder,
  resetCacheFolder,
  refreshCacheSize,
  clearCache,
  openCacheFolder,
  relaunch
} = useSettingsStore()

const { exclusiveMode, toggleExclusiveMode, volume, setVolume } = usePlayerStore()

const volumePercent = computed({
  get: () => Math.round(volume.value * 100),
  set: (value: number) => {
    setVolume(value / 100)
  }
})

const activeCachePath = computed(() => paths.value?.activeCachePath ?? '')
const cachePathNeedsRestart = computed(
  () => !!activeCachePath.value && activeCachePath.value !== settings.value.cachePath
)
const restartReasonText = computed(() => restartReasons.value.join('、'))

function toggleSetting(key: BooleanSettingKey): void {
  void updateSettings({ [key]: !settings.value[key] } as Partial<AppSettings>)
}

function setLyricFontSize(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  void updateSettings({ lyricFontSize: value })
}

function setVolumeFromInput(event: Event): void {
  volumePercent.value = Number((event.target as HTMLInputElement).value)
}

onMounted(async () => {
  await loadSettings()
  await refreshCacheSize()
})
</script>

<template>
  <div class="settings-page">
    <header class="settings-header">
      <button class="icon-button" title="返回" @click="$emit('back')">
        <i class="pi pi-arrow-left"></i>
      </button>
      <div class="settings-heading">
        <h1>设置</h1>
        <span v-if="saving">正在保存</span>
        <span v-else-if="loading">正在加载</span>
        <span v-else>Twilight Echo</span>
      </div>
    </header>

    <div v-if="restartRequired" class="restart-strip">
      <div>
        <strong>需要重启</strong>
        <span>{{ restartReasonText }} 会在重启后生效</span>
      </div>
      <button class="primary-button" @click="relaunch">
        <i class="pi pi-refresh"></i>
        重启应用
      </button>
    </div>

    <div class="settings-shell">
      <nav class="settings-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="tab-btn"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          <i :class="tab.icon"></i>
          <span>{{ tab.label }}</span>
        </button>
      </nav>

      <main class="settings-body">
        <section v-if="activeTab === 'general'" class="settings-section">
          <h2>常规</h2>
          <div class="settings-group">
            <div class="setting-row">
              <div class="setting-copy">
                <span class="setting-label">启动时检查网易云登录</span>
                <span class="setting-desc">打开应用后同步当前登录状态</span>
              </div>
              <button
                class="toggle-switch"
                :class="{ active: settings.autoCheckLogin }"
                role="switch"
                :aria-checked="settings.autoCheckLogin"
                @click="toggleSetting('autoCheckLogin')"
              >
                <span class="toggle-knob"></span>
              </button>
            </div>

            <div class="setting-row">
              <div class="setting-copy">
                <span class="setting-label">关闭按钮最小化到托盘</span>
                <span class="setting-desc">关闭窗口时保留后台播放和托盘入口</span>
              </div>
              <button
                class="toggle-switch"
                :class="{ active: settings.minimizeToTray }"
                role="switch"
                :aria-checked="settings.minimizeToTray"
                @click="toggleSetting('minimizeToTray')"
              >
                <span class="toggle-knob"></span>
              </button>
            </div>

            <div class="setting-row">
              <div class="setting-copy">
                <span class="setting-label">开机自动启动</span>
                <span class="setting-desc">登录系统后自动启动 Twilight Echo</span>
              </div>
              <button
                class="toggle-switch"
                :class="{ active: settings.launchAtLogin }"
                role="switch"
                :aria-checked="settings.launchAtLogin"
                @click="toggleSetting('launchAtLogin')"
              >
                <span class="toggle-knob"></span>
              </button>
            </div>
          </div>
        </section>

        <section v-if="activeTab === 'playback'" class="settings-section">
          <h2>播放</h2>
          <div class="settings-group">
            <div class="setting-row">
              <div class="setting-copy">
                <span class="setting-label">WASAPI 独占模式</span>
                <span class="setting-desc">直通音频设备，适合外置 DAC 和耳放</span>
              </div>
              <button
                class="toggle-switch"
                :class="{ active: exclusiveMode }"
                role="switch"
                :aria-checked="exclusiveMode"
                @click="toggleExclusiveMode"
              >
                <span class="toggle-knob"></span>
              </button>
            </div>

            <div class="setting-row range-row">
              <div class="setting-copy">
                <span class="setting-label">当前音量</span>
                <span class="setting-desc">{{ volumePercent }}%</span>
              </div>
              <input
                class="range-control"
                type="range"
                min="0"
                max="100"
                step="1"
                :value="volumePercent"
                @input="setVolumeFromInput"
              />
            </div>

            <div class="setting-row">
              <div class="setting-copy">
                <span class="setting-label">音频引擎</span>
                <span class="setting-desc">本地与在线歌曲统一由 mpv 输出</span>
              </div>
              <span class="setting-value">MPV</span>
            </div>
          </div>
        </section>

        <section v-if="activeTab === 'cache'" class="settings-section">
          <h2>缓存</h2>
          <div class="settings-group">
            <div class="setting-row path-row">
              <div class="setting-copy">
                <span class="setting-label">缓存位置</span>
                <span class="setting-desc">网络图片、接口数据和 Chromium 会话缓存</span>
              </div>
              <div class="path-actions">
                <div class="path-field" :title="settings.cachePath">
                  {{ settings.cachePath }}
                </div>
                <button class="text-button" @click="chooseCacheFolder">
                  <i class="pi pi-folder-open"></i>
                  选择
                </button>
                <button class="icon-button subtle" title="恢复默认" @click="resetCacheFolder">
                  <i class="pi pi-undo"></i>
                </button>
                <button class="icon-button subtle" title="打开缓存目录" @click="openCacheFolder">
                  <i class="pi pi-external-link"></i>
                </button>
              </div>
            </div>

            <div v-if="cachePathNeedsRestart" class="inline-note">
              当前生效目录：{{ activeCachePath }}
            </div>

            <div class="setting-row">
              <div class="setting-copy">
                <span class="setting-label">缓存占用</span>
                <span class="setting-desc">{{ formattedCacheSize }}</span>
              </div>
              <div class="button-cluster">
                <button class="text-button" @click="refreshCacheSize">
                  <i class="pi pi-sync"></i>
                  刷新
                </button>
                <button class="danger-button" :disabled="clearingCache" @click="clearCache">
                  <i class="pi pi-trash"></i>
                  {{ clearingCache ? '清理中' : '清理缓存' }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section v-if="activeTab === 'performance'" class="settings-section">
          <h2>性能</h2>
          <div class="settings-group">
            <div class="setting-row">
              <div class="setting-copy">
                <span class="setting-label">GPU 加速</span>
                <span class="setting-desc">启用 Chromium 界面渲染硬件加速</span>
              </div>
              <button
                class="toggle-switch"
                :class="{ active: settings.hardwareAcceleration }"
                role="switch"
                :aria-checked="settings.hardwareAcceleration"
                @click="toggleSetting('hardwareAcceleration')"
              >
                <span class="toggle-knob"></span>
              </button>
            </div>

            <div class="setting-row">
              <div class="setting-copy">
                <span class="setting-label">重启应用</span>
                <span class="setting-desc">让 GPU 和缓存目录变更立即进入新进程</span>
              </div>
              <button class="primary-button" :disabled="!restartRequired" @click="relaunch">
                <i class="pi pi-refresh"></i>
                立即重启
              </button>
            </div>
          </div>
        </section>

        <section v-if="activeTab === 'appearance'" class="settings-section">
          <h2>外观</h2>
          <div class="settings-group">
            <div class="setting-row">
              <div class="setting-copy">
                <span class="setting-label">毛玻璃效果</span>
                <span class="setting-desc">降低透明模糊效果可以减少显卡压力</span>
              </div>
              <button
                class="toggle-switch"
                :class="{ active: settings.blurEffect }"
                role="switch"
                :aria-checked="settings.blurEffect"
                @click="toggleSetting('blurEffect')"
              >
                <span class="toggle-knob"></span>
              </button>
            </div>

            <div class="setting-row">
              <div class="setting-copy">
                <span class="setting-label">封面取色</span>
                <span class="setting-desc">播放控件跟随当前歌曲封面生成强调色</span>
              </div>
              <button
                class="toggle-switch"
                :class="{ active: settings.useCoverTheme }"
                role="switch"
                :aria-checked="settings.useCoverTheme"
                @click="toggleSetting('useCoverTheme')"
              >
                <span class="toggle-knob"></span>
              </button>
            </div>

            <div class="setting-row range-row">
              <div class="setting-copy">
                <span class="setting-label">歌词字号</span>
                <span class="setting-desc">{{ settings.lyricFontSize }} px</span>
              </div>
              <input
                class="range-control"
                type="range"
                min="14"
                max="28"
                step="1"
                :value="settings.lyricFontSize"
                @input="setLyricFontSize"
              />
            </div>
          </div>
        </section>

        <section v-if="activeTab === 'shortcuts'" class="settings-section">
          <h2>快捷键</h2>
          <div class="shortcut-list">
            <div class="shortcut-item">
              <span>播放 / 暂停</span>
              <kbd>Space</kbd>
            </div>
            <div class="shortcut-item">
              <span>上一首</span>
              <span><kbd>Ctrl</kbd><b>+</b><kbd>←</kbd></span>
            </div>
            <div class="shortcut-item">
              <span>下一首</span>
              <span><kbd>Ctrl</kbd><b>+</b><kbd>→</kbd></span>
            </div>
            <div class="shortcut-item">
              <span>音量加</span>
              <span><kbd>Ctrl</kbd><b>+</b><kbd>↑</kbd></span>
            </div>
            <div class="shortcut-item">
              <span>音量减</span>
              <span><kbd>Ctrl</kbd><b>+</b><kbd>↓</kbd></span>
            </div>
          </div>
        </section>

        <section v-if="activeTab === 'about'" class="settings-section">
          <h2>关于</h2>
          <div class="settings-group">
            <div class="setting-row compact">
              <span class="setting-label">应用名称</span>
              <span class="setting-value">Twilight Echo</span>
            </div>
            <div class="setting-row compact">
              <span class="setting-label">版本</span>
              <span class="setting-value">v{{ appVersion || '0.20.0' }}</span>
            </div>
            <div class="setting-row compact">
              <span class="setting-label">技术栈</span>
              <span class="setting-value">Electron + Vue 3 + MPV</span>
            </div>
            <div class="setting-row compact">
              <span class="setting-label">设置文件</span>
              <span class="setting-value path-value">{{ paths?.settingsFile }}</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  position: fixed;
  inset: 32px 0 0 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.96);
  color: var(--te-neutral-900);
}

.settings-header {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 56px;
  padding: 0 20px;
  border-bottom: 1px solid rgba(17, 24, 39, 0.08);
  flex-shrink: 0;
}

.settings-heading {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.settings-heading h1 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
}

.settings-heading span {
  margin-top: 2px;
  font-size: 12px;
  color: var(--te-neutral-500);
}

.restart-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 20px;
  background: #fff7ed;
  border-bottom: 1px solid #fed7aa;
  color: #9a3412;
  flex-shrink: 0;
}

.restart-strip div {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.restart-strip strong {
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}

.restart-strip span {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-shell {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 176px minmax(0, 1fr);
}

.settings-tabs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 12px;
  border-right: 1px solid rgba(17, 24, 39, 0.08);
  background: rgba(248, 250, 252, 0.72);
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 0 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--te-neutral-500);
  font-size: 13px;
  cursor: pointer;
  transition:
    color 0.15s,
    background 0.15s;
}

.tab-btn i {
  width: 16px;
  text-align: center;
  font-size: 14px;
}

.tab-btn:hover {
  color: var(--te-neutral-900);
  background: rgba(17, 24, 39, 0.05);
}

.tab-btn.active {
  color: #2563eb;
  background: rgba(37, 99, 235, 0.1);
  font-weight: 700;
}

.settings-body {
  overflow-y: auto;
  padding: 28px 32px 48px;
}

.settings-section {
  max-width: 820px;
}

.settings-section h2 {
  margin: 0 0 16px;
  font-size: 20px;
  font-weight: 800;
}

.settings-group {
  border: 1px solid rgba(17, 24, 39, 0.08);
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.setting-row {
  min-height: 72px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 20px;
  padding: 14px 18px;
}

.setting-row + .setting-row {
  border-top: 1px solid rgba(17, 24, 39, 0.06);
}

.setting-row.compact {
  min-height: 54px;
}

.setting-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.setting-label {
  font-size: 14px;
  font-weight: 700;
  color: var(--te-neutral-900);
}

.setting-desc,
.setting-value {
  font-size: 12px;
  color: var(--te-neutral-500);
}

.path-value {
  max-width: 520px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toggle-switch {
  position: relative;
  width: 42px;
  height: 24px;
  border: none;
  border-radius: 999px;
  background: #d1d5db;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: background 0.2s ease;
}

.toggle-switch.active {
  background: #2563eb;
}

.toggle-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.2);
  transition: transform 0.2s ease;
}

.toggle-switch.active .toggle-knob {
  transform: translateX(18px);
}

.range-row {
  grid-template-columns: minmax(0, 1fr) minmax(180px, 260px);
}

.range-control {
  width: 100%;
  accent-color: #2563eb;
}

.path-row {
  grid-template-columns: minmax(0, 1fr) minmax(280px, 440px);
  align-items: start;
}

.path-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  gap: 8px;
  align-items: center;
}

.path-field {
  height: 34px;
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 0 10px;
  border: 1px solid rgba(17, 24, 39, 0.1);
  border-radius: 7px;
  background: #f8fafc;
  color: var(--te-neutral-700);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.button-cluster {
  display: flex;
  align-items: center;
  gap: 8px;
}

.icon-button,
.text-button,
.primary-button,
.danger-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  border: 1px solid transparent;
  border-radius: 7px;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
  transition:
    background 0.15s,
    border-color 0.15s,
    color 0.15s;
}

.icon-button {
  width: 34px;
  padding: 0;
  background: transparent;
  color: var(--te-neutral-700);
}

.icon-button:hover,
.icon-button.subtle:hover {
  background: rgba(17, 24, 39, 0.06);
}

.icon-button.subtle {
  background: #f8fafc;
  border-color: rgba(17, 24, 39, 0.08);
  color: var(--te-neutral-500);
}

.text-button {
  padding: 0 12px;
  background: #f8fafc;
  border-color: rgba(17, 24, 39, 0.08);
  color: var(--te-neutral-700);
}

.text-button:hover {
  color: #2563eb;
  border-color: rgba(37, 99, 235, 0.24);
  background: rgba(37, 99, 235, 0.06);
}

.primary-button {
  padding: 0 13px;
  background: #2563eb;
  color: #fff;
}

.primary-button:hover {
  background: #1d4ed8;
}

.primary-button:disabled {
  cursor: default;
  opacity: 0.45;
}

.danger-button {
  padding: 0 13px;
  background: #fef2f2;
  color: #dc2626;
  border-color: #fecaca;
}

.danger-button:hover {
  background: #fee2e2;
}

.danger-button:disabled {
  cursor: wait;
  opacity: 0.6;
}

.inline-note {
  padding: 9px 18px;
  background: #eff6ff;
  border-top: 1px solid rgba(37, 99, 235, 0.12);
  color: #1d4ed8;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shortcut-list {
  border: 1px solid rgba(17, 24, 39, 0.08);
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.shortcut-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  min-height: 50px;
  padding: 0 18px;
  font-size: 14px;
}

.shortcut-item + .shortcut-item {
  border-top: 1px solid rgba(17, 24, 39, 0.06);
}

.shortcut-item kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 24px;
  padding: 0 7px;
  border-radius: 6px;
  border: 1px solid rgba(17, 24, 39, 0.12);
  background: #f8fafc;
  color: var(--te-neutral-700);
  font-family: inherit;
  font-size: 12px;
}

.shortcut-item b {
  margin: 0 4px;
  color: var(--te-neutral-500);
  font-weight: 500;
}

@media (max-width: 820px) {
  .settings-shell {
    grid-template-columns: 1fr;
  }

  .settings-tabs {
    flex-direction: row;
    overflow-x: auto;
    border-right: none;
    border-bottom: 1px solid rgba(17, 24, 39, 0.08);
  }

  .tab-btn {
    flex: 0 0 auto;
  }

  .settings-body {
    padding: 20px 16px 40px;
  }

  .setting-row,
  .path-row,
  .range-row {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .path-actions {
    grid-template-columns: minmax(0, 1fr) auto auto auto;
  }

  .restart-strip {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
