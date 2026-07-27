<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useAudioOutputDspStore } from '../stores/useAudioOutputDspStore'
import {
  EQ_RESPONSE_DEFAULT_SAMPLE_RATE,
  computeAutoPreampDb,
  computeBandResponse,
  computeCompositeResponse,
  isBandActive
} from '@renderer/utils/eqResponse'
import type {
  AppSettings,
  AudioEqPreset,
  AudioProcessingSettings,
  EqualizerBand,
  EqualizerFilterType,
  EqMode,
  HeadphoneCompensationSettings
} from '../types/settings'
import type { DspSceneState } from '../../../shared/dspGraph.ts'

const emit = defineEmits<{
  back: []
}>()

type EqualizerTab = EqMode
type OpraProfile = Awaited<ReturnType<typeof window.api.opra.search>>[number]
type OpraCatalogStatus = Awaited<ReturnType<typeof window.api.opra.getStatus>>

const opraDrawerOpen = ref(true)
const graphMinFrequency = 20
const graphMaxFrequency = 20000
const graphMinGain = -18
const graphMaxGain = 18
const frequencyTicks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 16000, 20000]
const gainTicks = [-18, -12, -6, 0, 6, 12, 18]
const defaultBandFrequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

const filterTypes: { value: EqualizerFilterType; label: string; usesGain: boolean }[] = [
  { value: 'peak', label: '峰值', usesGain: true },
  { value: 'lowShelf', label: '低频搁架', usesGain: true },
  { value: 'highShelf', label: '高频搁架', usesGain: true },
  { value: 'bandPass', label: '带通', usesGain: false },
  { value: 'lowPass', label: '低通', usesGain: false },
  { value: 'highPass', label: '高通', usesGain: false },
  { value: 'allPass', label: '全通', usesGain: false },
  { value: 'notch', label: '陷波', usesGain: false }
]

const defaultEqBands: EqualizerBand[] = defaultBandFrequencies.map((frequency) => ({
  frequency,
  gain: 0,
  q: 1,
  filterType: 'peak'
}))

const defaultAudioProcessing: AudioProcessingSettings = {
  dspEnabled: false,
  clipGuard: true,
  fftEnabled: true,
  fftResolution: 8192,
  highResolution: true,
  dsdToPcm: false,
  dsdOutputMode: 'auto',
  sacdProgramMode: 'auto',
  eqEnabled: false,
  eqMode: 'graphic',
  eqPreamp: 0,
  eqBands: defaultEqBands,
  volumeNormalization: 'off',
  replayGainPreamp: 0,
  replayGainFallback: 0,
  replayGainClip: true,
  convolverEnabled: false,
  convolverIrPath: '',
  crossfeedEnabled: false,
  crossfeedStrength: 0,
  crossfeedDelayMs: 0.35,
  crossfeedCutoffHz: 700,
  gapless: true,
  crossfadeSeconds: 0
}

const builtInEqPresets: AudioEqPreset[] = [
  {
    id: 'flat',
    name: 'Flat',
    eqMode: 'graphic',
    eqPreamp: 0,
    eqBands: defaultEqBands
  },
  {
    id: 'warm',
    name: 'Warm',
    eqMode: 'graphic',
    eqPreamp: -1,
    eqBands: [2.4, 1.8, 1.1, 0.4, 0, -0.4, -0.5, 0.2, 0.8, 1].map((gain, index) => ({
      ...defaultEqBands[index],
      gain
    }))
  },
  {
    id: 'vocal',
    name: 'Vocal',
    eqMode: 'parametric',
    eqPreamp: -1.5,
    eqBands: [-1, -0.8, -0.2, 0.7, 1.6, 2.4, 2, 1.1, 0.2, -0.6].map((gain, index) => ({
      ...defaultEqBands[index],
      gain,
      q: index >= 4 && index <= 6 ? 1.3 : 1
    }))
  },
  {
    id: 'night',
    name: 'Night',
    eqMode: 'graphic',
    eqPreamp: -2,
    eqBands: [-2.5, -2, -1.1, -0.4, 0, 0.3, 0.2, -0.2, -0.8, -1.4].map((gain, index) => ({
      ...defaultEqBands[index],
      gain
    }))
  }
]

const tabs: { key: EqualizerTab; label: string; icon: string; desc: string }[] = [
  {
    key: 'graphic',
    label: '图形均衡器',
    icon: 'pi pi-chart-bar',
    desc: '曲线、Master 与 10 波段塑形'
  },
  {
    key: 'parametric',
    label: '参数均衡器',
    icon: 'pi pi-sliders-h',
    desc: '频率、滤波器、增益与 Q 值'
  }
]

const audioOutputDspStore = useAudioOutputDspStore()
const { audioProcessing, outputInfo } = storeToRefs(audioOutputDspStore)
const { setAudioProcessing } = audioOutputDspStore

const autoPreampStorageKey = 'twilight-echo:eq-auto-preamp:v1'

const activeTab = ref<EqualizerTab>('graphic')
const autoPreampEnabled = ref(false)
const appSettings = ref<AppSettings | null>(null)
const presetName = ref('')
const saving = ref(false)
const presetMenuOpen = ref(false)
const filterMenuOpen = ref(false)
const selectedBandIndex = ref(0)
const opraQuery = ref('')
const opraResults = ref<OpraProfile[]>([])
const opraStatus = ref<OpraCatalogStatus | null>(null)
const opraSearching = ref(false)
const opraRefreshing = ref(false)
const opraApplyingEqId = ref('')
const opraError = ref('')
let opraSearchTimer: number | null = null

const userPresets = computed(() => appSettings.value?.audioEqPresets ?? [])
const headphoneCompensation = computed<HeadphoneCompensationSettings>(
  () =>
    appSettings.value?.headphoneCompensation ?? {
      enabled: false,
      productId: '',
      productName: '',
      vendorName: '',
      eqId: '',
      author: '',
      details: '',
      link: '',
      preampDb: 0,
      bands: []
    }
)
const selectedBand = computed(
  () => audioProcessing.value.eqBands[selectedBandIndex.value] ?? audioProcessing.value.eqBands[0]
)

const responsePath = computed(() =>
  responsePoints.value
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ')
)
const responseFillPath = computed(() => {
  if (responsePoints.value.length === 0) return ''
  const first = responsePoints.value[0]
  const last = responsePoints.value[responsePoints.value.length - 1]
  const zero = gainToY(0)
  return `${responsePath.value} L${last.x.toFixed(2)},${zero.toFixed(2)} L${first.x.toFixed(2)},${zero.toFixed(2)} Z`
})

// Display reference rate: use the actual device output rate when known so the
// plotted curve matches the coefficients the engine builds for that rate.
const responseSampleRate = computed(() => {
  const info = outputInfo.value
  const rate = info?.actualSampleRate || info?.outputSampleRate || 0
  return rate > 0 ? rate : EQ_RESPONSE_DEFAULT_SAMPLE_RATE
})

// Exact RBJ biquad response (same math as ParametricEqProcessor.cpp), computed
// only when bands / preamp / mode change — never per frame.
const responsePoints = computed(() => {
  const response = computeCompositeResponse(
    audioProcessing.value.eqBands,
    audioProcessing.value.eqPreamp,
    {
      sampleRate: responseSampleRate.value,
      mode: audioProcessing.value.eqMode,
      pointCount: 257,
      minFrequency: graphMinFrequency,
      maxFrequency: graphMaxFrequency
    }
  )
  return response.map((point) => ({
    x: frequencyToX(point.frequency),
    y: gainToY(clampNumber(point.db, graphMinGain, graphMaxGain, 0))
  }))
})

// Faint per-band curves rendered under the composite (active bands only).
const bandResponsePaths = computed(() => {
  const mode = audioProcessing.value.eqMode
  const sampleRate = responseSampleRate.value
  const paths: string[] = []
  for (const band of audioProcessing.value.eqBands) {
    if (!isBandActive(band, mode)) continue
    const response = computeBandResponse(band, {
      sampleRate,
      mode,
      pointCount: 97,
      minFrequency: graphMinFrequency,
      maxFrequency: graphMaxFrequency
    })
    paths.push(
      response
        .map((point, index) => {
          const x = frequencyToX(point.frequency)
          const y = gainToY(clampNumber(point.db, graphMinGain, graphMaxGain, 0))
          return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
        })
        .join(' ')
    )
  }
  return paths
})

