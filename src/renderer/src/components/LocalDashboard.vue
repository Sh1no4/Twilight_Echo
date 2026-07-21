<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useMusicStore } from '../stores/useMusicStore'
import {
  getMostListenedTracks,
  getRecentTracks,
  useListeningStatsStore
} from '../stores/useListeningStatsStore'
import { useAudioOutputDspStore } from '../stores/useAudioOutputDspStore'
import { usePlaybackQueueStore } from '../stores/usePlaybackQueueStore'
import {
  DEFAULT_DSP_OUTPUT_STAGE,
  type DspGraphNode,
  type DspGraphNodeStatus,
  type DspGraphStatus,
  type DspNodeType,
  type DspSceneState
} from '../../../shared/dspGraph.ts'
import type { Track } from '../types/music'
import { createUnifiedRecentTrackResolver } from '../utils/unifiedRecentTracks'
import CoverImg from './CoverImg.vue'

const emit = defineEmits<{
  (event: 'select-view', category: string, filter: string | null): void
}>()

const DEFAULT_COVER = '/icon.png'
const DASHBOARD_QUEUE_WINDOW = 200
const SHELF_SIZE = 6
const TOP_TRACK_COUNT = 6
const ALBUM_SHELF_SIZE = 5

const { tracks, albums, artists } = useMusicStore()
const { listeningStats } = useListeningStatsStore()
const playbackStore = usePlaybackQueueStore()
const audioOutputDspStore = useAudioOutputDspStore()
const { currentTrack, isPlaying, currentTime, duration, progress } = storeToRefs(playbackStore)
const { audioProcessing, playbackInfo, outputInfo } = storeToRefs(audioOutputDspStore)
const { playTrack, togglePlay, next, prev, seek, formatTime, setPlayMode } = playbackStore

const now = ref(new Date())
const homeScrollRef = ref<HTMLElement | null>(null)
const homeScrollbarActive = ref(false)
const homeScrollbarNear = ref(false)
const HOME_SCROLLBAR_PROXIMITY_PX = 28
let homeScrollbarHideTimer: ReturnType<typeof setTimeout> | null = null

function clearHomeScrollbarHideTimer(): void {
  if (homeScrollbarHideTimer == null) return
  clearTimeout(homeScrollbarHideTimer)
  homeScrollbarHideTimer = null
}

function revealHomeScrollbar(): void {
  homeScrollbarActive.value = true
  clearHomeScrollbarHideTimer()
  homeScrollbarHideTimer = setTimeout(() => {
    homeScrollbarActive.value = false
    homeScrollbarHideTimer = null
  }, 900)
}

function onHomeScroll(): void {
  revealHomeScrollbar()
}

function onHomePointerMove(event: PointerEvent): void {
  const el = homeScrollRef.value
  if (!el) return
  if (el.scrollHeight <= el.clientHeight + 1) {
    homeScrollbarNear.value = false
    return
  }
  const rect = el.getBoundingClientRect()
  const distFromRight = rect.right - event.clientX
  const withinY = event.clientY >= rect.top && event.clientY <= rect.bottom
  homeScrollbarNear.value =
    withinY && distFromRight >= 0 && distFromRight <= HOME_SCROLLBAR_PROXIMITY_PX
}

function onHomePointerLeave(): void {
  homeScrollbarNear.value = false
}

onMounted(() => {
  const el = homeScrollRef.value
  el?.addEventListener('scroll', onHomeScroll, { passive: true })
  el?.addEventListener('pointermove', onHomePointerMove, { passive: true })
  el?.addEventListener('pointerleave', onHomePointerLeave, { passive: true })
  window.addEventListener('keydown', onDspRouteDialogKeydown)
  void refreshDspRouteState(true)
  dspRoutePoll = window.setInterval(() => {
    if (document.visibilityState === 'hidden') return
    dspRoutePollTick += 1
    void refreshDspGraphStatus()
    if (dspRoutePollTick % 5 === 0) void refreshDspSceneState()
  }, 1000)
})

onBeforeUnmount(() => {
  const el = homeScrollRef.value
  el?.removeEventListener('scroll', onHomeScroll)
  el?.removeEventListener('pointermove', onHomePointerMove)
  el?.removeEventListener('pointerleave', onHomePointerLeave)
  window.removeEventListener('keydown', onDspRouteDialogKeydown)
  if (dspRoutePoll !== null) window.clearInterval(dspRoutePoll)
  dspRoutePoll = null
  clearHomeScrollbarHideTimer()
})

const greeting = computed(() => {
  const hour = now.value.getHours()
  if (hour < 5) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
})

const hasLibrary = computed(() => tracks.value.length > 0)

const totalDurationText = computed(() => {
  const seconds = tracks.value.reduce((sum, track) => sum + Math.max(0, track.duration || 0), 0)
  const hours = seconds / 3600
  if (hours >= 24) return `${(hours / 24).toFixed(1)} 天`
  if (hours >= 1) return `${hours.toFixed(1)} 小时`
  return `${Math.round(seconds / 60)} 分钟`
})

interface RankedStat {
  id: string
  seconds: number
  plays: number
  title: string
  artist: string
  cover: string | null
  coverSource: string | null
  track: Track | null
}

const rankedStats = computed<RankedStat[]>(() => {
  const resolveRecentTrack = createUnifiedRecentTrackResolver(tracks.value)
  return getMostListenedTracks(TOP_TRACK_COUNT).map((stat) => {
    const track = resolveRecentTrack(stat) ?? stat.track ?? null
    return {
      id: stat.id,
      seconds: stat.seconds,
      plays: stat.plays,
      title: stat.title,
      artist: stat.artist,
      cover: track?.cover ?? stat.cover ?? null,
      coverSource: track?.coverSource ?? stat.coverSource ?? null,
      track
    }
  })
})

const lastPlayedTrack = computed<Track | null>(() => {
  const latestStat = getRecentTracks(1)[0]
  if (!latestStat) return null

  const resolveRecentTrack = createUnifiedRecentTrackResolver(tracks.value)
  return resolveRecentTrack(latestStat) ?? latestStat.track ?? null
})

const heroTrack = computed<Track | null>(() => {
  if (currentTrack.value) return currentTrack.value
  if (lastPlayedTrack.value) return lastPlayedTrack.value
  const ranked = rankedStats.value[0]
  if (ranked?.track) return ranked.track
  return tracks.value[0] ?? null
})

const heroIsCurrent = computed(
  () => !!currentTrack.value && heroTrack.value?.id === currentTrack.value.id
)

const heroCoverKey = computed(
  () =>
    `hero:${heroTrack.value?.id ?? 'none'}:${heroTrack.value?.cover ?? ''}:${heroTrack.value?.coverSource ?? ''}`
)
const nowPlayingTitle = computed(() => currentTrack.value?.title || heroTrack.value?.title)
const progressWidth = computed(() => `${Math.min(100, Math.max(0, progress.value))}%`)

const heroLabel = computed(() => {
  if (!heroTrack.value) return ''
  return heroIsCurrent.value && isPlaying.value ? '正在播放' : '上次播放'
})

