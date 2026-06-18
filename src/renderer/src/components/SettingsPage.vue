<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

type SectionKey =
  | 'general'
  | 'playback'
  | 'dsp'
  | 'cache'
  | 'plugins'
  | 'performance'
  | 'appearance'
  | 'shortcuts'
  | 'about'

const props = defineProps<{
  initialSection?: SectionKey
}>()

defineEmits<{
  back: []
  openEqualizer: []
}>()

const sections: { key: SectionKey; label: string; icon: string }[] = [
  { key: 'general', label: '常规', icon: 'pi pi-sliders-h' },
  { key: 'playback', label: '播放', icon: 'pi pi-volume-up' },
  { key: 'dsp', label: 'DSP', icon: 'pi pi-sliders-v' },
  { key: 'cache', label: '缓存', icon: 'pi pi-database' },
  { key: 'plugins', label: '插件', icon: 'pi pi-box' },
  { key: 'performance', label: '性能', icon: 'pi pi-bolt' },
  { key: 'appearance', label: '外观', icon: 'pi pi-palette' },
  { key: 'shortcuts', label: '快捷键', icon: 'pi pi-keyboard' },
  { key: 'about', label: '关于', icon: 'pi pi-info-circle' }
]

const activeSection = ref<SectionKey>(props.initialSection ?? 'general')
const pageRef = ref<HTMLElement | null>(null)

