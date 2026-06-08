<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { usePlayerStore } from '../stores/usePlayerStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import type {
  AppSettings,
  AppTheme,
  AudioOutputId,
  AudioProcessingSettings,
  ChannelRoutingMode,
  DsdOutputMode,
  PlaybackResumeMode,
  SacdProgramMode,
  VolumeNormalizationMode
} from '../types/settings'

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

const themeOptions: { value: AppTheme; label: string; description: string }[] = [
  { value: 'system', label: '跟随', description: '自动匹配系统明暗' },
  { value: 'pureWhite', label: '浅色', description: '清爽白底与蓝色重点色' },
  { value: 'dark', label: '深色', description: '低亮度背景与高对比文本' },
  { value: 'aurora', label: '流光', description: '柔和多彩的玻璃风格' }
]

const playbackResumeOptions: {
  value: PlaybackResumeMode
  label: string
  description: string
}[] = [
  { value: 'off', label: '关闭', description: '启动时不恢复播放' },
  { value: 'track', label: '记住曲目', description: '只恢复上次曲目' },
  { value: 'trackAndPosition', label: '曲目和位置', description: '恢复曲目与进度' }
]

const bufferSizeOptions = [
  { value: 0, label: 'Auto', help: '由后端和设备协商，通常最稳。' },
  { value: 64, label: '64', help: '低延迟，适合实时监听；更容易受设备和系统负载影响。' },
  { value: 128, label: '128', help: '低延迟与稳定性的折中。' },
  { value: 256, label: '256', help: '推荐日常值，兼顾响应和稳定。' },
  { value: 512, label: '512', help: '更稳，适合普通播放。' },
  { value: 1024, label: '1024', help: '高稳定，切歌和操作响应会略慢。' },
  { value: 2048, label: '2048', help: '最大稳定优先，适合设备容易 underrun 的场景。' }
] as const

const routingModeOptions: { value: ChannelRoutingMode; label: string; help: string }[] = [
  { value: 'auto', label: 'Auto', help: '按源文件与设备自动选择声道布局。' },
  { value: 'stereo', label: 'Stereo', help: '强制立体声输出，最适合耳机和双声道音箱。' },
  { value: 'stereo-to-5.1', label: 'Stereo -> 5.1', help: '把双声道扩展到 5.1 布局。' },
  { value: 'stereo-to-7.1', label: 'Stereo -> 7.1', help: '把双声道扩展到 7.1 布局。' },
  { value: 'mono-to-stereo', label: 'Mono -> Stereo', help: '单声道复制到左右声道。' },
  { value: 'mono-to-multichannel', label: 'Mono -> Multichannel', help: '单声道扩展到多声道设备。' }
]

const replayGainOptions: { value: VolumeNormalizationMode; label: string; help: string }[] = [
  { value: 'off', label: 'Off', help: '不做响度归一化，保留原始音量。' },
  { value: 'track', label: 'Track', help: '逐曲目拉平响度，歌单随机播放更均衡。' },
  { value: 'album', label: 'Album', help: '保留专辑内曲目相对音量，适合整专播放。' },
  { value: 'loudnorm', label: 'Loudnorm', help: '按响度分析目标处理，适合来源差异很大的音频。' }
]

const dsdOutputModeOptions: { value: DsdOutputMode; label: string; help: string }[] = [
  { value: 'auto', label: 'Auto', help: '按设备实际能力选择：Native、DoP 载波或 PCM 回退。' },
  { value: 'pcm', label: 'PCM', help: '始终将 DSD 转换为 PCM，兼容性最高。' },
  { value: 'dop', label: 'DoP', help: '请求 DoP 载波；不可用时显示实际 PCM 回退。' },
  { value: 'native', label: 'Native', help: '请求 Native DSD；仅在输出状态确认时显示 Native。' }
]

const sacdProgramModeOptions: { value: SacdProgramMode; label: string; help: string }[] = [
  { value: 'auto', label: 'Auto', help: '自动选择 SACD program。' },
  { value: 'stereo', label: 'Stereo', help: '优先播放 SACD 双声道 program。' },
  { value: 'multichannel', label: 'Multichannel', help: '优先播放 SACD 多声道 program。' }
]

const fftResolutionOptions = [64, 128, 256, 512, 1024, 2048] as const

const playbackHelp = {
  audioOutput:
    '选择原生输出后端。Windows 可用 WASAPI/ASIO，macOS 用 CoreAudio，Linux 用 ALSA；不同后端决定设备枚举、独占能力和 bit-perfect 可能性。',
  audioDevice:
    '选择当前后端要使用的具体设备或驱动。Auto 会跟随系统默认输出，指定设备适合外置 DAC、专业声卡或 ALSA hw/plughw。',
  exclusive:
    '独占模式会尝试绕过系统混音器。WASAPI Exclusive/ASIO 更可能 bit-perfect；CoreAudio 默认输出和 ALSA default 通常不保证。',
  buffer:
    '缓冲越小延迟越低，但更容易爆音或 underrun；缓冲越大越稳，但切歌和交互响应会变慢。Auto 通常优先稳定。',
  routing:
    '声道路由会改变声道语义，因此可能让 bit-perfect 失效。听耳机和普通音箱建议 Auto 或 Stereo。',
  status:
    '显示后端实际输出格式、延迟和恢复计数。Source Exact 表示源格式未被破坏，Output Perfect 表示解码后 PCM 到设备没有额外处理或格式转换。',
  dsp: 'DSP 总开关控制均衡器、ReplayGain、Crossfeed 和卷积等处理。关闭后更接近原始输出，也更容易满足 bit-perfect。',
  clipGuard: '在增益、EQ 或 ReplayGain 可能超过 0 dBFS 时降低削波风险，适合开启 DSP 时保留。',
  replayGain:
    'ReplayGain 用元数据或响度分析平衡不同歌曲音量。Track 适合随机播放，Album 适合整专，Preamp/Fallback 用于补偿整体响度。',
  eq: '启用均衡器处理。详细频段和参数在均衡器页面调整；开启 EQ 会让 bit-perfect 失效。',
  crossfeed:
    '把左右声道少量互混，减轻耳机声像过宽或疲劳感。适合耳机，不建议用于本来就做过空间混音的内容。',
  convolver:
    '加载卷积脉冲响应，用于房间校正、耳机校正或空间效果。IR 采样率不匹配时可能产生额外重采样。',
  continuity:
    '把播放体验相关选项合并在一起：无缝播放减少曲目间空隙，Crossfade 做淡入淡出，关闭记忆决定下次启动恢复方式。',
  fft: 'FFT 只影响频谱/可视化分析精度，不直接改变听到的声音；分辨率越高越耗 CPU。',
  volume: '应用音量低于 100% 会改变样本值，因此不满足 bit-perfect。追求 bit-perfect 时保持 100%。',
  error: '显示原生音频引擎、设备切换或输出配置的最近错误。'
} as const