// Auto gain compensation target: offset the highest boost of the band-only
// response by a 0.5 dB safety margin, clamped to the preamp slider range.
const autoPreampTargetDb = computed(() =>
  computeAutoPreampDb(audioProcessing.value.eqBands, {
    sampleRate: responseSampleRate.value,
    mode: audioProcessing.value.eqMode,
    minFrequency: graphMinFrequency,
    maxFrequency: graphMaxFrequency,
    marginDb: 0.5,
    minPreampDb: -24,
    maxPreampDb: 24
  })
)

function loadAutoPreampPreference(): void {
  try {
    autoPreampEnabled.value = globalThis.localStorage?.getItem(autoPreampStorageKey) === '1'
  } catch {
    // A blocked localStorage must not break the equalizer page.
  }
}

function saveAutoPreampPreference(enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(autoPreampStorageKey, enabled ? '1' : '0')
  } catch {
    // Persisting the toggle is best-effort only.
  }
}

function toggleAutoPreamp(): void {
  autoPreampEnabled.value = !autoPreampEnabled.value
  saveAutoPreampPreference(autoPreampEnabled.value)
  if (autoPreampEnabled.value) void applyAutoPreamp()
}

async function applyAutoPreamp(): Promise<void> {
  const target = autoPreampTargetDb.value
  if (Math.abs(audioProcessing.value.eqPreamp - target) < 0.05) return
  await updateAudioProcessing({ eqPreamp: target })
}

const opraStatusText = computed(() => {
  const status = opraStatus.value
  if (!status) return 'OPRA 未加载'
  if (status.loading) return 'OPRA 正在加载'
  if (status.loaded) {
    const source = status.source === 'network' ? '已刷新' : '本地缓存'
    return `${source} · ${status.profileCount.toLocaleString()} profiles`
  }
  return status.lastError ? `离线：${status.lastError}` : '离线，暂无缓存'
})

const activeCompensationTitle = computed(() => {
  const hp = headphoneCompensation.value
  if (!hp.enabled || !hp.eqId) return '未启用耳机补偿'
  return `${hp.vendorName} ${hp.productName}`.trim()
})

function cloneBands(bands: EqualizerBand[]): EqualizerBand[] {
  return bands.map((band) => ({ ...band }))
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const next = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.min(max, Math.max(min, next))
}

function normalizeFilterType(value: unknown): EqualizerFilterType {
  if (
    value === 'lowShelf' ||
    value === 'highShelf' ||
    value === 'bandPass' ||
    value === 'lowPass' ||
    value === 'highPass' ||
    value === 'allPass' ||
    value === 'notch'
  ) {
    return value
  }
  return 'peak'
}

function normalizeAudioProcessing(
  settings?: Partial<AudioProcessingSettings>
): AudioProcessingSettings {
  const eqMode: EqMode = settings?.eqMode === 'parametric' ? 'parametric' : 'graphic'
  const rawBands = Array.isArray(settings?.eqBands) ? settings.eqBands : defaultEqBands
  const eqBands =
    eqMode === 'parametric'
      ? rawBands.slice(0, 32).map((band, index) => {
          const defaultBand = defaultEqBands[index % defaultEqBands.length]
          return {
            frequency: clampNumber(band.frequency, 20, 24000, defaultBand.frequency),
            gain: clampNumber(band.gain, -24, 24, 0),
            q: clampNumber(band.q, 0.1, 20, 1),
            filterType: normalizeFilterType(band.filterType)
          }
        })
      : defaultEqBands.map((defaultBand, index) => {
          const band = rawBands[index] ?? defaultBand
          return {
            frequency: clampNumber(band.frequency, 20, 24000, defaultBand.frequency),
            gain: clampNumber(band.gain, -12, 12, 0),
            q: clampNumber(band.q, 0.25, 8, 1),
            filterType: normalizeFilterType(band.filterType)
          }
        })
  return {
    ...defaultAudioProcessing,
    ...settings,
    eqMode,
    dsdOutputMode:
      settings?.dsdOutputMode === 'pcm' ||
      settings?.dsdOutputMode === 'dop' ||
      settings?.dsdOutputMode === 'native'
        ? settings.dsdOutputMode
        : settings?.dsdToPcm === true
          ? 'pcm'
          : 'auto',
    sacdProgramMode:
      settings?.sacdProgramMode === 'stereo' || settings?.sacdProgramMode === 'multichannel'
        ? settings.sacdProgramMode
        : 'auto',
    fftResolution: clampNumber(settings?.fftResolution, 64, 8192, 8192),
    eqPreamp: clampNumber(settings?.eqPreamp, -24, 24, 0),
    replayGainPreamp: clampNumber(settings?.replayGainPreamp, -12, 12, 0),
    replayGainFallback: clampNumber(settings?.replayGainFallback, -12, 12, 0),
    crossfeedStrength: clampNumber(settings?.crossfeedStrength, 0, 1, 0),
    crossfeedDelayMs: clampNumber(settings?.crossfeedDelayMs, 0.05, 2, 0.35),
    crossfeedCutoffHz: clampNumber(settings?.crossfeedCutoffHz, 80, 4000, 700),
    crossfadeSeconds: clampNumber(settings?.crossfadeSeconds, 0, 12, 0),
    eqBands: eqBands.length > 0 ? eqBands : cloneBands(defaultEqBands)
  }
}

async function loadAppSettings(): Promise<void> {
  try {
    const settings = await window.api.settings.get()
    appSettings.value = {
      ...settings,
      audioProcessing: normalizeAudioProcessing(settings.audioProcessing),
      audioEqPresets: settings.audioEqPresets.map((preset) => ({
        ...preset,
        eqBands: normalizeAudioProcessing({ eqBands: preset.eqBands }).eqBands
      }))
    }
    appSettings.value.headphoneCompensation = {
      ...settings.headphoneCompensation,
      bands: cloneBands(settings.headphoneCompensation?.bands ?? [])
    }
    audioProcessing.value = appSettings.value.audioProcessing
    const dspState = await window.api.audioEngine.getDspSceneState()
    applyActiveSceneEqToEditor(dspState)
    if (audioProcessing.value.eqMode === 'parametric') {
      activeTab.value = 'parametric'
    }
  } catch (err) {
    console.error('读取均衡器设置失败：', err)
  }
}

function applyActiveSceneEqToEditor(dspState: DspSceneState): void {
  const scene = dspState.scenes.find((item) => item.id === dspState.activeSceneId)
  const node = scene?.graph.nodes.find((item) => item.type === 'equalizer')
  if (!node) return
  const params = node.params
  const settings = normalizeAudioProcessing({
    ...audioProcessing.value,
    dspEnabled: true,
    eqEnabled: node.enabled,
    eqMode: params.mode === 'parametric' ? 'parametric' : 'graphic',
    eqPreamp: typeof params.preampDb === 'number' ? params.preampDb : 0,
    eqBands: Array.isArray(params.bands) ? (params.bands as EqualizerBand[]) : []
  })
  audioProcessing.value = settings
  if (appSettings.value) appSettings.value.audioProcessing = settings
}

async function syncActiveSceneEq(nextSettings: AudioProcessingSettings): Promise<void> {
  const dspState = await window.api.audioEngine.getDspSceneState()
  const scene = dspState.scenes.find((item) => item.id === dspState.activeSceneId)
  const node = scene?.graph.nodes.find((item) => item.type === 'equalizer')
  if (!node) return
  node.enabled = nextSettings.eqEnabled
  node.params = {
    ...node.params,
    mode: nextSettings.eqMode,
    preampDb: nextSettings.eqPreamp,
    bands: nextSettings.eqBands
  }
  await window.api.audioEngine.setDspScenes(dspState.scenes, dspState.pinnedSceneId)
}

async function updateAudioProcessing(patch: Partial<AudioProcessingSettings>): Promise<void> {
  const eqTouched =
    patch.eqEnabled === true ||
    patch.eqMode !== undefined ||
    patch.eqPreamp !== undefined ||
    patch.eqBands !== undefined
  const nextSettings = normalizeAudioProcessing({
    ...audioProcessing.value,
    ...patch,
    dspEnabled: patch.dspEnabled ?? (audioProcessing.value.dspEnabled || eqTouched),
    eqEnabled: patch.eqEnabled ?? true
  })
  // Auto gain compensation follows band/mode edits in the same engine update
  // so the compensated preamp reaches the DSP scene without a second apply.
  if (autoPreampEnabled.value && patch.eqPreamp === undefined) {
    nextSettings.eqPreamp = computeAutoPreampDb(nextSettings.eqBands, {
      sampleRate: responseSampleRate.value,
      mode: nextSettings.eqMode,
      minFrequency: graphMinFrequency,
      maxFrequency: graphMaxFrequency,
      marginDb: 0.5,
      minPreampDb: -24,
      maxPreampDb: 24
    })
  }
  await setAudioProcessing(nextSettings)
  await syncActiveSceneEq(nextSettings)
  if (appSettings.value) {
    appSettings.value = {
      ...appSettings.value,
      audioProcessing: nextSettings
    }
  }
}

