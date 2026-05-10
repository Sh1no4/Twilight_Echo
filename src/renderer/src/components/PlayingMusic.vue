<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import { usePlayerStore } from '../stores/usePlayerStore'

const { currentTrack, currentTime } = usePlayerStore()

defineEmits<{
  back: []
}>()

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

    <!-- 前景内容 -->
    <div class="playing-music-foreground">
      <div v-if="currentTrack" class="playing-music-content">
        <!-- 左侧：封面 -->
        <div class="cover-display">
          <img v-if="currentTrack.cover" :src="currentTrack.cover" class="main-cover" alt="cover" />
          <div v-else class="main-cover-placeholder">
            <i class="pi pi-wave-pulse" style="font-size: 80px; color: #ccc"></i>
          </div>
        </div>

        <!-- 右侧：歌曲信息 + 歌词 -->
        <div class="info-panel" :class="{ 'has-lyrics': lyricLines.length > 0 }">
          <div class="track-info">
            <h1 class="track-title">{{ currentTrack.title }}</h1>
            <p class="track-artist">{{ currentTrack.artist }}</p>
            <p class="track-album">{{ currentTrack.album }}</p>
          </div>

          <div v-if="lyricLines.length > 0" ref="lyricsEl" class="lyrics-container">
            <p
              v-for="(line, i) in lyricLines"
              :key="i"
              class="lyric-line"
              :class="{ active: i === activeLyricIndex }"
            >
              {{ line.text }}
            </p>
          </div>
        </div>
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
  align-items: center;
  padding: 0 80px 110px 120px;
  gap: 100px;
}

/* 左侧封面 */
.cover-display {
  flex-shrink: 0;
  margin-left: 40px;
  margin-top: 20px;
}

.main-cover {
  width: min(34vw, 300px);
  height: min(34vw, 300px);
  border-radius: 12px;
  object-fit: cover;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.25);
}

.main-cover-placeholder {
  width: min(28vw, 220px);
  height: min(28vw, 220px);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.1);
}

/* 右侧信息面板 */
.info-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 24px;
  max-height: calc(100vh - 142px);
  padding-left: 150px;
  padding-top: 60px;
}

.info-panel.has-lyrics {
  justify-content: flex-start;
}

.track-info {
  flex-shrink: 0;
}

.track-title {
  font-size: 28px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 8px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.track-artist {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.8);
  margin: 0 0 4px 0;
}

.track-album {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.55);
  margin: 0;
}

/* 歌词区域 */
.lyrics-container {
  flex: 1;
  overflow-y: auto;
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(0, 0, 0, 0.3) 10%,
    rgba(0, 0, 0, 1) 25%,
    rgba(0, 0, 0, 1) 75%,
    rgba(0, 0, 0, 0.3) 90%,
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(0, 0, 0, 0.3) 10%,
    rgba(0, 0, 0, 1) 25%,
    rgba(0, 0, 0, 1) 75%,
    rgba(0, 0, 0, 0.3) 90%,
    transparent 100%
  );
  padding: 120px 0;
  scroll-behavior: smooth;
}

.lyrics-container::-webkit-scrollbar {
  width: 0;
}

.lyric-line {
  font-size: 15px;
  color: rgba(255, 255, 255, 0.45);
  line-height: 2.4;
  margin: 0;
  transition:
    color 0.3s,
    font-size 0.3s;
}

.lyric-line.active {
  color: #fff;
  font-size: 17px;
  font-weight: 600;
}
</style>
