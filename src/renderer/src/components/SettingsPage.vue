<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePlayerStore } from '../stores/usePlayerStore'

defineEmits<{
  back: []
}>()

const { exclusiveMode, toggleExclusiveMode } = usePlayerStore()

const tabs = [
  {
    key: 'general',
    label: '通用',
    icon: 'pi pi-sparkles',
    description: '启动行为与常用偏好'
  },
  {
    key: 'system',
    label: '系统',
    icon: 'pi pi-desktop',
    description: '播放核心与系统集成'
  },
  {
    key: 'personalization',
    label: '个性化',
    icon: 'pi pi-palette',
    description: '界面质感与主题表现'
  },
  {
    key: 'shortcuts',
    label: '快捷键',
    icon: 'pi pi-bolt',
    description: '快速控制播放'
  },
  {
    key: 'about',
    label: '关于',
    icon: 'pi pi-info-circle',
    description: '版本与应用信息'
  }
] as const

type TabKey = (typeof tabs)[number]['key']

const activeTab = ref<TabKey>('general')

const activeTabMeta = computed(() => tabs.find((tab) => tab.key === activeTab.value) ?? tabs[0])
</script>

<template>
  <div class="settings-page">
    <div class="settings-shell">
      <aside class="settings-sidebar" aria-label="设置分类">
        <div class="settings-side-head">
          <button class="settings-back-btn" title="返回" @click="$emit('back')">
            <i class="pi pi-arrow-left"></i>
          </button>
          <div class="settings-title-block">
            <span class="settings-title">设置</span>
            <span class="settings-subtitle">Twilight Echo</span>
          </div>
        </div>

        <nav class="settings-nav">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="nav-option"
            :class="{ active: activeTab === tab.key }"
            @click="activeTab = tab.key"
          >
            <span class="nav-icon">
              <i :class="tab.icon"></i>
            </span>
            <span class="nav-copy">
              <span class="nav-label">{{ tab.label }}</span>
              <span class="nav-desc">{{ tab.description }}</span>
            </span>
          </button>
        </nav>
      </aside>

      <main class="settings-content">
        <header class="content-header">
          <div class="content-title-row">
            <span class="content-icon">
              <i :class="activeTabMeta.icon"></i>
            </span>
            <div>
              <h1>{{ activeTabMeta.label }}</h1>
              <p>{{ activeTabMeta.description }}</p>
            </div>
          </div>
        </header>

        <div class="settings-body">
          <section v-if="activeTab === 'general'" class="tab-section">
            <div class="setting-item">
              <div class="setting-main">
                <span class="setting-item-label">启动时自动检查登录</span>
                <p class="setting-item-desc">应用启动时自动检查网易云音乐登录状态</p>
              </div>
              <button class="toggle-switch active" role="switch" aria-checked="true">
                <span class="toggle-knob"></span>
              </button>
            </div>

            <div class="setting-item">
              <div class="setting-main">
                <span class="setting-item-label">最小化到托盘</span>
                <p class="setting-item-desc">关闭窗口时最小化到系统托盘而不是退出程序</p>
              </div>
              <button class="toggle-switch" role="switch" aria-checked="false">
                <span class="toggle-knob"></span>
              </button>
            </div>
          </section>

          <section v-if="activeTab === 'system'" class="tab-section">
            <div class="setting-item">
              <div class="setting-main">
                <span class="setting-item-label">独占模式</span>
                <p class="setting-item-desc">
                  绕过 Windows 混音器，直通音频设备。开启后系统内其他应用将无法同时播放音频。
                </p>
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

            <div class="setting-item">
              <div class="setting-main">
                <span class="setting-item-label">音频引擎</span>
                <p class="setting-item-desc">当前使用的音频播放引擎</p>
              </div>
              <span class="setting-item-value">MPV</span>
            </div>
          </section>

          <section v-if="activeTab === 'personalization'" class="tab-section">
            <div class="setting-item">
              <div class="setting-main">
                <span class="setting-item-label">毛玻璃效果</span>
                <p class="setting-item-desc">播放页面启用毛玻璃背景效果</p>
              </div>
              <button class="toggle-switch active" role="switch" aria-checked="true">
                <span class="toggle-knob"></span>
              </button>
            </div>

            <div class="setting-item">
              <div class="setting-main">
                <span class="setting-item-label">主题色</span>
                <p class="setting-item-desc">界面主题色提取自当前播放歌曲的封面</p>
              </div>
              <span class="setting-item-value">跟随封面</span>
            </div>
          </section>

          <section v-if="activeTab === 'shortcuts'" class="tab-section">
            <div class="shortcut-list">
              <div class="shortcut-item">
                <span class="shortcut-label">播放 / 暂停</span>
                <span class="shortcut-keys"><kbd>Space</kbd></span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-label">上一首</span>
                <span class="shortcut-keys"><kbd>Ctrl</kbd><span>+</span><kbd>←</kbd></span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-label">下一首</span>
                <span class="shortcut-keys"><kbd>Ctrl</kbd><span>+</span><kbd>→</kbd></span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-label">音量加</span>
                <span class="shortcut-keys"><kbd>Ctrl</kbd><span>+</span><kbd>↑</kbd></span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-label">音量减</span>
                <span class="shortcut-keys"><kbd>Ctrl</kbd><span>+</span><kbd>↓</kbd></span>
              </div>
            </div>
          </section>

          <section v-if="activeTab === 'about'" class="tab-section">
            <div class="about-info">
              <div class="about-item">
                <span class="about-label">应用名称</span>
                <span class="about-value">Twilight Echo</span>
              </div>
              <div class="about-item">
                <span class="about-label">版本</span>
                <span class="about-value">v1.0.0</span>
              </div>
              <div class="about-item">
                <span class="about-label">技术栈</span>
                <span class="about-value">Electron + Vue 3 + MPV</span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  position: fixed;
  inset: 32px 0 0;
  z-index: 50;
  overflow: auto;
  padding: 28px clamp(22px, 4vw, 56px) 118px;
  background:
    linear-gradient(145deg, rgba(124, 77, 255, 0.035), transparent 34%),
    linear-gradient(215deg, rgba(34, 211, 238, 0.03), transparent 42%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(250, 252, 255, 0.92));
}