function scrollToSection(section: SectionKey): void {
  activeSection.value = section
  document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function updateActiveSection(): void {
  const page = pageRef.value
  if (!page) return

  const pageTop = page.getBoundingClientRect().top
  let closest = activeSection.value
  let closestDistance = Number.POSITIVE_INFINITY

  for (const section of sections) {
    const el = document.getElementById(section.key)
    if (!el) continue
    const distance = Math.abs(el.getBoundingClientRect().top - pageTop - 24)
    if (distance < closestDistance) {
      closest = section.key
      closestDistance = distance
    }
  }

  activeSection.value = closest
}

onMounted(async () => {
  await nextTick()
  pageRef.value?.addEventListener('scroll', updateActiveSection, { passive: true })
  if (props.initialSection && props.initialSection !== 'general') {
    scrollToSection(props.initialSection)
  }
})

onBeforeUnmount(() => {
  pageRef.value?.removeEventListener('scroll', updateActiveSection)
})
</script>

<template>
  <main ref="pageRef" class="settings-preview-page">
    <div class="settings-preview-layout">
      <nav class="settings-preview-nav" aria-label="设置分区">
        <button
          v-for="section in sections"
          :key="section.key"
          type="button"
          class="preview-nav-item"
          :class="{ active: activeSection === section.key }"
          @click="scrollToSection(section.key)"
        >
          <i :class="section.icon"></i>
          <span>{{ section.label }}</span>
        </button>
      </nav>

      <div class="settings-preview-stack">
        <section id="general" class="glass-card preview-section">
          <div class="section-title-row">
            <i class="pi pi-sliders-h"></i>
            <h2>常规 (General)</h2>
          </div>

          <div class="section-block">
            <h3>媒体库管理 (Library & Sync)</h3>
            <div class="setting-list">
              <div class="setting-item top-align">
                <div class="setting-copy">
                  <strong>扫描文件夹</strong>
                  <span>添加包含您本地音乐文件的目录。</span>
                </div>
                <div class="folder-list">
                  <div class="folder-chip">
                    <span>D:\Music\Hi-Res</span>
                    <i class="pi pi-times"></i>
                  </div>
                  <button type="button" class="dashed-button">
                    <i class="pi pi-plus"></i>
                    添加文件夹
                  </button>
                </div>
              </div>
              <hr />
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>实时监控文件夹变动</strong>
                  <span>当添加新音乐时自动同步到媒体库，无需手动刷新。</span>
                </div>
                <span class="toggle-switch active" aria-hidden="true"></span>
              </div>
            </div>
          </div>

          <div class="section-block">
            <h3>存储与清理 (Storage)</h3>
            <div class="setting-list">
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>图片与歌词缓存位置</strong>
                  <span>当前：C:\Users\Admin\AppData\...</span>
                </div>
                <button type="button" class="soft-button">更改目录</button>
              </div>
              <hr />
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>清理应用缓存</strong>
                  <span>当前占用：<b>1.2 GB</b>。清理不会删除您的本地音乐文件。</span>
                </div>
                <button type="button" class="danger-soft-button">
                  <i class="pi pi-trash"></i>
                  立即清理
                </button>
              </div>
            </div>
          </div>

          <div class="section-block">
            <h3>集成与社交 (Integration & Social)</h3>
            <div class="setting-list">
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>原生媒体控制 (SMTC)</strong>
                  <span>响应键盘多媒体按键，并在系统锁屏界面显示播放控制。</span>
                </div>
                <span class="toggle-switch active" aria-hidden="true"></span>
              </div>
              <hr />
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>Discord Rich Presence <i class="pi pi-discord discord-icon"></i></strong>
                  <span>在 Discord 状态中向好友展示您正在播放的音乐。</span>
                </div>
                <span class="toggle-switch inactive" aria-hidden="true"></span>
              </div>
            </div>
          </div>

          <div class="section-block">
            <h3>启动与窗口 (Startup)</h3>
            <div class="setting-list">
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>开机自动启动</strong>
                  <span>在系统启动时自动在后台运行。</span>
                </div>
                <span class="toggle-switch inactive" aria-hidden="true"></span>
              </div>
              <hr />
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>关闭主窗口时</strong>
                  <span>选择点击关闭按钮后的应用行为。</span>
                </div>
                <select class="preview-select">
                  <option>最小化到系统托盘</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        <section id="playback" class="glass-card preview-section">
          <div class="section-title-row">
            <i class="pi pi-volume-up"></i>
            <h2>播放 (Playback)</h2>
          </div>

          <div class="device-panel">
            <div class="device-panel-head">
              <div>
                <p>Audio Output</p>
                <h3>输出设备与链路</h3>
              </div>
              <button type="button" class="icon-button" title="刷新设备列表">
                <i class="pi pi-refresh"></i>
              </button>
            </div>
            <div class="device-grid">
              <button type="button" class="device-card active">
                <i class="pi pi-headphones"></i>
                <span>系统默认输出</span>
                <small>WASAPI · 2ch · 48kHz</small>
                <b>当前</b>
              </button>
              <button type="button" class="device-card">
                <i class="pi pi-volume-up"></i>
                <span>Realtek Audio</span>
                <small>Shared · 24bit · 96kHz</small>
              </button>
              <button type="button" class="device-card">
                <i class="pi pi-microchip"></i>
                <span>USB DAC</span>
                <small>Exclusive · Native DSD</small>
              </button>
            </div>
          </div>

          <div class="section-block">
            <h3>播放引擎 (Engine)</h3>
            <div class="setting-list">
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>输出模式</strong>
                  <span>选择音频后端和系统混音路径。</span>
                </div>
                <div class="segmented-control">
                  <button class="active" type="button">WASAPI</button>
                  <button type="button">ASIO</button>
                  <button type="button">ALSA</button>
                </div>
              </div>
              <hr />
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>独占模式 (Exclusive)</strong>
                  <span>尝试绕过系统混音器以获得更直接的输出链路。</span>
                </div>
                <span class="toggle-switch inactive" aria-hidden="true"></span>
              </div>
              <hr />
              <div class="setting-item compact-row">
                <div class="setting-copy">
                  <strong>音量与削波保护</strong>
                  <span>应用音量低于 100% 会改变样本值。</span>
                </div>
                <div class="inline-controls">
                  <input class="number-input" type="number" value="100" />
                  <span class="toggle-switch active" aria-hidden="true"></span>
                </div>
              </div>
              <hr />
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>启动时恢复播放</strong>
                  <span>记住上次播放的曲目和播放位置。</span>
                </div>
                <select class="preview-select">
                  <option>曲目和精确位置</option>
                </select>
              </div>
            </div>
          </div>

          <div class="accordion-preview">
            <div class="accordion-head">
              <div>
                <strong>高级引擎参数</strong>
                <span>缓冲、声道路由、DSD 输出和 SACD program。</span>
              </div>
              <i class="pi pi-chevron-down"></i>
            </div>
            <div class="advanced-grid">
              <label>
                <span>Buffer Size</span>
                <select class="preview-select">
                  <option>Auto</option>
                  <option>256</option>
                </select>
              </label>
              <label>
                <span>Routing</span>
                <select class="preview-select">
                  <option>Auto</option>
                  <option>Stereo</option>
                </select>
              </label>
              <label>
                <span>DSD Output</span>
                <select class="preview-select">
                  <option>Auto</option>
                  <option>DoP</option>
                </select>
              </label>
            </div>
          </div>
        </section>

        <section id="dsp" class="glass-card preview-section">
          <div class="section-title-row split">
            <div>
              <i class="pi pi-sliders-v"></i>
              <h2>DSP 处理器</h2>
            </div>
            <span class="toggle-switch inactive large" aria-hidden="true"></span>
          </div>

          <div class="dsp-status-grid">
            <div class="dsp-meter">
              <span>Input</span>
              <strong>PCM 24bit</strong>
              <small>96 kHz · 2ch</small>
            </div>
            <div class="dsp-meter">
              <span>Process</span>
              <strong>Bypass</strong>
              <small>0 modules active</small>
            </div>
            <div class="dsp-meter">
              <span>Output</span>
              <strong>WASAPI</strong>
              <small>Shared path</small>
            </div>
          </div>

          <div class="dsp-disabled-content">
            <div class="dsp-actions">
              <button class="brand-soft-button" type="button">
                <i class="pi pi-sliders-h"></i>
                打开均衡器
              </button>
              <button class="soft-button" type="button">
                <i class="pi pi-folder-open"></i>
                载入 IR
              </button>
              <button class="soft-button" type="button">
                <i class="pi pi-undo"></i>
                重置
              </button>
            </div>

            <div class="dsp-module-grid">
              <div class="dsp-module-card">
                <h3>基础处理 (Core)</h3>
                <div class="mini-setting">
                  <div>
                    <strong>ReplayGain</strong>
                    <span>响度归一化</span>
                  </div>
                  <select class="preview-select">
                    <option>Track</option>
                  </select>
                </div>
                <div class="mini-setting">
                  <div>
                    <strong>Preamp</strong>
                    <span>预增益</span>
                  </div>
                  <input class="number-input" type="number" value="0.0" />
                </div>
              </div>

              <div class="dsp-module-card">
                <h3>空间与声学 (Spatial & Acoustic)</h3>
                <div class="mini-setting">
                  <div>
                    <strong>Parametric EQ</strong>
                    <span>10 段均衡器</span>
                  </div>
                  <button class="soft-button compact" type="button">
                    <i class="pi pi-sliders-h"></i>
                    打开面板
                  </button>
                </div>
                <div class="mini-setting">
                  <div>
                    <strong>Crossfeed</strong>
                    <span>耳机声场融合</span>
                  </div>
                  <input class="range-input" type="range" min="0" max="100" value="40" />
                </div>
              </div>

              <div class="dsp-module-card">
                <h3>硬核解码 (Decoding)</h3>
                <div class="decode-grid">
                  <label>
                    <span>DSD Mode</span>
                    <select class="preview-select">
                      <option>Auto</option>
                    </select>
                  </label>
                  <label>
                    <span>SACD Program</span>
                    <select class="preview-select">
                      <option>Auto</option>
                    </select>
                  </label>
                  <label>
                    <span>FFT Resolution</span>
                    <select class="preview-select">
                      <option>2048 (高精度)</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="cache" class="glass-card preview-section">
          <div class="section-title-row">
            <i class="pi pi-database"></i>
            <h2>缓存 (Cache)</h2>
          </div>
          <div class="setting-list">
            <div class="setting-item top-align">
              <div class="setting-copy">
                <strong>缓存目录</strong>
                <span>保存图片、歌词和在线资源缓存。</span>
              </div>
              <div class="path-control">
                <input readonly value="C:\Users\Admin\AppData\Roaming\TwilightEcho\Cache" />
                <button type="button" class="soft-button">选择文件夹</button>
                <button type="button" class="muted-button">恢复默认</button>
              </div>
            </div>
            <hr />
            <div class="setting-item top-align">
              <div class="setting-copy">
                <strong>音乐缓存目录</strong>
                <span>单独存放可复用的流媒体缓存。</span>
              </div>
              <div class="path-control">
                <input readonly value="未设置" />
                <button type="button" class="soft-button">选择文件夹</button>
              </div>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>缓存占用</strong>
                <span>当前估算：<b>1.2 GB</b></span>
              </div>
              <button class="danger-soft-button solid-hover" type="button">
                <i class="pi pi-trash"></i>
                清理缓存
              </button>
            </div>
          </div>
        </section>

        <section id="plugins" class="glass-card preview-section">
          <div class="section-title-row">
            <i class="pi pi-box"></i>
            <h2>插件 (Plugins)</h2>
          </div>
          <div class="plugin-empty">
            <i class="pi pi-box"></i>
            <strong>插件生态准备中</strong>
            <span>安装、启用、权限和插件设置区域将显示在这里。</span>
          </div>
        </section>

        <section id="performance" class="glass-card preview-section">
          <div class="section-title-row">
            <i class="pi pi-bolt"></i>
            <h2>性能 (Performance)</h2>
          </div>
          <div class="setting-list">
            <div class="setting-item">
              <div class="setting-copy">
                <strong>硬件加速</strong>
                <span>使用 GPU 加速界面渲染、动画与模糊效果。</span>
              </div>
              <span class="toggle-switch active" aria-hidden="true"></span>
            </div>
          </div>
        </section>

        <section id="appearance" class="glass-card preview-section">
          <div class="section-title-row">
            <i class="pi pi-palette"></i>
            <h2>外观 (Appearance)</h2>
          </div>

          <div class="setting-list">
            <div class="setting-item">
              <div class="setting-copy">
                <strong>主题模式</strong>
                <span>跟随系统或固定为浅色、深色。</span>
              </div>
              <div class="theme-segment">
                <button class="active" type="button">
                  <i class="pi pi-desktop"></i>
                  系统
                </button>
                <button type="button">
                  <i class="pi pi-sun"></i>
                  浅色
                </button>
                <button type="button">
                  <i class="pi pi-moon"></i>
                  深色
                </button>
              </div>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>强调色</strong>
                <span>选择界面中的主要品牌色。</span>
              </div>
              <div class="swatch-row" aria-hidden="true">
                <span class="swatch violet active"><i class="pi pi-check"></i></span>
                <span class="swatch blue"></span>
                <span class="swatch emerald"></span>
                <span class="swatch rose"></span>
                <span class="swatch amber"></span>
                <span class="swatch slate"></span>
              </div>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>原生半透明材质 (Mica / Acrylic)</strong>
                <span>启用系统级视窗模糊效果，让背景透出桌面壁纸。</span>
              </div>
              <span class="toggle-switch active" aria-hidden="true"></span>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>全局字体 (Typography)</strong>
                <span>更换界面的主要显示字体。</span>
              </div>
              <select class="preview-select wide">
                <option>系统默认 (System)</option>
                <option>Inter / Roboto</option>
                <option>霞鹜文楷 (LXGW)</option>
                <option>Sarasa Gothic</option>
                <option>Comic Sans MS</option>
              </select>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>界面排版密度 (UI Density)</strong>
                <span>控制列表项的间距与信息密度。</span>
              </div>
              <div class="segmented-control density">
                <button type="button">紧凑</button>
                <button class="active" type="button">标准</button>
                <button type="button">舒展</button>
              </div>
            </div>
            <hr />
            <div class="setting-item top-align">
              <div class="setting-copy">
                <strong>沉浸式播放页背景 (Now Playing)</strong>
                <span>全屏播放或详情页的背景视觉风格。</span>
              </div>
              <div class="background-options">
                <button class="active" type="button">
                  <span class="blur-cover"></span>
                  <small>专辑高斯模糊</small>
                </button>
                <button type="button">
                  <span class="fluid-cover"></span>
                  <small>动态流体渐变</small>
                </button>
                <button type="button">
                  <span class="solid-cover"></span>
                  <small>纯粹极简纯色</small>
                </button>
              </div>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>歌词显示样式 (Lyrics Style)</strong>
                <span>翻译对齐方式及未播放行暗度。</span>
              </div>
              <div class="inline-controls">
                <select class="preview-select">
                  <option>居中对齐</option>
                  <option>靠左对齐</option>
                </select>
                <div class="range-pill">
                  <span>未播放暗度</span>
                  <input class="range-input" type="range" min="10" max="100" value="40" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="shortcuts" class="glass-card preview-section">
          <div class="section-title-row">
            <i class="pi pi-keyboard"></i>
            <h2>快捷键</h2>
          </div>
          <div class="setting-list">
            <div class="setting-item">
              <div class="setting-copy">
                <strong>全局快捷键 (Global Shortcuts)</strong>
                <span>在应用位于后台时，依然响应系统媒体播放快捷键。</span>
              </div>
              <span class="toggle-switch inactive" aria-hidden="true"></span>
            </div>
            <hr />
            <div class="shortcut-grid">
              <div><span>播放 / 暂停</span><kbd>Space</kbd></div>
              <div><span>上一首</span><kbd>Ctrl + Left</kbd></div>
              <div><span>下一首</span><kbd>Ctrl + Right</kbd></div>
              <div><span>音量加/减</span><kbd>Up / Down</kbd></div>
            </div>
          </div>
        </section>

        <section id="about" class="glass-card preview-section about-section">
          <div class="about-glow" aria-hidden="true"></div>
          <div class="section-title-row">
            <i class="pi pi-info-circle"></i>
            <h2>关于 (About)</h2>
          </div>

          <div class="about-hero">
            <div class="logo-shell">
              <div class="logo-glow"></div>
              <div class="logo-mark">
                <i class="pi pi-headphones"></i>
              </div>
            </div>
            <div class="about-copy">
              <h3>Twilight Echo</h3>
              <span>Version 1.2.0-beta.4</span>
              <p>一款专为发烧友打造的现代级桌面音乐枢纽，支持海量本地高解析度音频与插件化流媒体扩展。</p>
            </div>
          </div>

          <div class="about-cards">
            <div class="update-card">
              <div class="status-icon"><i class="pi pi-check-circle"></i></div>
              <div>
                <strong>当前已是最新版本</strong>
                <span>上次检查：今天 10:42</span>
              </div>
              <button class="soft-button" type="button">
                <i class="pi pi-sync"></i>
                检查更新
              </button>
            </div>

            <div class="sponsor-card">
              <i class="pi pi-heart-fill sponsor-watermark"></i>
              <div>
                <h3><i class="pi pi-heart"></i> 支持项目发展</h3>
                <p>Twilight Echo 是一个由热情驱动的免费开源项目。您的慷慨赞助将直接用于服务器开销、持续更新以及给开发者的深夜咖啡。</p>
              </div>
              <div class="sponsor-actions">
                <button class="sponsor-button" type="button">
                  <i class="pi pi-wallet"></i>
                  赞助支持
                </button>
                <button class="sponsor-list-button" type="button">
                  <i class="pi pi-users"></i>
                  赞助名单
                </button>
              </div>
            </div>
          </div>

          <hr />

          <div class="about-links">
            <button type="button"><i class="pi pi-github"></i> GitHub</button>
            <button type="button"><i class="pi pi-file-o"></i> 更新日志</button>
            <button type="button"><i class="pi pi-heart-fill"></i> 开源致谢</button>
          </div>
        </section>
      </div>
    </div>
  </main>
</template>

<style>
@font-face {
  font-family: 'Outfit';
  src: url('/font/Outfit-VariableFont_wght.ttf') format('truetype');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Noto Sans SC';
  src: url('/font/NotoSansSC-VariableFont_wght.ttf') format('truetype');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
</style>

<style scoped>

.settings-preview-page {
  --brand-50: #f5f3ff;
  --brand-100: #ede9fe;
  --brand-200: #ddd6fe;
  --brand-300: #c4b5fd;
  --brand-400: #a78bfa;
  --brand-500: #8b5cf6;
  --brand-600: #7c3aed;
  --brand-700: #6d28d9;
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100vh;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 48px 48px;
  background: #f4f4f7;
  color: #111827;
  font-family: 'Outfit', 'Noto Sans SC', var(--te-font-sans), sans-serif;
  scroll-behavior: smooth;
}

.settings-preview-page::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.settings-preview-page::-webkit-scrollbar-track {
  background: transparent;
}

.settings-preview-page::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.15);
}

