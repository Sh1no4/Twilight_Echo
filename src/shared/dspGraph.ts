export const DSP_GRAPH_VERSION = 2

export type DspChannelLayout = 'mono' | 'stereo' | '5.1' | '7.1'

export type DspNodeType =
  | 'replayGain'
  | 'equalizer'
  | 'dynamicEqualizer'
  | 'convolver'
  | 'crossfeed'
  | 'channelMatrix'
  | 'channelStrip'
  | 'bassManagement'
  | 'gate'
  | 'compressor'
  | 'multibandCompressor'
  | 'stereoField'
  | 'loudnessContour'
  | 'truePeakLimiter'
  | 'nativePlugin'
  | 'vst3Plugin'
  | 'meter'

export type DspResamplerQuality = 'native' | 'high' | 'ultra'
export type DspDitherMode = 'off' | 'tpdf' | 'highpassTpdf' | 'noiseShaped'

export interface DspOutputStageConfig {
  targetSampleRate: 'device' | number
  resamplerQuality: DspResamplerQuality
  dither: DspDitherMode
  /** Applied only to PCM graphs; it never enables PCM fallback by itself. */
  safetyClamp: boolean
}

export const DEFAULT_DSP_OUTPUT_STAGE: DspOutputStageConfig = {
  targetSampleRate: 'device',
  resamplerQuality: 'native',
  dither: 'off',
  safetyClamp: true
}

export interface Vst3PluginReference {
  catalogId: string
  classId: string
  stateAssetId?: string
}

export interface DspGraphNode {
  id: string
  type: DspNodeType
  enabled: boolean
  params: Record<string, unknown>
  pluginId?: string
  pluginAbiVersion?: 1 | 2
  vst3?: Vst3PluginReference
}

export interface DspGraphConfig {
  version: number
  nodes: DspGraphNode[]
  outputStage: DspOutputStageConfig
}

export interface DspSceneRule {
  deviceIds?: string[]
  backends?: string[]
  channelLayouts?: DspChannelLayout[]
  sourceKinds?: Array<'pcm' | 'dsd'>
  minSampleRate?: number
  maxSampleRate?: number
}

export interface DspScene {
  id: string
  name: string
  enabled: boolean
  priority: number
  rules: DspSceneRule
  graph: DspGraphConfig
  allowDsdPcmFallback?: boolean
}

export const DSP_FACTORY_SCENE_TEMPLATES = [
  { id: 'transparent', name: 'Transparent Playback' },
  { id: 'headphoneCrossfeed', name: 'Headphone Crossfeed' },
  { id: 'headphoneCorrection', name: 'Headphone Correction' },
  { id: 'roomCorrection', name: 'Room Correction' },
  { id: 'speakerCalibration51', name: '5.1 Speaker Calibration' },
  { id: 'speakerCalibration71', name: '7.1 Speaker Calibration' }
] as const

export type DspFactorySceneTemplateId = (typeof DSP_FACTORY_SCENE_TEMPLATES)[number]['id']

export interface DspSceneContext {
  deviceId: string
  backend: string
  channelLayout: DspChannelLayout
  sourceKind: 'pcm' | 'dsd'
  sampleRate: number
}

export interface DspSceneResolution {
  scene: DspScene | null
  graph: DspGraphConfig
  reason: string
  requiresPcmFallback: boolean
  pinned: boolean
}

export interface DspGraphNodeStatus {
  id: string
  type: DspNodeType
  enabled: boolean
  active: boolean
  bypassed: boolean
  bypassReason: string
  latencyFrames: number
  tailFrames: number
  processCalls: number
  lastProcessMs: number
  maxProcessMs: number
  averageProcessMs?: number
  overrunCount?: number
  clipCount?: number
  format?: string
}

export interface DspMeterSnapshot {
  momentaryLufs: number | null
  shortTermLufs: number | null
  integratedLufs: number | null
  loudnessRangeLu: number | null
  truePeakDb: number | null
  correlation: number | null
  clipCount: number
  updatedAt: number
}