type TabKey = (typeof tabs)[number]['key']
type BooleanSettingKey =
  | 'autoCheckLogin'
  | 'minimizeToTray'
  | 'launchAtLogin'
  | 'hardwareAcceleration'
  | 'blurEffect'
  | 'useCoverTheme'

const props = defineProps<{
  initialSection?: TabKey
}>()

const activeTab = ref<TabKey>(props.initialSection ?? 'general')

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

const {
  exclusiveMode,
  audioOutput,
  audioDevice,
  audioOutputOptions,
  audioDeviceOptions,
  audioProcessing,
  audioOutputConfig,
  playbackInfo,
  outputInfo,
  audioEngineError,
  toggleExclusiveMode,
  setAudioOutput,
  setAudioDevice,
  setAudioOutputConfig,
  setAudioProcessing,
  setReplayGainMode,
  setCrossfeedStrength,
  selectImpulseResponse,
  clearImpulseResponse,
  refreshAudioOutputState,
  volume,
  setVolume
} = usePlayerStore()

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
const selectedAudioOutput = computed(() =>
  audioOutputOptions.value.find((option) => option.id === audioOutput.value)
)
const selectedAudioDevice = computed(() =>
  audioDeviceOptions.value.find((option) => option.id === audioDevice.value)
)
const exclusiveAvailable = computed(() => selectedAudioOutput.value?.supportsExclusive ?? false)
const backendLabels: Record<string, string> = {
  wasapi: 'WASAPI Shared',
  'wasapi-exclusive': 'WASAPI Exclusive',
  asio: 'ASIO',
  coreaudio: 'CoreAudio',
  alsa: 'ALSA'
}
const reasonCodeLabels: Record<string, string> = {
  shared_mixer: '共享输出经过系统混音器',
  processing_active: '当前处理链正在改变样本',
  replaygain_active: 'ReplayGain 正在改变样本',
  eq_active: 'EQ 正在改变样本',
  convolver_active: 'Convolver 正在改变样本',
  crossfeed_active: 'Crossfeed 正在改变声道内容',
  crossfade_active: 'Crossfade 正在改变播放连续性',
  volume_not_unity: '软件音量不是 100%',
  routing_changes_semantics: '声道路由或通道语义发生变化',
  pcm_converted: 'PCM 格式或采样率发生转换',
  integer_passthrough_unavailable: '源格式与设备实际输出格式不一致，无法 PCM 直通',
  source_lossy: '源文件是有损格式，不能 Source Exact',
  source_format_differs: '源格式与输出链不一致',
  backend_not_output_perfect: '当前输出路径未声明 bit-perfect 能力',
  output_not_perfect: '当前输出链尚未验证为直通',
  visualization_inactive: '当前没有可视化采样数据',
  dsd_processing_pcm_fallback: 'DSD 因处理链启用而回退到 PCM',
  dsd_high_rate_pcm_fallback: 'DSD 因采样率或驱动限制回退到 PCM',
  dsd_converted_to_pcm: 'DSD 当前已转换为 PCM 输出',
  dsd_source_unsupported: '当前 DSD 源或模式不受支持',
  sacd_iso_unsupported: 'SACD ISO 目前仅识别，不支持播放',
  dsd_dop: '当前 DSD 正在通过 DoP 载波传输',
  dop_carrier_mismatch: 'DoP 载波格式与目标 DSD 速率不匹配',
  dop_passthrough_unproven: 'DoP 输出路径未能证明直通',
  plugin_path: '当前设备路径包含插件或混音层',
  device_not_found: '当前后端没有找到请求设备',
  format_not_supported: '当前设备不支持请求的输出格式',
  backend_open_failure: '输出后端打开失败',
  backend_start_failure: '输出后端启动失败',
  buffer_failure: '输出缓冲失败或发生 underrun',
  device_lost: '输出设备已断开，需要恢复',
  driver_restart: '驱动发生重启或重置'
}
const accessModeLabels: Record<string, string> = {
  shared: 'Shared',
  exclusive: 'Exclusive',
  hog: 'Hog',
  direct: 'Direct',
  plugin: 'Plugin'
}
const nativeDsdStateLabels: Record<string, string> = {
  unsupported: 'Native DSD Unsupported',
  candidate: 'Native DSD Candidate',
  unproven: 'Native DSD Unproven',
  mismatch: 'Native DSD Mismatch',
  proven: 'Native DSD Proven'
}

function canonicalSourceExact(): boolean {
  return outputInfo.value?.sourceExact === true
}

function canonicalOutputPerfect(): boolean {
  return outputInfo.value?.outputPerfect === true
}

function formatBackendLabel(backend: string): string {
  return backendLabels[backend] ?? backend
}

function formatPerfectReason(reason: string): string {
  const trimmed = reason.trim()
  if (!trimmed) return ''
  return trimmed
}

function resolvePerfectReasonText(): string {
  const code = outputInfo.value?.perfectReasonCode || playbackInfo.value?.perfectReasonCode || ''
  if (code && reasonCodeLabels[code]) return reasonCodeLabels[code]
  const capabilityReason = outputInfo.value?.capabilityReason?.trim()
  if (capabilityReason) return capabilityReason
  return formatPerfectReason(outputInfo.value?.perfectReason || playbackInfo.value?.perfectReason || '')
}

function nativeDsdRuntimeTone(state: string): 'success' | 'warning' | 'muted' {
  if (state === 'proven') return 'success'
  if (state === 'candidate' || state === 'unproven' || state === 'mismatch') return 'warning'
  return 'muted'
}

const nativeDsdRuntimeText = computed(() => {
  const info = outputInfo.value
  if (!info) return ''
  const state = info.nativeDsdRuntimeState || 'unsupported'
  const hasRuntimeInterest =
    state !== 'unsupported' ||
    info.driverNativeDsdCapable ||
    info.nativeDsdRequestedRate > 0 ||
    info.nativeDsdExplicitlyCapable
  if (!hasRuntimeInterest) return ''
  const label = nativeDsdStateLabels[state] ?? `Native DSD ${state}`
  const rate =
    info.nativeDsdActualRate || info.nativeDsdRequestedRate || info.driverNativeDsdSampleRates?.[0] || 0
  return rate > 0 ? `${label} ${compactRate(rate)}` : label
})