.settings-shell {
  width: min(1060px, 100%);
  min-height: min(680px, calc(100vh - 178px));
  margin: 0 auto;
  display: grid;
  grid-template-columns: 236px minmax(0, 1fr);
  gap: 18px;
  animation: settings-in 0.42s var(--te-ease-soft) both;
}

.settings-sidebar,
.settings-content {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.68);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0.34)),
    rgba(255, 255, 255, 0.22);
  box-shadow:
    0 24px 70px rgba(86, 70, 160, 0.11),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(24px) saturate(158%);
  -webkit-backdrop-filter: blur(24px) saturate(158%);
}

.settings-sidebar {
  border-radius: 12px;
  padding: 14px;
}

.settings-content {
  border-radius: 12px;
  display: flex;
  flex-direction: column;
}

.settings-sidebar::before,
.settings-content::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.58), transparent 42%);
  opacity: 0.72;
}

.settings-side-head,
.settings-nav,
.content-header,
.settings-body {
  position: relative;
  z-index: 1;
}

.settings-side-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 2px 14px;
  margin-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.58);
}

.settings-back-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.5);
  color: var(--te-neutral-900);
  cursor: pointer;
  box-shadow: 0 10px 24px rgba(86, 70, 160, 0.08);
  transition:
    transform 0.2s var(--te-ease-soft),
    background 0.2s,
    box-shadow 0.2s;
}

.settings-back-btn:hover {
  background: rgba(255, 255, 255, 0.78);
  transform: translateX(-1px);
  box-shadow: 0 14px 30px rgba(86, 70, 160, 0.12);
}

.settings-title-block {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.settings-title {
  font-size: 18px;
  font-weight: 850;
  color: var(--te-neutral-900);
  line-height: 1.1;
}

.settings-subtitle {
  font-size: 11px;
  font-weight: 700;
  color: rgba(80, 88, 116, 0.58);
}

.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.nav-option {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 58px;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: rgba(52, 61, 87, 0.72);
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  transition:
    transform 0.22s var(--te-ease-soft),
    background 0.22s,
    border-color 0.22s,
    box-shadow 0.22s,
    color 0.22s;
}

.nav-option::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background:
    linear-gradient(120deg, rgba(124, 77, 255, 0.12), rgba(34, 211, 238, 0.08)),
    rgba(255, 255, 255, 0.42);
  opacity: 0;
  transition: opacity 0.22s;
}

.nav-option:hover,
.nav-option.active {
  color: var(--te-neutral-900);
  transform: translateX(2px);
  border-color: rgba(255, 255, 255, 0.72);
  box-shadow: 0 14px 34px rgba(86, 70, 160, 0.1);
}

.nav-option:hover::before,
.nav-option.active::before {
  opacity: 1;
}

.nav-option.active::after {
  content: '';
  position: absolute;
  left: 0;
  top: 12px;
  bottom: 12px;
  width: 3px;
  border-radius: 999px;
  background: linear-gradient(180deg, var(--te-primary-500), var(--te-accent-cyan));
}

.nav-icon,
.nav-copy {
  position: relative;
  z-index: 1;
}