const heroMeta = computed(() => {
  const track = heroTrack.value
  if (!track) return ''
  const parts: string[] = []
  if (track.album) parts.push(track.album)
  if (track.format) parts.push(track.format.toUpperCase())
  if (track.sampleRate) parts.push(`${Math.round(track.sampleRate / 1000)}kHz`)
  return parts.join(' · ')
})

const recentlyAdded = computed(() => tracks.value.slice(-SHELF_SIZE).reverse())

const topTracks = computed<RankedStat[]>(() => {
  if (rankedStats.value.length > 0) return rankedStats.value
  return tracks.value.slice(0, TOP_TRACK_COUNT).map((track) => ({
    id: track.id,
    seconds: 0,
    plays: 0,
    title: track.title,
    artist: track.artist,
    cover: track.cover,
    coverSource: track.coverSource ?? null,
    track
  }))
})

const topMaxSeconds = computed(() =>
  topTracks.value.reduce((max, stat) => Math.max(max, stat.seconds), 0)
)

const albumShelf = computed(() =>
  [...albums.value].sort((a, b) => b.trackCount - a.trackCount).slice(0, ALBUM_SHELF_SIZE)
)

function playDashboardTrack(track: Track | null | undefined): void {
  if (!track) return
  const sourceIndex = tracks.value.findIndex((item) => item.id === track.id)
  if (sourceIndex < 0) {
    playTrack(track, [track])
    return
  }
  const halfWindow = Math.floor(DASHBOARD_QUEUE_WINDOW / 2)
  const start = Math.max(0, sourceIndex - halfWindow)
  const end = Math.min(tracks.value.length, start + DASHBOARD_QUEUE_WINDOW)
  const queueStart = Math.max(0, end - DASHBOARD_QUEUE_WINDOW)
  playTrack(track, tracks.value.slice(queueStart, end))
}

function handleHeroPlay(): void {
  if (heroIsCurrent.value) {
    togglePlay()
    return
  }
  playDashboardTrack(heroTrack.value)
}

function shuffleAll(): void {
  if (tracks.value.length === 0) return
  const index = Math.floor(Math.random() * tracks.value.length)
  setPlayMode('shuffle')
  playDashboardTrack(tracks.value[index])
}

function handleHeroSeek(event: MouseEvent): void {
  if (!heroIsCurrent.value || duration.value <= 0) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  seek(duration.value * ratio)
}

function playAlbum(album: { tracks: Track[] }): void {
  const albumTracks = album.tracks
  if (albumTracks.length === 0) return
  playTrack(albumTracks[0], albumTracks)
}

function formatPlays(stat: RankedStat): string {
  if (stat.plays <= 0) return '还未播放'
  const hours = stat.seconds / 3600
  const time =
    hours >= 1 ? `${hours.toFixed(1)} 小时` : `${Math.max(1, Math.round(stat.seconds / 60))} 分钟`
  return `${stat.plays} 次 · ${time}`
}

function statPercent(stat: RankedStat): number {
  if (topMaxSeconds.value <= 0) return 0
  return Math.max(6, Math.round((stat.seconds / topMaxSeconds.value) * 100))
}

// ---------- Listening calendar ----------
const CAL_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

interface CalendarCell {
  key: string
  day: number
  seconds: number
  level: number
  isToday: boolean
  isFuture: boolean
}

const calCursor = ref(new Date(now.value.getFullYear(), now.value.getMonth(), 1))

const calMonthLabel = computed(() =>
  calCursor.value.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })
)

const calAtCurrentMonth = computed(
  () =>
    calCursor.value.getFullYear() === now.value.getFullYear() &&
    calCursor.value.getMonth() === now.value.getMonth()
)

function shiftCalMonth(delta: number): void {
  const next = new Date(calCursor.value.getFullYear(), calCursor.value.getMonth() + delta, 1)
  if (next > now.value) return
  calCursor.value = next
}

function calDayKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const calendarCells = computed<(CalendarCell | null)[]>(() => {
  const year = calCursor.value.getFullYear()
  const month = calCursor.value.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const leadingBlanks = (new Date(year, month, 1).getDay() + 6) % 7
  const days = listeningStats.value.days
  let monthMax = 0
  for (let day = 1; day <= daysInMonth; day += 1) {
    monthMax = Math.max(monthMax, days[calDayKey(year, month, day)] ?? 0)
  }
  const today = now.value
  const cells: (CalendarCell | null)[] = Array.from({ length: leadingBlanks }, () => null)
  for (let day = 1; day <= daysInMonth; day += 1) {
    const seconds = days[calDayKey(year, month, day)] ?? 0
    const cellDate = new Date(year, month, day)
    cells.push({
      key: calDayKey(year, month, day),
      day,
      seconds,
      level: seconds <= 0 || monthMax <= 0 ? 0 : Math.max(1, Math.ceil((seconds / monthMax) * 4)),
      isToday:
        year === today.getFullYear() && month === today.getMonth() && day === today.getDate(),
      isFuture: cellDate > new Date(today.getFullYear(), today.getMonth(), today.getDate())
    })
  }
  return cells
})

const calSummary = computed(() => {
  const active = calendarCells.value.filter((cell) => cell && cell.seconds > 0)
  if (active.length === 0) return '本月还没有听歌记录'
  const totalSeconds = active.reduce((sum, cell) => sum + (cell?.seconds ?? 0), 0)
  return `${active.length} 天在听 · 共 ${formatListenDuration(totalSeconds)}`
})

function formatListenDuration(seconds: number): string {
  const hours = seconds / 3600
  if (hours >= 1) return `${hours.toFixed(1)} 小时`
  return `${Math.max(1, Math.round(seconds / 60))} 分钟`
}

function calCellTitle(cell: CalendarCell): string {
  if (cell.seconds <= 0) return `${cell.key} · 无记录`
  return `${cell.key} · ${formatListenDuration(cell.seconds)}`
}

// ---------- DSP chain ----------
type DspRouteStageState = 'active' | 'ready' | 'bypassed' | 'disabled' | 'error'
type DspRouteStageType = DspNodeType | 'resampler' | 'dither' | 'safetyClamp'

interface DspRouteStage {
  id: string
  type: DspRouteStageType
  label: string
  shortLabel: string
  icon: string
  enabled: boolean
  active: boolean
  state: DspRouteStageState
  stateLabel: string
  detail: string
  status?: DspGraphNodeStatus
}

const DSP_NODE_PRESENTATION: Record<
  DspNodeType,
  { label: string; shortLabel: string; icon: string }
