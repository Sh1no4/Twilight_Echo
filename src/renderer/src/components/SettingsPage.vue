<script setup lang="ts">
import { ref } from 'vue'
import { usePlayerStore } from '../stores/usePlayerStore'

defineEmits<{
  back: []
}>()

const { exclusiveMode, toggleExclusiveMode } = usePlayerStore()

const tabs = [
  { key: 'general', label: '通用' },
  { key: 'system', label: '系统' },
  { key: 'personalization', label: '个性化' },
  { key: 'shortcuts', label: '快捷键' },
  { key: 'about', label: '关于' }
] as const

type TabKey = (typeof tabs)[number]['key']

const activeTab = ref<TabKey>('general')
</script>

<template>
  <div class="settings-page">
    <div class="settings-header">
      <button class="settings-back-btn" title="返回" @click="$emit('back')">
        <i class="pi pi-arrow-left"></i>
      </button>
      <span class="settings-title">设置</span>
    </div>
    <div class="settings-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>
    <div class="settings-body">
      <!-- 通用 -->
      <section v-if="activeTab === 'general'" class="tab-section">
        <div class="setting-item">
          <div class="setting-item-header">
            <span class="setting-item-label">启动时自动检查登录</span>
            <button class="toggle-switch active" role="switch" aria-checked="true">
              <span class="toggle-knob"></span>
            </button>
          </div>
          <p class="setting-item-desc">应用启动时自动检查网易云音乐登录状态</p>
        </div>
        <div class="setting-item">
          <div class="setting-item-header">
            <span class="setting-item-label">最小化到托盘</span>
            <button class="toggle-switch" role="switch" aria-checked="false">
              <span class="toggle-knob"></span>
            </button>
          </div>
          <p class="setting-item-desc">关闭窗口时最小化到系统托盘而不是退出程序</p>
        </div>
      </section>

      <!-- 系统 -->
      <section v-if="activeTab === 'system'" class="tab-section">
        <div class="setting-item">
          <div class="setting-item-header">
            <span class="setting-item-label">独占模式</span>
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
          <p class="setting-item-desc">绕过 Windows 混音器，直通音频设备。开启后系统内其他应用将无法同时播放音频。</p>
        </div>
        <div class="setting-item">
          <div class="setting-item-header">
            <span class="setting-item-label">音频引擎</span>
            <span class="setting-item-value">MPV</span>
          </div>
          <p class="setting-item-desc">当前使用的音频播放引擎</p>
        </div>
      </section>

      <!-- 个性化 -->
      <section v-if="activeTab === 'personalization'" class="tab-section">
        <div class="setting-item">
          <div class="setting-item-header">
            <span class="setting-item-label">毛玻璃效果</span>
            <button class="toggle-switch active" role="switch" aria-checked="true">
              <span class="toggle-knob"></span>
            </button>
          </div>
          <p class="setting-item-desc">播放页面启用毛玻璃背景效果</p>
        </div>
        <div class="setting-item">
          <div class="setting-item-header">
            <span class="setting-item-label">主题色</span>
            <span class="setting-item-value">跟随封面</span>
          </div>
          <p class="setting-item-desc">界面主题色提取自当前播放歌曲的封面</p>
        </div>
      </section>

      <!-- 快捷键 -->
      <section v-if="activeTab === 'shortcuts'" class="tab-section">
        <div class="shortcut-list">
          <div class="shortcut-item">
            <span class="shortcut-label">播放 / 暂停</span>
            <kbd>Space</kbd>
          </div>
          <div class="shortcut-item">
            <span class="shortcut-label">上一首</span>
            <span><kbd>Ctrl</kbd><span class="shortcut-plus">+</span><kbd>←</kbd></span>
          </div>
          <div class="shortcut-item">
            <span class="shortcut-label">下一首</span>
            <span><kbd>Ctrl</kbd><span class="shortcut-plus">+</span><kbd>→</kbd></span>
          </div>
          <div class="shortcut-item">
            <span class="shortcut-label">音量加</span>
            <span><kbd>Ctrl</kbd><span class="shortcut-plus">+</span><kbd>↑</kbd></span>
          </div>
          <div class="shortcut-item">
            <span class="shortcut-label">音量减</span>
            <span><kbd>Ctrl</kbd><span class="shortcut-plus">+</span><kbd>↓</kbd></span>
          </div>
        </div>
      </section>

      <!-- 关于 -->
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
  </div>
</template>

<style scoped>
.settings-page {
  position: fixed;
  inset: 32px 0 0 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.settings-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-bottom: 1px solid #f0f0f0;
}

.settings-back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #333;
  cursor: pointer;
  font-size: 16px;
  transition: background 0.15s;
}

.settings-back-btn:hover {
  background: #f0f0f0;
}

.settings-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

/* ---- Tabs ---- */
.settings-tabs {
  display: flex;
  gap: 0;
  padding: 0 16px;
  border-bottom: 1px solid #eee;
  flex-shrink: 0;
}

.tab-btn {
  padding: 10px 16px;
  border: none;
  background: transparent;
  color: #888;
  font-size: 13px;
  cursor: pointer;
  position: relative;
  transition: color 0.15s;
}

.tab-btn:hover {
  color: #555;
}

.tab-btn.active {
  color: #1a73e8;
  font-weight: 500;
}

.tab-btn.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 16px;
  right: 16px;
  height: 2px;
  background: #1a73e8;
  border-radius: 1px 1px 0 0;
}

/* ---- Body ---- */
.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px 20px;
}

.tab-section {
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.setting-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.setting-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.setting-item-label {
  font-size: 14px;
  color: #333;
}

.setting-item-value {
  font-size: 13px;
  color: #999;
}

.setting-item-desc {
  font-size: 12px;
  color: #999;
  line-height: 1.5;
  margin: 0;
}

/* Toggle switch */
.toggle-switch {
  position: relative;
  width: 40px;
  height: 22px;
  border: none;
  border-radius: 11px;
  background: #ccc;
  cursor: pointer;
  padding: 0;
  transition: background 0.2s;
  flex-shrink: 0;
}

.toggle-switch.active {
  background: #1a73e8;
}

.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.toggle-switch.active .toggle-knob {
  transform: translateX(18px);
}

/* Shortcuts */
.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.shortcut-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #f8f8f8;
  border-radius: 6px;
}

.shortcut-label {
  font-size: 14px;
  color: #333;
}

.shortcut-item kbd {
  display: inline-block;
  padding: 3px 7px;
  font-size: 12px;
  font-family: inherit;
  color: #555;
  background: #e8e8e8;
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  line-height: 1.4;
}

.shortcut-plus {
  margin: 0 4px;
  color: #999;
  font-size: 12px;
}

/* About */
.about-info {
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid #eee;
  border-radius: 8px;
  overflow: hidden;
}

.about-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
}

.about-item + .about-item {
  border-top: 1px solid #f0f0f0;
}

.about-label {
  font-size: 14px;
  color: #333;
}

.about-value {
  font-size: 13px;
  color: #999;
}
</style>