export interface DspOutputStageStatus {
  targetSampleRate: number | null
  actualSampleRate: number | null
  resamplerQuality: DspResamplerQuality
  dither: DspDitherMode
  active: boolean
  reason: string
}

export interface DspGraphStatus {
  revision: number
  activeSceneId: string | null
  totalLatencyFrames: number
  totalTailFrames: number
  nodes: DspGraphNodeStatus[]
  compileState?: 'ready' | 'compiling' | 'failed' | 'bypassed'
  compileError?: string
  meter?: DspMeterSnapshot
  outputStage?: DspOutputStageStatus
}

export type DspAssetKind = 'impulseResponse' | 'correctionProfile' | 'vst3Preset' | 'vst3State'

export interface DspAsset {
  id: string
  kind: DspAssetKind
  name: string
  fileName: string
  sha256: string
  byteSize: number
  mediaType: string
  createdAt: string
  sourceSampleRate?: number
  sourceChannels?: number
  referenceCount: number
}

export type DspCorrectionFormat = 'equalizerApo' | 'rew' | 'autoeq'

export type DspCorrectionFilterType =
  | 'peak'
  | 'lowShelf'
  | 'highShelf'
  | 'bandPass'
  | 'lowPass'
  | 'highPass'
  | 'allPass'
  | 'notch'

/** A validated parametric EQ profile imported from a text-based correction tool. */
export interface DspCorrectionBand {
  frequency: number
  gain: number
  q: number
  filterType: DspCorrectionFilterType
  enabled: boolean
  channelMask: number
}

export interface DspCorrectionProfile {
  format: DspCorrectionFormat
  preampDb: number
  bands: DspCorrectionBand[]
}

export interface DspCorrectionImportResult {
  asset: DspAsset
  profile: DspCorrectionProfile
}

export interface DspProfile {
  schemaVersion: 1
  id: string
  name: string
  createdAt: string
  updatedAt: string
  scenes: DspScene[]
  pinnedSceneId: string | null
  assetIds: string[]
}

export type Vst3CatalogStatus = 'available' | 'incompatible' | 'quarantined' | 'failed'

export interface Vst3ParameterDescriptor {
  id: number
  title: string
  unit: string
  defaultNormalizedValue: number
  stepCount: number
  flags: number
}

export interface Vst3ScanDescriptor {
  classId: string
  name: string
  vendor: string
  version: string
  category?: string
  supportedLayouts?: DspChannelLayout[]
  parameters?: Vst3ParameterDescriptor[]
}

export interface Vst3CatalogEntry {
  id: string
  modulePath: string
  moduleFingerprint: string
  classId: string
  name: string
  vendor: string
  version: string
  category: string
  supportedLayouts: DspChannelLayout[]
  parameters: Vst3ParameterDescriptor[]
  status: Vst3CatalogStatus
  error: string | null
  scannedAt: string
  quarantinedAt?: string
}

export interface Vst3CatalogState {
  enabled: boolean
  searchPaths: string[]
  entries: Vst3CatalogEntry[]
}

export interface DspSceneState {
  scenes: DspScene[]
  pinnedSceneId: string | null
  activeSceneId: string | null
  graph: DspGraphConfig
  requiresPcmFallback: boolean
  dsdPcmFallbackApplied: boolean
}

export interface LegacyDspSettings {
  dspEnabled?: boolean
  eqEnabled?: boolean
  eqMode?: string
  eqPreamp?: number
  eqBands?: unknown[]
  volumeNormalization?: string
  replayGainPreamp?: number
  replayGainFallback?: number
  replayGainClip?: boolean
  convolverEnabled?: boolean
  convolverIrPath?: string
  crossfeedEnabled?: boolean
  crossfeedStrength?: number
  crossfeedDelayMs?: number
  crossfeedCutoffHz?: number
}