const nativeDsdRuntimeReasonText = computed(() => {
  const reason = outputInfo.value?.nativeDsdRuntimeReason?.trim()
  return reason ? `Native DSD: ${reason}` : ''
})

const readablePerfectReason = computed(() => resolvePerfectReasonText())
const sourceExact = computed(() => canonicalSourceExact())
const outputPerfect = computed(() => canonicalOutputPerfect())
const accessModeText = computed(() => {
  const mode = outputInfo.value?.accessMode || ''
  return mode ? accessModeLabels[mode] ?? mode : 'Unknown'
})
const pathKindText = computed(() => outputInfo.value?.devicePathKind || 'Unknown path')
const selectedDeviceCapabilityText = computed(() => {
  const device = selectedAudioDevice.value
  if (!device) return '等待设备能力'
  const parts = [
    device.supportsExclusive ? 'Exclusive' : '',
    device.supportsHogMode ? 'Hog' : '',
    device.supportsDirectHw ? 'Direct HW' : '',
    device.supportsNativeDsd ? 'Native DSD' : '',
    device.supportsDop ? 'DoP' : '',
    device.pathKind ? `Path ${device.pathKind}` : ''
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : device.capabilityReason || '未声明额外能力'
})
const outputFormatText = computed(() => {
  const info = outputInfo.value
  if (!info) return '等待音频引擎'
  const format = info.actualOutputFormat || playbackInfo.value?.actualOutputFormat || ''
  const rate =
    info.actualSampleRate || info.outputSampleRate || playbackInfo.value?.actualSampleRate || 0
  const bitDepth =
    info.actualBitDepth || info.outputBitDepth || playbackInfo.value?.actualBitDepth || 0
  const channels = info.actualChannels || playbackInfo.value?.actualChannels || 0
  const parts = [
    format,
    rate > 0 ? `${rate} Hz` : '',
    bitDepth > 0 ? `${bitDepth} bit` : '',
    channels > 0 ? `${channels} ch` : ''
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : '未开始播放'
})
function compactRate(rate: number): string {
  return rate > 0 ? `${Math.round(rate / 100) / 10}kHz` : ''
}

function compactSampleFormat(format: string, bitDepth: number): string {
  const normalized = format.trim().toLowerCase()
  if (/^(f32|float|float32|flt|fltp)$/.test(normalized)) return 'float32'
  if (/^(s24|s24_3le|int24|int24in32|s32p24)/.test(normalized)) return 'int24'
  if (/^(s16|s16le|int16)/.test(normalized)) return 'int16'
  if (/^(s32|s32le|int32)/.test(normalized)) return 'int32'
  return format || (bitDepth > 0 ? `${bitDepth}bit` : '')
}

function compactPcm(
  format: string,
  bitDepth: number,
  sampleRate: number,
  channels: number,
  includeRate = true
): string {
  const parts = [
    compactSampleFormat(format, bitDepth),
    includeRate && sampleRate > 0 ? compactRate(sampleRate) : '',
    channels > 0 ? `${channels}ch` : ''
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : 'PCM'
}

function isSacdIsoSource(info: NonNullable<typeof playbackInfo.value>): boolean {
  return info.source.split('.').pop()?.toUpperCase() === 'ISO'
}

function inferDsdRate(sampleRate: number): number {
  if (sampleRate >= 20000000) return 512
  if (sampleRate >= 10000000) return 256
  if (sampleRate >= 5000000) return 128
  if (sampleRate >= 2500000) return 64
  return 0
}

function isDsdSource(info: NonNullable<typeof playbackInfo.value>): boolean {
  return /\.(dsf|dff)$/i.test(info.source) || info.codec.trim().toLowerCase() === 'dsd'
}

function isDsdPlayback(): boolean {
  const out = outputInfo.value
  return (
    out?.isDsd === true ||
    out?.dsdMode === 'native' ||
    out?.dsdMode === 'dop' ||
    out?.dsdMode === 'unsupported'
  )
}

function formatDsdSource(info: NonNullable<typeof playbackInfo.value>): string {
  const ext = info.source.split('.').pop()?.toUpperCase()
  const container = ext === 'DSF' || ext === 'DFF' ? ext : ext === 'ISO' ? 'SACD ISO' : 'DSD'
  const dsdRate = outputInfo.value?.dsdRate || inferDsdRate(info.sourceSampleRate)
  return [container, dsdRate > 0 ? `DSD${dsdRate}` : 'DSD'].filter(Boolean).join(' ')
}

function formatDecodedStage(info: NonNullable<typeof playbackInfo.value>): string {
  const pcm = compactPcm(
    info.decodedSampleFormat,
    info.decodedBitDepth,
    info.decodedSampleRate,
    info.decodedChannels,
    false
  )
  if (!isDsdSource(info) && !isDsdPlayback()) return pcm
  const mode = outputInfo.value?.dsdMode || 'pcm'
  if (mode === 'native') return 'Native DSD path'
  if (mode === 'dop') return `DoP carrier ${pcm}`
  if (mode === 'unsupported' && isSacdIsoSource(info)) return 'SACD unsupported'
  return `PCM fallback ${pcm}`
}

const outputChainText = computed(() => {
  const info = playbackInfo.value
  if (!info) return ''
  const source = isDsdSource(info) || isSacdIsoSource(info)
    ? formatDsdSource(info)
    : [
        info.codec || 'Source',
        info.sourceBitDepth > 0 ? `${info.sourceBitDepth}bit` : '',
        compactRate(info.sourceSampleRate)
      ]
        .filter(Boolean)
        .join(' ')
  const decoded = formatDecodedStage(info)
  const out = outputInfo.value
  const backend = out?.actualBackend || info.actualBackend || ''
  const actual = compactPcm(
    out?.actualOutputFormat || info.actualOutputFormat,
    out?.actualBitDepth || info.actualBitDepth,
    out?.actualSampleRate || info.actualSampleRate,
    out?.actualChannels || info.actualChannels,
    false
  )
  const reason = readablePerfectReason.value
  const perfect =
    sourceExact.value && outputPerfect.value
      ? 'Bit Perfect'
      : reason
        ? `Not Bit Perfect (${reason})`
        : 'Not Bit Perfect'
  return `${source || 'Source'} -> ${decoded} -> ${backend ? formatBackendLabel(backend) : 'Backend pending'} -> ${actual} -> ${perfect}`
})
const statusSummaryText = computed(() => {
  if (readablePerfectReason.value) return `未达成：${readablePerfectReason.value}`
  if (outputPerfect.value) return 'Output Perfect 已验证'
  return outputChainText.value || outputFormatText.value
})
const outputLatencyText = computed(() => {
  const info = outputInfo.value
  if (!info) return 'Latency 0.0 ms'
  const buffer = info.latencyInfo?.bufferLatencyMs ?? 0
  const driver = info.latencyInfo?.outputLatencyMs ?? 0
  const total = info.latencyInfo?.totalLatencyMs ?? info.latencyMs ?? 0
  const frames = info.bufferSizeFrames || playbackInfo.value?.bufferSizeFrames || 0
  return `Latency Buffer ${buffer.toFixed(1)} ms · Driver ${driver.toFixed(1)} ms · Total ${total.toFixed(total >= 10 ? 0 : 1)} ms${frames > 0 ? ` · ${frames} frames` : ''}`
})
const outputDiagnosticsText = computed(() => {
  const diagnostics = outputInfo.value?.diagnostics ?? playbackInfo.value?.diagnostics
  if (!diagnostics) return 'Underrun 0 · Drop 0 · Restart 0 · Lost 0 · Recovery 0'
  return `Underrun ${diagnostics.sessionUnderrunCount} · Drop ${diagnostics.sessionBufferDropCount} · Restart ${diagnostics.driverRestartCount} · Lost ${diagnostics.deviceLostCount} · Recovery ${diagnostics.sessionRecoveryCount}`
})
const convolverPathLabel = computed(() => {
  const path = audioProcessing.value.convolverIrPath
  if (!path) return '未加载'
  return path.split(/[\\/]/).pop() || path
})

function toggleSetting(key: BooleanSettingKey): void {
  void updateSettings({ [key]: !settings.value[key] } as Partial<AppSettings>)
}

function setTheme(theme: AppTheme): void {
  if (settings.value.theme === theme) return
  void updateSettings({ theme })
}

function setPlaybackResumeMode(playbackResumeMode: PlaybackResumeMode): void {
  if (settings.value.playbackResumeMode === playbackResumeMode) return
  void updateSettings({ playbackResumeMode })
}

function selectAudioOutput(output: AudioOutputId): void {
  if (audioOutput.value === output) return
  void setAudioOutput(output)
}

function selectAudioDevice(event: Event): void {
  const target = event.target as HTMLSelectElement
  if (audioDevice.value === target.value) return
  void setAudioDevice(target.value)
}

function setPreferredBufferSize(value: number): void {
  if (audioOutputConfig.value.preferredBufferSize === value) return
  void setAudioOutputConfig({ preferredBufferSize: value })
}

function setRoutingMode(event: Event): void {
  const target = event.target as HTMLSelectElement
  void setAudioOutputConfig({ routingMode: target.value as ChannelRoutingMode })
}

function updateAudioProcessing(patch: Partial<AudioProcessingSettings>): void {
  void setAudioProcessing(patch)
}

function setReplayGainFromSelect(event: Event): void {
  const target = event.target as HTMLSelectElement
  void setReplayGainMode(target.value as VolumeNormalizationMode)
}

function setReplayGainPreamp(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  updateAudioProcessing({ replayGainPreamp: value })
}

function setReplayGainFallback(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  updateAudioProcessing({ replayGainFallback: value })
}

function setCrossfeedFromInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  void setCrossfeedStrength(value)
}

function setCrossfadeFromInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  updateAudioProcessing({ crossfadeSeconds: value })
}

function setFftResolution(event: Event): void {
  const value = Number((event.target as HTMLSelectElement).value)
  updateAudioProcessing({ fftResolution: value })
}

function setDsdOutputMode(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as DsdOutputMode
  updateAudioProcessing({ dsdOutputMode: value, dsdToPcm: value === 'pcm' })
}

function setSacdProgramMode(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as SacdProgramMode
  updateAudioProcessing({ sacdProgramMode: value })
}

function setLyricFontSize(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  void updateSettings({ lyricFontSize: value })
}

function setVolumeFromInput(event: Event): void {
  volumePercent.value = Number((event.target as HTMLInputElement).value)
}

onMounted(async () => {
  await Promise.all([loadSettings(), refreshAudioOutputState()])
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
            <div class="setting-row audio-output-row">
              <div class="setting-copy">
                <span class="label-row">
                  <span class="setting-label">音频输出</span>
                  <span
                    class="help-dot"
                    tabindex="0"
                    role="note"
                    :aria-label="playbackHelp.audioOutput"
                    :data-help="playbackHelp.audioOutput"
                    >?</span
                  >
                </span>
                <span class="setting-desc">
                  当前为 {{ selectedAudioOutput?.label ?? '自动' }} ·
                  {{ selectedAudioDevice?.label ?? audioDevice }}
                </span>
              </div>
              <div
                class="audio-output-segment"
                role="radiogroup"
                aria-label="音频输出"
                :style="{
                  gridTemplateColumns: `repeat(${Math.max(audioOutputOptions.length, 1)}, minmax(0, 1fr))`
                }"
              >
                <button
                  v-for="option in audioOutputOptions"
                  :key="option.id"
                  class="audio-output-option"
                  :class="{ active: audioOutput === option.id }"
                  type="button"
                  role="radio"
                  :title="option.description"
                  :aria-checked="audioOutput === option.id"
                  @click="selectAudioOutput(option.id)"
                >
                  <span>{{ option.label }}</span>
                  <small>{{ option.description }}</small>
                </button>
              </div>
            </div>

            <div class="setting-row audio-device-row">
              <div class="setting-copy">
                <span class="label-row">
                  <span class="setting-label">输出设备</span>
                  <span
                    class="help-dot"
                    tabindex="0"
                    role="note"
                    :aria-label="playbackHelp.audioDevice"
                    :data-help="playbackHelp.audioDevice"
                    >?</span
                  >
                </span>
                <span class="setting-desc">{{ selectedDeviceCapabilityText }}</span>
              </div>
              <select class="select-control" :value="audioDevice" @change="selectAudioDevice">
                <option v-for="device in audioDeviceOptions" :key="device.id" :value="device.id">
                  {{ device.label }}
                </option>
              </select>
            </div>

            <div class="setting-row">
              <div class="setting-copy">
                <span class="label-row">
                  <span class="setting-label">独占模式</span>
                  <span
                    class="help-dot"
                    tabindex="0"
                    role="note"
                    :aria-label="playbackHelp.exclusive"
                    :data-help="playbackHelp.exclusive"
                    >?</span
                  >
                </span>
                <span class="setting-desc">
                  {{
                    exclusiveAvailable
                      ? '绕过系统混音器，适合外置 DAC 和耳放'
                      : '当前输出后端不支持独占模式'
                  }}
                </span>
              </div>
              <button
                class="toggle-switch"
                :class="{ active: exclusiveMode }"
                role="switch"
                :aria-checked="exclusiveMode"
                :disabled="!exclusiveAvailable"
                @click="toggleExclusiveMode"
              >
                <span class="toggle-knob"></span>
              </button>
            </div>

            <div class="setting-row buffer-row">
              <div class="setting-copy">
                <span class="label-row">
                  <span class="setting-label">输出缓冲</span>
                  <span
                    class="help-dot"
                    tabindex="0"
                    role="note"
                    :aria-label="playbackHelp.buffer"
                    :data-help="playbackHelp.buffer"
                    >?</span
                  >
                </span>
                <span class="setting-desc"
                  >当前 {{ audioOutputConfig.preferredBufferSize || 'Auto' }}</span
                >
              </div>
              <div class="chip-segment" role="radiogroup" aria-label="输出缓冲">
                <button
                  v-for="option in bufferSizeOptions"
                  :key="option.value"
                  class="chip-option"
                  :class="{ active: audioOutputConfig.preferredBufferSize === option.value }"
                  type="button"
                  role="radio"
                  :title="option.help"
                  :aria-checked="audioOutputConfig.preferredBufferSize === option.value"
                  @click="setPreferredBufferSize(option.value)"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>

            <div class="setting-row audio-device-row">
              <div class="setting-copy">
                <span class="label-row">
                  <span class="setting-label">声道路由</span>
                  <span
                    class="help-dot"
                    tabindex="0"
                    role="note"
                    :aria-label="playbackHelp.routing"
                    :data-help="playbackHelp.routing"
                    >?</span
                  >
                </span>
                <span class="setting-desc">{{ audioOutputConfig.routingMode }}</span>
              </div>
              <select
                class="select-control"
                :value="audioOutputConfig.routingMode"
                @change="setRoutingMode"
              >
                <option
                  v-for="option in routingModeOptions"
                  :key="option.value"
                  :value="option.value"
                  :title="option.help"
                >
                  {{ option.label }}
                </option>
              </select>
            </div>

            <div class="setting-row status-row">
              <div class="setting-copy">
                <span class="label-row">
                  <span class="setting-label">输出状态</span>
                  <span
                    class="help-dot"
                    tabindex="0"
                    role="note"
                    :aria-label="playbackHelp.status"
                    :data-help="playbackHelp.status"
                    >?</span
                  >
                </span>
                <span class="setting-desc">{{ statusSummaryText }}</span>
              </div>
              <div class="status-panel">
                <span
                  class="status-chip"
                  :class="{ success: sourceExact }"
                >
                  Source Exact
                </span>
                <span
                  class="status-chip"
                  :class="{ success: outputPerfect, warning: !outputPerfect && outputInfo?.supportsOutputPerfect }"
                >
                  Output Perfect
                </span>
                <span class="status-chip">{{ accessModeText }}</span>
                <span class="status-chip">{{ pathKindText }}</span>
                <span class="status-chip">{{
                  outputInfo?.actualBackend ? formatBackendLabel(outputInfo.actualBackend) : 'Backend pending'
                }}</span>
                <span class="status-chip">{{ outputFormatText }}</span>
                <span
                  v-if="nativeDsdRuntimeText"
                  class="status-chip"
                  :class="nativeDsdRuntimeTone(outputInfo?.nativeDsdRuntimeState || 'unsupported')"
                >
                  {{ nativeDsdRuntimeText }}
                </span>
                <span v-if="outputChainText" class="status-chip status-chain">{{ outputChainText }}</span>
                <span class="status-chip">{{ outputLatencyText }}</span>
                <span class="status-chip">{{ outputDiagnosticsText }}</span>
                <span v-if="nativeDsdRuntimeReasonText" class="status-chip status-chain">{{
                  nativeDsdRuntimeReasonText
                }}</span>
              </div>
            </div>

            <div class="settings-subheading">音频处理</div>

            <div class="setting-row audio-device-row">
              <div class="setting-copy">
                <span class="setting-label">DSD 输出模式</span>
                <span class="setting-desc">
                  {{ dsdOutputModeOptions.find((option) => option.value === audioProcessing.dsdOutputMode)?.help }}
                </span>
              </div>
              <select
                class="select-control"
                :value="audioProcessing.dsdOutputMode"
                @change="setDsdOutputMode"
              >
                <option
                  v-for="option in dsdOutputModeOptions"
                  :key="option.value"
                  :value="option.value"
                  :title="option.help"
                >
                  {{ option.label }}
                </option>
              </select>
            </div>

            <div class="setting-row audio-device-row">
              <div class="setting-copy">
                <span class="setting-label">SACD Program</span>
                <span class="setting-desc">
                  {{
                    sacdProgramModeOptions.find(
                      (option) => option.value === audioProcessing.sacdProgramMode
                    )?.help
                  }}
                </span>
              </div>
              <select
                class="select-control"
                :value="audioProcessing.sacdProgramMode"
                @change="setSacdProgramMode"
              >
                <option
                  v-for="option in sacdProgramModeOptions"
                  :key="option.value"
                  :value="option.value"
                  :title="option.help"
                >
                  {{ option.label }}
                </option>
              </select>
            </div>

            <div class="setting-row">
              <div class="setting-copy">
                <span class="label-row">
                  <span class="setting-label">DSP 总开关</span>
                  <span
                    class="help-dot"
                    tabindex="0"
                    role="note"
                    :aria-label="playbackHelp.dsp"
                    :data-help="playbackHelp.dsp"
                    >?</span
                  >
                </span>
                <span class="setting-desc">
                  {{ playbackInfo?.dspActive ? '正在处理音频' : '处理链待命' }}
                </span>
              </div>
              <button
                class="toggle-switch"
                :class="{ active: audioProcessing.dspEnabled }"
                role="switch"
                :aria-checked="audioProcessing.dspEnabled"
                @click="updateAudioProcessing({ dspEnabled: !audioProcessing.dspEnabled })"
              >
                <span class="toggle-knob"></span>
              </button>
            </div>

            <div class="setting-row">
              <div class="setting-copy">
                <span class="label-row">
                  <span class="setting-label">Clip Guard</span>
                  <span
                    class="help-dot"
                    tabindex="0"
                    role="note"
                    :aria-label="playbackHelp.clipGuard"
                    :data-help="playbackHelp.clipGuard"
                    >?</span
                  >
                </span>
                <span class="setting-desc">削波保护</span>
              </div>
              <button
                class="toggle-switch"
                :class="{ active: audioProcessing.clipGuard }"
                role="switch"
                :aria-checked="audioProcessing.clipGuard"
                @click="updateAudioProcessing({ clipGuard: !audioProcessing.clipGuard })"
              >
                <span class="toggle-knob"></span>
              </button>
            </div>

            <div class="setting-row replaygain-row">
              <div class="setting-copy">
                <span class="label-row">
                  <span class="setting-label">ReplayGain</span>
                  <span
                    class="help-dot"
                    tabindex="0"
                    role="note"
                    :aria-label="playbackHelp.replayGain"
                    :data-help="playbackHelp.replayGain"
                    >?</span
                  >
                </span>
                <span class="setting-desc">
                  Preamp {{ audioProcessing.replayGainPreamp.toFixed(1) }} dB · Fallback
                  {{ audioProcessing.replayGainFallback.toFixed(1) }} dB ·
                  {{ audioProcessing.replayGainClip ? '防削波' : '允许峰值' }}
                </span>
              </div>
              <div class="stacked-control">
                <div class="inline-control-group spread">
                  <select
                    class="select-control"
                    :value="audioProcessing.volumeNormalization"
                    @change="setReplayGainFromSelect"
                  >
                    <option
                      v-for="option in replayGainOptions"
                      :key="option.value"
                      :value="option.value"
                      :title="option.help"
                    >
                      {{ option.label }}
                    </option>
                  </select>
                  <label class="inline-toggle-label">
                    防削波
                    <button
                      class="toggle-switch"
                      :class="{ active: audioProcessing.replayGainClip }"
                      role="switch"
                      :aria-checked="audioProcessing.replayGainClip"
                      @click="
                        updateAudioProcessing({ replayGainClip: !audioProcessing.replayGainClip })
                      "
                    >
                      <span class="toggle-knob"></span>
                    </button>
                  </label>
                </div>
                <label class="compact-range-row">
                  <span>Preamp</span>
                  <input
                    class="range-control"
                    type="range"
                    min="-12"
                    max="12"
                    step="0.5"
                    :value="audioProcessing.replayGainPreamp"
                    @input="setReplayGainPreamp"
                  />
                  <strong>{{ audioProcessing.replayGainPreamp.toFixed(1) }}</strong>
                </label>
                <label class="compact-range-row">
                  <span>Fallback</span>
                  <input
                    class="range-control"
                    type="range"
                    min="-12"
                    max="12"
                    step="0.5"
                    :value="audioProcessing.replayGainFallback"
                    @input="setReplayGainFallback"
                  />
                  <strong>{{ audioProcessing.replayGainFallback.toFixed(1) }}</strong>
                </label>
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-copy">
                <span class="label-row">
                  <span class="setting-label">均衡器</span>
                  <span
                    class="help-dot"
                    tabindex="0"
                    role="note"
                    :aria-label="playbackHelp.eq"
                    :data-help="playbackHelp.eq"
                    >?</span
                  >
                </span>
                <span class="setting-desc">{{ audioProcessing.eqMode }}</span>
              </div>
              <button
                class="toggle-switch"
                :class="{ active: audioProcessing.eqEnabled }"
                role="switch"
                :aria-checked="audioProcessing.eqEnabled"
                @click="updateAudioProcessing({ eqEnabled: !audioProcessing.eqEnabled })"
              >
                <span class="toggle-knob"></span>
              </button>
            </div>

            <div class="setting-row range-row">
              <div class="setting-copy">
                <span class="label-row">
                  <span class="setting-label">Crossfeed</span>
                  <span
                    class="help-dot"
                    tabindex="0"
                    role="note"
                    :aria-label="playbackHelp.crossfeed"
                    :data-help="playbackHelp.crossfeed"
                    >?</span
                  >
                </span>
                <span class="setting-desc">
                  {{
                    audioProcessing.crossfeedEnabled
                      ? Math.round(audioProcessing.crossfeedStrength * 100)
                      : 0
                  }}%
                </span>
              </div>
              <input
                class="range-control"
                type="range"
                min="0"
                max="1"
                step="0.05"
                :value="audioProcessing.crossfeedEnabled ? audioProcessing.crossfeedStrength : 0"
                @input="setCrossfeedFromInput"
              />
            </div>

            <div class="setting-row path-row">
              <div class="setting-copy">
                <span class="label-row">
                  <span class="setting-label">Convolver IR</span>
                  <span
                    class="help-dot"
                    tabindex="0"
                    role="note"
                    :aria-label="playbackHelp.convolver"
                    :data-help="playbackHelp.convolver"
                    >?</span
                  >
                </span>
                <span class="setting-desc">{{ convolverPathLabel }}</span>
              </div>
              <div class="path-actions convolver-actions">
                <div class="path-field" :title="audioProcessing.convolverIrPath">
                  {{ convolverPathLabel }}
                </div>
                <button class="text-button" @click="selectImpulseResponse">
                  <i class="pi pi-folder-open"></i>
                  选择
                </button>
                <button
                  class="icon-button subtle"
                  title="卸载"
                  :disabled="!audioProcessing.convolverIrPath"
                  @click="clearImpulseResponse"
                >
                  <i class="pi pi-times"></i>
                </button>
              </div>
            </div>

            <div class="setting-row audio-device-row">
              <div class="setting-copy">
                <span class="label-row">
                  <span class="setting-label">FFT</span>
                  <span
                    class="help-dot"
                    tabindex="0"
                    role="note"
                    :aria-label="playbackHelp.fft"
                    :data-help="playbackHelp.fft"
                    >?</span
                  >
                </span>
                <span class="setting-desc">{{ audioProcessing.fftEnabled ? '开启' : '关闭' }}</span>
              </div>
              <div class="inline-control-group">
                <button
                  class="toggle-switch"
                  :class="{ active: audioProcessing.fftEnabled }"
                  role="switch"
                  :aria-checked="audioProcessing.fftEnabled"
                  @click="updateAudioProcessing({ fftEnabled: !audioProcessing.fftEnabled })"
                >
                  <span class="toggle-knob"></span>
                </button>
                <select
                  class="select-control compact-select"
                  :value="audioProcessing.fftResolution"
                  @change="setFftResolution"
                >
                  <option v-for="value in fftResolutionOptions" :key="value" :value="value">
                    {{ value }}
                  </option>
                </select>
              </div>
            </div>

            <div class="settings-subheading">播放体验</div>

            <div class="setting-row continuity-row">
              <div class="setting-copy">
                <span class="label-row">
                  <span class="setting-label">播放连续性</span>
                  <span
                    class="help-dot"
                    tabindex="0"
                    role="note"
                    :aria-label="playbackHelp.continuity"
                    :data-help="playbackHelp.continuity"
                    >?</span
                  >
                </span>
                <span class="setting-desc">
                  无缝 {{ audioProcessing.gapless ? '开' : '关' }} · Crossfade
                  {{ audioProcessing.crossfadeSeconds.toFixed(1) }} s ·
                  {{
                    playbackResumeOptions.find(
                      (option) => option.value === settings.playbackResumeMode
                    )?.label
                  }}
                </span>
              </div>
              <div class="continuity-panel">
                <div class="inline-control-group spread">
                  <label class="inline-toggle-label">
                    无缝播放
                    <button
                      class="toggle-switch"
                      :class="{ active: audioProcessing.gapless }"
                      role="switch"
                      :aria-checked="audioProcessing.gapless"
                      @click="updateAudioProcessing({ gapless: !audioProcessing.gapless })"
                    >
                      <span class="toggle-knob"></span>
                    </button>
                  </label>
                  <label class="compact-range-row crossfade-compact">
                    <span>Crossfade</span>
                    <input
                      class="range-control"
                      type="range"
                      min="0"
                      max="12"
                      step="0.5"
                      :value="audioProcessing.crossfadeSeconds"
                      @input="setCrossfadeFromInput"
                    />
                    <strong>{{ audioProcessing.crossfadeSeconds.toFixed(1) }}</strong>
                  </label>
                </div>
                <div
                  class="resume-segment compact-resume"
                  role="radiogroup"
                  aria-label="关闭时记忆播放"
                >
                  <button
                    v-for="option in playbackResumeOptions"
                    :key="option.value"
                    class="resume-option"
                    :class="{ active: settings.playbackResumeMode === option.value }"
                    type="button"
                    role="radio"
                    :title="option.description"
                    :aria-checked="settings.playbackResumeMode === option.value"
                    @click="setPlaybackResumeMode(option.value)"
                  >
                    <span>{{ option.label }}</span>
                    <small>{{ option.description }}</small>
                  </button>
                </div>
              </div>
            </div>

            <div v-if="audioEngineError" class="setting-row compact">
              <div class="setting-copy">
                <span class="label-row">
                  <span class="setting-label">音频输出提示</span>
                  <span
                    class="help-dot"
                    tabindex="0"
                    role="note"
                    :aria-label="playbackHelp.error"
                    :data-help="playbackHelp.error"
                    >?</span
                  >
                </span>
                <span class="setting-desc">{{ audioEngineError }}</span>
              </div>
            </div>

            <div class="setting-row range-row">
              <div class="setting-copy">
                <span class="label-row">
                  <span class="setting-label">当前音量</span>
                  <span
                    class="help-dot"
                    tabindex="0"
                    role="note"
                    :aria-label="playbackHelp.volume"
                    :data-help="playbackHelp.volume"
                    >?</span
                  >
                </span>
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
            <div class="setting-row theme-row">
              <div class="setting-copy">
                <span class="setting-label">主题</span>
                <span class="setting-desc">切换应用整体配色和背景风格</span>
              </div>
              <div class="theme-segment" role="radiogroup" aria-label="主题">
                <button
                  v-for="theme in themeOptions"
                  :key="theme.value"
                  class="theme-option"
                  :class="{ active: settings.theme === theme.value }"
                  type="button"
                  role="radio"
                  :aria-checked="settings.theme === theme.value"
                  @click="setTheme(theme.value)"
                >
                  <span class="theme-swatch" :class="`theme-swatch-${theme.value}`"></span>
                  <span class="theme-option-copy">
                    <span>{{ theme.label }}</span>
                    <small>{{ theme.description }}</small>
                  </span>
                </button>
              </div>
            </div>

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
              <span><kbd>Ctrl</kbd><b>+</b><kbd>Left</kbd></span>
            </div>
            <div class="shortcut-item">
              <span>下一首</span>
              <span><kbd>Ctrl</kbd><b>+</b><kbd>Right</kbd></span>
            </div>
            <div class="shortcut-item">
              <span>音量增加</span>
              <span><kbd>Ctrl</kbd><b>+</b><kbd>Up</kbd></span>
            </div>
            <div class="shortcut-item">
              <span>音量降低</span>
              <span><kbd>Ctrl</kbd><b>+</b><kbd>Down</kbd></span>
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
              <span class="setting-value">Electron + Vue 3 + Twilight Audio Engine</span>
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
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  background: #fff;
  color: var(--te-neutral-900);
}

.settings-header {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 56px;
  padding: 0 20px;
  border-bottom: 0;
  background: #fff;
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
  background: #f8fafc;
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
  overflow: visible;
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

.settings-subheading {
  padding: 12px 18px 8px;
  border-top: 1px solid rgba(17, 24, 39, 0.06);
  background: #f8fafc;
  color: var(--te-neutral-500);
  font-size: 12px;
  font-weight: 800;
}

.setting-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.label-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.help-dot {
  position: relative;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #eff6ff;
  color: #2563eb;
  font-size: 11px;
  font-weight: 900;
  line-height: 1;
  cursor: help;
  outline: none;
}

.help-dot:hover,
.help-dot:focus-visible {
  background: #2563eb;
  color: #fff;
}

.help-dot::after {
  content: attr(data-help);
  position: absolute;
  left: calc(100% + 8px);
  top: 50%;
  width: min(300px, 56vw);
  padding: 9px 10px;
  border: 1px solid rgba(37, 99, 235, 0.16);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 16px 38px rgba(15, 23, 42, 0.14);
  color: var(--te-neutral-700);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
  white-space: normal;
  pointer-events: none;
  opacity: 0;
  transform: translateY(-50%) translateX(-3px);
  transition:
    opacity 0.14s ease,
    transform 0.14s ease;
}

.help-dot:hover::after,
.help-dot:focus-visible::after {
  opacity: 1;
  transform: translateY(-50%);
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
  border: 1px solid rgba(15, 23, 42, 0.24);
  border-radius: 999px;
  background: #64748b;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.54),
    0 1px 2px rgba(15, 23, 42, 0.08);
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.toggle-switch.active {
  border-color: #1e40af;
  background: #1d4ed8;
}

.toggle-switch:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.toggle-switch:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 3px rgba(37, 99, 235, 0.22),
    inset 0 0 0 1px rgba(255, 255, 255, 0.62);
}

.toggle-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 5px rgba(15, 23, 42, 0.28);
  transition: transform 0.2s ease;
}

.toggle-switch.active .toggle-knob {
  transform: translateX(18px);
}

.range-row {
  grid-template-columns: minmax(0, 1fr) minmax(180px, 260px);
}

.buffer-row {
  grid-template-columns: minmax(0, 1fr) minmax(360px, 520px);
}

.status-row {
  align-items: start;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 520px);
}