.nav-icon,
.content-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 8px;
  color: var(--te-primary-500);
  background:
    radial-gradient(circle at 35% 28%, rgba(255, 255, 255, 0.9), transparent 36%),
    linear-gradient(135deg, rgba(124, 77, 255, 0.14), rgba(34, 211, 238, 0.1));
}

.nav-icon {
  width: 32px;
  height: 32px;
}

.nav-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-label {
  font-size: 13px;
  font-weight: 850;
}

.nav-desc {
  max-width: 150px;
  font-size: 11px;
  font-weight: 650;
  color: rgba(80, 88, 116, 0.58);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.content-header {
  padding: 26px 30px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.58);
}

.content-title-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.content-icon {
  width: 44px;
  height: 44px;
  font-size: 18px;
  box-shadow: 0 14px 30px rgba(86, 70, 160, 0.1);
}

.content-header h1 {
  margin: 0;
  font-size: 24px;
  line-height: 1.1;
  font-weight: 900;
  color: var(--te-neutral-900);
  letter-spacing: 0;
}

.content-header p {
  margin: 6px 0 0;
  font-size: 13px;
  font-weight: 700;
  color: rgba(80, 88, 116, 0.62);
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px 30px 30px;
}

.tab-section {
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.setting-item,
.shortcut-item,
.about-item {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.62);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.58), rgba(255, 255, 255, 0.24)),
    rgba(255, 255, 255, 0.16);
  box-shadow:
    0 16px 42px rgba(86, 70, 160, 0.07),
    inset 0 1px 0 rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(18px) saturate(145%);
  -webkit-backdrop-filter: blur(18px) saturate(145%);
}

.setting-item {
  min-height: 78px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 16px 18px;
  transition:
    transform 0.22s var(--te-ease-soft),
    border-color 0.22s,
    box-shadow 0.22s;
}

.setting-item:hover,
.shortcut-item:hover,
.about-item:hover {
  transform: translateY(-1px);
  border-color: rgba(255, 255, 255, 0.82);
  box-shadow:
    0 20px 50px rgba(86, 70, 160, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
}

.setting-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.setting-item-label,
.shortcut-label,
.about-label {
  font-size: 14px;
  font-weight: 850;
  color: var(--te-neutral-900);
}

.setting-item-value,
.about-value {
  flex-shrink: 0;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.48);
  color: rgba(80, 88, 116, 0.78);
  font-size: 12px;
  font-weight: 800;
}

.setting-item-desc {
  margin: 0;
  max-width: 520px;
  font-size: 12px;
  line-height: 1.55;
  color: rgba(80, 88, 116, 0.62);
}

.toggle-switch {
  position: relative;
  flex-shrink: 0;
  width: 46px;
  height: 26px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 999px;
  background:
    linear-gradient(145deg, rgba(221, 225, 235, 0.92), rgba(255, 255, 255, 0.52)),
    rgba(255, 255, 255, 0.5);
  cursor: pointer;
  padding: 0;
  box-shadow:
    inset 0 1px 2px rgba(80, 88, 116, 0.12),
    0 10px 24px rgba(86, 70, 160, 0.08);
  transition:
    background 0.22s,
    box-shadow 0.22s;
}

.toggle-switch.active {
  background: linear-gradient(135deg, var(--te-primary-500), var(--te-accent-cyan));
  box-shadow:
    0 12px 28px rgba(124, 77, 255, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

.toggle-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 4px 10px rgba(32, 38, 62, 0.18);
  transition: transform 0.22s var(--te-ease-soft);
}

.toggle-switch.active .toggle-knob {
  transform: translateX(20px);
}

.shortcut-list,
.about-info {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.shortcut-item,
.about-item {
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  transition:
    transform 0.22s var(--te-ease-soft),
    border-color 0.22s,
    box-shadow 0.22s;
}

.shortcut-keys {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  color: rgba(80, 88, 116, 0.56);
  font-size: 12px;
  font-weight: 800;
}

.shortcut-item kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 24px;
  padding: 0 8px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.36)),
    rgba(255, 255, 255, 0.46);
  color: rgba(52, 61, 87, 0.82);
  font-family: inherit;
  font-size: 12px;
  font-weight: 850;
  box-shadow: 0 8px 18px rgba(86, 70, 160, 0.08);
}

.about-value {
  max-width: 56%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@keyframes settings-in {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.992);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (max-width: 860px) {
  .settings-page {
    padding: 18px 16px 108px;
  }

  .settings-shell {
    grid-template-columns: 1fr;
    min-height: auto;
  }

  .settings-nav {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .nav-desc {
    max-width: 100%;
  }

  .content-header,
  .settings-body {
    padding-left: 18px;
    padding-right: 18px;
  }
}
</style>