const BUILT_IN_NODE_TYPES = new Set<DspNodeType>([
  'replayGain',
  'equalizer',
  'dynamicEqualizer',
  'convolver',
  'crossfeed',
  'channelMatrix',
  'channelStrip',
  'bassManagement',
  'gate',
  'compressor',
  'multibandCompressor',
  'stereoField',
  'loudnessContour',
  'truePeakLimiter',
  'nativePlugin',
  'vst3Plugin',
  'meter'
])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  return items.length > 0 ? [...new Set(items)] : undefined
}

function normalizeLayout(value: unknown): DspChannelLayout | null {
  return value === 'mono' || value === 'stereo' || value === '5.1' || value === '7.1' ? value : null
}

function normalizeVst3Reference(value: unknown): Vst3PluginReference | undefined {
  const raw = asRecord(value)
  const catalogId = typeof raw.catalogId === 'string' ? raw.catalogId.trim() : ''
  const classId = typeof raw.classId === 'string' ? raw.classId.trim() : ''
  if (!catalogId || !classId) return undefined
  const stateAssetId =
    typeof raw.stateAssetId === 'string' && raw.stateAssetId.trim()
      ? raw.stateAssetId.trim()
      : undefined
  return { catalogId, classId, ...(stateAssetId ? { stateAssetId } : {}) }
}

export function normalizeDspOutputStage(value: unknown): DspOutputStageConfig {
  const raw = asRecord(value)
  const targetSampleRate =
    raw.targetSampleRate === 'device'
      ? 'device'
      : typeof raw.targetSampleRate === 'number' && Number.isFinite(raw.targetSampleRate)
        ? Math.max(8000, Math.min(768000, Math.trunc(raw.targetSampleRate)))
        : DEFAULT_DSP_OUTPUT_STAGE.targetSampleRate
  const resamplerQuality =
    raw.resamplerQuality === 'high' || raw.resamplerQuality === 'ultra'
      ? raw.resamplerQuality
      : 'native'
  const dither =
    raw.dither === 'tpdf' || raw.dither === 'highpassTpdf' || raw.dither === 'noiseShaped'
      ? raw.dither
      : 'off'
  return {
    targetSampleRate,
    resamplerQuality,
    dither,
    safetyClamp: raw.safetyClamp !== false
  }
}

function normalizeNode(value: unknown, index: number): DspGraphNode | null {
  const raw = asRecord(value)
  const type = raw.type
  if (typeof type !== 'string' || !BUILT_IN_NODE_TYPES.has(type as DspNodeType)) return null
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `${type}-${index + 1}`
  const params = asRecord(raw.params)
  const pluginId =
    typeof raw.pluginId === 'string' && raw.pluginId.trim() ? raw.pluginId.trim() : undefined
  const pluginAbiVersion =
    raw.pluginAbiVersion === 1 || raw.pluginAbiVersion === 2 ? raw.pluginAbiVersion : undefined
  const vst3 = normalizeVst3Reference(raw.vst3)
  return {
    id,
    type: type as DspNodeType,
    enabled: raw.enabled !== false,
    params,
    ...(pluginId ? { pluginId } : {}),
    ...(pluginAbiVersion ? { pluginAbiVersion } : {}),
    ...(vst3 ? { vst3 } : {})
  }
}

export function normalizeDspGraph(value: unknown): DspGraphConfig {
  const raw = asRecord(value)
  const nodes = Array.isArray(raw.nodes)
    ? raw.nodes
        .map((node, index) => normalizeNode(node, index))
        .filter((node): node is DspGraphNode => !!node)
    : []
  const seen = new Set<string>()
  const uniqueNodes = nodes.filter((node) => {
    if (seen.has(node.id)) return false
    seen.add(node.id)
    return true
  })
  return {
    version: DSP_GRAPH_VERSION,
    nodes: uniqueNodes,
    outputStage: normalizeDspOutputStage(raw.outputStage)
  }
}