.replaygain-row,
.continuity-row {
  align-items: start;
  grid-template-columns: minmax(0, 1fr) minmax(390px, 520px);
}

.theme-row {
  grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
}

.theme-segment {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
  gap: 8px;
  padding: 4px;
  border: 1px solid rgba(17, 24, 39, 0.08);
  border-radius: 8px;
  background: #f8fafc;
}

.theme-option {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  min-height: 54px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--te-neutral-700);
  text-align: left;
  cursor: pointer;
  transition:
    background 0.16s,
    border-color 0.16s,
    color 0.16s,
    box-shadow 0.16s;
}

.theme-option:hover {
  background: rgba(255, 255, 255, 0.76);
  color: var(--te-neutral-900);
}

.theme-option.active {
  border-color: color-mix(in srgb, var(--te-primary-500) 28%, transparent);
  background: #fff;
  color: var(--te-neutral-900);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.06);
}

.theme-swatch {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid rgba(17, 24, 39, 0.1);
  box-shadow: inset 0 0 0 5px rgba(255, 255, 255, 0.76);
}

.theme-swatch-pureWhite {
  background: linear-gradient(135deg, #fff 0 48%, #2563eb 49% 100%);
}

.theme-swatch-system {
  background: linear-gradient(135deg, #fff 0 48%, #111827 49% 100%);
}

.theme-swatch-dark {
  background: linear-gradient(135deg, #0b1020 0 48%, #8b5cf6 49% 100%);
}

.theme-swatch-aurora {
  background: linear-gradient(135deg, #7c4dff 0%, #c084fc 48%, #22d3ee 100%);
}

.theme-option-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.theme-option-copy span {
  font-size: 13px;
  font-weight: 700;
}

.theme-option-copy small {
  overflow: hidden;
  color: var(--te-neutral-500);
  font-size: 11px;
  font-weight: 400;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resume-row,
.audio-output-row {
  grid-template-columns: minmax(0, 1fr) minmax(360px, 520px);
}

.audio-device-row {
  grid-template-columns: minmax(0, 1fr) minmax(260px, 360px);
}

.resume-segment,
.audio-output-segment {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 4px;
  border: 1px solid rgba(17, 24, 39, 0.08);
  border-radius: 8px;
  background: #f8fafc;
}

.chip-segment {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
  padding: 4px;
  border: 1px solid rgba(17, 24, 39, 0.08);
  border-radius: 8px;
  background: #f8fafc;
}

.chip-option {
  min-width: 0;
  height: 32px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--te-neutral-700);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

.chip-option:hover,
.chip-option.active {
  border-color: color-mix(in srgb, var(--te-primary-500) 28%, transparent);
  background: #fff;
  color: #2563eb;
}

.status-panel {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 7px;
}

.status-chip {
  max-width: 100%;
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  padding: 0 9px;
  border-radius: 999px;
  background: #f8fafc;
  color: var(--te-neutral-600);
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}

.status-chip.success {
  background: #ecfdf5;
  color: #047857;
}

.status-chip.warning {
  background: #fff7ed;
  color: #c2410c;
}

.status-chain {
  max-width: min(520px, 100%);
  overflow: hidden;
  text-overflow: ellipsis;
}

.resume-option,
.audio-output-option {
  display: flex;
  min-height: 54px;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--te-neutral-700);
  text-align: left;
  cursor: pointer;
  transition:
    background 0.16s,
    border-color 0.16s,
    color 0.16s,
    box-shadow 0.16s;
}

.resume-option:hover,
.audio-output-option:hover {
  background: rgba(255, 255, 255, 0.76);
  color: var(--te-neutral-900);
}

.resume-option.active,
.audio-output-option.active {
  border-color: color-mix(in srgb, var(--te-primary-500) 28%, transparent);
  background: #fff;
  color: var(--te-neutral-900);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.06);
}

.resume-option span,
.audio-output-option span {
  overflow: hidden;
  font-size: 13px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resume-option small,
.audio-output-option small {
  overflow: hidden;
  color: var(--te-neutral-500);
  font-size: 11px;
  font-weight: 400;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-control {
  width: 100%;
  min-height: 38px;
  border: 1px solid rgba(17, 24, 39, 0.12);
  border-radius: 7px;
  background: #fff;
  color: var(--te-neutral-800);
  font-size: 13px;
  outline: none;
  padding: 0 10px;
}

.select-control:focus {
  border-color: color-mix(in srgb, var(--te-primary-500) 42%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--te-primary-500) 12%, transparent);
}

.range-control {
  width: 100%;
  accent-color: #2563eb;
}

.stacked-control,
.continuity-panel {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}

.inline-control-group.spread {
  justify-content: space-between;
}

.inline-toggle-label {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 9px;
  min-height: 38px;
  color: var(--te-neutral-600);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.compact-range-row {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr) 42px;
  align-items: center;
  gap: 9px;
  min-width: 0;
  color: var(--te-neutral-600);
  font-size: 12px;
  font-weight: 700;
}

.compact-range-row strong {
  color: var(--te-neutral-700);
  font-size: 12px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.crossfade-compact {
  flex: 1;
  grid-template-columns: 70px minmax(110px, 1fr) 36px;
}

.compact-resume {
  grid-template-columns: repeat(3, minmax(0, 1fr));
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

.convolver-actions {
  grid-template-columns: minmax(0, 1fr) auto auto;
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

.icon-button:disabled,
.text-button:disabled {
  cursor: not-allowed;
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

.inline-control-group {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.compact-select {
  width: 120px;
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
  .theme-row,
  .audio-output-row,
  .audio-device-row,
  .buffer-row,
  .status-row,
  .replaygain-row,
  .continuity-row,
  .resume-row,
  .range-row {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .path-actions {
    grid-template-columns: minmax(0, 1fr) auto auto auto;
  }

  .convolver-actions {
    grid-template-columns: minmax(0, 1fr) auto auto;
  }

  .chip-segment {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .status-panel,
  .inline-control-group {
    justify-content: flex-start;
  }

  .inline-control-group.spread {
    align-items: flex-start;
    flex-direction: column;
  }

  .compact-range-row,
  .crossfade-compact {
    grid-template-columns: 72px minmax(0, 1fr) 42px;
    width: 100%;
  }

  .help-dot::after {
    left: 0;
    top: calc(100% + 8px);
    transform: translateY(-3px);
  }

  .help-dot:hover::after,
  .help-dot:focus-visible::after {
    transform: translateY(0);
  }

  .restart-strip {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