.settings-preview-page::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.25);
}

.settings-preview-page button,
.settings-preview-page input,
.settings-preview-page select {
  font: inherit;
}

.settings-preview-layout {
  width: min(100%, 1280px);
  margin: 0 auto;
}

.settings-preview-layout {
  position: relative;
  display: block;
  padding-top: 32px;
}

.settings-preview-nav {
  position: fixed;
  left: max(24px, calc((100vw - 896px) / 4 - 96px));
  top: 44%;
  z-index: 20;
  display: flex;
  width: 192px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  max-height: calc(100vh - 96px);
  transform: translateY(-50%);
}

.preview-nav-item {
  display: grid;
  grid-template-columns: 16px auto;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  min-height: 40px;
  padding: 10px 16px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  color: #4b5563;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  text-align: center;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    color 0.18s ease;
}

.preview-nav-item i {
  width: 16px;
  text-align: center;
}

.preview-nav-item:hover {
  background: rgba(255, 255, 255, 0.6);
  color: #111827;
}

.preview-nav-item.active {
  border-color: var(--brand-100);
  background: #ffffff;
  color: var(--brand-600);
  font-weight: 800;
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.08);
}

.settings-preview-stack {
  display: flex;
  width: min(100%, 896px);
  flex-direction: column;
  gap: 32px;
  margin: 0 auto;
  padding-bottom: 40px;
}