export function createLegacyDspGraph(settings: LegacyDspSettings = {}): DspGraphConfig {
  const dspEnabled = settings.dspEnabled === true
  return {
    version: DSP_GRAPH_VERSION,
    outputStage: { ...DEFAULT_DSP_OUTPUT_STAGE },
    nodes: [
      {
        id: 'replay-gain',
        type: 'replayGain',
        enabled:
          dspEnabled &&
          settings.volumeNormalization !== undefined &&
          settings.volumeNormalization !== 'off',
        params: {
          mode: settings.volumeNormalization ?? 'off',
          preampDb: settings.replayGainPreamp ?? 0,
          fallbackDb: settings.replayGainFallback ?? 0,
          clip: settings.replayGainClip !== false
        }
      },
      {
        id: 'equalizer',
        type: 'equalizer',
        enabled: dspEnabled && settings.eqEnabled === true,
        params: {
          mode: settings.eqMode ?? 'graphic',
          preampDb: settings.eqPreamp ?? 0,
          bands: Array.isArray(settings.eqBands) ? settings.eqBands : []
        }
      },
      {
        id: 'convolver',
        type: 'convolver',
        enabled: dspEnabled && settings.convolverEnabled === true && !!settings.convolverIrPath,
        params: { impulseResponsePath: settings.convolverIrPath ?? '', wet: 1, dry: 0 }
      },
      {
        id: 'crossfeed',
        type: 'crossfeed',
        enabled:
          dspEnabled && settings.crossfeedEnabled === true && (settings.crossfeedStrength ?? 0) > 0,
        params: {
          algorithm: 'custom',
          strength: settings.crossfeedStrength ?? 0,
          delayMs: settings.crossfeedDelayMs ?? 0.35,
          cutoffHz: settings.crossfeedCutoffHz ?? 700
        }
      },
      { id: 'channel-strip', type: 'channelStrip', enabled: false, params: { channels: [] } },
      { id: 'bass-management', type: 'bassManagement', enabled: false, params: {} },
      { id: 'gate', type: 'gate', enabled: false, params: {} },
      { id: 'compressor', type: 'compressor', enabled: false, params: {} },
      { id: 'dynamic-equalizer', type: 'dynamicEqualizer', enabled: false, params: { bands: [] } },
      {
        id: 'multiband-compressor',
        type: 'multibandCompressor',
        enabled: false,
        params: { bands: [] }
      },
      { id: 'stereo-field', type: 'stereoField', enabled: false, params: {} },
      { id: 'loudness-contour', type: 'loudnessContour', enabled: false, params: {} },
      {
        id: 'true-peak-limiter',
        type: 'truePeakLimiter',
        enabled: false,
        params: { ceilingDb: -0.1 }
      },
      { id: 'meter', type: 'meter', enabled: true, params: {} }
    ]
  }
}

