<script setup lang="ts">
import { ref } from 'vue'
import PuzzleIcon from './icons/PuzzleIcon.vue'

const emit = defineEmits<{
  back: []
}>()

const activeTab = ref('installed')
const devMode = ref(false)

function switchTab(tabId: string) {
  activeTab.value = tabId
}
</script>

<template>
  <div class="plugin-page">
    <div class="plugin-window">
      
      <!-- Sidebar -->
      <aside class="sidebar">
        <div class="sidebar-header">
          <h1><PuzzleIcon /> 扩展中心</h1>
        </div>
        <nav class="nav-menu">
          <div class="nav-item" :class="{ active: activeTab === 'installed' }" @click="switchTab('installed')">
            <i class="pi pi-check-circle"></i>
            <span>已安装</span>
          </div>
          <div class="nav-item" :class="{ active: activeTab === 'discover' }" @click="switchTab('discover')">
            <i class="pi pi-compass"></i>
            <span>发现市场</span>
          </div>
          <div class="nav-item" :class="{ active: activeTab === 'updates' }" @click="switchTab('updates')">
            <i class="pi pi-cloud-download"></i>
            <span>更新 <span style="background: #ef4444; color: #fff; font-size: 10px; padding: 2px 6px; border-radius: 100px; margin-left: 4px;">2</span></span>
          </div>
        </nav>

        <div class="sidebar-footer">
          <div class="dev-mode-toggle">
            <span>开发者模式</span>
            <div class="switch" :class="{ on: devMode }" @click="devMode = !devMode"></div>
          </div>
        </div>
      </aside>

      <!-- Main Content -->
      <main class="main-content">
        
        <!-- Topbar -->
        <header class="topbar">
          <div class="search-box">
            <i class="pi pi-search"></i>
            <input 
              type="text" 
              :placeholder="activeTab === 'installed' ? '搜索已安装插件名称或作者...' : activeTab === 'discover' ? '搜索官方插件市场...' : '在可用更新中搜索...'"
            >
          </div>
          <div class="top-actions">
            <button v-if="activeTab === 'installed'" class="btn btn-outline" id="localInstallBtn">
              <i class="pi pi-folder-open"></i> 从本地安装包 (.tep)
            </button>
          </div>
        </header>

        <!-- Scroll Area: Installed -->
        <div class="scroll-area" v-if="activeTab === 'installed'">
          <div class="page-title">
            已安装扩展 <span class="badge">4</span>
          </div>

          <div class="plugin-grid">
            
            <!-- Card 1: NCM (Built-in) -->
            <div class="plugin-card">
              <div class="builtin-label">系统内置</div>
              <div class="plugin-card-header">
                <div class="plugin-icon ncm"><i class="pi pi-cloud"></i></div>
                <div class="plugin-info">
                  <div class="plugin-title-row">
                    <div class="plugin-name">网易云音乐源</div>
                    <div class="plugin-version">v1.2.0</div>
                  </div>
                  <div class="plugin-author"><i class="pi pi-verified" style="color:#6366f1"></i> Twilight Echo 官方团队</div>
                  <div class="plugin-tags">
                    <span class="tag provider">PROVIDER</span>
                    <span class="tag ui">UI</span>
                  </div>
                </div>
              </div>
              <div class="plugin-desc">
                Twilight Echo 官方维护的基础流媒体供应商。提供网易云音乐曲库搜索、歌单解析、歌词与封面抓取功能。
              </div>
              <div class="plugin-footer">
                <div class="switch-wrap">
                  <div class="switch on"></div>
                  <span class="switch-label">已启用</span>
                </div>
                <div class="plugin-actions">
                  <button class="icon-btn" title="插件设置"><i class="pi pi-cog"></i></button>
                </div>
              </div>
            </div>

            <!-- Card 2: Bilibili -->
            <div class="plugin-card">
              <div class="plugin-card-header">
                <div class="plugin-icon bili"><i class="pi pi-video"></i></div>
                <div class="plugin-info">
                  <div class="plugin-title-row">
                    <div class="plugin-name">Bilibili 收藏夹音源</div>
                    <div class="plugin-version">v0.8.4</div>
                  </div>
                  <div class="plugin-author"><i class="pi pi-user"></i> Asenyarzc</div>
                  <div class="plugin-tags">
                    <span class="tag provider">PROVIDER</span>
                  </div>
                </div>
              </div>
              <div class="plugin-desc">
                解析并在 Twilight Echo 流媒体区展示 B 站收藏夹内容。通过 DASH 音频提取进行高音质无缝播放。
              </div>
              <div class="plugin-footer">
                <div class="switch-wrap">
                  <div class="switch on"></div>
                  <span class="switch-label">已启用</span>
                </div>
                <div class="plugin-actions">
                  <button class="icon-btn" title="查看日志"><i class="pi pi-align-left"></i></button>
                  <button class="icon-btn" title="插件设置"><i class="pi pi-cog"></i></button>
                  <button class="icon-btn danger" title="卸载"><i class="pi pi-trash"></i></button>
                </div>
              </div>
            </div>

            <!-- Card 3: AutoEQ -->
            <div class="plugin-card">
              <div class="plugin-card-header">
                <div class="plugin-icon dsp"><i class="pi pi-wave-pulse"></i></div>
                <div class="plugin-info">
                  <div class="plugin-title-row">
                    <div class="plugin-name">OPRA (AutoEQ) 补偿</div>
                    <div class="plugin-version">v2.0.1</div>
                  </div>
                  <div class="plugin-author"><i class="pi pi-verified" style="color:#6366f1"></i> Twilight Echo 官方团队</div>
                  <div class="plugin-tags">
                    <span class="tag dsp">DSP NATIVE</span>
                    <span class="tag ui">UI</span>
                  </div>
                </div>
              </div>
              <div class="plugin-desc">
                基于原生 C++ DSP 模块的高性能耳机频响自动补偿。接入 JaakkoPasanen/AutoEq 数据集。
              </div>
              <div class="plugin-footer">
                <div class="switch-wrap">
                  <div class="switch on"></div>
                  <span class="switch-label">已启用</span>
                </div>
                <div class="plugin-actions">
                  <button class="icon-btn" title="卸载"><i class="pi pi-trash"></i></button>
                </div>
              </div>
            </div>

            <!-- Card 4: Discord RPC -->
            <div class="plugin-card" style="opacity: 0.7;">
              <div class="plugin-card-header">
                <div class="plugin-icon" style="background: linear-gradient(135deg, #e0e7ff, #c7d2fe); color: #4f46e5;"><i class="pi pi-discord"></i></div>
                <div class="plugin-info">
                  <div class="plugin-title-row">
                    <div class="plugin-name">Discord Rich Presence</div>
                    <div class="plugin-version">v1.1.0</div>
                  </div>
                  <div class="plugin-author"><i class="pi pi-user"></i> Community</div>
                  <div class="plugin-tags">
                    <span class="tag tool">TOOL</span>
                  </div>
                </div>
              </div>
              <div class="plugin-desc">
                在 Discord 个人资料中实时展示当前正在 Twilight Echo 中播放的高解析度音频信息。
              </div>
              <div class="plugin-footer">
                <div class="switch-wrap">
                  <div class="switch"></div>
                  <span class="switch-label">已停用</span>
                </div>
                <div class="plugin-actions">
                  <button class="icon-btn danger" title="卸载"><i class="pi pi-trash"></i></button>
                </div>
              </div>
            </div>

          </div>
        </div>

        <!-- Scroll Area: Discover -->
        <div class="scroll-area" v-else-if="activeTab === 'discover'">
          
          <div class="discover-banner">
            <div class="banner-text">
              <h2>官方插件市场</h2>
              <p>基于受信任的索引仓库分发，为 Twilight Echo 赋予无尽可能。</p>
            </div>
            <div class="banner-art">
              <i class="pi pi-server"></i>
            </div>
            <button class="btn btn-outline" style="position: absolute; right: 32px; bottom: 32px; background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.2); color: #fff;">浏览 GitHub 仓库 <i class="pi pi-external-link"></i></button>
          </div>

          <div class="page-title" style="font-size: 18px; margin-bottom: 16px;">
            本周推荐
          </div>

          <div class="plugin-grid">
            <!-- Market Card 1 -->
            <div class="plugin-card">
              <div class="plugin-card-header">
                <div class="plugin-icon" style="background: linear-gradient(135deg, #fce7f3, #fbcfe8); color: #db2777;"><i class="pi pi-globe"></i></div>
                <div class="plugin-info">
                  <div class="plugin-title-row">
                    <div class="plugin-name">Spotify Source</div>
                    <div class="plugin-version">v0.9.1</div>
                  </div>
                  <div class="plugin-author"><i class="pi pi-user"></i> EchoDev</div>
                  <div class="plugin-tags">
                    <span class="tag provider">PROVIDER</span>
                  </div>
                </div>
              </div>
              <div class="plugin-desc">
                接入 Spotify Premium 账号，提供 Spotify 歌单同步、流媒体检索功能。（需 Premium 账号与 Ogg Vorbis 原生解码支持）
              </div>
              <div class="plugin-footer">
                <div style="font-size: 12px; color: var(--te-neutral-400);"><i class="pi pi-download"></i> 12.5k</div>
                <button class="btn btn-primary" style="padding: 6px 16px;">获取</button>
              </div>
            </div>

            <!-- Market Card 2 -->
            <div class="plugin-card">
              <div class="plugin-card-header">
                <div class="plugin-icon" style="background: linear-gradient(135deg, #dcfce7, #bbf7d0); color: #16a34a;"><i class="pi pi-image"></i></div>
                <div class="plugin-info">
                  <div class="plugin-title-row">
                    <div class="plugin-name">Last.fm Scrobbler</div>
                    <div class="plugin-version">v2.1.0</div>
                  </div>
                  <div class="plugin-author"><i class="pi pi-user"></i> ScrobbleFan</div>
                  <div class="plugin-tags">
                    <span class="tag tool">TOOL</span>
                  </div>
                </div>
              </div>
              <div class="plugin-desc">
                自动将 Twilight Echo 的播放记录同步到你的 Last.fm 账户。支持多音源混合记录模式。
              </div>
              <div class="plugin-footer">
                <div style="font-size: 12px; color: var(--te-neutral-400);"><i class="pi pi-download"></i> 8.2k</div>
                <button class="btn btn-primary" style="padding: 6px 16px;">获取</button>
              </div>
            </div>

          </div>
        </div>

        <!-- Scroll Area: Updates -->
        <div class="scroll-area" v-else-if="activeTab === 'updates'">
          
          <div class="page-title">
            可用更新 <span class="badge" style="background: #fee2e2; color: #ef4444;">2</span>
          </div>
          
          <div style="margin-bottom: 24px; padding: 16px; background: rgba(99, 102, 241, 0.05); border: 1px solid rgba(99, 102, 241, 0.1); border-radius: 16px; display: flex; justify-content: space-between; align-items: center;">
            <div style="font-size: 14px; font-weight: 600; color: var(--te-primary-600);">有 2 个插件可以更新。</div>
            <button class="btn btn-primary">全部更新</button>
          </div>

          <div class="plugin-grid" style="grid-template-columns: 1fr;">
            
            <!-- Update Card 1 -->
            <div class="plugin-card" style="flex-direction: row; align-items: center; justify-content: space-between; padding: 20px;">
              <div class="plugin-card-header" style="align-items: center; margin-bottom: 0;">
                <div class="plugin-icon dsp" style="width: 48px; height: 48px; font-size: 20px;"><i class="pi pi-wave-pulse"></i></div>
                <div class="plugin-info" style="margin-left: 16px;">
                  <div class="plugin-title-row">
                    <div class="plugin-name" style="font-size: 16px;">OPRA (AutoEQ) 补偿</div>
                  </div>
                  <div class="plugin-author">v2.0.1 <i class="pi pi-arrow-right" style="font-size: 10px; margin: 0 4px;"></i> <span style="color: var(--te-primary-600); font-weight: 600;">v2.1.0</span></div>
                </div>
              </div>
              <div style="flex: 1; margin: 0 32px; font-size: 13px; color: var(--te-neutral-500);">
                - 同步最新的 AutoEq 数据集<br>
                - 优化高采样率下卷积处理的 CPU 占用
              </div>
              <button class="btn btn-primary" style="padding: 6px 16px;">更新</button>
            </div>

            <!-- Update Card 2 -->
            <div class="plugin-card" style="flex-direction: row; align-items: center; justify-content: space-between; padding: 20px;">
              <div class="plugin-card-header" style="align-items: center; margin-bottom: 0;">
                <div class="plugin-icon bili" style="width: 48px; height: 48px; font-size: 20px;"><i class="pi pi-video"></i></div>
                <div class="plugin-info" style="margin-left: 16px;">
                  <div class="plugin-title-row">
                    <div class="plugin-name" style="font-size: 16px;">Bilibili 收藏夹音源</div>
                  </div>
                  <div class="plugin-author">v0.8.4 <i class="pi pi-arrow-right" style="font-size: 10px; margin: 0 4px;"></i> <span style="color: var(--te-primary-600); font-weight: 600;">v0.9.0</span></div>
                </div>
              </div>
              <div style="flex: 1; margin: 0 32px; font-size: 13px; color: var(--te-neutral-500);">
                - 修复部分视频获取 DASH 链接失败的问题<br>
                - 支持自定义获取音质等级（默认最高 192k）
              </div>
              <button class="btn btn-primary" style="padding: 6px 16px;">更新</button>
            </div>

          </div>
        </div>

      </main>
    </div>
  </div>