async function updateEqBand(index: number, patch: Partial<EqualizerBand>): Promise<void> {
  const bands = cloneBands(audioProcessing.value.eqBands)
  if (!bands[index]) return
  bands[index] = {
    ...bands[index],
    ...patch,
    frequency:
      patch.frequency !== undefined
        ? clampNumber(patch.frequency, 20, 24000, bands[index].frequency)
        : bands[index].frequency,
    gain:
      patch.gain !== undefined
        ? clampNumber(
            patch.gain,
            audioProcessing.value.eqMode === 'parametric' ? -24 : -12,
            audioProcessing.value.eqMode === 'parametric' ? 24 : 12,
            bands[index].gain
          )
        : bands[index].gain,
    q:
      patch.q !== undefined
        ? clampNumber(
            patch.q,
            audioProcessing.value.eqMode === 'parametric' ? 0.1 : 0.25,
            audioProcessing.value.eqMode === 'parametric' ? 20 : 8,
            bands[index].q
          )
        : bands[index].q,
    filterType:
      patch.filterType !== undefined
        ? normalizeFilterType(patch.filterType)
        : bands[index].filterType
  }
  await updateAudioProcessing({ eqBands: bands })
}

async function loadOpraStatus(): Promise<void> {
  try {
    opraStatus.value = await window.api.opra.getStatus()
  } catch (err) {
    opraError.value = err instanceof Error ? err.message : String(err)
  }
}

async function searchOpraProfiles(): Promise<void> {
  const query = opraQuery.value.trim()
  if (!query) {
    opraResults.value = []
    return
  }
  opraSearching.value = true
  opraError.value = ''
  try {
    opraResults.value = await window.api.opra.search(query)
    opraStatus.value = await window.api.opra.getStatus()
  } catch (err) {
    opraError.value = err instanceof Error ? err.message : String(err)
  } finally {
    opraSearching.value = false
  }
}

async function refreshOpraCatalog(): Promise<void> {
  opraRefreshing.value = true
  opraError.value = ''
  try {
    opraStatus.value = await window.api.opra.refresh()
    await searchOpraProfiles()
  } catch (err) {
    opraError.value = err instanceof Error ? err.message : String(err)
  } finally {
    opraRefreshing.value = false
  }
}

async function applyOpraProfile(profile: OpraProfile): Promise<void> {
  if (!profile.applicable || opraApplyingEqId.value) return
  opraApplyingEqId.value = profile.eqId
  opraError.value = ''
  try {
    const fullProfile = (await window.api.opra.getProfile(profile.eqId)) ?? profile
    if (!fullProfile.applicable) {
      opraError.value = `该 profile 包含暂不支持的滤波器：${fullProfile.unsupportedBandTypes.join(', ')}`
      return
    }
    const savedSettings = await window.api.settings.update({
      headphoneCompensation: {
        enabled: true,
        productId: fullProfile.productId,
        productName: fullProfile.productName,
        vendorName: fullProfile.vendorName,
        eqId: fullProfile.eqId,
        author: fullProfile.author,
        details: fullProfile.details,
        link: fullProfile.link,
        preampDb: fullProfile.preampDb,
        bands: cloneBands(fullProfile.bands)
      }
    })
    appSettings.value = { ...appSettings.value, ...savedSettings }
  } catch (err) {
    opraError.value = err instanceof Error ? err.message : String(err)
  } finally {
    opraApplyingEqId.value = ''
  }
}

async function disableOpraCompensation(): Promise<void> {
  if (!appSettings.value) return
  try {
    const savedSettings = await window.api.settings.update({
      headphoneCompensation: {
        ...headphoneCompensation.value,
        enabled: false
      }
    })
    // Explicitly construct a new object to guarantee Vue reactivity triggers
    appSettings.value = {
      ...appSettings.value,
      ...savedSettings,
      headphoneCompensation: {
        ...headphoneCompensation.value,
        enabled: false
      }
    }
  } catch (err) {
    console.error('停用 OPRA 补偿失败：', err)
    // Fallback: at least update local state so the UI reflects the change
    appSettings.value = {
      ...appSettings.value,
      headphoneCompensation: {
        ...headphoneCompensation.value,
        enabled: false
      }
    }
  }
}

async function applyEqPreset(preset: AudioEqPreset): Promise<void> {
  activeTab.value = preset.eqMode
  await updateAudioProcessing({
    eqMode: preset.eqMode,
    eqPreamp: preset.eqPreamp,
    eqBands: cloneBands(preset.eqBands)
  })
  presetMenuOpen.value = false
}

async function saveEqPreset(): Promise<void> {
  const name =
    presetName.value.trim() ||
    `自定义 ${new Date().toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    })}`
  if (!name || !appSettings.value || saving.value) return
  saving.value = true
  try {
    const nextPreset: AudioEqPreset = {
      id: `custom-${Date.now()}`,
      name,
      eqMode: audioProcessing.value.eqMode,
      eqPreamp: audioProcessing.value.eqPreamp,
      eqBands: cloneBands(audioProcessing.value.eqBands)
    }
    appSettings.value = await window.api.settings.update({
      audioEqPresets: [...userPresets.value, nextPreset]
    })
    presetName.value = ''
    presetMenuOpen.value = true
  } catch (err) {
    console.error('保存均衡器预设失败：', err)
  } finally {
    saving.value = false
  }
}

function saveAsCurrentPreset(): void {
  void saveEqPreset()
}

function switchTab(tab: EqualizerTab): void {
  activeTab.value = tab
  presetMenuOpen.value = false
  filterMenuOpen.value = false
  if (tab === 'graphic' || tab === 'parametric') {
    void updateAudioProcessing({ eqMode: tab })
  }
}

function openAdvancedSettings(index = selectedBandIndex.value): void {
  selectedBandIndex.value = Math.min(Math.max(index, 0), audioProcessing.value.eqBands.length - 1)
  activeTab.value = 'parametric'
  presetMenuOpen.value = false
  filterMenuOpen.value = false
  void updateAudioProcessing({ eqMode: 'parametric' })
}

async function resetEqualizer(): Promise<void> {
  await updateAudioProcessing({
    eqEnabled: false,
    eqMode: activeTab.value === 'parametric' ? 'parametric' : 'graphic',
    eqPreamp: 0,
    eqBands: cloneBands(defaultEqBands)
  })
}

function togglePresetMenu(): void {
  presetMenuOpen.value = !presetMenuOpen.value
  if (presetMenuOpen.value) filterMenuOpen.value = false
}

async function selectFilterType(filterType: EqualizerFilterType): Promise<void> {
  filterMenuOpen.value = false
  await updateEqBand(selectedBandIndex.value, { filterType })
}

function selectBand(index: number): void {
  selectedBandIndex.value = index
  filterMenuOpen.value = false
}