export function createDspFactoryScene(
  templateId: DspFactorySceneTemplateId,
  id = `factory-${templateId}`
): DspScene {
  const meter: DspGraphNode = { id: 'meter', type: 'meter', enabled: true, params: {} }
  const scene: DspScene = {
    id,
    name:
      DSP_FACTORY_SCENE_TEMPLATES.find((template) => template.id === templateId)?.name ??
      'DSP Scene',
    enabled: true,
    priority: 0,
    rules: { sourceKinds: ['pcm'] },
    graph: {
      version: DSP_GRAPH_VERSION,
      outputStage: { ...DEFAULT_DSP_OUTPUT_STAGE },
      nodes: [meter]
    }
  }

  switch (templateId) {
    case 'transparent':
      scene.rules = {}
      break
    case 'headphoneCrossfeed':
      scene.priority = 20
      scene.rules.channelLayouts = ['stereo']
      scene.graph.nodes = [
        {
          id: 'crossfeed',
          type: 'crossfeed',
          enabled: true,
          params: { algorithm: 'bauer', strength: 0.35, delayMs: 0.35, cutoffHz: 700 }
        },
        meter
      ]
      break
    case 'headphoneCorrection':
      scene.priority = 30
      scene.rules.channelLayouts = ['stereo']
      scene.graph.nodes = [
        {
          id: 'equalizer',
          type: 'equalizer',
          enabled: false,
          params: { mode: 'parametric', preampDb: 0, bands: [] }
        },
        meter
      ]
      break
    case 'roomCorrection':
      scene.priority = 30
      scene.rules.channelLayouts = ['stereo']
      scene.graph.nodes = [
        {
          id: 'convolver',
          type: 'convolver',
          enabled: false,
          params: {
            impulseResponseAssetId: '',
            impulseResponsePath: '',
            wet: 1,
            dry: 0,
            gainDb: 0,
            routingMode: 'diagonal',
            layout: 'stereo',
            matrix: []
          }
        },
        meter
      ]
      break
    case 'speakerCalibration51':
      scene.priority = 40
      scene.rules.channelLayouts = ['5.1']
      scene.graph.nodes = [
        createSpeakerCalibrationNode('5.1'),
        {
          id: 'bass-management',
          type: 'bassManagement',
          enabled: false,
          params: { crossoverHz: 80, lfeGainDb: 0 }
        },
        meter
      ]
      break
    case 'speakerCalibration71':
      scene.priority = 40
      scene.rules.channelLayouts = ['7.1']
      scene.graph.nodes = [
        createSpeakerCalibrationNode('7.1'),
        {
          id: 'bass-management',
          type: 'bassManagement',
          enabled: false,
          params: { crossoverHz: 80, lfeGainDb: 0 }
        },
        meter
      ]
      break
  }

  return scene
}

function createSpeakerCalibrationNode(layout: '5.1' | '7.1'): DspGraphNode {
  const channelCount = layout === '5.1' ? 6 : 8
  return {
    id: 'channel-strip',
    type: 'channelStrip',
    // Keep the identity calibration inactive until the listener enters the
    // measured gains/delays and explicitly enables it.
    enabled: false,
    params: {
      layout,
      channels: Array.from({ length: channelCount }, () => ({
        gainDb: 0,
        delayMs: 0,
        polarityInverted: false,
        muted: false
      }))
    }
  }
}

export function graphHasEnabledProcessing(graph: DspGraphConfig): boolean {
  const outputStage = normalizeDspOutputStage(graph.outputStage)
  return (
    graph.nodes.some((node) => node.enabled && node.type !== 'meter') ||
    outputStage.targetSampleRate !== 'device' ||
    outputStage.resamplerQuality !== 'native' ||
    outputStage.dither !== 'off'
  )
}

export function normalizeDspSceneRule(value: unknown): DspSceneRule {
  const raw = asRecord(value)
  const channelLayouts = Array.isArray(raw.channelLayouts)
    ? raw.channelLayouts.map(normalizeLayout).filter((item): item is DspChannelLayout => !!item)
    : undefined
  const sourceKinds = Array.isArray(raw.sourceKinds)
    ? raw.sourceKinds.filter((item): item is 'pcm' | 'dsd' => item === 'pcm' || item === 'dsd')
    : undefined
  const minSampleRate =
    typeof raw.minSampleRate === 'number' && Number.isFinite(raw.minSampleRate)
      ? Math.max(0, Math.trunc(raw.minSampleRate))
      : undefined
  const maxSampleRate =
    typeof raw.maxSampleRate === 'number' && Number.isFinite(raw.maxSampleRate)
      ? Math.max(0, Math.trunc(raw.maxSampleRate))
      : undefined
  return {
    ...(asStringArray(raw.deviceIds) ? { deviceIds: asStringArray(raw.deviceIds) } : {}),
    ...(asStringArray(raw.backends) ? { backends: asStringArray(raw.backends) } : {}),
    ...(channelLayouts && channelLayouts.length > 0
      ? { channelLayouts: [...new Set(channelLayouts)] }
      : {}),
    ...(sourceKinds && sourceKinds.length > 0 ? { sourceKinds: [...new Set(sourceKinds)] } : {}),
    ...(minSampleRate !== undefined ? { minSampleRate } : {}),
    ...(maxSampleRate !== undefined
      ? { maxSampleRate: Math.max(minSampleRate ?? 0, maxSampleRate) }
      : {})
  }
}

