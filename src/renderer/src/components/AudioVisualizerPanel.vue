<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { usePlayerStore } from '../stores/usePlayerStore'
import { useCover } from '../utils/coverLoader'

const props = defineProps<{ active: boolean }>()

const { currentTrack, isPlaying, currentTime, duration, formatTime, togglePlay, next, prev, seek } =
  usePlayerStore()
const resolvedCover = useCover(computed(() => currentTrack.value?.cover ?? null))

const iframeRef = ref<HTMLIFrameElement | null>(null)
const iframeReady = ref(false)
const visualizerSrc = `./audio-visualizer/index.html?v=${Date.now()}`
const visualizationOptions = {
  spectrumPoints: 4096,
  waveformPoints: 96,
  spectrogramFrames: 48,
  oscilloscopePoints: 1024
} as const
const VISUALIZER_POLL_INTERVAL_MS = 100
let visualizationTimer: number | null = null
let visualizationRequestInFlight = false

function post(msg: unknown): void {
  const targetWindow = iframeRef.value?.contentWindow
  if (!targetWindow) return
  try {
    targetWindow.postMessage(
      msg,
      window.location.protocol === 'file:' ? '*' : window.location.origin
    )
  } catch {
    targetWindow.postMessage(msg, '*')
  }
}

async function pollVisualizationFrame(): Promise<void> {
  if (!props.active || !iframeReady.value || visualizationRequestInFlight) return
  visualizationRequestInFlight = true
  try {
    const v = await window.api.audioEngine.getVisualizationData(visualizationOptions)
    post({
      kind: 'spectrum',
      data: v.spectrum,
      waveform: v.waveform,
      sampleRate: v.sampleRate,
      active: v.active
    })
  } catch {
    // The playback controls remain usable if visualization sampling is unavailable.
  } finally {
    visualizationRequestInFlight = false
  }
}

function startVisualizationPolling(): void {
  if (visualizationTimer !== null) return
  void pollVisualizationFrame()
  visualizationTimer = window.setInterval(
    () => void pollVisualizationFrame(),
    VISUALIZER_POLL_INTERVAL_MS
  )
}

function stopVisualizationPolling(): void {
  if (visualizationTimer === null) return
  window.clearInterval(visualizationTimer)
  visualizationTimer = null
}

// Buffer the latest track/cover/playback payloads so they can be re-sent once
// the iframe signals readiness — otherwise early messages would be dropped.
let pendingTrack: { track: Record<string, unknown> } | null = null
let pendingCover: { url: string | null } | null = null
let pendingPlayback: {
  isPlaying: boolean
  position: number
  duration: number
} | null = null

function flushPending(): void {
  if (pendingTrack) {
    post(pendingTrack)
    pendingTrack = null
  }
  if (pendingCover) {
    post(pendingCover)
    pendingCover = null
  }
  if (pendingPlayback) {
    post(pendingPlayback)
    pendingPlayback = null
  }
}

function onMessage(event: MessageEvent): void {
  if (event.source !== iframeRef.value?.contentWindow) return
  if (event.data?.kind === 'ready') {
    iframeReady.value = true
    flushPending()
    startVisualizationPolling()
    return
  }

  if (event.data?.kind !== 'control') return
  switch (event.data.action) {
    case 'togglePlay':
      void togglePlay()
      break
    case 'previous':
      prev()
      break
    case 'next':
      next()
      break
    case 'seek': {
      const position = event.data.position
      if (typeof position === 'number' && Number.isFinite(position)) {
        seek(position)
      }
      break
    }
  }
}

window.addEventListener('message', onMessage)
onBeforeUnmount(() => {
  stopVisualizationPolling()
  window.removeEventListener('message', onMessage)
})

watch(
  () => props.active,
  (active) => {
    if (active && iframeReady.value) {
      startVisualizationPolling()
      return
    }
    stopVisualizationPolling()
  },
  { immediate: true }
)

// Post track metadata when the current track changes.
watch(
  currentTrack,
  (track) => {
    if (!track) return
    const trackPayload = {
      kind: 'track',
      track: {
        title: track.title,
        artist: track.artist,
        album: track.album,
        quality: buildQualityString(track),
        bpm: '',
        genre: '',
        duration: formatTime(track.duration),
        durationSeconds: track.duration,
        dynamicRange: '',
        loudness: '',
        samplerate: track.sampleRate ? `${(track.sampleRate / 1000).toFixed(1)} kHz` : '',
        bitdepth: track.bitDepth ? `${track.bitDepth}-bit` : '',
        channels: '',
        bitrate: track.bitrate ? `${track.bitrate} kbps` : '',
        filesize: track.size ? `${(track.size / (1024 * 1024)).toFixed(1)} MB` : '',
        format: track.format || ''
      }
    }
    if (iframeReady.value) post(trackPayload)
    else pendingTrack = trackPayload
  },
  { immediate: true }
)

// Post cover URL when resolved.
watch(
  resolvedCover,
  (url) => {
    const coverPayload = { kind: 'cover', url: url ?? null }
    if (iframeReady.value) post(coverPayload)
    else pendingCover = coverPayload
  },
  { immediate: true }
)

// Post playback state.
watch(
  [isPlaying, currentTime, duration],
  ([playing, position, dur]) => {
    const playbackPayload = {
      kind: 'playback',
      isPlaying: playing,
      position,
      duration: dur
    }
    if (iframeReady.value) post(playbackPayload)
    else pendingPlayback = playbackPayload
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  post({ kind: 'playback', isPlaying: false, position: 0, duration: 0 })
})

function buildQualityString(track: {
  format?: string
  sampleRate?: number
  bitrate?: number
  bitDepth?: number
}): string {
  const parts: string[] = []
  if (track.format) parts.push(track.format.toUpperCase())
  if (track.bitDepth) parts.push(`${track.bitDepth}-bit`)
  if (track.sampleRate) parts.push(`${(track.sampleRate / 1000).toFixed(1)}kHz`)
  if (track.bitrate) parts.push(`${track.bitrate}kbps`)
  return parts.join(' / ')
}
</script>

<template>
  <div class="visualizer-panel">
    <iframe
      ref="iframeRef"
      :src="visualizerSrc"
      class="visualizer-iframe"
      frameborder="0"
      allow="autoplay; fullscreen; encrypted-media"
    />
  </div>
</template>

<style scoped>
.visualizer-panel {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: 18px;
  background: #e4e6eb;
  /* Force the iframe into its own compositor layer so it doesn't interact
     with the backdrop's blur filter (which can stall the GPU process). */
  contain: strict;
  transform: translateZ(0);
  will-change: transform;
}

.visualizer-iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
  background: #e4e6eb;
}
</style>