.glass-card {
  border: 1px solid rgba(255, 255, 255, 1);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 4px 20px -5px rgba(0, 0, 0, 0.05);
  -webkit-backdrop-filter: blur(24px);
  backdrop-filter: blur(24px);
}

.preview-section {
  scroll-margin-top: 24px;
  padding: 32px;
}

.section-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 24px;
}

.section-title-row.split {
  justify-content: space-between;
}

.section-title-row.split > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-title-row i {
  color: var(--brand-500);
  font-size: 18px;
}

.section-title-row h2 {
  margin: 0;
  color: #1f2937;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0;
}

.section-block + .section-block {
  margin-top: 32px;
}

.section-block h3,
.dsp-module-card h3 {
  margin: 0 0 16px;
  color: var(--brand-500);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.setting-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.setting-list hr,
.about-section hr {
  width: 100%;
  height: 1px;
  margin: 0;
  border: 0;
  background: rgba(243, 244, 246, 0.82);
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.setting-item.top-align {
  align-items: flex-start;
}

.setting-copy {
  display: grid;
  min-width: 0;
  gap: 4px;
  padding-right: 8px;
}

.setting-copy strong {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #1f2937;
  font-size: 13px;
  font-weight: 800;
  line-height: 1.35;
}

.setting-copy span {
  color: #6b7280;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.45;
}

.setting-copy b {
  color: var(--brand-600);
  font-weight: 800;
}

.discord-icon {
  color: #6366f1 !important;
  font-size: 14px !important;
}

.folder-list {
  display: flex;
  width: 256px;
  flex-direction: column;
  gap: 8px;
}

.folder-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  color: #374151;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.06);
  font-size: 12px;
  font-weight: 800;
}

.folder-chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-chip i {
  color: #9ca3af;
  font-size: 12px;
}

.dashed-button,
.soft-button,
.muted-button,
.danger-soft-button,
.brand-soft-button,
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  transition:
    background 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;
}