export function normalizeDspScenes(value: unknown, legacy: LegacyDspSettings = {}): DspScene[] {
  const rawScenes = Array.isArray(value) ? value : []
  const scenes: DspScene[] = []
  const seen = new Set<string>()
  for (let index = 0; index < rawScenes.length; index += 1) {
    const raw = asRecord(rawScenes[index])
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `scene-${index + 1}`
    if (seen.has(id)) continue
    seen.add(id)
    scenes.push({
      id,
      name:
        typeof raw.name === 'string' && raw.name.trim()
          ? raw.name.trim()
          : `DSP Scene ${index + 1}`,
      enabled: raw.enabled !== false,
      priority:
        typeof raw.priority === 'number' && Number.isFinite(raw.priority)
          ? Math.trunc(raw.priority)
          : 0,
      rules: normalizeDspSceneRule(raw.rules),
      graph: normalizeDspGraph(raw.graph),
      ...(raw.allowDsdPcmFallback === true ? { allowDsdPcmFallback: true } : {})
    })
  }
  if (scenes.length > 0) return scenes
  return [
    {
      id: 'default',
      name: 'Default',
      enabled: true,
      priority: 0,
      rules: {},
      graph: createLegacyDspGraph(legacy)
    }
  ]
}

function matchesSceneRule(rule: DspSceneRule, context: DspSceneContext): boolean {
  if (rule.deviceIds && !rule.deviceIds.includes(context.deviceId)) return false
  if (rule.backends && !rule.backends.includes(context.backend)) return false
  if (rule.channelLayouts && !rule.channelLayouts.includes(context.channelLayout)) return false
  if (rule.sourceKinds && !rule.sourceKinds.includes(context.sourceKind)) return false
  if (rule.minSampleRate !== undefined && context.sampleRate < rule.minSampleRate) return false
  if (rule.maxSampleRate !== undefined && context.sampleRate > rule.maxSampleRate) return false
  return true
}

function sceneSpecificity(rule: DspSceneRule): number {
  return (
    (rule.deviceIds?.length ? 1 : 0) +
    (rule.backends?.length ? 1 : 0) +
    (rule.channelLayouts?.length ? 1 : 0) +
    (rule.sourceKinds?.length ? 1 : 0) +
    (rule.minSampleRate !== undefined || rule.maxSampleRate !== undefined ? 1 : 0)
  )
}

export function resolveDspScene(
  scenes: DspScene[],
  context: DspSceneContext,
  pinnedSceneId?: string | null
): DspSceneResolution {
  const pinned = pinnedSceneId
    ? scenes.find((scene) => scene.id === pinnedSceneId && scene.enabled)
    : undefined
  const candidates = pinned
    ? [pinned]
    : scenes
        .map((scene, index) => ({ scene, index }))
        .filter(({ scene }) => scene.enabled && matchesSceneRule(scene.rules, context))
        .sort(
          (left, right) =>
            right.scene.priority - left.scene.priority ||
            sceneSpecificity(right.scene.rules) - sceneSpecificity(left.scene.rules) ||
            left.index - right.index
        )
        .map(({ scene }) => scene)
  const scene = candidates[0] ?? null
  const graph = scene?.graph ?? createLegacyDspGraph()
  const requiresPcmFallback = context.sourceKind === 'dsd' && graphHasEnabledProcessing(graph)
  return {
    scene,
    graph,
    reason: scene ? (pinned ? 'manual-pin' : 'rule-match') : 'no-matching-scene',
    requiresPcmFallback,
    pinned: !!pinned
  }
}