> = {
  replayGain: { label: 'ReplayGain', shortLabel: '增益', icon: 'ph ph-speaker-high' },
  equalizer: { label: '参数均衡器', shortLabel: 'EQ', icon: 'ph ph-faders' },
  dynamicEqualizer: { label: '动态均衡器', shortLabel: 'Dyn EQ', icon: 'ph ph-wave-sine' },
  convolver: { label: '卷积校正', shortLabel: '卷积', icon: 'ph ph-waveform' },
  crossfeed: { label: '交叉馈送', shortLabel: 'Crossfeed', icon: 'ph ph-headphones' },
  channelMatrix: { label: '声道矩阵', shortLabel: '矩阵', icon: 'ph ph-share-network' },
  channelStrip: { label: '声道校准', shortLabel: '声道', icon: 'ph ph-sliders-horizontal' },
  bassManagement: { label: '低频管理', shortLabel: '分频', icon: 'ph ph-speaker-low' },
  gate: { label: '噪声门', shortLabel: 'Gate', icon: 'ph ph-git-branch' },
  compressor: { label: '压缩器', shortLabel: 'Comp', icon: 'ph ph-chart-line' },
  multibandCompressor: { label: '多段压缩', shortLabel: 'Multi', icon: 'ph ph-stack' },
  stereoField: {
    label: '立体声场',
    shortLabel: 'Stereo',
    icon: 'ph ph-arrows-out-line-horizontal'
  },
  loudnessContour: { label: '响度轮廓', shortLabel: 'Loudness', icon: 'ph ph-speaker-simple-high' },
  truePeakLimiter: { label: '真峰值限幅', shortLabel: 'Limiter', icon: 'ph ph-shield-check' },
  nativePlugin: { label: '原生 DSP 插件', shortLabel: 'Native', icon: 'ph ph-plugs-connected' },
  vst3Plugin: { label: 'VST3 效果器', shortLabel: 'VST3', icon: 'ph ph-puzzle-piece' },
  meter: { label: 'R128 计量', shortLabel: 'Meter', icon: 'ph ph-activity' }
}

const DITHER_LABELS: Record<string, string> = {
  off: '关闭',
  tpdf: 'TPDF',
  highpassTpdf: '高通 TPDF',
  noiseShaped: '二阶噪声整形'
}

const RESAMPLER_LABELS: Record<string, string> = {
  native: 'Native',
  high: 'High',
  ultra: 'Ultra'
}

const dspSceneState = ref<DspSceneState | null>(null)
const polledDspGraphStatus = ref<DspGraphStatus | null>(null)
const dspRouteDialogOpen = ref(false)
const dspRouteLoading = ref(false)
const dspRouteError = ref('')
let dspRoutePoll: number | null = null
let dspRoutePollTick = 0
let dspRouteRefreshInFlight = false

const embeddedDspGraphStatus = computed(
  () =>
    outputInfo.value?.nativeDsp?.graph ?? playbackInfo.value?.outputInfo?.nativeDsp?.graph ?? null
)
const dspGraphStatus = computed<DspGraphStatus | null>(() => {
  const embedded = embeddedDspGraphStatus.value
  const polled = polledDspGraphStatus.value
  if (!embedded) return polled
  if (!polled) return embedded
  const runtimeStatus = polled.revision >= embedded.revision ? polled : embedded
  return {
    ...runtimeStatus,
    requestedRevision: polled.requestedRevision,
    appliedRevision: polled.appliedRevision,
    applyState: polled.applyState,
    applyError: polled.applyError
  }
})
const activeDspScene = computed(() => {
  const state = dspSceneState.value
  if (!state) return null
  return state.scenes.find((scene) => scene.id === state.activeSceneId) ?? null
})
const activeDspSceneName = computed(() => activeDspScene.value?.name ?? '默认 DSP 场景')

const legacyDspGraphNodes = computed<DspGraphNode[]>(() => {
  const ap = audioProcessing.value
  const on = ap.dspEnabled
  return [
    {
      id: 'legacy-replay-gain',
      type: 'replayGain',
      enabled: on && ap.volumeNormalization !== 'off',
      params: { mode: ap.volumeNormalization, preampDb: ap.replayGainPreamp }
    },
    {
      id: 'legacy-equalizer',
      type: 'equalizer',
      enabled: on && ap.eqEnabled,
      params: { mode: ap.eqMode, preampDb: ap.eqPreamp, bands: ap.eqBands }
    },
    {
      id: 'legacy-crossfeed',
      type: 'crossfeed',
      enabled: on && ap.crossfeedEnabled,
      params: { algorithm: 'custom', strength: ap.crossfeedStrength }
    },
    {
      id: 'legacy-convolver',
      type: 'convolver',
      enabled: on && ap.convolverEnabled,
      params: { impulseResponsePath: ap.convolverIrPath }
    }
  ]
})

const configuredDspNodes = computed(() =>
  dspSceneState.value ? dspSceneState.value.graph.nodes : legacyDspGraphNodes.value
)
const configuredOutputStage = computed(
  () => dspSceneState.value?.graph.outputStage ?? DEFAULT_DSP_OUTPUT_STAGE
)

function stringParam(node: DspGraphNode, key: string, fallback = ''): string {
  const value = node.params[key]
  return typeof value === 'string' ? value : fallback
}