function formatFrequency(frequency: number): string {
  if (frequency >= 1000) {
    return (frequency / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  }
  return Math.round(frequency).toString()
}

function frequencyToX(frequency: number): number {
  const min = Math.log10(graphMinFrequency)
  const max = Math.log10(graphMaxFrequency)
  const ratio =
    (Math.log10(clampNumber(frequency, graphMinFrequency, graphMaxFrequency, graphMinFrequency)) -
      min) /
    (max - min)
  return ratio * 100
}

function gainToY(gain: number): number {
  const ratio =
    (clampNumber(gain, graphMinGain, graphMaxGain, 0) - graphMinGain) /
    (graphMaxGain - graphMinGain)
  return 100 - ratio * 100
}

function getThumbTop(val: number, max: number) {
  const ratio = (max - val) / (2 * max)
  return ratio * 100 + '%'
}

function getFillStyle(val: number, max: number) {
  if (val >= 0) {
    const heightRatio = (val / max) * 50
    return { bottom: '50%', height: heightRatio + '%' }
  } else {
    const heightRatio = (-val / max) * 50
    return { top: '50%', height: heightRatio + '%' }
  }
}

function isGainDisabled(band: EqualizerBand | undefined): boolean {
  if (!band) return true
  return !filterTypes.find((filter) => filter.value === band.filterType)?.usesGain
}

onMounted(() => {
  loadAutoPreampPreference()
  void loadAppSettings()
  void loadOpraStatus()
})

// Keep the compensated preamp in sync when bands change through paths that
// bypass updateAudioProcessing (preset apply on load, external scene edits).
watch(autoPreampTargetDb, () => {
  if (!autoPreampEnabled.value) return
  void applyAutoPreamp()
})

watch(opraQuery, () => {
  if (opraSearchTimer !== null) window.clearTimeout(opraSearchTimer)
  opraSearchTimer = window.setTimeout(() => {
    void searchOpraProfiles()
  }, 250)
})
</script>

<template>
  <div class="eq-page">
    <button type="button" class="eq-back-button" aria-label="返回" @click="emit('back')">
      <i class="pi pi-chevron-left"></i>
    </button>

    <div class="eq-container">
      <aside class="eq-sidebar">
        <div
          v-for="tab in tabs"
          :key="tab.key"
          class="nav-item"
          data-te-interactive
          role="button"
          tabindex="0"
          :aria-pressed="activeTab === tab.key"
          :class="{ active: activeTab === tab.key }"
          @click="switchTab(tab.key)"
          @keydown.enter.prevent="switchTab(tab.key)"
          @keydown.space.prevent="switchTab(tab.key)"
        >
          <i :class="tab.icon"></i>
          <div class="nav-info">
            <span>{{ tab.label }}</span
            ><small>{{ tab.desc }}</small>
          </div>
        </div>
      </aside>

      <main class="eq-content">
        <!-- Toolbar for Presets across Graphic and Parametric -->
        <div class="eq-toolbar-modern">
          <div class="preset-menu-anchor">
            <button type="button" class="eq-command preset-menu-button" @click="togglePresetMenu">
              选择预设 <i class="pi pi-chevron-down"></i>
            </button>
            <div v-if="presetMenuOpen" class="preset-menu">
              <div class="preset-menu-section">
                <span class="preset-menu-title">内置预设</span>
                <button
                  v-for="preset in builtInEqPresets"
                  :key="preset.id"
                  type="button"
                  class="preset-menu-item"
                  @click="applyEqPreset(preset)"
                >
                  {{ preset.name }}
                </button>
              </div>
              <div class="preset-menu-section">
                <span class="preset-menu-title">自定义预设</span>
                <button
                  v-for="preset in userPresets"
                  :key="preset.id"
                  type="button"
                  class="preset-menu-item"
                  @click="applyEqPreset(preset)"
                >
                  {{ preset.name }}
                </button>
                <span v-if="userPresets.length === 0" class="preset-empty">暂无自定义预设</span>
              </div>
              <div class="preset-create">
                <input v-model="presetName" type="text" placeholder="新建预设名称" />
                <button
                  type="button"
                  :disabled="saving || !presetName.trim()"
                  @click="saveEqPreset"
                >
                  新建
                </button>
              </div>
            </div>
          </div>
          <button
            v-if="activeTab === 'graphic'"
            type="button"
            class="eq-command"
            @click="openAdvancedSettings()"
          >
            高级设置
          </button>
          <button v-else type="button" class="eq-command" @click="switchTab('graphic')">
            返回图形
          </button>
          <button
            type="button"
            class="eq-command auto-preamp-toggle"
            :class="{ active: autoPreampEnabled }"
            :aria-pressed="autoPreampEnabled"
            title="根据当前曲线的最大增益自动下调前置放大，预留 0.5 dB 余量"
            @click="toggleAutoPreamp"
          >
            <i :class="autoPreampEnabled ? 'pi pi-check-circle' : 'pi pi-circle'"></i>
            自动增益补偿
          </button>
          <button type="button" class="eq-command soft" @click="resetEqualizer">重置</button>
          <button type="button" class="eq-command" :disabled="saving" @click="saveAsCurrentPreset">
            另存为
          </button>
        </div>

        <div v-if="activeTab === 'graphic'" class="tab-pane active">
          <header class="eq-header">
            <div class="eq-title">
              <h1>图形均衡器</h1>
              <p>全局频率响应塑形工具，调整此面板将改变最终输出听感。</p>
            </div>
            <div
              class="master-switch"
              data-te-interactive
              role="switch"
              tabindex="0"
              aria-label="启用均衡器"
              :aria-checked="audioProcessing.eqEnabled"
              :class="{ off: !audioProcessing.eqEnabled }"
              @click="updateAudioProcessing({ eqEnabled: !audioProcessing.eqEnabled })"
              @keydown.enter.prevent="
                updateAudioProcessing({ eqEnabled: !audioProcessing.eqEnabled })
              "
              @keydown.space.prevent="
                updateAudioProcessing({ eqEnabled: !audioProcessing.eqEnabled })
              "
            >
              {{ audioProcessing.eqEnabled ? '已启用' : '已关闭' }}
              <div class="toggle-track"><div class="toggle-thumb"></div></div>
            </div>
          </header>

          <section class="opra-panel">
            <div class="opra-header">
              <div class="opra-info">
                <h3>
                  {{ activeCompensationTitle }}
                  <span v-if="headphoneCompensation.enabled" class="badge">已启用补偿</span>
                </h3>
                <p>OPRA (AutoEQ) 自动耳机频响校正曲线。独立处理，不干扰您的手动 EQ 设置。</p>
              </div>
              <button
                class="opra-action-btn"
                :class="{ active: opraDrawerOpen }"
                @click="opraDrawerOpen = !opraDrawerOpen"
              >
                <span>{{ opraDrawerOpen ? '收起设备搜索' : '展开设备搜索' }}</span>
                <i class="pi pi-chevron-down"></i>
              </button>
            </div>

            <div class="opra-drawer-wrapper" :class="{ collapsed: !opraDrawerOpen }">
              <div class="opra-drawer">
                <div class="opra-drawer-inner">
                  <div class="opra-search">
                    <div class="opra-search-input-wrap">
                      <i class="pi pi-search search-icon"></i>
                      <input
                        type="text"
                        v-model="opraQuery"
                        placeholder="搜索耳机型号或厂商，例如 HD 600、Sony、Moondrop"
                      />
                    </div>
                    <button
                      class="opra-refresh"
                      :disabled="opraRefreshing"
                      @click="refreshOpraCatalog"
                    >
                      {{ opraRefreshing ? '刷新中' : '刷新缓存' }}
                    </button>
                  </div>

                  <div
                    style="
                      font-size: 12px;
                      font-weight: 700;
                      color: var(--te-neutral-500);
                      display: flex;
                      justify-content: space-between;
                    "
                  >
                    <span>{{ opraStatusText }} <span v-if="opraSearching">搜索中...</span></span>
                    <span v-if="opraError" style="color: #ec4899">{{ opraError }}</span>
                    <button
                      v-if="headphoneCompensation.enabled"
                      @click="disableOpraCompensation"
                      style="
                        background: none;
                        border: none;
                        color: #ec4899;
                        cursor: pointer;
                        font-weight: 700;
                      "
                    >
                      停用补偿
                    </button>
                  </div>

                  <div class="opra-results" v-if="opraResults.length > 0">
                    <div
                      v-for="profile in opraResults"
                      :key="profile.eqId"
                      class="opra-result-item"
                    >
                      <div class="result-info">
                        <span class="result-brand">{{ profile.vendorName }}</span>
                        <span class="result-model">{{ profile.productName }}</span>
                        <span class="result-author">Profile by {{ profile.author }}</span>
                        <span
                          class="result-author"
                          v-if="!profile.applicable"
                          style="color: #ec4899"
                          >不支持: {{ profile.unsupportedBandTypes.join(', ') }}</span
                        >
                      </div>
                      <button
                        class="result-apply"
                        :style="
                          headphoneCompensation.eqId === profile.eqId
                            ? 'background: var(--te-primary-500); color: #fff;'
                            : ''
                        "
                        :disabled="!profile.applicable || opraApplyingEqId === profile.eqId"
                        @click="applyOpraProfile(profile)"
                      >
                        <template v-if="headphoneCompensation.eqId === profile.eqId"
                          >In Use</template
                        >
                        <template v-else-if="opraApplyingEqId === profile.eqId">Applying</template>
                        <template v-else>Apply</template>
                      </button>
                    </div>
                  </div>

                  <p class="opra-attribution">
                    Data sourced from
                    <a href="https://github.com/opra-project/OPRA" target="_blank">OPRA</a>. Profile
                    authors are credited in each result.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section class="chart-card">
            <div class="svg-container">
              <div class="chart-labels-y">
                <span
                  v-for="gain in [...gainTicks].reverse()"
                  :key="'g-' + gain"
                  :class="{ zero: gain === 0 }"
                  >{{ gain > 0 ? '+' + gain : gain }}</span
                >
              </div>
              <div class="chart-labels-x">
                <span
                  v-for="freq in frequencyTicks"
                  :key="'f-' + freq"
                  :style="{ left: frequencyToX(freq) + '%' }"
                  >{{ formatFrequency(freq) }}</span
                >
              </div>

              <div
                v-for="(band, idx) in audioProcessing.eqBands"
                :key="'point-' + idx"
                v-show="!isGainDisabled(band)"
                class="chart-point"
                :style="{
                  left: frequencyToX(band.frequency) + '%',
                  top: gainToY(band.gain) + '%',
                  borderColor: 'var(--te-primary-500)'
                }"
              ></div>

              <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="curveGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stop-color="#6366f1" />
                    <stop offset="50%" stop-color="#22d3ee" />
                    <stop offset="100%" stop-color="#ec4899" />
                  </linearGradient>
                  <linearGradient id="fillGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#6366f1" stop-opacity="0.25" />
                    <stop offset="100%" stop-color="#22d3ee" stop-opacity="0.0" />
                  </linearGradient>
                </defs>
                <line
                  v-for="gain in gainTicks"
                  :key="'gl-' + gain"
                  x1="0"
                  x2="100"
                  :y1="gainToY(gain)"
                  :y2="gainToY(gain)"
                  class="grid-line"
                  :class="{ zero: gain === 0 }"
                />
                <line
                  v-for="freq in frequencyTicks"
                  :key="'fl-' + freq"
                  :x1="frequencyToX(freq)"
                  :x2="frequencyToX(freq)"
                  y1="0"
                  y2="100"
                  class="grid-line"
                />
                <path
                  v-for="(bandPath, bandPathIndex) in bandResponsePaths"
                  :key="'band-curve-' + bandPathIndex"
                  class="equalizer-band-line"
                  :d="bandPath"
                  fill="none"
                  vector-effect="non-scaling-stroke"
                />
                <path
                  class="equalizer-spectrum-area"
                  :d="responseFillPath"
                  fill="url(#fillGradient)"
                />
                <path
                  class="equalizer-spectrum-line"
                  :d="responsePath"
                  fill="none"
                  stroke="url(#curveGradient)"
                  stroke-width="3px"
                  vector-effect="non-scaling-stroke"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </div>
          </section>

          <section class="sliders-board">
            <div class="slider-column master-column">
              <div class="slider-gain">
                {{
                  audioProcessing.eqPreamp > 0
                    ? '+' + audioProcessing.eqPreamp.toFixed(1)
                    : audioProcessing.eqPreamp.toFixed(1)
                }}
              </div>
              <div class="slider-track">
                <div class="slider-fill" :style="getFillStyle(audioProcessing.eqPreamp, 24)"></div>
                <div
                  class="slider-thumb"
                  :style="{ top: getThumbTop(audioProcessing.eqPreamp, 24) }"
                ></div>
                <input
                  type="range"
                  min="-24"
                  max="24"
                  step="0.1"
                  :value="audioProcessing.eqPreamp"
                  :disabled="autoPreampEnabled"
                  @input="
                    updateAudioProcessing({
                      eqPreamp: Number(($event.target as HTMLInputElement).value)
                    })
                  "
                  class="invisible-range"
                />
              </div>
              <div class="slider-freq">{{ autoPreampEnabled ? 'PREAMP · AUTO' : 'PREAMP' }}</div>
            </div>

            <div
              v-for="(band, index) in audioProcessing.eqBands"
              :key="'band-' + index"
              class="slider-column"
            >
              <div class="slider-gain">
                {{ band.gain > 0 ? '+' + band.gain.toFixed(1) : band.gain.toFixed(1) }}
              </div>
              <div class="slider-track">
                <div class="slider-fill" :style="getFillStyle(band.gain, 12)"></div>
                <div class="slider-thumb" :style="{ top: getThumbTop(band.gain, 12) }"></div>
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="0.1"
                  :value="band.gain"
                  :disabled="isGainDisabled(band)"
                  @input="
                    updateEqBand(index, { gain: Number(($event.target as HTMLInputElement).value) })
                  "
                  class="invisible-range"
                />
              </div>
              <div
                class="slider-freq"
                data-te-interactive
                role="button"
                tabindex="0"
                :aria-label="`高级设置 ${formatFrequency(band.frequency)}`"
                style="cursor: pointer"
                @click="openAdvancedSettings(index)"
                @keydown.enter.prevent="openAdvancedSettings(index)"
                @keydown.space.prevent="openAdvancedSettings(index)"
              >
                {{ formatFrequency(band.frequency) }}
              </div>
            </div>
          </section>
        </div>

        <div v-else-if="activeTab === 'parametric'" class="tab-pane active">
          <header class="eq-header">
            <div class="eq-title">
              <h1>参数均衡器</h1>
              <p>精确控制每个波段的中心频率、增益和品质因数（Q值）。</p>
            </div>
          </header>

          <section class="chart-card">
            <div class="svg-container">
              <div class="chart-labels-y">
                <span
                  v-for="gain in [...gainTicks].reverse()"
                  :key="'py-' + gain"
                  :class="{ zero: gain === 0 }"
                  >{{ gain > 0 ? '+' + gain : gain }}</span
                >
              </div>
              <div class="chart-labels-x">
                <span
                  v-for="freq in frequencyTicks"
                  :key="'px-' + freq"
                  :style="{ left: frequencyToX(freq) + '%' }"
                  >{{ formatFrequency(freq) }}</span
                >
              </div>

              <div
                v-if="selectedBand"
                class="chart-point"
                :style="{
                  left: frequencyToX(selectedBand.frequency) + '%',
                  top: gainToY(selectedBand.gain) + '%',
                  borderColor: '#6366f1',
                  width: '12px',
                  height: '12px',
                  boxShadow: '0 0 10px rgba(99,102,241,0.5)'
                }"
              ></div>

              <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="curveGradientP" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stop-color="#6366f1" />
                    <stop offset="50%" stop-color="#22d3ee" />
                    <stop offset="100%" stop-color="#ec4899" />
                  </linearGradient>
                  <linearGradient id="fillGradientP" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#6366f1" stop-opacity="0.25" />
                    <stop offset="100%" stop-color="#22d3ee" stop-opacity="0.0" />
                  </linearGradient>
                </defs>
                <line
                  v-for="gain in gainTicks"
                  :key="'pgl-' + gain"
                  x1="0"
                  x2="100"
                  :y1="gainToY(gain)"
                  :y2="gainToY(gain)"
                  class="grid-line"
                  :class="{ zero: gain === 0 }"
                />
                <line
                  v-for="freq in frequencyTicks"
                  :key="'pfl-' + freq"
                  :x1="frequencyToX(freq)"
                  :x2="frequencyToX(freq)"
                  y1="0"
                  y2="100"
                  class="grid-line"
                />
                <line
                  v-if="selectedBand"
                  class="frequency-guide"
                  :x1="frequencyToX(selectedBand.frequency)"
                  :x2="frequencyToX(selectedBand.frequency)"
                  y1="0"
                  y2="100"
                  stroke="#6366f1"
                  stroke-width="2px"
                  stroke-dasharray="4 4"
                  vector-effect="non-scaling-stroke"
                />

                <path
                  v-for="(bandPath, bandPathIndex) in bandResponsePaths"
                  :key="'pband-curve-' + bandPathIndex"
                  class="equalizer-band-line"
                  :d="bandPath"
                  fill="none"
                  vector-effect="non-scaling-stroke"
                />
                <path
                  class="equalizer-spectrum-area"
                  :d="responseFillPath"
                  fill="url(#fillGradientP)"
                />
                <path
                  class="equalizer-spectrum-line"
                  :d="responsePath"
                  fill="none"
                  stroke="url(#curveGradientP)"
                  stroke-width="3px"
                  vector-effect="non-scaling-stroke"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </div>
          </section>

          <section class="band-selector">
            <button
              v-for="(band, idx) in audioProcessing.eqBands"
              :key="'btab-' + idx"
              class="band-tab"
              :class="{ active: selectedBandIndex === idx }"
              @click="selectBand(idx)"
            >
              {{ formatFrequency(band.frequency) }}
            </button>
          </section>

          <section v-if="selectedBand" class="parameter-card">
            <div class="param-group">
              <label>频率 FREQ (Hz)</label>
              <input
                type="number"
                min="20"
                max="24000"
                :value="Math.round(selectedBand.frequency)"
                @change="
                  updateEqBand(selectedBandIndex, {
                    frequency: Number(($event.target as HTMLInputElement).value)
                  })
                "
              />
            </div>
            <div class="param-group">
              <label>滤波器类型</label>
              <select
                :value="selectedBand.filterType"
                @change="
                  selectFilterType(
                    ($event.target as HTMLSelectElement).value as EqualizerFilterType
                  )
                "
              >
                <option v-for="filter in filterTypes" :key="filter.value" :value="filter.value">
                  {{ filter.label }}
                </option>
              </select>
            </div>
            <div class="param-group">
              <label>品质因数 Q</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="20"
                :value="selectedBand.q"
                @input="
                  updateEqBand(selectedBandIndex, {
                    q: Number(($event.target as HTMLInputElement).value)
                  })
                "
              />
            </div>
            <div class="param-group">
              <label>增益 GAIN (dB)</label>
              <input
                type="number"
                step="0.5"
                min="-24"
                max="24"
                :value="selectedBand.gain"
                :disabled="isGainDisabled(selectedBand)"
                @input="
                  updateEqBand(selectedBandIndex, {
                    gain: Number(($event.target as HTMLInputElement).value)
                  })
                "
              />
            </div>
          </section>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.eq-back-button {
  position: fixed;
  top: 42px;
  left: 42px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--te-glass-bg);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(15, 23, 42, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--te-neutral-700);
  font-size: 16px;
  transition: all 0.2s;
  z-index: 100;
}