</template>

<style scoped>
.plugin-page {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: #fafaf9;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}



.plugin-window {
  width: 100%;
  height: 100%;
  flex: 1;
  background: #fafaf9;
  display: flex;
  overflow: hidden;
  position: relative;
}

/* Sidebar */
.sidebar {
  width: 240px;
  background: var(--te-bg-card, #ffffff);
  border-right: 1px solid var(--te-border-color, #e5e7eb);
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 56px 24px 24px 24px;
}

.sidebar-header h1 {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--te-neutral-900, #111827);
}

.sidebar-header h1 i,
.sidebar-header h1 .puzzle-icon {
  color: var(--te-neutral-900, #111827);
  font-size: 20px;
}

.nav-menu {
  flex: 1;
  padding: 0 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 12px;
  color: var(--te-neutral-600, #4b5563);
  cursor: pointer;
  transition: all 0.2s;
  font-weight: 500;
  font-size: 14px;
}

.nav-item i {
  font-size: 18px;
  opacity: 0.7;
}

.nav-item:hover {
  background: var(--te-bg-hover, #f3f4f6);
  color: var(--te-neutral-900, #111827);
}

.nav-item.active {
  background: rgba(99, 102, 241, 0.1);
  color: var(--te-primary-600, #6366f1);
}

.nav-item.active i {
  opacity: 1;
}

.sidebar-footer {
  padding: 20px 24px;
  border-top: 1px solid var(--te-border-color, #e5e7eb);
}

.dev-mode-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 500;
  color: var(--te-neutral-600, #4b5563);
}

.switch {
  width: 36px;
  height: 20px;
  background: var(--te-border-color, #e5e7eb);
  border-radius: 20px;
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
}

.switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.switch.on {
  background: var(--te-primary-600, #6366f1);
}

.switch.on::after {
  transform: translateX(16px);
}

/* Main Content */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #fafaf9; /* 极浅暖灰背景，区分侧边栏 */
}

.topbar {
  height: 104px;
  padding: 32px 32px 0 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 0;
  background: #fafaf9;
  z-index: 10;
}

.search-box {
  display: flex;
  align-items: center;
  background: rgba(0,0,0,0.04);
  border-radius: 100px;
  padding: 8px 16px;
  width: 300px;
  transition: all 0.2s;
}

.search-box:focus-within {
  background: #fff;
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
}

.search-box i {
  color: var(--te-neutral-400, #9ca3af);
  margin-right: 8px;
}

.search-box input {
  border: none;
  background: transparent;
  outline: none;
  font-size: 13px;
  width: 100%;
  color: var(--te-neutral-800, #1f2937);
}

.search-box input::placeholder {
  color: var(--te-neutral-400, #9ca3af);
}

.top-actions {
  display: flex;
  gap: 12px;
}

.btn {
  padding: 8px 16px;
  border-radius: 100px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s;
  border: none;
}

.btn-outline {
  background: transparent;
  border: 1px solid var(--te-border-color, #e5e7eb);
  color: var(--te-neutral-700, #374151);
}

.btn-outline:hover {
  background: var(--te-bg-hover, #f3f4f6);
}

.btn-primary {
  background: var(--te-primary-600, #6366f1);
  color: #fff;
}

.btn-primary:hover {
  background: var(--te-primary-500, #818cf8);
}

.scroll-area {
  flex: 1;
  overflow-y: auto;
  padding: 32px;
}

.page-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--te-neutral-900, #111827);
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.badge {
  font-size: 12px;
  font-weight: 600;
  background: rgba(0,0,0,0.06);
  color: var(--te-neutral-600, #4b5563);
  padding: 4px 10px;
  border-radius: 100px;
}

.plugin-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

/* Cards */
.plugin-card {
  background: var(--te-bg-card, #fff);
  border-radius: 16px;
  padding: 24px;
  border: 1px solid var(--te-border-color, #e5e7eb);
  display: flex;
  flex-direction: column;
  position: relative;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02);
}

.plugin-card:hover {
  box-shadow: 0 10px 20px -5px rgba(0,0,0,0.05);
  transform: translateY(-2px);
  border-color: rgba(99, 102, 241, 0.3);
}

.builtin-label {
  position: absolute;
  top: 16px;
  right: 16px;
  font-size: 11px;
  font-weight: 600;
  color: var(--te-neutral-400, #9ca3af);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.plugin-card-header {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.plugin-icon {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  flex-shrink: 0;
}

.plugin-icon.ncm {
  background: linear-gradient(135deg, #fee2e2, #fecaca);
  color: #ef4444;
}

.plugin-icon.bili {
  background: linear-gradient(135deg, #f3e8ff, #e9d5ff);
  color: #a855f7;
}

.plugin-icon.dsp {
  background: linear-gradient(135deg, #e0f2fe, #bae6fd);
  color: #0ea5e9;
}

.plugin-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.plugin-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.plugin-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--te-neutral-900, #111827);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.plugin-version {
  font-size: 11px;
  color: var(--te-neutral-400, #9ca3af);
  background: rgba(0,0,0,0.04);
  padding: 2px 6px;
  border-radius: 6px;
}

.plugin-author {
  font-size: 12px;
  color: var(--te-neutral-500, #6b7280);
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
}

.plugin-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.tag {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
}

.tag.provider {
  background: rgba(99, 102, 241, 0.1);
  color: var(--te-primary-600, #6366f1);
}

.tag.ui {
  background: rgba(245, 158, 11, 0.1);
  color: #d97706;
}

.tag.dsp {
  background: rgba(14, 165, 233, 0.1);
  color: #0ea5e9;
}

.tag.tool {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
}

.plugin-desc {
  font-size: 13px;
  color: var(--te-neutral-600, #4b5563);
  line-height: 1.5;
  flex: 1;
  margin-bottom: 20px;
}

.plugin-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid rgba(0,0,0,0.04);
  padding-top: 16px;
}

.switch-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.switch-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--te-neutral-500, #6b7280);
}

.plugin-actions {
  display: flex;
  gap: 8px;
}

.icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: rgba(0,0,0,0.04);
  color: var(--te-neutral-600, #4b5563);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.icon-btn:hover {
  background: rgba(0,0,0,0.08);
  color: var(--te-neutral-900, #111827);
}

.icon-btn.danger:hover {
  background: #fee2e2;
  color: #ef4444;
}

/* Discover Banner */
.discover-banner {
  background: linear-gradient(135deg, #4f46e5, #818cf8);
  border-radius: 20px;
  padding: 32px;
  color: #fff;
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: relative;
  overflow: hidden;
  margin-bottom: 32px;
}

.banner-text h2 {
  margin: 0 0 8px 0;
  font-size: 28px;
  font-weight: 800;
}

.banner-text p {
  margin: 0;
  font-size: 14px;
  opacity: 0.9;
  max-width: 300px;
  line-height: 1.5;
}

.banner-art {
  position: absolute;
  right: -20px;
  bottom: -40px;
  font-size: 180px;
  opacity: 0.1;
  transform: rotate(-15deg);
}
</style>