function numberParam(node: DspGraphNode, key: string, fallback = 0): number {
  const value = node.params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function arrayLengthParam(node: DspGraphNode, key: string): number {
  return Array.isArray(node.params[key]) ? node.params[key].length : 0
}

function formatSampleRate(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '-'
  const khz = value / 1000
  return `${Number.isInteger(khz) ? khz.toFixed(0) : khz.toFixed(1)} kHz`
}

function formatChannels(value: number | null | undefined): string {
  if (!value || value < 1) return '-'
  if (value === 1) return 'Mono'
  if (value === 2) return 'Stereo'
  if (value === 6) return '5.1'
  if (value === 8) return '7.1'
  return `${value} ch`
}

function formatMetric(value: number | null | undefined, digits = 1, unit = ''): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(digits)}${unit}`
    : '-'
}

function dspNodeDetail(node: DspGraphNode): string {
  switch (node.type) {
    case 'replayGain':
      return `${stringParam(node, 'mode', 'track')} · ${numberParam(node, 'preampDb').toFixed(1)} dB`
    case 'equalizer':
      return `${arrayLengthParam(node, 'bands')} 段 · ${stringParam(node, 'mode', 'parametric')}`
    case 'dynamicEqualizer':
      return `${arrayLengthParam(node, 'bands')} 个动态频段`
    case 'convolver':
      return node.params.impulseResponseAssetId || stringParam(node, 'impulseResponsePath')
        ? `IR · Wet ${Math.round(numberParam(node, 'wet', 1) * 100)}%`
        : '未选择 IR'
    case 'crossfeed':
      return `${stringParam(node, 'algorithm', 'custom')} · ${Math.round(numberParam(node, 'strength', 0.35) * 100)}%`
    case 'channelMatrix':
    case 'channelStrip':
      return stringParam(node, 'layout', 'stereo').toUpperCase()
    case 'bassManagement':
      return `${numberParam(node, 'crossoverHz', 80).toFixed(0)} Hz · LR4`
    case 'gate':
      return `${numberParam(node, 'thresholdDb', -60).toFixed(1)} dB`
    case 'compressor':
      return `${numberParam(node, 'thresholdDb', -18).toFixed(1)} dB · ${numberParam(node, 'ratio', 2).toFixed(1)}:1`
    case 'multibandCompressor':
      return `${Math.max(2, arrayLengthParam(node, 'bands'))} 段`
    case 'stereoField':
      return `Width ${numberParam(node, 'width', 1).toFixed(2)}`
    case 'loudnessContour':
      return `Amount ${numberParam(node, 'amount').toFixed(1)}`
    case 'truePeakLimiter':
      return `${numberParam(node, 'ceilingDb', -0.1).toFixed(1)} dBTP`
    case 'nativePlugin':
      return node.pluginId || 'ABI v2'
    case 'vst3Plugin':
      return node.vst3?.catalogId || '未选择插件'
    case 'meter':
      return 'EBU R128 · True Peak'
  }
}

function routeStageState(
  node: DspGraphNode,
  status: DspGraphNodeStatus | undefined
): Pick<DspRouteStage, 'active' | 'state' | 'stateLabel'> {
  if (!node.enabled) return { active: false, state: 'disabled', stateLabel: '已关闭' }
  if (
    dspGraphStatus.value?.compileState === 'failed' ||
    dspGraphStatus.value?.applyState === 'failed'
  ) {
    return { active: false, state: 'error', stateLabel: '图编译失败' }
  }
  if (dspGraphStatus.value?.applyState === 'pending') {
    return { active: false, state: 'ready', stateLabel: '等待应用' }
  }
  if (status?.bypassed) {
    return { active: false, state: 'bypassed', stateLabel: status.bypassReason || '旁路' }
  }
  if (status?.active) return { active: true, state: 'active', stateLabel: '实时运行' }
  return { active: false, state: 'ready', stateLabel: '已就绪' }
}

const dspNodeStages = computed<DspRouteStage[]>(() => {
  const statuses = dspGraphStatus.value?.nodes ?? []
  return configuredDspNodes.value.map((node) => {
    const status =
      statuses.find((candidate) => candidate.id === node.id) ??
      statuses.find((candidate) => candidate.type === node.type)
    const presentation = DSP_NODE_PRESENTATION[node.type]
    return {
      id: node.id,
      type: node.type,
      label: presentation.label,
      shortLabel: presentation.shortLabel,
      icon: presentation.icon,
      enabled: node.enabled,
      detail: status?.format || dspNodeDetail(node),
      status,
      ...routeStageState(node, status)
    }
  })
})

const sourceSampleRate = computed(
  () => playbackInfo.value?.decodedSampleRate || playbackInfo.value?.sourceSampleRate || 0
)
const actualOutputSampleRate = computed(
  () => outputInfo.value?.actualSampleRate || playbackInfo.value?.actualSampleRate || 0
)
const outputStageStatus = computed(() => dspGraphStatus.value?.outputStage)

const dspOutputStages = computed<DspRouteStage[]>(() => {
  const config = configuredOutputStage.value
  const status = outputStageStatus.value
  const sourceRate = sourceSampleRate.value
  const actualRate = status?.actualSampleRate || actualOutputSampleRate.value
  const srcActive =
    status?.active === true ||
    outputInfo.value?.resampled === true ||
    (sourceRate > 0 && actualRate > 0 && sourceRate !== actualRate)
  const targetLabel =
    config.targetSampleRate === 'device'
      ? actualRate > 0
        ? formatSampleRate(actualRate)
        : '跟随设备'
      : formatSampleRate(config.targetSampleRate)
  const srcDetail =
    sourceRate > 0 && actualRate > 0
      ? `${formatSampleRate(sourceRate)} → ${formatSampleRate(actualRate)}`
      : targetLabel
  const ditherEnabled = config.dither !== 'off'
  const playbackLive = playbackInfo.value?.state === 'playing'

  return [
    {
      id: 'output-resampler',
      type: 'resampler',
      label: '采样率转换',
      shortLabel: 'SRC',
      icon: 'ph ph-arrows-left-right',
      enabled: true,
      active: srcActive,
      state: srcActive ? 'active' : 'bypassed',
      stateLabel: srcActive ? '实时转换' : 'Native 直通',
      detail: `${RESAMPLER_LABELS[config.resamplerQuality]} · ${srcDetail}`
    },
    {
      id: 'output-dither',
      type: 'dither',
      label: '整数输出抖动',
      shortLabel: 'Dither',
      icon: 'ph ph-dots-nine',
      enabled: ditherEnabled,
      active: ditherEnabled && playbackLive,
      state: ditherEnabled ? (playbackLive ? 'active' : 'ready') : 'disabled',
      stateLabel: ditherEnabled ? (playbackLive ? '实时运行' : '已就绪') : '已关闭',
      detail: DITHER_LABELS[config.dither] ?? config.dither
    },
    {
      id: 'output-safety-clamp',
      type: 'safetyClamp',
      label: '终端输出保护',
      shortLabel: '保护',
      icon: 'ph ph-shield-check',
      enabled: config.safetyClamp,
      active: config.safetyClamp && playbackLive,
      state: config.safetyClamp ? (playbackLive ? 'active' : 'ready') : 'disabled',
      stateLabel: config.safetyClamp ? (playbackLive ? '实时运行' : '已就绪') : '已关闭',
      detail: config.safetyClamp ? '数值安全钳制' : '关闭'
    }
  ]
})

const dspRouteStages = computed(() => [...dspNodeStages.value, ...dspOutputStages.value])
const dspProcessingActive = computed(
  () =>
    playbackInfo.value?.dspActive === true ||
    dspRouteStages.value.some((stage) => stage.active) ||
    outputStageStatus.value?.active === true
)
const dspEngineOn = computed(
  () =>
    audioProcessing.value.dspEnabled ||
    configuredDspNodes.value.some((node) => node.enabled) ||
    configuredOutputStage.value.resamplerQuality !== 'native' ||
    configuredOutputStage.value.targetSampleRate !== 'device' ||
    configuredOutputStage.value.dither !== 'off'
)

const dspStatusText = computed(() => {
  if (dspGraphStatus.value?.applyState === 'failed') return 'DSP 图应用失败'
  if (dspGraphStatus.value?.applyState === 'pending') return 'DSP 图等待应用'
  if (dspGraphStatus.value?.compileState === 'failed') return 'DSP 图编译失败'
  if (!currentTrack.value) return '等待播放源'
  if (dspProcessingActive.value) return '实时线路运行中'
  if (!dspEngineOn.value) return '透明直通'
  return 'DSP 线路已就绪'
})

const dspSourceDetail = computed(() => {
  const info = playbackInfo.value
  if (info && info.sourceSampleRate > 0) {
    const codec = info.codec ? info.codec.toUpperCase() : ''
    return `${codec} ${formatSampleRate(info.sourceSampleRate)}`.trim()
  }
  const track = currentTrack.value
  if (track?.format) return track.format.toUpperCase()
  return '未在播放'
})

const dspOutputDetail = computed(() => {
  const info = outputInfo.value
  if (info && info.actualSampleRate > 0) {
    const depth = info.actualBitDepth > 0 ? `${info.actualBitDepth} bit · ` : ''
    return `${depth}${formatSampleRate(info.actualSampleRate)}`
  }
  return '等待输出'
})

const dspSourceFullDetail = computed(() => {
  const info = playbackInfo.value
  if (!info || info.state === 'stopped') return '当前没有活动播放源'
  return [
    info.codec?.toUpperCase(),
    formatSampleRate(info.sourceSampleRate),
    info.sourceBitDepth > 0 ? `${info.sourceBitDepth} bit` : '',
    formatChannels(info.channelCount || info.decodedChannels)
  ]
    .filter(Boolean)
    .join(' · ')
})

const dspOutputFullDetail = computed(() => {
  const info = outputInfo.value
  if (!info || info.actualSampleRate <= 0) return '等待音频后端建立输出线路'
  return [
    info.actualOutputFormat || 'PCM',
    formatSampleRate(info.actualSampleRate),
    info.actualBitDepth > 0 ? `${info.actualBitDepth} bit` : '',
    formatChannels(info.actualChannels)
  ]
    .filter(Boolean)
    .join(' · ')
})

const dspOutputDeviceDetail = computed(() => {
  const info = outputInfo.value
  if (!info) return '音频后端待命'
  const backend = (info.actualBackend || info.backend || '').toUpperCase()
  const device = info.actualDeviceName || info.deviceName || '默认设备'
  return [backend, info.accessMode, device].filter(Boolean).join(' · ')
})

const activeDspCount = computed(() => dspRouteStages.value.filter((stage) => stage.active).length)
const enabledDspCount = computed(() => dspRouteStages.value.filter((stage) => stage.enabled).length)
const dspGraphLatencyMs = computed(() => {
  const frames = dspGraphStatus.value?.totalLatencyFrames ?? 0
  const rate = actualOutputSampleRate.value || sourceSampleRate.value
  return frames > 0 && rate > 0 ? (frames / rate) * 1000 : 0
})
const dspGraphTailMs = computed(() => {
  const frames = dspGraphStatus.value?.totalTailFrames ?? 0
  const rate = actualOutputSampleRate.value || sourceSampleRate.value
  return frames > 0 && rate > 0 ? (frames / rate) * 1000 : 0
})
const dspAverageCpuMs = computed(() =>
  (dspGraphStatus.value?.nodes ?? []).reduce(
    (total, node) => total + (node.averageProcessMs ?? node.lastProcessMs ?? 0),
    0
  )
)
const dspPeakCpuMs = computed(() =>
  (dspGraphStatus.value?.nodes ?? []).reduce(
    (peak, node) => Math.max(peak, node.maxProcessMs ?? node.lastProcessMs ?? 0),
    0
  )
)
const dspOverrunCount = computed(() =>
  (dspGraphStatus.value?.nodes ?? []).reduce((total, node) => total + (node.overrunCount ?? 0), 0)
)
const dspCompileLabel = computed(() => {
  const state = dspGraphStatus.value?.compileState
  if (state === 'ready') return '已编译'
  if (state === 'compiling') return '编译中'
  if (state === 'failed') return '编译失败'
  if (state === 'bypassed') return '全局旁路'
  return '等待状态'
})

async function refreshDspGraphStatus(): Promise<void> {
  if (dspRouteRefreshInFlight) return
  dspRouteRefreshInFlight = true
  try {
    polledDspGraphStatus.value = await window.api.audioEngine.getDspGraphStatus()
    dspRouteError.value = ''
  } catch (error) {
    if (!polledDspGraphStatus.value && !embeddedDspGraphStatus.value) {
      dspRouteError.value = error instanceof Error ? error.message : '无法读取 DSP 图状态'
    }
  } finally {
    dspRouteRefreshInFlight = false
  }
}

async function refreshDspSceneState(): Promise<void> {
  try {
    dspSceneState.value = await window.api.audioEngine.getDspSceneState()
    dspRouteError.value = ''
  } catch (error) {
    if (!dspSceneState.value) {
      dspRouteError.value = error instanceof Error ? error.message : '无法读取 DSP 场景'
    }
  }
}

async function refreshDspRouteState(includeScene = false): Promise<void> {
  dspRouteLoading.value = true
  try {
    await Promise.all([
      refreshDspGraphStatus(),
      includeScene ? refreshDspSceneState() : Promise.resolve()
    ])
  } finally {
    dspRouteLoading.value = false
  }
}

function openDspRouteDialog(): void {
  dspRouteDialogOpen.value = true
  void refreshDspRouteState(true)
}

function closeDspRouteDialog(): void {
  dspRouteDialogOpen.value = false
}

function onDspRouteDialogKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && dspRouteDialogOpen.value) closeDspRouteDialog()
}
</script>

<template>
  <div
    ref="homeScrollRef"
    class="home dashboard-wrapper te-auto-scrollbar"
    :class="{
      'is-scrollbar-active': homeScrollbarActive,
      'is-scrollbar-near': homeScrollbarNear,
      'has-route-dialog': dspRouteDialogOpen
    }"
  >
    <div class="ambient" aria-hidden="true">
      <span class="blob blob-a"></span>
      <span class="blob blob-b"></span>
      <span class="blob blob-c"></span>
    </div>

    <main class="home-inner">
      <header class="masthead">
        <div class="masthead-copy">
          <h1 class="greeting">{{ greeting }}，<span>让熟悉的旋律陪你一会儿。</span></h1>
        </div>
        <button v-if="hasLibrary" class="shuffle-shortcut" @click="shuffleAll">
          <span class="shuffle-icon"><i class="ph ph-shuffle"></i></span>
          <span>
            <strong>随机漫游</strong>
            <small>从音乐库里随便挑一首</small>
          </span>
          <i class="ph ph-arrow-up-right"></i>
        </button>
      </header>

      <section v-if="!hasLibrary" class="empty-state">
        <div class="empty-visual" aria-hidden="true">
          <span class="empty-record"><i class="ph ph-music-note"></i></span>
          <span class="empty-sleeve"></span>
          <i class="ph ph-sparkle empty-sparkle sparkle-a"></i>
          <i class="ph ph-sparkle empty-sparkle sparkle-b"></i>
        </div>
        <div class="empty-copy">
          <h2>这里还很安静</h2>
          <p>前往「设置 → 音乐库」添加本地文件夹，封面、专辑和听歌足迹都会自动在这里汇聚。</p>
          <div class="empty-features">
            <span><i class="ph ph-folder-simple-plus"></i> 批量扫描</span>
            <span><i class="ph ph-disc"></i> 无损格式</span>
            <span><i class="ph ph-chart-line-up"></i> 聆听统计</span>
          </div>
        </div>
      </section>

      <template v-else>
        <section class="hero-grid" aria-label="音乐库概览">
          <article class="feature-card">
            <div :key="`bg:${heroCoverKey}`" class="feature-backdrop" aria-hidden="true">
              <CoverImg
                v-if="heroTrack?.cover || heroTrack?.coverSource"
                :cover="heroTrack?.cover"
                :cover-source="heroTrack?.coverSource"
                :identity="heroTrack?.id"
                :fallback="DEFAULT_COVER"
                alt=""
              />
              <img v-else :src="DEFAULT_COVER" alt="" />
            </div>
            <div class="feature-glow" aria-hidden="true"></div>

            <div class="feature-layout">
              <div class="feature-copy">
                <span class="hero-eyebrow">
                  <span v-if="heroIsCurrent && isPlaying" class="eq" aria-hidden="true">
                    <i></i><i></i><i></i>
                  </span>
                  <i v-else class="ph ph-clock-counter-clockwise"></i>
                  {{ heroLabel }}
                </span>

                <div class="hero-heading">
                  <h2>{{ nowPlayingTitle }}</h2>
                  <p>{{ heroTrack?.artist || '未知艺术家' }}</p>
                </div>

                <div class="hero-meta-row">
                  <span><i class="ph ph-disc"></i> {{ heroMeta || '本地音乐' }}</span>
                </div>

                <div v-if="heroIsCurrent" class="hero-progress">
                  <button
                    class="hero-progress-track"
                    title="点击跳转播放进度"
                    aria-label="播放进度"
                    @click="handleHeroSeek"
                  >
                    <span :style="{ width: progressWidth }"></span>
                  </button>
                  <div class="hero-time">
                    <span>{{ formatTime(currentTime) }}</span>
                    <span>{{ formatTime(duration) }}</span>
                  </div>
                </div>

                <div v-if="heroIsCurrent" class="transport-controls">
                  <button class="transport-button" title="上一首" aria-label="上一首" @click="prev">
                    <i class="ph ph-skip-back"></i>
                  </button>
                  <button
                    class="transport-button transport-play"
                    :title="isPlaying ? '暂停' : '播放'"
                    :aria-label="isPlaying ? '暂停' : '播放'"
                    @click="togglePlay"
                  >
                    <i :class="isPlaying ? 'ph ph-pause' : 'ph ph-play'"></i>
                  </button>
                  <button class="transport-button" title="下一首" aria-label="下一首" @click="next">
                    <i class="ph ph-skip-forward"></i>
                  </button>
                  <button class="hero-secondary-action" @click="shuffleAll">
                    <i class="ph ph-shuffle"></i>
                    随机畅听
                  </button>
                </div>

                <div v-else class="transport-controls">
                  <button class="hero-primary-action" @click="handleHeroPlay">
                    <i class="ph ph-play"></i>
                    播放这首
                  </button>
                  <button class="hero-secondary-action" @click="shuffleAll">
                    <i class="ph ph-shuffle"></i>
                    随机畅听
                  </button>
                </div>
              </div>

              <div :key="`art:${heroCoverKey}`" class="hero-art" aria-hidden="true">
                <div class="hero-vinyl" :class="{ spinning: heroIsCurrent && isPlaying }">
                  <CoverImg
                    v-if="heroTrack?.cover || heroTrack?.coverSource"
                    :cover="heroTrack?.cover"
                    :cover-source="heroTrack?.coverSource"
                    :identity="heroTrack?.id"
                    :fallback="DEFAULT_COVER"
                    alt=""
                  />
                  <img v-else :src="DEFAULT_COVER" alt="" />
                  <span></span>
                </div>
                <div class="hero-sleeve">
                  <CoverImg
                    v-if="heroTrack?.cover || heroTrack?.coverSource"
                    :cover="heroTrack?.cover"
                    :cover-source="heroTrack?.coverSource"
                    :identity="heroTrack?.id"
                    :fallback="DEFAULT_COVER"
                    alt=""
                  />
                  <img v-else :src="DEFAULT_COVER" alt="" />
                  <span class="sleeve-shine"></span>
                </div>
              </div>
            </div>
          </article>

          <div class="summary-stack">
            <aside class="overview-card surface-card">
              <div class="compact-card-head">
                <div>
                  <h2>收藏概览</h2>
                </div>
                <button
                  class="round-link"
                  title="查看全部歌曲"
                  aria-label="查看全部歌曲"
                  @click="emit('select-view', 'allSongs', null)"
                >
                  <i class="ph ph-arrow-up-right"></i>
                </button>
              </div>

              <div class="overview-grid">
                <button class="overview-stat" @click="emit('select-view', 'allSongs', null)">
                  <span class="stat-icon"><i class="ph ph-music-notes-simple"></i></span>
                  <strong>{{ tracks.length }}</strong>
                  <small>首歌曲</small>
                </button>
                <button class="overview-stat" @click="emit('select-view', 'albums', null)">
                  <span class="stat-icon"><i class="ph ph-disc"></i></span>
                  <strong>{{ albums.length }}</strong>
                  <small>张专辑</small>
                </button>
                <button class="overview-stat" @click="emit('select-view', 'artists', null)">
                  <span class="stat-icon"><i class="ph ph-microphone-stage"></i></span>
                  <strong>{{ artists.length }}</strong>
                  <small>位艺术家</small>
                </button>
                <div class="overview-stat is-static">
                  <span class="stat-icon"><i class="ph ph-clock"></i></span>
                  <strong>{{ totalDurationText }}</strong>
                  <small>收藏时长</small>
                </div>
              </div>
            </aside>

            <aside
              class="signal-card surface-card"
              role="button"
              tabindex="0"
              aria-label="打开实时 DSP 输出线路"
              @click="openDspRouteDialog"
              @keydown.enter.prevent="openDspRouteDialog"
              @keydown.space.prevent="openDspRouteDialog"
            >
              <div class="signal-head">
                <div>
                  <h2>播放链路</h2>
                  <small>{{ activeDspSceneName }}</small>
                </div>
                <div class="signal-head-state">
                  <span class="dsp-state" :class="{ on: dspEngineOn, live: dspProcessingActive }">
                    <span class="dsp-state-dot" aria-hidden="true"></span>
                    {{ dspStatusText }}
                  </span>
                  <i class="ph ph-caret-right" aria-hidden="true"></i>
                </div>
              </div>

              <div class="signal-summary">
                <span><i class="ph ph-stack"></i>{{ enabledDspCount }} 个启用阶段</span>
                <span><i class="ph ph-timer"></i>{{ dspGraphLatencyMs.toFixed(2) }} ms</span>
              </div>

              <div class="dsp-route-strip is-compact">
                <div class="route-stage route-endpoint-stage" title="播放源">
                  <span class="route-stage-icon"><i class="ph ph-music-notes"></i></span>
                  <div class="route-stage-copy">
                    <small>SOURCE</small>
                    <strong>{{ dspSourceDetail }}</strong>
                  </div>
                </div>

                <template v-for="stage in dspRouteStages" :key="stage.id">
                  <span
                    class="route-connector"
                    :class="{ active: stage.active || dspProcessingActive }"
                    aria-hidden="true"
                  ></span>
                  <div
                    class="route-stage"
                    :class="[`is-${stage.state}`, { 'is-active': stage.active }]"
                    :title="`${stage.label} · ${stage.stateLabel} · ${stage.detail}`"
                  >
                    <span class="route-stage-icon"><i :class="stage.icon"></i></span>
                    <div class="route-stage-copy">
                      <small>{{ stage.shortLabel }}</small>
                      <strong>{{ stage.detail }}</strong>
                    </div>
                  </div>
                </template>

                <span
                  class="route-connector"
                  :class="{ active: playbackInfo?.state === 'playing' }"
                  aria-hidden="true"
                ></span>
                <div class="route-stage route-endpoint-stage is-output" title="实际输出">
                  <span class="route-stage-icon"><i class="ph ph-speaker-hifi"></i></span>
                  <div class="route-stage-copy">
                    <small>OUTPUT</small>
                    <strong>{{ dspOutputDetail }}</strong>
                  </div>
                </div>
              </div>

              <div class="signal-foot">
                <span>{{ dspOutputDeviceDetail }}</span>
                <strong>{{ activeDspCount }}/{{ dspRouteStages.length }} LIVE</strong>
              </div>
            </aside>
          </div>
        </section>

        <section class="content-section recent-section">
          <div class="section-head modern-section-head">
            <div class="section-heading-copy">
              <h3>最近添加</h3>
              <p>刚刚加入收藏的声音，值得先听一遍。</p>
            </div>
            <button class="link-all" @click="emit('select-view', 'allSongs', null)">
              全部歌曲 <i class="ph ph-arrow-right"></i>
            </button>
          </div>

          <div class="recent-grid">
            <button
              v-for="track in recentlyAdded"
              :key="track.id"
              class="track-card"
              @click="playDashboardTrack(track)"
            >
              <span class="track-cover">
                <CoverImg
                  :cover="track.cover"
                  :cover-source="track.coverSource"
                  :identity="track.id"
                  :fallback="DEFAULT_COVER"
                  :alt="track.title"
                />
                <span v-if="track.format" class="format-badge">{{
                  track.format.toUpperCase()
                }}</span>
                <span class="track-play"><i class="ph ph-play"></i></span>
              </span>
              <span class="track-card-copy">
                <strong>{{ track.title }}</strong>
                <small>{{ track.artist || '未知艺术家' }}</small>
              </span>
            </button>
          </div>
        </section>

        <section class="content-section footprint-section">
          <div class="section-head modern-section-head">
            <div class="section-heading-copy">
              <h3>聆听足迹</h3>
              <p>每一次重播，都在慢慢画出你的音乐偏好。</p>
            </div>
            <button class="link-all" @click="emit('select-view', 'recent', null)">
              最近播放 <i class="ph ph-arrow-right"></i>
            </button>
          </div>

          <div class="insight-grid">
            <article class="top-panel surface-card">
              <div class="panel-head">
                <div>
                  <i class="ph ph-chart-bar"></i>
                  <span>常听曲目</span>
                </div>
                <small>按累计聆听时长排序</small>
              </div>
              <div class="top-grid">
                <button
                  v-for="(entry, index) in topTracks"
                  :key="entry.id"
                  class="top-row"
                  @click="playDashboardTrack(entry.track)"
                >
                  <span class="top-rank" :class="{ podium: index < 3 }">{{
                    String(index + 1).padStart(2, '0')
                  }}</span>
                  <CoverImg
                    :cover="entry.track?.cover || entry.cover"
                    :cover-source="entry.track?.coverSource || entry.coverSource"
                    :identity="entry.track?.id || entry.id"
                    :fallback="DEFAULT_COVER"
                    :alt="entry.title"
                    class="top-cover"
                  />
                  <span class="top-text">
                    <span class="top-title">{{ entry.track?.title || entry.title }}</span>
                    <span class="top-artist">{{
                      entry.track?.artist || entry.artist || '未知艺术家'
                    }}</span>
                    <span class="top-bar" aria-hidden="true">
                      <span
                        class="top-bar-fill"
                        :style="{ width: statPercent(entry) + '%' }"
                      ></span>
                    </span>
                  </span>
                  <span class="top-plays">{{ formatPlays(entry) }}</span>
                </button>
              </div>
            </article>

            <aside class="cal-card surface-card">
              <div class="cal-head">
                <span class="cal-title">
                  <i class="ph ph-calendar-heart"></i>
                  听歌日历
                </span>
                <div class="cal-nav">
                  <button class="cal-nav-btn" title="上个月" @click="shiftCalMonth(-1)">
                    <i class="ph ph-caret-left"></i>
                  </button>
                  <span class="cal-month">{{ calMonthLabel }}</span>
                  <button
                    class="cal-nav-btn"
                    title="下个月"
                    :disabled="calAtCurrentMonth"
                    @click="shiftCalMonth(1)"
                  >
                    <i class="ph ph-caret-right"></i>
                  </button>
                </div>
              </div>
              <div class="cal-weekdays" aria-hidden="true">
                <span v-for="weekday in CAL_WEEKDAYS" :key="weekday">{{ weekday }}</span>
              </div>
              <div class="cal-grid">
                <span
                  v-for="(cell, index) in calendarCells"
                  :key="cell?.key ?? `blank-${index}`"
                  class="cal-cell"
                  :class="[
                    cell ? `lv-${cell.level}` : 'is-blank',
                    { 'is-today': cell?.isToday, 'is-future': cell?.isFuture }
                  ]"
                  :title="cell ? calCellTitle(cell) : undefined"
                >
                  {{ cell?.day ?? '' }}
                </span>
              </div>
              <div class="cal-foot">
                <span class="cal-summary">{{ calSummary }}</span>
                <span class="cal-legend" aria-hidden="true">
                  少
                  <i v-for="level in 5" :key="level" :class="`lv-${level - 1}`"></i>
                  多
                </span>
              </div>
            </aside>
          </div>
        </section>

        <section v-if="albumShelf.length > 0" class="content-section album-section">
          <div class="section-head modern-section-head">
            <div class="section-heading-copy">
              <h3>专辑精选</h3>
              <p>从头到尾听完一张专辑，是留给音乐最温柔的时间。</p>
            </div>
            <button class="link-all" @click="emit('select-view', 'albums', null)">
              全部专辑 <i class="ph ph-arrow-right"></i>
            </button>
          </div>

          <div class="album-grid">
            <button
              v-for="album in albumShelf"
              :key="album.id"
              class="album-tile"
              @click="playAlbum(album)"
            >
              <CoverImg :cover="album.cover" :fallback="DEFAULT_COVER" :alt="album.name" />
              <span class="album-veil" aria-hidden="true"></span>
              <span class="album-number">{{ String(album.trackCount).padStart(2, '0') }}</span>
              <span class="album-text">
                <span class="album-name">{{ album.name }}</span>
                <span class="album-count"
                  >{{ album.trackCount }} 首 · {{ album.artist || '未知艺术家' }}</span
                >
              </span>
              <span class="album-play"><i class="ph ph-play"></i></span>
            </button>
          </div>
        </section>
      </template>
    </main>

    <Transition name="dsp-route-dialog">
      <div
        v-if="dspRouteDialogOpen"
        class="dsp-route-dialog-backdrop"
        @click.self="closeDspRouteDialog"
      >
        <section
          class="dsp-route-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dsp-route-dialog-title"
        >
          <header class="dsp-route-dialog-head">
            <div>
              <span class="dialog-eyebrow">LIVE SIGNAL PATH</span>
              <h2 id="dsp-route-dialog-title">实时 DSP 输出线路</h2>
              <p>{{ activeDspSceneName }} · {{ dspOutputDeviceDetail }}</p>
            </div>
            <div class="dialog-head-actions">
              <span
                class="dialog-live-state"
                :class="{
                  live: dspProcessingActive,
                  error:
                    dspGraphStatus?.compileState === 'failed' ||
                    dspGraphStatus?.applyState === 'failed'
                }"
              >
                <i></i>{{ dspStatusText }}
              </span>
              <button
                type="button"
                class="dialog-icon-button"
                title="刷新线路"
                aria-label="刷新线路"
                :disabled="dspRouteLoading"
                @click="refreshDspRouteState(true)"
              >
                <i class="ph ph-arrow-clockwise" :class="{ spinning: dspRouteLoading }"></i>
              </button>
              <button
                type="button"
                class="dialog-icon-button"
                title="关闭"
                aria-label="关闭"
                @click="closeDspRouteDialog"
              >
                <i class="ph ph-x"></i>
              </button>
            </div>
          </header>

          <div v-if="dspRouteError" class="dsp-route-error">
            <i class="ph ph-warning-circle"></i>{{ dspRouteError }}
          </div>

          <div class="dialog-format-bar">
            <div>
              <span><i class="ph ph-file-audio"></i>播放源</span>
              <strong>{{ dspSourceFullDetail }}</strong>
            </div>
            <i class="ph ph-arrow-right"></i>
            <div class="is-output">
              <span><i class="ph ph-speaker-hifi"></i>实际输出</span>
              <strong>{{ dspOutputFullDetail }}</strong>
            </div>
          </div>

          <div class="dialog-route-scroll te-auto-scrollbar">
            <div class="dsp-route-strip is-dialog">
              <div class="route-stage route-endpoint-stage">
                <span class="route-stage-icon"><i class="ph ph-music-notes"></i></span>
                <div class="route-stage-copy">
                  <small>SOURCE</small><strong>{{ dspSourceDetail }}</strong>
                </div>
                <em>{{ dspSourceFullDetail }}</em>
              </div>

              <template v-for="stage in dspRouteStages" :key="`dialog-${stage.id}`">
                <span
                  class="route-connector"
                  :class="{ active: stage.active || dspProcessingActive }"
                  aria-hidden="true"
                ></span>
                <div
                  class="route-stage"
                  :class="[`is-${stage.state}`, { 'is-active': stage.active }]"
                >
                  <span class="route-stage-icon"><i :class="stage.icon"></i></span>
                  <div class="route-stage-copy">
                    <small>{{ stage.shortLabel }}</small
                    ><strong>{{ stage.label }}</strong>
                  </div>
                  <em>{{ stage.detail }}</em>
                  <span class="route-stage-state">{{ stage.stateLabel }}</span>
                </div>
              </template>

              <span
                class="route-connector"
                :class="{ active: playbackInfo?.state === 'playing' }"
                aria-hidden="true"
              ></span>
              <div class="route-stage route-endpoint-stage is-output">
                <span class="route-stage-icon"><i class="ph ph-speaker-hifi"></i></span>
                <div class="route-stage-copy">
                  <small>OUTPUT</small><strong>{{ dspOutputDetail }}</strong>
                </div>
                <em>{{ dspOutputDeviceDetail }}</em>
              </div>
            </div>
          </div>

          <div class="dialog-diagnostics">
            <section class="dialog-node-status">
              <div class="dialog-section-head">
                <div>
                  <span>NODE STATUS</span>
                  <h3>节点实时状态</h3>
                </div>
                <strong>{{ activeDspCount }} / {{ dspRouteStages.length }}</strong>
              </div>

              <div class="dialog-node-list te-auto-scrollbar">
                <article
                  v-for="stage in dspRouteStages"
                  :key="`status-${stage.id}`"
                  class="dialog-node-row"
                  :class="[`is-${stage.state}`, { 'is-active': stage.active }]"
                >
                  <span class="dialog-node-icon"><i :class="stage.icon"></i></span>
                  <div>
                    <strong>{{ stage.label }}</strong>
                    <small>{{ stage.detail }}</small>
                  </div>
                  <span class="dialog-node-state">{{ stage.stateLabel }}</span>
                  <dl>
                    <div>
                      <dt>AVG</dt>
                      <dd>{{ formatMetric(stage.status?.averageProcessMs, 3, ' ms') }}</dd>
                    </div>
                    <div>
                      <dt>PEAK</dt>
                      <dd>{{ formatMetric(stage.status?.maxProcessMs, 3, ' ms') }}</dd>
                    </div>
                  </dl>
                </article>
              </div>
            </section>

            <aside class="dialog-live-metrics">
              <div class="dialog-section-head">
                <div>
                  <span>REALTIME TELEMETRY</span>
                  <h3>输出诊断</h3>
                </div>
                <strong>{{ dspCompileLabel }}</strong>
              </div>

              <dl class="dialog-metric-grid">
                <div>
                  <dt>总延迟</dt>
                  <dd>{{ dspGraphLatencyMs.toFixed(2) }} ms</dd>
                </div>
                <div>
                  <dt>尾音</dt>
                  <dd>{{ dspGraphTailMs.toFixed(1) }} ms</dd>
                </div>
                <div>
                  <dt>CPU 平均</dt>
                  <dd>{{ dspAverageCpuMs.toFixed(3) }} ms</dd>
                </div>
                <div>
                  <dt>CPU 峰值</dt>
                  <dd>{{ dspPeakCpuMs.toFixed(3) }} ms</dd>
                </div>
                <div>
                  <dt>Overrun</dt>
                  <dd>{{ dspOverrunCount }}</dd>
                </div>
                <div>
                  <dt>削波</dt>
                  <dd>{{ dspGraphStatus?.meter?.clipCount ?? 0 }}</dd>
                </div>
                <div>
                  <dt>Momentary</dt>
                  <dd>{{ formatMetric(dspGraphStatus?.meter?.momentaryLufs, 1, ' LUFS') }}</dd>
                </div>
                <div>
                  <dt>Short-term</dt>
                  <dd>{{ formatMetric(dspGraphStatus?.meter?.shortTermLufs, 1, ' LUFS') }}</dd>
                </div>
                <div>
                  <dt>Integrated</dt>
                  <dd>{{ formatMetric(dspGraphStatus?.meter?.integratedLufs, 1, ' LUFS') }}</dd>
                </div>
                <div>
                  <dt>True Peak</dt>
                  <dd>{{ formatMetric(dspGraphStatus?.meter?.truePeakDb, 2, ' dBTP') }}</dd>
                </div>
                <div>
                  <dt>LRA</dt>
                  <dd>{{ formatMetric(dspGraphStatus?.meter?.loudnessRangeLu, 1, ' LU') }}</dd>
                </div>
                <div>
                  <dt>相关度</dt>
                  <dd>{{ formatMetric(dspGraphStatus?.meter?.correlation, 3) }}</dd>
                </div>
              </dl>

              <p v-if="dspGraphStatus?.compileError" class="dialog-compile-error">
                <i class="ph ph-warning"></i>{{ dspGraphStatus.compileError }}
              </p>
            </aside>
          </div>
        </section>
      </div>
    </Transition>
  </div>
</template>

<style scoped src="./LocalDashboard.css"></style>