.eq-back-button:hover {
  background: var(--te-card-bg);
  color: var(--te-primary-500);
  transform: translateX(-2px);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);
}

/* Ensure eq-page allows absolute positioning of the back button */
.eq-page {
  position: fixed;
  inset: 0;
  z-index: 1100;
  overflow: hidden;
  background: var(--te-glass-bg);
  backdrop-filter: blur(24px) saturate(150%);
  -webkit-backdrop-filter: blur(24px) saturate(150%);
}

.eq-toolbar-modern {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 0 20px 0;
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
  margin-bottom: 24px;
}

.eq-command {
  background: var(--te-glass-bg);
  border: 1px solid var(--te-glass-border);
  padding: 8px 16px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--te-neutral-700);
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
}

.eq-command:hover:not(:disabled) {
  background: var(--te-card-bg);
  border-color: var(--te-primary-400);
  color: var(--te-primary-500);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.1);
}

.eq-command.soft {
  background: transparent;
  border-color: transparent;
}
.eq-command.soft:hover {
  background: rgba(15, 23, 42, 0.04);
  color: var(--te-neutral-900);
}

.eq-command:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.auto-preamp-toggle.active {
  background: rgba(var(--te-primary-rgb), 0.1);
  border-color: var(--te-primary-400);
  color: var(--te-primary-500);
}