.dashed-button {
  width: 100%;
  min-height: 36px;
  border: 1px dashed #d1d5db;
  background: rgba(249, 250, 251, 0.5);
  color: #6b7280;
}

.dashed-button:hover {
  border-color: var(--brand-500);
  background: var(--brand-50);
  color: var(--brand-600);
}

.soft-button,
.muted-button {
  min-height: 30px;
  padding: 6px 16px;
  border: 1px solid #e5e7eb;
  background: #fff;
  color: #374151;
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.06);
}

.soft-button:hover {
  border-color: #d1d5db;
}

.muted-button {
  background: #f3f4f6;
  color: #4b5563;
  box-shadow: none;
}

.danger-soft-button {
  min-height: 30px;
  padding: 6px 16px;
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #dc2626;
  box-shadow: 0 1px 5px rgba(220, 38, 38, 0.08);
}

.danger-soft-button:hover,
.danger-soft-button.solid-hover:hover {
  background: #fee2e2;
}

.danger-soft-button.solid-hover:hover {
  border-color: #ef4444;
  background: #ef4444;
  color: #fff;
}

.brand-soft-button {
  min-height: 38px;
  padding: 8px 16px;
  border: 1px solid var(--brand-200);
  background: var(--brand-50);
  color: var(--brand-700);
  box-shadow: 0 1px 5px rgba(124, 58, 237, 0.08);
}

