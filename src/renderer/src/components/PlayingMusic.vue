<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import { usePlayerStore } from '../stores/usePlayerStore'

const { currentTrack, currentTime } = usePlayerStore()

defineEmits<{
  back: []
}>()

// 视图模式：cover = 封面模式, lyrics = 歌词模式
const viewMode = ref<'cover' | 'lyrics'>('cover')

function toggleViewMode(): void {
  viewMode.value = viewMode.value === 'cover' ? 'lyrics' : 'cover'
}

const bgSrc = ref(currentTrack.value?.cover ?? '')
const bgOpacity = ref(1)
const lyricsEl = ref<HTMLElement | null>(null)

watch(
  () => currentTrack.value?.cover,
  (newCover, oldCover) => {
    if (!oldCover && newCover) {
      bgSrc.value = newCover ?? ''
      return
    }
    if (newCover && newCover !== bgSrc.value) {
      bgOpacity.value = 0
      setTimeout(() => {
        bgSrc.value = newCover
        bgOpacity.value = 1
      }, 400)
    } else if (!newCover) {
      bgOpacity.value = 0
      setTimeout(() => {
        bgSrc.value = ''
      }, 600)
    }
  }
)

const showCoverBg = computed(() => !!bgSrc.value)

interface LyricLine {
  time: number
  text: string
}

function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = []
  const lineRe = /\[(\d{1,3}):(\d{2})(?:[.:](\d{2,3}))?\]/g

  for (const raw of lrc.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    let match: RegExpExecArray | null
    const timestamps: number[] = []
    lineRe.lastIndex = 0

    while ((match = lineRe.exec(trimmed)) !== null) {
      const min = parseInt(match[1], 10)
      const sec = parseInt(match[2], 10)
      let ms = 0
      if (match[3]) {
        ms = parseInt(match[3], 10)
        if (match[3].length === 2) ms = ms * 10
      }
      timestamps.push(min * 60 + sec + ms / 1000)
    }

    const text = trimmed.replace(lineRe, '').trim()
    if (!text) continue

    for (const ts of timestamps) {
      lines.push({ time: ts, text })
    }
  }

  lines.sort((a, b) => a.time - b.time)
  return lines
}

const lyricLines = computed(() => {
  if (!currentTrack.value?.lyrics) return []
  return parseLrc(currentTrack.value.lyrics)
})

const activeLyricIndex = computed(() => {
  const t = currentTime.value
  let idx = -1
  for (let i = 0; i < lyricLines.value.length; i++) {
    if (lyricLines.value[i].time <= t) {
      idx = i
    } else {
      break
    }
  }
  return idx
})

watch(activeLyricIndex, async () => {
  await nextTick()
  if (!lyricsEl.value) return
  const active = lyricsEl.value.querySelector('.lyric-line.active') as HTMLElement | null
  if (active) {
    active.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
})

watch(
  () => currentTrack.value?.id,
  () => {
    if (lyricsEl.value) {
      lyricsEl.value.scrollTo({ top: 0, behavior: 'instant' })
    }
  }
)
</script>

<template>
  <div class="playing-music">
    <!-- 模糊封面背景 -->
    <div v-if="showCoverBg" class="cover-bg-wrapper">
      <img :src="bgSrc" class="cover-bg-img" :style="{ opacity: bgOpacity }" />
    </div>
    <!-- 液态玻璃叠加层 -->
    <div v-if="showCoverBg" class="glass-overlay" />

    <!-- 小药丸切换按钮 -->
    <div class="pill-toggle" @click="toggleViewMode">
      <div class="pill-slider" :class="{ 'pill-right': viewMode === 'lyrics' }" />
      <span class="pill-label" :class="{ active: viewMode === 'cover' }">封面</span>
      <span class="pill-label" :class="{ active: viewMode === 'lyrics' }">歌词</span>
    </div>

    <!-- 前景内容 -->
    <div class="playing-music-foreground">
      <div v-if="currentTrack" class="playing-music-content">
        <!-- ========== 封面模式 ========== -->
        <Transition name="mode-fade" mode="out-in">
          <div v-if="viewMode === 'cover'" key="cover" class="cover-mode">
            <div class="cover-mode-inner">
              <!-- 左侧封面 -->
              <div class="cover-mode-left">
                <img
                  v-if="currentTrack.cover"
                  :src="currentTrack.cover"
                  class="cover-mode-img"
                  alt="cover"
                />
                <div v-else class="cover-mode-placeholder">
                  <i
                    class="pi pi-wave-pulse"
                    style="font-size: 96px; color: rgba(255, 255, 255, 0.3)"
                  ></i>
                </div>
              </div>
              <!-- 右侧信息 -->
              <div class="cover-mode-right">
                <h1 class="cover-mode-title">{{ currentTrack.title }}</h1>
                <p class="cover-mode-artist">{{ currentTrack.artist }}</p>
                <p v-if="currentTrack.album" class="cover-mode-album">{{ currentTrack.album }}</p>
              </div>
            </div>
          </div>

          <!-- ========== 歌词模式 ========== -->
          <div v-else key="lyrics" class="lyrics-mode">
            <!-- 左上角浮层：歌曲信息 -->
            <div class="lyrics-left">
              <span class="lyrics-now-playing">NOW PLAYING</span>
            </div>

            <!-- 歌词：铺满全屏居中 -->
            <div class="lyrics-right">
              <div v-if="lyricLines.length > 0" ref="lyricsEl" class="lyrics-mode-container">
                <p
                  v-for="(line, i) in lyricLines"
                  :key="i"
                  class="lyric-line"
                  :class="{ active: i === activeLyricIndex }"
                >
                  {{ line.text }}
                </p>
              </div>
              <div v-else class="lyrics-mode-empty">
                <i
                  class="pi pi-wave-pulse"
                  style="font-size: 40px; color: rgba(255, 255, 255, 0.15)"
                ></i>
                <p>暂无歌词</p>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.playing-music {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #111;
}

/* 模糊封面背景层 */
.cover-bg-wrapper {
  position: absolute;
  inset: 0;
  overflow: hidden;
  z-index: 0;
}

.cover-bg-img {
  width: 110%;
  height: 110%;
  object-fit: cover;
  filter: blur(100px) brightness(0.5) saturate(2);
  transform: translate(-5%, -5%);
  transition: opacity 0.8s ease;
}

/* 液态玻璃叠加层 */
.glass-overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.15) 0%,
    rgba(0, 0, 0, 0.02) 40%,
    rgba(255, 255, 255, 0.06) 70%,
    rgba(255, 255, 255, 0.12) 100%
  );
  backdrop-filter: blur(8px);
  pointer-events: none;
}