.preset-menu-anchor {
  position: relative;
}

.preset-menu {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  background: var(--te-glass-bg-strong);
  backdrop-filter: blur(20px);
  border: 1px solid var(--te-glass-border);
  border-radius: 16px;
  box-shadow: 0 10px 40px rgba(15, 23, 42, 0.1);
  padding: 12px;
  width: 240px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.preset-menu-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.preset-menu-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--te-neutral-400);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 0 8px 4px;
}

.preset-menu-item {
  background: transparent;
  border: none;
  padding: 8px;
  text-align: left;
  font-size: 13px;
  font-weight: 600;
  color: var(--te-neutral-700);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.preset-menu-item:hover {
  background: var(--te-primary-50);
  color: var(--te-primary-600);
}

.preset-empty {
  font-size: 12px;
  color: var(--te-neutral-400);
  padding: 4px 8px;
}

.preset-create {
  display: flex;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid rgba(15, 23, 42, 0.06);
}

.preset-create input {
  flex: 1;
  background: rgba(15, 23, 42, 0.04);
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
  outline: none;
  transition: all 0.2s;
  width: 100%;
}

.preset-create input:focus {
  background: var(--te-card-bg);
  border-color: var(--te-primary-400);
}

.preset-create button {
  background: var(--te-primary-500);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.preset-create button:hover:not(:disabled) {
  background: var(--te-primary-600);
}
.preset-create button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

:root {
  --te-primary-500: #6366f1;
  --te-primary-rgb: 99, 102, 241;
  --te-neutral-900: #1e293b;
  --te-neutral-500: #64748b;
  --te-ease-soft: cubic-bezier(0.4, 0, 0.2, 1);
  --transition: all 0.3s var(--te-ease-soft);
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.eq-container {
  width: 100%;
  height: 100%;
  margin: 0;
  max-width: none;
  background: var(--te-glass-bg);
  backdrop-filter: blur(24px) saturate(150%);
  -webkit-backdrop-filter: blur(24px) saturate(150%);
  border: none;
  border-radius: 0;
  box-shadow: none;
  display: flex;
  overflow: hidden;
}

/* Sidebar Navigation */
.eq-sidebar {
  width: 240px;
  background: var(--te-glass-bg);
  border-right: 1px solid var(--te-glass-border);
  padding: 90px 20px 32px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 16px;
  cursor: pointer;
  transition: var(--transition);
  color: var(--te-neutral-500);
}
.nav-item:hover {
  background: var(--te-hover-bg);
  color: var(--te-neutral-900);
}
.nav-item.active {
  background: var(--te-active-bg);
  color: var(--te-primary-500);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
  border: 1px solid var(--te-card-border);
}
.nav-item i {
  font-size: 1.2rem;
  background: var(--te-subtle-bg);
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  transition: var(--transition);
}
.nav-item.active i {
  background: rgba(var(--te-primary-rgb), 0.1);
  color: var(--te-primary-500);
}
.nav-info {
  display: flex;
  flex-direction: column;
}
.nav-info span {
  font-weight: 700;
  font-size: 14px;
}
.nav-info small {
  font-size: 11px;
  font-weight: 500;
  opacity: 0.7;
}

/* Content Area */
.eq-content {
  flex: 1;
  padding: 40px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 30px;
}
.tab-pane {
  display: none;
  flex-direction: column;
  gap: 30px;
  animation: fadeIn 0.4s var(--te-ease-soft);
}
.tab-pane.active {
  display: flex;
}
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.eq-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.eq-title h1 {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.5px;
  margin-bottom: 6px;
}
.eq-title p {
  color: var(--te-neutral-500);
  font-size: 14px;
  font-weight: 500;
}

.master-switch {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--te-card-bg);
  padding: 8px 16px 8px 20px;
  border-radius: 999px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
  border: 1px solid var(--te-card-border);
  font-weight: 700;
  font-size: 14px;
  color: var(--te-primary-500);
  cursor: pointer;
  transition: color 0.2s;
}
.master-switch.off {
  color: var(--te-neutral-500);
}
.toggle-track {
  width: 44px;
  height: 24px;
  background: linear-gradient(135deg, var(--te-primary-500), #22d3ee);
  border-radius: 999px;
  position: relative;
  transition: background 0.2s;
}
.master-switch.off .toggle-track {
  background: rgba(15, 23, 42, 0.12);
}
.toggle-thumb {
  width: 20px;
  height: 20px;
  background: #fff; /* keep-white: toggle knob */
  border-radius: 50%;
  position: absolute;
  top: 2px;
  right: 2px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  transition:
    right 0.2s,
    left 0.2s;
}
.master-switch.off .toggle-thumb {
  right: auto;
  left: 2px;
}

/* OPRA Panel */
.opra-panel {
  background: var(--te-card-bg);
  border-radius: 20px;
  border: 1px solid var(--te-card-border);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.03);
  overflow: hidden;
}
.opra-header {
  padding: 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--te-card-bg);
  z-index: 2;
  position: relative;
}
.opra-info h3 {
  font-size: 16px;
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 8px;
}
.opra-info h3 span.badge {
  background: var(--te-success-soft-bg);
  color: var(--te-success-soft-fg);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 6px;
}
.opra-info p {
  font-size: 13px;
  color: var(--te-neutral-500);
  margin-top: 6px;
  font-weight: 500;
}
.opra-action-btn {
  background: rgba(15, 23, 42, 0.04);
  border: none;
  padding: 10px 20px;
  border-radius: 10px;
  font-weight: 700;
  color: var(--te-neutral-900);
  cursor: pointer;
  transition: var(--transition);
  display: flex;
  align-items: center;
  gap: 8px;
}
.opra-action-btn i {
  font-size: 10px;
  transition: transform 0.4s var(--te-ease-soft);
}
.opra-action-btn:hover {
  background: var(--te-subtle-bg);
  transform: translateY(-2px);
}
.opra-action-btn.active {
  background: var(--te-info-soft-bg);
  color: var(--te-info-soft-fg);
  transform: translateY(0);
}
.opra-action-btn.active i {
  transform: rotate(180deg);
}

.opra-drawer-wrapper {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows 0.4s var(--te-ease-soft);
}
.opra-drawer-wrapper.collapsed {
  grid-template-rows: 0fr;
}
.opra-drawer {
  overflow: hidden;
}
.opra-drawer-inner {
  border-top: 1px solid var(--te-card-border);
  background: var(--te-subtle-bg);
  padding: 20px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.opra-search {
  display: flex;
  gap: 12px;
  align-items: center;
}
.opra-search-input-wrap {
  flex: 1;
  position: relative;
}
.opra-search-input-wrap .search-icon {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--te-neutral-500);
}
.opra-search-input-wrap input {
  width: 100%;
  padding: 12px 16px 12px 40px;
  border-radius: 12px;
  border: 1px solid var(--te-card-border);
  background: var(--te-card-bg);
  font-family: inherit;
  font-size: 14px;
  color: var(--te-neutral-900);
  outline: none;
  transition: var(--transition);
  font-weight: 500;
}
.opra-search-input-wrap input:focus {
  border-color: var(--te-primary-500);
  box-shadow: 0 0 0 3px rgba(var(--te-primary-rgb), 0.1);
}
.opra-refresh {
  background: var(--te-card-bg);
  border: 1px solid var(--te-card-border);
  padding: 11px 20px;
  border-radius: 12px;
  font-weight: 700;
  color: var(--te-neutral-900);
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(15, 23, 42, 0.02);
  transition: var(--transition);
}
.opra-refresh:hover {
  background: var(--te-hover-bg);
  border-color: var(--te-active-bg);
}

.opra-results {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
  max-height: 200px;
  overflow-y: auto;
  padding-right: 4px;
}
.opra-results::-webkit-scrollbar {
  width: 6px;
}
.opra-results::-webkit-scrollbar-track {
  background: transparent;
}
.opra-results::-webkit-scrollbar-thumb {
  background: rgba(15, 23, 42, 0.1);
  border-radius: 999px;
}

.opra-result-item {
  background: var(--te-card-bg);
  border: 1px solid var(--te-card-border);
  padding: 16px;
  border-radius: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: var(--transition);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.02);
}
.opra-result-item:hover {
  border-color: rgba(99, 102, 241, 0.3);
  box-shadow: 0 8px 16px rgba(99, 102, 241, 0.08);
  transform: translateY(-2px);
}
.result-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.result-brand {
  font-size: 11px;
  font-weight: 800;
  color: var(--te-neutral-500);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.result-model {
  font-size: 15px;
  font-weight: 800;
  color: var(--te-neutral-900);
}
.result-author {
  font-size: 12px;
  font-weight: 500;
  color: rgba(15, 23, 42, 0.4);
  margin-top: 4px;
}
.result-apply {
  background: rgba(99, 102, 241, 0.1);
  color: var(--te-primary-500);
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
  transition: var(--transition);
}
.result-apply:hover {
  background: var(--te-primary-500);
  color: #fff;
}

.opra-attribution {
  font-size: 12px;
  font-weight: 500;
  color: var(--te-neutral-500);
  margin-top: 4px;
}
.opra-attribution a {
  color: var(--te-primary-500);
  text-decoration: none;
  font-weight: 700;
}
.opra-attribution a:hover {
  text-decoration: underline;
}

/* Detailed SVG Chart Area */
.chart-card {
  background: var(--te-card-bg);
  border-radius: 20px;
  padding: 16px 16px 36px 40px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.03);
  border: 1px solid var(--te-card-border);
  position: relative;
}
.svg-container {
  width: 100%;
  height: 210px;
  position: relative;
}
svg {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
}