.brand-soft-button:hover {
  background: var(--brand-100);
}

.icon-button {
  width: 32px;
  height: 32px;
  border: 1px solid #e5e7eb;
  background: #fff;
  color: #4b5563;
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.06);
}

.icon-button:hover {
  border-color: var(--brand-300);
  color: var(--brand-600);
}

.toggle-switch {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  width: 40px;
  height: 20px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.toggle-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
}

.toggle-switch.active {
  background: var(--brand-500);
}

.toggle-switch.active::after {
  left: 22px;
}

.toggle-switch.inactive {
  background: #d1d5db;
}

.toggle-switch.inactive::after {
  left: 2px;
}

.toggle-switch.large {
  width: 48px;
  height: 26px;
}

.toggle-switch.large::after {
  top: 3px;
  width: 20px;
  height: 20px;
}

.toggle-switch.large.active::after {
  left: 25px;
}

.preview-select,
.number-input {
  height: 34px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  outline: none;
  background: #fff;
  color: #374151;
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.05);
  font-size: 12px;
  font-weight: 800;
}

.preview-select {
  width: 144px;
  padding: 0 12px;
  appearance: none;
}

.preview-select.wide {
  width: 160px;
  background: #f9fafb;
  box-shadow: none;
}

.number-input {
  width: 56px;
  padding: 0 8px;
  text-align: right;
}

.preview-select:focus,
.number-input:focus {
  border-color: var(--brand-500);
}

.device-panel {
  margin-bottom: 32px;
  overflow: hidden;
  border: 1px solid rgba(229, 231, 235, 0.75);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.62);
}

.device-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 20px;
}

.device-panel-head p {
  margin: 0 0 2px;
  color: var(--brand-500);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.device-panel-head h3 {
  margin: 0;
  color: #1f2937;
  font-size: 15px;
  font-weight: 900;
}

.device-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 0 20px 20px;
}

.device-card {
  position: relative;
  display: grid;
  min-height: 132px;
  gap: 4px;
  align-content: end;
  padding: 16px;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.95), rgba(249, 250, 251, 0.78)),
    #ffffff;
  color: #374151;
  text-align: left;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
  cursor: pointer;
}

.device-card:hover,
.device-card.active {
  border-color: var(--brand-300);
  box-shadow: 0 14px 32px rgba(124, 58, 237, 0.12);
}

.device-card i {
  position: absolute;
  top: 16px;
  left: 16px;
  color: var(--brand-500);
  font-size: 28px;
}

.device-card span {
  overflow: hidden;
  color: #1f2937;
  font-size: 13px;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-card small {
  overflow: hidden;
  color: #6b7280;
  font-size: 11px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-card b {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 3px 7px;
  border-radius: 999px;
  background: var(--brand-50);
  color: var(--brand-600);
  font-size: 10px;
  font-weight: 900;
}

.segmented-control,
.theme-segment {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid rgba(229, 231, 235, 0.7);
  border-radius: 12px;
  background: rgba(243, 244, 246, 0.8);
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.04);
}

.segmented-control button,
.theme-segment button {
  min-height: 32px;
  padding: 7px 16px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  font-size: 13px;
  font-weight: 800;
}

.segmented-control button.active,
.theme-segment button.active {
  background: #fff;
  color: #1f2937;
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.08);
}

.theme-segment button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.theme-segment button.active i {
  color: var(--brand-500);
}

.inline-controls {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
}

.compact-row {
  min-height: 38px;
}

.accordion-preview {
  overflow: hidden;
  border: 1px solid rgba(229, 231, 235, 0.65);
  border-radius: 12px;
  background: rgba(249, 250, 251, 0.7);
}

.accordion-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 16px 20px;
}

.accordion-head div {
  display: grid;
  gap: 3px;
}

.accordion-head strong {
  color: #1f2937;
  font-size: 13px;
  font-weight: 900;
}

.accordion-head span {
  color: #6b7280;
  font-size: 12px;
  font-weight: 500;
}

.accordion-head i {
  color: #9ca3af;
}

.advanced-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  padding: 14px 20px 20px;
  border-top: 1px solid rgba(229, 231, 235, 0.6);
}

.advanced-grid label,
.decode-grid label {
  display: grid;
  gap: 7px;
}

.advanced-grid label span,
.decode-grid label span {
  color: #6b7280;
  font-size: 11px;
  font-weight: 800;
}

.dsp-status-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.dsp-meter {
  display: grid;
  gap: 3px;
  min-height: 92px;
  padding: 18px;
  border: 1px solid rgba(229, 231, 235, 0.72);
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
}