/* ===== 小药丸切换按钮 ===== */
.pill-toggle {
  position: absolute;
  top: 44px;
  right: 24px;
  z-index: 10;
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  padding: 3px;
  cursor: pointer;
  user-select: none;
  transition: background 0.2s;
}

.pill-toggle:hover {
  background: rgba(255, 255, 255, 0.16);
}

.pill-slider {
  position: absolute;
  top: 3px;
  left: 3px;
  width: calc(50% - 3px);
  height: calc(100% - 6px);
  background: rgba(255, 255, 255, 0.2);
  border-radius: 999px;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: none;
}

.pill-slider.pill-right {
  transform: translateX(100%);
}

.pill-label {
  position: relative;
  z-index: 1;
  padding: 4px 16px;
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.45);
  transition: color 0.3s;
  white-space: nowrap;
}

.pill-label.active {
  color: #fff;
}

/* 前景内容层 */
.playing-music-foreground {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  height: 100%;
  padding-top: 32px;
}

.playing-music-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* ===== 模式切换动画 ===== */
.mode-fade-enter-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}
.mode-fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.mode-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.mode-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* ===== 封面模式 ===== */
.cover-mode {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-bottom: 72px;
}

.cover-mode-inner {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 80px;
  padding: 0 120px 0 40px;
  width: 100%;
  max-width: 1080px;
}

/* 左侧封面列 */
.cover-mode-left {
  flex-shrink: 0;
}

.cover-mode-img {
  width: min(40vw, 400px);
  height: min(40vw, 400px);
  border-radius: 20px;
  object-fit: cover;
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.45),
    0 6px 20px rgba(0, 0, 0, 0.25);
}

.cover-mode-placeholder {
  width: min(40vw, 400px);
  height: min(40vw, 400px);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.3);
}

/* 右侧信息列 */
.cover-mode-right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-left: 80px;
}

.cover-mode-title {
  font-size: 42px;
  font-weight: 700;
  color: #fff;
  margin: 0;
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  letter-spacing: -0.2px;
}

.cover-mode-artist {
  font-size: 24px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.75);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cover-mode-album {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.4);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ===== 歌词模式 ===== */
.lyrics-mode {
  flex: 1;
  position: relative;
  overflow: hidden;
}

/* 左上角浮层信息栏 */
.lyrics-left {
  position: absolute;
  top: 28px;
  left: 48px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 320px;
  pointer-events: none;
}

.lyrics-now-playing {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.35);
}

.lyrics-big-title {
  font-size: 38px;
  font-weight: 700;
  color: #fff;
  margin: 4px 0 0 0;
  line-height: 1.1;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  letter-spacing: -0.2px;
}

.lyrics-big-artist {
  font-size: 20px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.75);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lyrics-big-album {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.4);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 歌词全屏容器 */
.lyrics-right {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
}

/* 歌词区域 */
.lyrics-mode-container {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(0, 0, 0, 0.3) 8%,
    rgba(0, 0, 0, 1) 20%,
    rgba(0, 0, 0, 1) 80%,
    rgba(0, 0, 0, 0.3) 92%,
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(0, 0, 0, 0.3) 8%,
    rgba(0, 0, 0, 1) 20%,
    rgba(0, 0, 0, 1) 80%,
    rgba(0, 0, 0, 0.3) 92%,
    transparent 100%
  );
  padding: 100px 60px;
  scroll-behavior: smooth;
}

.lyrics-mode-container::-webkit-scrollbar {
  width: 0;
}

.lyric-line {
  font-size: 18px;
  color: rgba(255, 255, 255, 0.35);
  line-height: 2.6;
  margin: 0;
  text-align: center;
  transition:
    color 0.4s ease,
    font-size 0.4s ease,
    transform 0.4s ease;
  transform: scale(1);
}

.lyric-line.active {
  color: #fff;
  font-size: 22px;
  font-weight: 600;
  transform: scale(1.05);
}

/* 无歌词占位 */
.lyrics-mode-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: rgba(255, 255, 255, 0.25);
  font-size: 14px;
}

.lyrics-mode-empty p {
  margin: 0;
}
</style>