.grid-line {
  stroke: rgba(15, 23, 42, 0.05);
  stroke-width: 1px;
  vector-effect: non-scaling-stroke;
}

/* Faint per-band response curves under the composite line */
.equalizer-band-line {
  stroke: var(--te-primary-500);
  stroke-width: 1px;
  opacity: 0.18;
}
.grid-line.zero {
  stroke: rgba(15, 23, 42, 0.15);
  stroke-width: 2px;
  stroke-dasharray: 4 4;
  vector-effect: non-scaling-stroke;
}

/* HTML based labels & points */
.chart-labels-y {
  position: absolute;
  top: 0;
  left: -32px;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  color: var(--te-neutral-500);
  font-size: 11px;
  font-weight: 600;
  font-family: var(--te-font-sans);
  text-align: right;
  width: 24px;
}
.chart-labels-y span.zero {
  font-weight: 800;
  color: var(--te-neutral-900);
}

.chart-labels-x {
  position: absolute;
  bottom: -24px;
  left: 0;
  width: 100%;
  height: 16px;
  color: var(--te-neutral-500);
  font-size: 11px;
  font-weight: 600;
  font-family: var(--te-font-sans);
}
.chart-labels-x span {
  position: absolute;
  transform: translateX(-50%);
  text-align: center;
}

/* Pure HTML perfect circles for points to avoid SVG transform stretching */
.chart-point {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #fff; /* keep-white: chart point center */
  border: 3px solid;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.5);
  z-index: 10;
}

/* Graphic Sliders Board */
.sliders-board {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  background: var(--te-glass-bg);
  padding: 30px 40px;
  border-radius: 20px;
  border: 1px solid var(--te-glass-border);
}
.slider-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  flex: 1;
}
.slider-gain {
  font-size: 13px;
  font-weight: 700;
  color: var(--te-primary-500);
  background: var(--te-card-bg);
  padding: 4px 10px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
}
.slider-freq {
  font-size: 12px;
  font-weight: 600;
  color: var(--te-neutral-500);
}
.slider-track {
  width: 6px;
  height: 180px;
  background: rgba(15, 23, 42, 0.06);
  border-radius: 999px;
  position: relative;
}
.slider-fill {
  position: absolute;
  left: 0;
  width: 100%;
  background: linear-gradient(to top, var(--te-primary-500), #818cf8);
  border-radius: 999px;
  z-index: 1;
}
.slider-thumb {
  width: 20px;
  height: 20px;
  background: #fff; /* keep-white: slider knob */
  border-radius: 50%;
  position: absolute;
  left: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border: 2px solid var(--te-primary-500);
  cursor: grab;
  transition: transform 0.1s;
  z-index: 2;
}
.slider-thumb:hover {
  transform: translate(-50%, -50%) scale(1.2);
}

.invisible-range {
  position: absolute;
  width: 180px;
  height: 24px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-90deg);
  opacity: 0;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
  margin: 0;
  z-index: 3;
}

.master-column {
  padding-right: 20px;
  margin-right: 10px;
  border-right: 2px dashed rgba(15, 23, 42, 0.08);
}
.master-column .slider-gain {
  color: #ec4899;
}
.master-column .slider-fill {
  background: linear-gradient(to top, #ec4899, #f472b6);
}
.master-column .slider-thumb {
  border-color: #ec4899;
}

/* Parametric Specific Styles */
.band-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 16px 20px;
  background: var(--te-glass-bg);
  border-radius: 16px;
  border: 1px solid var(--te-glass-border);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.02);
}
.band-tab {
  padding: 8px 16px;
  border-radius: 10px;
  border: 1px solid var(--te-card-border);
  background: var(--te-card-bg);
  font-size: 13px;
  font-weight: 700;
  color: var(--te-neutral-500);
  cursor: pointer;
  transition: var(--transition);
}
.band-tab:hover {
  background: var(--te-hover-bg);
  color: var(--te-neutral-900);
}
.band-tab.active {
  background: var(--te-active-bg);
  color: var(--te-primary-500);
  border-color: var(--te-active-bg);
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.15);
}