.dsp-meter span {
  color: var(--brand-500);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.dsp-meter strong {
  color: #1f2937;
  font-size: 16px;
  font-weight: 900;
}

.dsp-meter small {
  color: #6b7280;
  font-size: 11px;
  font-weight: 600;
}

.dsp-disabled-content {
  opacity: 0.5;
  pointer-events: none;
  transition: opacity 0.3s ease;
}

.dsp-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 24px;
}

.dsp-module-grid {
  display: grid;
  gap: 18px;
}

.dsp-module-card {
  padding: 18px;
  border: 1px solid rgba(229, 231, 235, 0.7);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.76);
}

.mini-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  min-height: 48px;
}

.mini-setting + .mini-setting {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(243, 244, 246, 0.85);
}

.mini-setting div {
  display: grid;
  gap: 3px;
}

.mini-setting strong {
  color: #1f2937;
  font-size: 13px;
  font-weight: 900;
}

.mini-setting span {
  color: #6b7280;
  font-size: 12px;
  font-weight: 500;
}

.soft-button.compact {
  min-height: 30px;
  padding-inline: 12px;
}

.range-input {
  width: 96px;
  accent-color: var(--brand-500);
}

.decode-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.path-control {
  display: flex;
  min-width: min(100%, 520px);
  flex: 1;
  justify-content: flex-end;
  gap: 8px;
}

.path-control input {
  min-width: 0;
  flex: 1;
  height: 38px;
  padding: 0 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  outline: none;
  background: #f9fafb;
  color: #6b7280;
  font-size: 13px;
}

.plugin-empty {
  display: grid;
  place-items: center;
  min-height: 180px;
  gap: 8px;
  border: 1px dashed #d1d5db;
  border-radius: 14px;
  background: rgba(249, 250, 251, 0.55);
  color: #6b7280;
  text-align: center;
}

.plugin-empty i {
  color: var(--brand-400);
  font-size: 30px;
}

.plugin-empty strong {
  color: #1f2937;
  font-size: 14px;
  font-weight: 900;
}

.plugin-empty span {
  font-size: 12px;
  font-weight: 500;
}

.swatch-row {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.swatch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.12);
}

.swatch.active {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}

.swatch i {
  color: #fff;
  font-size: 10px;
}