.parameter-card {
  background: var(--te-glass-bg);
  border-radius: 20px;
  padding: 30px;
  border: 1px solid var(--te-glass-border);
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
}
.param-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.param-group label {
  font-size: 12px;
  font-weight: 700;
  color: var(--te-neutral-500);
}
.param-group input,
.param-group select {
  background: var(--te-card-bg);
  border: 1px solid var(--te-card-border);
  padding: 12px 16px;
  border-radius: 12px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--te-neutral-900);
  outline: none;
  width: 100%;
}
.param-group input:focus,
.param-group select:focus {
  border-color: var(--te-primary-500);
  box-shadow: 0 0 0 3px rgba(var(--te-primary-rgb), 0.1);
}

.square-card {
  background: var(--te-glass-bg);
  border-radius: 20px;
  padding: 40px;
  border: 1px solid var(--te-glass-border);
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 400px;
}
.square-card i {
  font-size: 48px;
  color: var(--te-primary-500);
  background: #fff; /* keep-white: icon circle */
  width: 100px;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  box-shadow: 0 16px 32px rgba(15, 23, 42, 0.05);
  margin-bottom: 24px;
}
.square-card h2 {
  font-size: 24px;
  font-weight: 800;
  margin-bottom: 12px;
}
.square-card p {
  color: var(--te-neutral-500);
  max-width: 400px;
  line-height: 1.6;
}
:global(html[data-te-equalizer-panel] .eq-page .opra-panel),
:global(html[data-te-equalizer-panel] .eq-page .chart-card),
:global(html[data-te-equalizer-panel] .eq-page .sliders-board),
:global(html[data-te-equalizer-panel] .eq-page .band-selector),
:global(html[data-te-equalizer-panel] .eq-page .parameter-card),
:global(html[data-te-equalizer-panel] .eq-page .square-card) {
  border-color: var(--te-equalizer-panel-border);
  border-radius: var(--te-equalizer-panel-radius);
  background: var(--te-equalizer-panel-bg);
}

:global(html[data-te-equalizer-panel='tinted'] .eq-page .opra-panel),
:global(html[data-te-equalizer-panel='tinted'] .eq-page .chart-card),
:global(html[data-te-equalizer-panel='tinted'] .eq-page .sliders-board),
:global(html[data-te-equalizer-panel='tinted'] .eq-page .band-selector),
:global(html[data-te-equalizer-panel='tinted'] .eq-page .parameter-card),
:global(html[data-te-equalizer-panel='tinted'] .eq-page .square-card) {
  background: color-mix(in srgb, var(--te-equalizer-panel-bg) 82%, var(--te-primary-500));
}

:global(html[data-te-equalizer-panel='glass'] .eq-page .opra-panel),
:global(html[data-te-equalizer-panel='glass'] .eq-page .chart-card),
:global(html[data-te-equalizer-panel='glass'] .eq-page .sliders-board),
:global(html[data-te-equalizer-panel='glass'] .eq-page .band-selector),
:global(html[data-te-equalizer-panel='glass'] .eq-page .parameter-card),
:global(html[data-te-equalizer-panel='glass'] .eq-page .square-card) {
  background: color-mix(in srgb, var(--te-equalizer-panel-bg) 68%, transparent);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
}

:global(html[data-te-equalizer-slider] .eq-page .slider-track) {
  background: var(--te-equalizer-slider-track);
}

:global(html[data-te-equalizer-slider] .eq-page .slider-fill),
:global(html[data-te-equalizer-slider] .eq-page .master-column .slider-fill) {
  background: var(--te-equalizer-slider-fill);
}

:global(html[data-te-equalizer-slider] .eq-page .slider-thumb) {
  width: var(--te-equalizer-slider-thumb-size);
  height: var(--te-equalizer-slider-thumb-size);
  background: var(--te-equalizer-slider-thumb);
}

:global(html[data-te-equalizer-slider='ring'] .eq-page .slider-thumb) {
  border: 2px solid var(--te-primary-500);
}

:global(html[data-te-equalizer-slider='solid'] .eq-page .slider-thumb) {
  border: 0;
  background: var(--te-primary-500);
}

:global(html[data-te-equalizer-panel] .eq-page .grid-line) {
  stroke: var(--te-equalizer-grid);
}

:global(html[data-te-equalizer-panel] .eq-page .grid-line.zero),
:global(html[data-te-equalizer-panel] .eq-page .frequency-guide) {
  stroke: var(--te-equalizer-guide);
}

:global(html[data-te-equalizer-spectrum] .eq-page .equalizer-spectrum-line) {
  stroke: var(--te-equalizer-spectrum);
}

:global(html[data-te-equalizer-spectrum] .eq-page .equalizer-spectrum-area) {
  fill: color-mix(in srgb, var(--te-equalizer-spectrum) 28%, transparent);
}

:global(html[data-te-equalizer-spectrum='line'] .eq-page .equalizer-spectrum-area),
:global(html[data-te-equalizer-spectrum='bars'] .eq-page .equalizer-spectrum-area) {
  display: none;
}

:global(html[data-te-equalizer-spectrum='bars'] .eq-page .equalizer-spectrum-line) {
  stroke-width: 8px;
  stroke-dasharray: 1.5 5;
  stroke-linecap: butt;
}

:global(html[data-te-equalizer-spectrum='area'] .eq-page .equalizer-spectrum-line) {
  stroke-width: 2px;
}

:global(html[data-te-equalizer-button] .eq-page .eq-command),
:global(html[data-te-equalizer-button] .eq-page .band-tab),
:global(html[data-te-equalizer-button] .eq-page .opra-action-btn),
:global(html[data-te-equalizer-button] .eq-page .result-apply) {
  border-radius: var(--te-equalizer-button-radius);
}

:global(html[data-te-equalizer-button='soft'] .eq-page .eq-command),
:global(html[data-te-equalizer-button='soft'] .eq-page .band-tab) {
  border-color: transparent;
  background: var(--te-equalizer-button-bg);
}

:global(html[data-te-equalizer-button='outline'] .eq-page .eq-command),
:global(html[data-te-equalizer-button='outline'] .eq-page .band-tab) {
  border-color: var(--te-equalizer-panel-border);
  background: transparent;
}

:global(html[data-te-equalizer-button='solid'] .eq-page .eq-command),
:global(html[data-te-equalizer-button='solid'] .eq-page .band-tab) {
  border-color: var(--te-primary-500);
  background: var(--te-primary-500);
  color: var(--te-neutral-50);
}

:global(html[data-te-equalizer-knob] .eq-page .toggle-thumb) {
  width: var(--te-equalizer-knob-size);
  height: var(--te-equalizer-knob-size);
}

:global(html[data-te-equalizer-knob] .eq-page .toggle-thumb::after) {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  background: var(--te-primary-500);
  transform: translate(-50%, -50%);
}

:global(html[data-te-equalizer-knob='line'] .eq-page .toggle-thumb::after) {
  width: 8px;
  height: 2px;
  border-radius: 1px;
}

:global(html[data-te-equalizer-knob='dot'] .eq-page .toggle-thumb::after) {
  width: 4px;
  height: 4px;
  border-radius: 50%;
}

:global(html[data-te-visible-equalizer-grid='false'] .eq-page .grid-line),
:global(html[data-te-visible-equalizer-frequency-guides='false'] .eq-page .chart-labels-x),
:global(html[data-te-visible-equalizer-frequency-guides='false'] .eq-page .chart-labels-y),
:global(html[data-te-visible-equalizer-frequency-guides='false'] .eq-page .frequency-guide),
:global(html[data-te-visible-equalizer-spectrum='false'] .eq-page .equalizer-spectrum-line),
:global(html[data-te-visible-equalizer-spectrum='false'] .eq-page .equalizer-spectrum-area),
:global(html[data-te-visible-equalizer-spectrum='false'] .eq-page .equalizer-band-line),
:global(html[data-te-visible-equalizer-spectrum='false'] .eq-page .chart-point) {
  display: none;
}

:global(html[data-te-equalizer-spectrum] .eq-page .equalizer-band-line) {
  stroke: var(--te-equalizer-spectrum);
}
</style>