.swatch.violet { color: #8b5cf6; background: #8b5cf6; }
.swatch.blue { background: #3b82f6; }
.swatch.emerald { background: #10b981; }
.swatch.rose { background: #fb7185; }
.swatch.amber { background: #f59e0b; }
.swatch.slate { background: #1f2937; }

.density button {
  min-width: 56px;
}

.background-options {
  display: flex;
  gap: 16px;
}

.background-options button {
  display: grid;
  justify-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.16s ease;
}

.background-options button:hover,
.background-options button.active {
  opacity: 1;
}

.background-options span {
  width: 64px;
  height: 40px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.08);
}

.background-options small {
  color: inherit;
  font-size: 10px;
  font-weight: 800;
}

.background-options button.active span {
  border-color: var(--brand-500);
  outline: 2px solid rgba(139, 92, 246, 0.3);
  outline-offset: 1px;
}

.background-options button.active small {
  color: var(--brand-600);
}

.blur-cover {
  filter: blur(2px);
  background: linear-gradient(135deg, #93c5fd, #c4b5fd 52%, #f9a8d4);
}

.background-options button:hover .blur-cover {
  filter: blur(0);
}

.fluid-cover {
  background: linear-gradient(90deg, #22d3ee, #3b82f6);
}

.solid-cover {
  background: #111827;
}

.range-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
}

.range-pill span {
  color: #6b7280;
  font-size: 12px;
  font-weight: 800;
}

.shortcut-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  padding: 16px;
  border: 1px solid rgba(229, 231, 235, 0.75);
  border-radius: 12px;
  background: #f9fafb;
}

.shortcut-grid div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.shortcut-grid span {
  color: #374151;
  font-size: 13px;
  font-weight: 600;
}

.shortcut-grid kbd {
  display: inline-flex;
  min-height: 26px;
  align-items: center;
  padding: 4px 8px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  color: #4b5563;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  font-weight: 700;
}

.about-section {
  position: relative;
  overflow: hidden;
}

.about-glow {
  position: absolute;
  top: -128px;
  right: -128px;
  width: 320px;
  height: 320px;
  border-radius: 999px;
  background: rgba(167, 139, 250, 0.1);
  filter: blur(100px);
  pointer-events: none;
}

.about-hero {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  gap: 24px;
  margin-bottom: 32px;
}

.logo-shell {
  position: relative;
  flex: 0 0 auto;
}

.logo-glow {
  position: absolute;
  inset: 0;
  border-radius: 16px;
  background: var(--brand-500);
  filter: blur(12px);
  opacity: 0.3;
  transition: opacity 0.5s ease;
}

.logo-shell:hover .logo-glow {
  opacity: 0.6;
}

.logo-mark {
  position: relative;
  display: flex;
  width: 96px;
  height: 96px;
  align-items: center;
  justify-content: center;
  border: 1px solid #374151;
  border-radius: 16px;
  background: linear-gradient(135deg, #111827, #000);
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.24);
}

.logo-mark i {
  background: linear-gradient(135deg, var(--brand-400), #e879f9);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-size: 42px;
}

.about-copy {
  display: grid;
  justify-items: start;
  gap: 10px;
  text-align: left;
}

.about-copy h3 {
  margin: 0;
  color: #1f2937;
  font-size: 24px;
  font-weight: 900;
  letter-spacing: -0.02em;
}

.about-copy span {
  display: inline-flex;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--brand-50);
  color: var(--brand-600);
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.about-copy p {
  max-width: 560px;
  margin: 0;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.65;
}

.about-cards {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 12px;
  margin-bottom: 32px;
}

.update-card,
.sponsor-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border-radius: 12px;
}

.update-card {
  border: 1px solid #e5e7eb;
  background: #fff;
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.06);
}

.status-icon {
  display: flex;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid #dcfce7;
  border-radius: 10px;
  background: #f0fdf4;
  color: #22c55e;
}

.update-card > div:nth-child(2) {
  display: grid;
  flex: 1;
  gap: 2px;
}

.update-card strong {
  color: #1f2937;
  font-size: 13px;
  font-weight: 900;
}

.update-card span {
  color: #9ca3af;
  font-size: 11px;
}

.sponsor-card {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(251, 191, 36, 0.6);
  background: linear-gradient(90deg, #fffbeb, rgba(255, 247, 237, 0.5));
  box-shadow: 0 1px 5px rgba(245, 158, 11, 0.08);
}

.sponsor-watermark {
  position: absolute;
  right: -8px;
  bottom: -8px;
  color: rgba(245, 158, 11, 0.1);
  font-size: 60px;
  transform: rotate(12deg);
  pointer-events: none;
}

.sponsor-card h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 2px;
  color: #92400e;
  font-size: 12px;
  font-weight: 900;
}

.sponsor-card p {
  max-width: 540px;
  margin: 0;
  color: rgba(146, 64, 14, 0.8);
  font-size: 11px;
  line-height: 1.6;
}

.sponsor-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}

.sponsor-button,
.sponsor-list-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 900;
  transition: transform 0.16s ease;
}

.sponsor-button {
  border: 0;
  background: linear-gradient(90deg, #fbbf24, #fb923c);
  color: #fff;
  box-shadow: 0 8px 18px rgba(249, 115, 22, 0.2);
}

.sponsor-button:hover,
.sponsor-list-button:hover,
.about-links button:hover {
  transform: translateY(-1px);
}

.sponsor-list-button {
  border: 1px solid #fde68a;
  background: #fff;
  color: #b45309;
  box-shadow: 0 1px 5px rgba(245, 158, 11, 0.08);
}

.about-links {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding-top: 32px;
}

.about-links button {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 48px;
  padding: 12px 24px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
  color: #374151;
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.06);
  cursor: pointer;
  font-size: 14px;
  font-weight: 900;
  transition:
    transform 0.16s ease,
    box-shadow 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease;
}

.about-links button:hover {
  border-color: #d1d5db;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.08);
}

.about-links button:nth-child(2):hover {
  border-color: var(--brand-300);
  color: var(--brand-600);
}

.about-links button:nth-child(3):hover {
  border-color: #fda4af;
  color: #e11d48;
}

@media (max-width: 1024px) {
  .settings-preview-page {
    padding: 0 24px 24px;
  }

  .settings-preview-layout {
    display: flex;
    flex-direction: column;
    gap: 28px;
    padding-top: 32px;
  }

  .settings-preview-nav {
    position: sticky;
    top: 0;
    left: auto;
    width: 100%;
    max-width: 100%;
    flex: 0 0 auto;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    min-height: auto;
    overflow-x: auto;
    padding-bottom: 8px;
    transform: none;
  }

  .preview-nav-item {
    flex: 0 0 auto;
  }

  .settings-preview-stack {
    width: 100%;
  }
}

@media (max-width: 760px) {
  .settings-preview-page {
    padding: 0 16px 40px;
  }

  .preview-section {
    padding: 24px;
  }

  .setting-item,
  .setting-item.top-align,
  .mini-setting,
  .update-card,
  .sponsor-card,
  .about-hero {
    align-items: stretch;
    flex-direction: column;
  }

  .folder-list,
  .preview-select,
  .preview-select.wide,
  .path-control,
  .path-control input,
  .soft-button,
  .muted-button,
  .danger-soft-button,
  .brand-soft-button {
    width: 100%;
  }

  .device-grid,
  .dsp-status-grid,
  .advanced-grid,
  .decode-grid,
  .shortcut-grid {
    grid-template-columns: 1fr;
  }

  .path-control,
  .inline-controls,
  .background-options,
  .sponsor-actions,
  .about-links {
    flex-direction: column;
    align-items: stretch;
  }

  .theme-segment,
  .segmented-control {
    width: 100%;
  }

  .theme-segment button,
  .segmented-control button {
    flex: 1;
  }

  .about-copy {
    justify-items: center;
    text-align: center;
  }

  .about-links button {
    flex: 1;
  }
}
</style>
