<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  createDspFactoryScene,
  DSP_FACTORY_SCENE_TEMPLATES,
  type DspFactorySceneTemplateId
} from '../../../shared/dspGraph.ts'
import type {
  DspAsset,
  DspAssetKind,
  DspChannelLayout,
  DspCorrectionProfile,
  DspGraphNode,
  DspGraphStatus,
  DspNodeType,
  DspResamplerQuality,
  DspScene,
  DspSceneState,
  Vst3CatalogState
} from '../../../shared/dspGraph.ts'
import {
  channelMatrixPresetMatrix,
  channelMatrixPresetsForLayout
} from '@renderer/utils/channelMatrixPresets'

const emit = defineEmits<{ back: [] }>()

const nodeCatalog: Array<{
  type: DspNodeType
  label: string
  icon: string
  params: Record<string, unknown>
}> = [
  {
    type: 'replayGain',
    label: 'ReplayGain',
    icon: 'pi pi-volume-up',
    params: { mode: 'track', preampDb: 0, fallbackDb: 0, clip: true }
  },
  {
    type: 'equalizer',
    label: '参数均衡器',
    icon: 'pi pi-sliders-h',
    params: { mode: 'parametric', preampDb: 0, bands: [] }
  },
  { type: 'dynamicEqualizer', label: 'Dynamic EQ', icon: 'pi pi-sliders-h', params: { bands: [] } },
  {
    type: 'convolver',
    label: '卷积',
    icon: 'pi pi-wave-pulse',
    params: { impulseResponsePath: '', wet: 1, dry: 0 }
  },
  {
    type: 'crossfeed',
    label: 'Crossfeed',
    icon: 'pi pi-headphones',
    params: { algorithm: 'custom', strength: 0.35, delayMs: 0.35, cutoffHz: 700 }
  },
  {
    type: 'channelMatrix',
    label: '声道矩阵',
    icon: 'pi pi-share-alt',
    params: { layout: 'stereo', matrix: [] }
  },
  {
    type: 'channelStrip',
    label: 'Channel Strip',
    icon: 'pi pi-sliders-v',
    params: { channels: [] }
  },
  {
    type: 'bassManagement',
    label: '低频管理',
    icon: 'pi pi-filter',
    params: { crossoverHz: 80, lfeGainDb: 0 }
  },
  {
    type: 'gate',
    label: 'Gate',
    icon: 'pi pi-minus-circle',
    params: { thresholdDb: -60, attackMs: 2, releaseMs: 120 }
  },
  {
    type: 'compressor',
    label: 'Compressor',
    icon: 'pi pi-chart-line',
    params: { thresholdDb: -18, ratio: 2, attackMs: 15, releaseMs: 180, makeupDb: 0 }
  },
  {
    type: 'multibandCompressor',
    label: 'Multiband Compressor',
    icon: 'pi pi-chart-line',
    params: {
      crossoversHz: [240],
      bands: [
        { thresholdDb: -18, ratio: 2, attackMs: 15, releaseMs: 180, makeupDb: 0, enabled: true },
        { thresholdDb: -18, ratio: 2, attackMs: 15, releaseMs: 180, makeupDb: 0, enabled: true }
      ]
    }
  },
  {
    type: 'stereoField',
    label: 'Stereo Field',
    icon: 'pi pi-arrows-h',
    params: { width: 1, balance: 0, midGainDb: 0, sideGainDb: 0 }
  },
  {
    type: 'loudnessContour',
    label: 'Loudness Contour',
    icon: 'pi pi-volume-down',
    params: { amount: 0, referenceVolume: 0.75 }
  },
  {
    type: 'truePeakLimiter',
    label: 'True-Peak Limiter',
    icon: 'pi pi-shield',
    params: { ceilingDb: -0.1, attackMs: 0.2, releaseMs: 80, lookaheadMs: 1 }
  },
  { type: 'meter', label: 'R128 Meter', icon: 'pi pi-chart-bar', params: {} },
  { type: 'nativePlugin', label: 'Native DSP v2', icon: 'pi pi-box', params: {} },
  { type: 'vst3Plugin', label: 'VST3 Effect', icon: 'pi pi-box', params: {} }
]

const channelLayouts: DspChannelLayout[] = ['mono', 'stereo', '5.1', '7.1']
const channelLabels: Record<DspChannelLayout, string[]> = {
  mono: ['M'],
  stereo: ['L', 'R'],
  '5.1': ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'],
  '7.1': ['L', 'R', 'C', 'LFE', 'Ls', 'Rs', 'Lrs', 'Rrs']
}
const defaultMultibandCrossovers = [240, 1800, 6000]
type ConvolverRoutingMode = 'diagonal' | 'monoToMany' | 'matrix'
const singletonNodeTypes = new Set<DspNodeType>([
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
  'meter'
])

const state = ref<DspSceneState | null>(null)
const status = ref<DspGraphStatus | null>(null)
const selectedSceneId = ref<string | null>(null)
const selectedNodeId = ref<string | null>(null)
const draggedNodeId = ref<string | null>(null)
const nodeTypeToAdd = ref<DspNodeType>('compressor')
const factoryTemplateToAdd = ref<DspFactorySceneTemplateId>('transparent')
const snapshotA = ref<DspScene[] | null>(null)
const busy = ref(false)
const message = ref('')
const assets = ref<DspAsset[]>([])
const vst3Catalog = ref<Vst3CatalogState | null>(null)

const scenes = computed(() => state.value?.scenes ?? [])
const selectedScene = computed(
  () => scenes.value.find((scene) => scene.id === selectedSceneId.value) ?? scenes.value[0] ?? null
)
const selectedNode = computed(
  () => selectedScene.value?.graph.nodes.find((node) => node.id === selectedNodeId.value) ?? null
)
const selectedStatus = computed(
  () => status.value?.nodes.find((node) => node.id === selectedNodeId.value) ?? null
)
const selectedVst3Entry = computed(() => {
  const catalogId = selectedNode.value?.vst3?.catalogId
  return catalogId
    ? (vst3Catalog.value?.entries.find((entry) => entry.id === catalogId) ?? null)
    : null
})
const vst3Helpers = computed(() => vst3Catalog.value?.helpers ?? null)
const vst3HelpersReady = computed(() => {
  if (typeof navigator !== 'undefined' && !/win/i.test(navigator.platform)) return false
  if (!vst3Helpers.value) return true
  return (
    vst3Helpers.value.platformSupported &&
    vst3Helpers.value.scannerPresent &&
    vst3Helpers.value.hostPresent
  )
})
const vst3HelpersNotice = computed(() => {
  if (typeof navigator !== 'undefined' && !/win/i.test(navigator.platform)) {
    return 'VST3 仅在 Windows x64 构建中提供。'
  }
  if (!vst3Helpers.value) return ''
  if (!vst3Helpers.value.platformSupported) return 'VST3 仅在 Windows x64 构建中提供。'
  if (!vst3Helpers.value.scannerPresent || !vst3Helpers.value.hostPresent) {
    return '本构建未包含 VST3 扫描/宿主组件。开发环境请执行 pnpm run stage:vst3-msvc，或安装完整 Windows 签名包。'
  }
  return ''
})
const visibleVst3Parameters = computed(() =>
  (selectedVst3Entry.value?.parameters ?? []).filter((parameter) => (parameter.flags & 16) === 0)
)
const vst3StateAssets = computed(() =>
  assets.value.filter((asset) => asset.kind === 'vst3Preset' || asset.kind === 'vst3State')
)
const activeSceneId = computed(() => state.value?.activeSceneId ?? null)
const isPinned = computed(() => state.value?.pinnedSceneId === selectedScene.value?.id)
const activeGraphLatency = computed(() => status.value?.totalLatencyFrames ?? 0)
const activeGraphTail = computed(() => status.value?.totalTailFrames ?? 0)
const graphApplyState = computed(() => status.value?.applyState ?? 'idle')
const graphApplyLabel = computed(() => {
  if (graphApplyState.value === 'pending') return 'Pending'
  if (graphApplyState.value === 'applied') return 'Applied'
  if (graphApplyState.value === 'failed') return 'Failed'
  return 'Idle'
})
const graphOverrunCount = computed(
  () => status.value?.nodes.reduce((total, node) => total + (node.overrunCount ?? 0), 0) ?? 0
)
let diagnosticsPoll: number | null = null

function formatMetric(value: number | null | undefined, digits = 1, unit = ''): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(digits)}${unit}`
    : '-'
}

function cloneNodeParams(params: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(params)) as Record<string, unknown>
}

function cloneScene(scene: DspScene, id = scene.id, name = scene.name): DspScene {
  return {
    ...scene,
    id,
    name,
    rules: { ...scene.rules },
    graph: {
      ...scene.graph,
      outputStage: { ...scene.graph.outputStage },
      nodes: scene.graph.nodes.map((node) => ({ ...node, params: cloneNodeParams(node.params) }))
    }
  }
}

function nodeLabel(type: DspNodeType): string {
  return nodeCatalog.find((item) => item.type === type)?.label ?? type
}

function selectScene(id: string): void {
  selectedSceneId.value = id
  selectedScene.value?.graph.nodes.forEach(normalizeNodeEditorParams)
  selectedNodeId.value = selectedScene.value?.graph.nodes[0]?.id ?? null
}

function selectNode(id: string): void {
  selectedNodeId.value = id
  if (selectedNode.value) normalizeNodeEditorParams(selectedNode.value)
}

function addScene(): void {
  const base = selectedScene.value ?? scenes.value[0]
  if (!base || !state.value) return
  const suffix = state.value.scenes.length + 1
  const next = cloneScene(base, `scene-${Date.now()}`, `New DSP Scene ${suffix}`)
  next.rules = {}
  state.value.scenes.push(next)
  selectScene(next.id)
  message.value = '新场景已加入，保存后生效。'
}

function addFactoryScene(): void {
  if (!state.value) return
  const template = createDspFactoryScene(
    factoryTemplateToAdd.value,
    `factory-${factoryTemplateToAdd.value}-${Date.now()}`
  )
  state.value.scenes.push(template)
  selectScene(template.id)
  message.value = `${template.name} 模板已加入；填写资料或校准值后保存并应用。`
}

function duplicateScene(): void {
  if (!selectedScene.value || !state.value) return
  const next = cloneScene(
    selectedScene.value,
    `${selectedScene.value.id}-copy-${Date.now()}`,
    `${selectedScene.value.name} Copy`
  )
  state.value.scenes.push(next)
  selectScene(next.id)
  message.value = '场景副本已创建。'
}

function removeScene(): void {
  if (!state.value || !selectedScene.value || state.value.scenes.length <= 1) return
  const index = state.value.scenes.findIndex((scene) => scene.id === selectedScene.value?.id)
  state.value.scenes.splice(index, 1)
  if (state.value.pinnedSceneId === selectedScene.value.id) state.value.pinnedSceneId = null
  selectScene(state.value.scenes[Math.max(0, index - 1)].id)
}

function addNode(): void {
  const scene = selectedScene.value
  const item = nodeCatalog.find((entry) => entry.type === nodeTypeToAdd.value)
  if (!scene || !item) return
  const existing = singletonNodeTypes.has(item.type)
    ? scene.graph.nodes.find((node) => node.type === item.type)
    : undefined
  if (existing) {
    selectedNodeId.value = existing.id
    message.value = `当前串行图已包含 ${item.label} 节点。`
    return
  }
  const node: DspGraphNode = {
    id: `${item.type}-${Date.now()}`,
    type: item.type,
    enabled: item.type === 'meter',
    params: { ...item.params }
  }
  scene.graph.nodes.push(node)
  normalizeNodeEditorParams(node)
  selectedNodeId.value = node.id
}

function removeNode(id: string): void {
  const scene = selectedScene.value
  if (!scene) return
  const index = scene.graph.nodes.findIndex((node) => node.id === id)
  if (index < 0) return
  scene.graph.nodes.splice(index, 1)
  selectedNodeId.value = scene.graph.nodes[Math.max(0, index - 1)]?.id ?? null
}

function moveNode(id: string, destinationId: string): void {
  const nodes = selectedScene.value?.graph.nodes
  if (!nodes || id === destinationId) return
  const from = nodes.findIndex((node) => node.id === id)
  const to = nodes.findIndex((node) => node.id === destinationId)
  if (from < 0 || to < 0) return
  const [node] = nodes.splice(from, 1)
  nodes.splice(to, 0, node)
}

function onDrop(destinationId: string): void {
  if (draggedNodeId.value) moveNode(draggedNodeId.value, destinationId)
  draggedNodeId.value = null
}

function numberParam(node: DspGraphNode, key: string, fallback: number): number {
  const value = node.params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringParam(node: DspGraphNode, key: string, fallback = ''): string {
  const value = node.params[key]
  return typeof value === 'string' ? value : fallback
}

function booleanParam(node: DspGraphNode, key: string, fallback = false): boolean {
  const value = node.params[key]
  return typeof value === 'boolean' ? value : fallback
}

function setNumberParam(node: DspGraphNode, key: string, value: string | number): void {
  const number = typeof value === 'number' ? value : Number(value)
  if (Number.isFinite(number)) node.params[key] = number
}

function setStringParam(node: DspGraphNode, key: string, value: string): void {
  node.params[key] = value
}

function setBooleanParam(node: DspGraphNode, key: string, value: boolean): void {
  node.params[key] = value
}

function objectArrayParam(node: DspGraphNode, key: string): Array<Record<string, unknown>> {
  const raw = node.params[key]
  const entries = Array.isArray(raw)
    ? raw.filter(
        (entry): entry is Record<string, unknown> =>
          !!entry && typeof entry === 'object' && !Array.isArray(entry)
      )
    : []
  if (!Array.isArray(raw) || entries.length !== raw.length) node.params[key] = entries
  return entries
}

function bandsFor(node: DspGraphNode): Array<Record<string, unknown>> {
  return objectArrayParam(node, 'bands')
}

function layoutForNode(node: DspGraphNode): DspChannelLayout {
  const layout = stringParam(node, 'layout', 'stereo')
  return channelLayouts.includes(layout as DspChannelLayout)
    ? (layout as DspChannelLayout)
    : 'stereo'
}

function channelLabelsForNode(node: DspGraphNode): string[] {
  return channelLabels[layoutForNode(node)]
}

function matrixChannelCount(node: DspGraphNode): number {
  return channelLabelsForNode(node).length
}

function identityMatrix(channelCount: number): number[] {
  return Array.from({ length: channelCount * channelCount }, (_, index) =>
    index % (channelCount + 1) === 0 ? 1 : 0
  )
}

function matrixForNode(node: DspGraphNode): number[] {
  const expectedLength = matrixChannelCount(node) ** 2
  const raw = node.params.matrix
  if (
    Array.isArray(raw) &&
    raw.length === expectedLength &&
    raw.every((value) => typeof value === 'number' && Number.isFinite(value))
  ) {
    return raw as number[]
  }
  const matrix = identityMatrix(matrixChannelCount(node))
  node.params.matrix = matrix
  return matrix
}

function matrixValue(node: DspGraphNode, output: number, input: number): number {
  const channelCount = matrixChannelCount(node)
  return matrixForNode(node)[output * channelCount + input] ?? 0
}

function setMatrixValue(
  node: DspGraphNode,
  output: number,
  input: number,
  value: string | number
): void {
  const next = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(next)) return
  const channelCount = matrixChannelCount(node)
  const matrix = matrixForNode(node)
  matrix[output * channelCount + input] = Math.max(-4, Math.min(4, next))
  node.params.matrix = matrix
}

function resetMatrix(node: DspGraphNode): void {
  node.params.matrix = identityMatrix(matrixChannelCount(node))
}

function applyMatrixPreset(node: DspGraphNode, event: Event): void {
  const select = event.target as HTMLSelectElement
  const matrix = channelMatrixPresetMatrix(select.value, layoutForNode(node))
  if (matrix) node.params.matrix = matrix
  select.value = ''
}

function channelStripRows(node: DspGraphNode): Array<Record<string, unknown>> {
  const rows = objectArrayParam(node, 'channels')
  const expected = matrixChannelCount(node)
  while (rows.length < expected) {
    rows.push({ gainDb: 0, delayMs: 0, polarityInverted: false, muted: false })
  }
  if (rows.length > expected) rows.splice(expected)
  node.params.channels = rows
  return rows
}

function setNodeLayout(node: DspGraphNode, value: string): void {
  if (!channelLayouts.includes(value as DspChannelLayout)) return
  node.params.layout = value
  if (node.type === 'channelMatrix') resetMatrix(node)
  if (node.type === 'channelStrip') channelStripRows(node)
}

function convolverRoutingMode(node: DspGraphNode): ConvolverRoutingMode {
  const mode = node.params.routingMode
  if (mode === 'monoToMany' || mode === 'matrix' || mode === 'diagonal') return mode
  const matrix = node.params.matrix
  if (!Array.isArray(matrix)) return 'diagonal'
  if (matrix.length === matrixChannelCount(node)) return 'monoToMany'
  if (matrix.length === matrixChannelCount(node) ** 2) return 'matrix'
  return 'diagonal'
}

function resetConvolverRouting(node: DspGraphNode): void {
  const mode = convolverRoutingMode(node)
  const channelCount = matrixChannelCount(node)
  node.params.matrix =
    mode === 'diagonal'
      ? []
      : mode === 'monoToMany'
        ? Array.from({ length: channelCount }, () => 1)
        : identityMatrix(channelCount)
}

function convolverRoutingMatrix(node: DspGraphNode): number[] {
  const mode = convolverRoutingMode(node)
  if (mode === 'diagonal') return []
  const expectedLength =
    mode === 'monoToMany' ? matrixChannelCount(node) : matrixChannelCount(node) ** 2
  const raw = node.params.matrix
  if (
    Array.isArray(raw) &&
    raw.length === expectedLength &&
    raw.every((value) => typeof value === 'number' && Number.isFinite(value))
  ) {
    return raw as number[]
  }
  resetConvolverRouting(node)
  return node.params.matrix as number[]
}

function convolverRoutingValue(node: DspGraphNode, output: number, input = 0): number {
  const matrix = convolverRoutingMatrix(node)
  if (convolverRoutingMode(node) === 'monoToMany') return matrix[output] ?? 0
  return matrix[output * matrixChannelCount(node) + input] ?? 0
}

function setConvolverRoutingValue(
  node: DspGraphNode,
  output: number,
  input: number,
  value: string | number
): void {
  const next = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(next)) return
  const matrix = convolverRoutingMatrix(node)
  const index =
    convolverRoutingMode(node) === 'monoToMany' ? output : output * matrixChannelCount(node) + input
  matrix[index] = Math.max(-4, Math.min(4, next))
  node.params.matrix = matrix
}

function setConvolverRoutingMode(node: DspGraphNode, value: string): void {
  if (value !== 'diagonal' && value !== 'monoToMany' && value !== 'matrix') return
  node.params.routingMode = value
  resetConvolverRouting(node)
}

function setConvolverRoutingLayout(node: DspGraphNode, value: string): void {
  if (!channelLayouts.includes(value as DspChannelLayout)) return
  node.params.layout = value
  resetConvolverRouting(node)
}

function numberArrayParam(node: DspGraphNode, key: string): number[] {
  const raw = node.params[key]
  const values = Array.isArray(raw)
    ? raw.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    : []
  if (!Array.isArray(raw) || values.length !== raw.length) node.params[key] = values
  return values
}

function normalizeMultibandCrossovers(node: DspGraphNode): number[] {
  const bandCount = bandsFor(node).length
  if (bandCount < 2) {
    node.params.crossoversHz = []
    return []
  }
  const source = numberArrayParam(node, 'crossoversHz')
  const crossovers: number[] = []
  let previous = 20
  for (let index = 0; index < bandCount - 1; index += 1) {
    const fallback = defaultMultibandCrossovers[index] ?? previous * 2
    const requested = source[index] ?? fallback
    const value = Math.max(previous + 1, Math.min(24000, requested))
    crossovers.push(value)
    previous = value
  }
  node.params.crossoversHz = crossovers
  return crossovers
}

function setMultibandCrossover(node: DspGraphNode, index: number, value: string | number): void {
  const next = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(next)) return
  const crossovers = normalizeMultibandCrossovers(node)
  crossovers[index] = next
  node.params.crossoversHz = crossovers
  normalizeMultibandCrossovers(node)
}

function addDynamicEqBand(node: DspGraphNode): void {
  const bands = bandsFor(node)
  if (bands.length >= 8) return
  bands.push({
    frequency: 1000,
    gainDb: 0,
    q: 1,
    thresholdDb: -24,
    ratio: 2,
    rangeDb: -6,
    attackMs: 15,
    releaseMs: 180,
    filterType: 'peak',
    enabled: true
  })
}

function addMultibandBand(node: DspGraphNode): void {
  const bands = bandsFor(node)
  if (bands.length >= 4) return
  const createBand = () => ({
    thresholdDb: -18,
    ratio: 2,
    attackMs: 15,
    releaseMs: 180,
    makeupDb: 0,
    enabled: true
  })
  if (bands.length === 0) {
    bands.push(createBand(), createBand())
  } else {
    bands.push(createBand())
  }
  normalizeMultibandCrossovers(node)
}

function removeBand(node: DspGraphNode, index: number): void {
  const bands = bandsFor(node)
  bands.splice(index, 1)
}

function removeMultibandBand(node: DspGraphNode, index: number): void {
  const bands = bandsFor(node)
  if (bands.length <= 2) return
  bands.splice(index, 1)
  normalizeMultibandCrossovers(node)
}

function setBandNumber(band: Record<string, unknown>, key: string, value: string | number): void {
  const number = typeof value === 'number' ? value : Number(value)
  if (Number.isFinite(number)) band[key] = number
}

function bandNumber(band: Record<string, unknown>, key: string, fallback: number): number {
  const value = band[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function bandString(band: Record<string, unknown>, key: string, fallback: string): string {
  return typeof band[key] === 'string' ? (band[key] as string) : fallback
}

function bandBoolean(band: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof band[key] === 'boolean' ? (band[key] as boolean) : fallback
}

function setBandBoolean(band: Record<string, unknown>, key: string, value: boolean): void {
  band[key] = value
}

function setBandString(band: Record<string, unknown>, key: string, value: string): void {
  band[key] = value
}

function normalizeNodeEditorParams(node: DspGraphNode): void {
  if (node.type === 'channelMatrix') {
    if (!channelLayouts.includes(stringParam(node, 'layout', 'stereo') as DspChannelLayout)) {
      node.params.layout = 'stereo'
    }
    matrixForNode(node)
  } else if (node.type === 'channelStrip') {
    if (!channelLayouts.includes(stringParam(node, 'layout', 'stereo') as DspChannelLayout)) {
      node.params.layout = 'stereo'
    }
    channelStripRows(node)
  } else if (node.type === 'convolver') {
    if (!channelLayouts.includes(stringParam(node, 'layout', 'stereo') as DspChannelLayout)) {
      node.params.layout = 'stereo'
    }
    convolverRoutingMatrix(node)
  } else if (node.type === 'multibandCompressor') {
    normalizeMultibandCrossovers(node)
  }
}

function updateRuleList(
  key: 'deviceIds' | 'backends' | 'channelLayouts' | 'sourceKinds',
  value: string
): void {
  const scene = selectedScene.value
  if (!scene) return
  const entries = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (entries.length === 0) {
    delete scene.rules[key]
    return
  }
  scene.rules[key] = entries as never
}

async function refreshDiagnostics(): Promise<void> {
  status.value = await window.api.audioEngine.getDspGraphStatus()
}

async function saveScenes(): Promise<void> {
  if (!state.value) return
  busy.value = true
  try {
    state.value.scenes.forEach((scene) => scene.graph.nodes.forEach(normalizeNodeEditorParams))
    state.value = await window.api.audioEngine.setDspScenes(
      state.value.scenes,
      state.value.pinnedSceneId
    )
    selectedSceneId.value = state.value.activeSceneId ?? selectedSceneId.value
    message.value = 'DSP 场景已保存并提交给音频引擎。'
    await refreshDiagnostics()
  } catch (error) {
    await refreshDiagnostics().catch(() => undefined)
    message.value =
      status.value?.applyError || (error instanceof Error ? error.message : '无法保存 DSP 场景')
  } finally {
    busy.value = false
  }
}

async function applySelectedScene(): Promise<void> {
  if (!selectedScene.value) return
  busy.value = true
  try {
    let next = await window.api.audioEngine.applyDspScene(selectedScene.value.id)
    if (next.requiresPcmFallback && !next.dsdPcmFallbackApplied) {
      const confirmed = window.confirm(
        '此场景需要 DSP 处理。切换到 PCM 并应用会停止 Native DSD/DoP 直通，是否继续？'
      )
      if (confirmed) next = await window.api.audioEngine.applyDspScene(selectedScene.value.id, true)
    }
    state.value = next
    message.value =
      next.requiresPcmFallback && !next.dsdPcmFallbackApplied
        ? '保留 DSD Direct/DoP 直通，DSP 图未应用。'
        : '活动场景已应用。'
    await refreshDiagnostics()
  } catch (error) {
    await refreshDiagnostics().catch(() => undefined)
    message.value =
      status.value?.applyError || (error instanceof Error ? error.message : '无法应用 DSP 场景')
  } finally {
    busy.value = false
  }
}

function togglePin(): void {
  if (!state.value || !selectedScene.value) return
  state.value.pinnedSceneId = isPinned.value ? null : selectedScene.value.id
  message.value = state.value.pinnedSceneId
    ? '手动 pin 将覆盖自动规则。请保存以生效。'
    : '已恢复自动规则。请保存以生效。'
}

function toggleSnapshot(): void {
  if (!state.value) return
  if (!snapshotA.value) {
    snapshotA.value = state.value.scenes.map((scene) => cloneScene(scene))
    message.value = 'A 快照已记录。修改后可一键回到 A。'
    return
  }
  state.value.scenes = snapshotA.value.map((scene) => cloneScene(scene))
  selectScene(selectedSceneId.value ?? state.value.scenes[0]?.id ?? '')
  message.value = '已恢复 A 快照。保存后重新编译。'
}

async function refreshLibrary(): Promise<void> {
  const [nextAssets, nextCatalog] = await Promise.all([
    window.api.audioEngine.getDspAssets(),
    window.api.audioEngine.getVst3Catalog()
  ])
  assets.value = nextAssets
  vst3Catalog.value = nextCatalog
}

async function importAsset(kind: DspAssetKind): Promise<void> {
  const asset = await window.api.audioEngine.importDspAsset(kind)
  if (!asset) return
  assets.value = await window.api.audioEngine.getDspAssets()
  if (selectedNode.value?.type === 'convolver' && kind === 'impulseResponse') {
    selectedNode.value.params.impulseResponseAssetId = asset.id
    selectedNode.value.params.impulseResponsePath = ''
  }
  if (
    selectedNode.value?.type === 'vst3Plugin' &&
    selectedNode.value.vst3 &&
    (kind === 'vst3Preset' || kind === 'vst3State')
  ) {
    selectedNode.value.vst3 = { ...selectedNode.value.vst3, stateAssetId: asset.id }
  }
}

function selectImpulseAsset(assetId: string): void {
  if (!selectedNode.value) return
  selectedNode.value.params.impulseResponseAssetId = assetId
  selectedNode.value.params.impulseResponsePath = ''
}

function applyCorrectionProfile(assetId: string, profile: DspCorrectionProfile): void {
  if (!selectedNode.value || selectedNode.value.type !== 'equalizer') return
  selectedNode.value.enabled = true
  selectedNode.value.params = {
    ...selectedNode.value.params,
    mode: 'parametric',
    preampDb: profile.preampDb,
    bands: profile.bands.map((band) => ({ ...band })),
    correctionAssetId: assetId,
    correctionFormat: profile.format
  }
}

async function importCorrectionProfile(): Promise<void> {
  if (!selectedNode.value || selectedNode.value.type !== 'equalizer') return
  busy.value = true
  try {
    const imported = await window.api.audioEngine.importDspCorrectionProfile()
    if (!imported) return
    applyCorrectionProfile(imported.asset.id, imported.profile)
    assets.value = await window.api.audioEngine.getDspAssets()
    message.value = `已导入 ${imported.profile.bands.length} 段 ${imported.profile.format} 校正，并写入当前参数 EQ。`
  } catch (error) {
    message.value = error instanceof Error ? error.message : '无法导入参数 EQ 校正文件'
  } finally {
    busy.value = false
  }
}

async function selectCorrectionAsset(assetId: string): Promise<void> {
  if (!selectedNode.value || selectedNode.value.type !== 'equalizer') return
  if (!assetId) {
    delete selectedNode.value.params.correctionAssetId
    delete selectedNode.value.params.correctionFormat
    return
  }
  busy.value = true
  try {
    applyCorrectionProfile(assetId, await window.api.audioEngine.getDspCorrectionProfile(assetId))
  } catch (error) {
    message.value = error instanceof Error ? error.message : '无法读取校正资料'
  } finally {
    busy.value = false
  }
}

async function exportProfile(): Promise<void> {
  await window.api.audioEngine.exportDspProfile(selectedScene.value?.name)
}

async function importProfile(): Promise<void> {
  const imported = await window.api.audioEngine.importDspProfile()
  if (!imported) return
  state.value = imported.state
  state.value.scenes.forEach((scene) => scene.graph.nodes.forEach(normalizeNodeEditorParams))
  selectedSceneId.value = imported.state.activeSceneId ?? imported.state.scenes[0]?.id ?? null
  selectedNodeId.value = selectedScene.value?.graph.nodes[0]?.id ?? null
  await refreshLibrary()
  await refreshDiagnostics()
}

async function scanVst3(): Promise<void> {
  busy.value = true
  try {
    vst3Catalog.value = await window.api.audioEngine.scanVst3Plugins()
  } finally {
    busy.value = false
  }
}

async function recoverVst3Module(catalogId: string): Promise<void> {
  busy.value = true
  try {
    vst3Catalog.value = await window.api.audioEngine.clearVst3Quarantine(catalogId)
    await refreshDiagnostics()
    const entry = vst3Catalog.value.entries.find((candidate) => candidate.id === catalogId)
    message.value =
      entry?.status === 'available'
        ? `${entry.name} was re-scanned and is ready for manual re-enable.`
        : entry?.error || 'The VST3 module remains unavailable after its isolated scan.'
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Unable to recover the VST3 module.'
  } finally {
    busy.value = false
  }
}

function selectVst3(catalogId: string): void {
  const entry = vst3Catalog.value?.entries.find((candidate) => candidate.id === catalogId)
  if (!selectedNode.value || !entry) return
  selectedNode.value.vst3 = { catalogId: entry.id, classId: entry.classId }
  selectedNode.value.params.catalogId = entry.id
  selectedNode.value.params.classId = entry.classId
  selectedNode.value.params.parameters = Object.fromEntries(
    entry.parameters.map((parameter) => [String(parameter.id), parameter.defaultNormalizedValue])
  )
}

function selectVst3State(assetId: string): void {
  const node = selectedNode.value
  if (!node?.vst3) return
  if (!assetId) {
    node.vst3 = { catalogId: node.vst3.catalogId, classId: node.vst3.classId }
    return
  }
  const asset = vst3StateAssets.value.find((candidate) => candidate.id === assetId)
  if (asset) node.vst3 = { ...node.vst3, stateAssetId: asset.id }
}

function vst3ParameterValue(node: DspGraphNode, id: number, fallback: number): number {
  const parameters = node.params.parameters
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return fallback
  const value = (parameters as Record<string, unknown>)[String(id)]
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback
}

function setVst3Parameter(node: DspGraphNode, id: number, value: string | number): void {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return
  const current =
    node.params.parameters &&
    typeof node.params.parameters === 'object' &&
    !Array.isArray(node.params.parameters)
      ? (node.params.parameters as Record<string, unknown>)
      : {}
  node.params.parameters = { ...current, [String(id)]: Math.max(0, Math.min(1, number)) }
}

function vst3ParameterStep(stepCount: number): number {
  return stepCount > 0 ? 1 / stepCount : 0.001
}

function isReadOnlyVst3Parameter(flags: number): boolean {
  return (flags & 2) !== 0 || (flags & 16) !== 0
}

function setOutputTarget(value: string): void {
  const scene = selectedScene.value
  if (!scene) return
  scene.graph.outputStage.targetSampleRate = value === 'device' ? 'device' : Number(value)
}

function setOutputQuality(value: string): void {
  const scene = selectedScene.value
  if (!scene || !['native', 'high', 'ultra', 'soxrHq', 'soxrVhq'].includes(value)) return
  scene.graph.outputStage.resamplerQuality = value as DspResamplerQuality
}

const soxrFallbackActive = computed(() => status.value?.outputStage?.resamplerFallback === true)

function setOutputDither(value: string): void {
  const scene = selectedScene.value
  if (!scene || !['off', 'tpdf', 'highpassTpdf', 'noiseShaped'].includes(value)) return
  scene.graph.outputStage.dither = value as 'off' | 'tpdf' | 'highpassTpdf' | 'noiseShaped'
}

onMounted(async () => {
  try {
    state.value = await window.api.audioEngine.getDspSceneState()
    state.value.scenes.forEach((scene) => scene.graph.nodes.forEach(normalizeNodeEditorParams))
    selectedSceneId.value = state.value.activeSceneId ?? state.value.scenes[0]?.id ?? null
    selectedNodeId.value = selectedScene.value?.graph.nodes[0]?.id ?? null
    await Promise.all([refreshDiagnostics(), refreshLibrary()])
  } catch (error) {
    message.value = error instanceof Error ? error.message : '无法读取 DSP Rack 状态'
  }
})
onMounted(() => {
  diagnosticsPoll = window.setInterval(() => {
    if (busy.value || document.visibilityState === 'hidden') return
    void refreshDiagnostics().catch(() => undefined)
  }, 1000)
})

onBeforeUnmount(() => {
  if (diagnosticsPoll !== null) window.clearInterval(diagnosticsPoll)
})
</script>

<template>
  <main class="dsp-rack-page">
    <header class="rack-header">
      <div>
        <p class="eyebrow">DSP WORKSTATION</p>
        <h1>DSP Rack</h1>
      </div>
      <div class="rack-header-actions">
        <button
          type="button"
          class="icon-button"
          title="刷新诊断"
          :disabled="busy"
          @click="refreshDiagnostics"
        >
          <i class="pi pi-refresh"></i>
        </button>
        <button
          type="button"
          class="icon-button"
          title="导入配置包"
          :disabled="busy"
          @click="importProfile"
        >
          <i class="pi pi-upload"></i>
        </button>
        <button
          type="button"
          class="icon-button"
          title="导出配置包"
          :disabled="busy"
          @click="exportProfile"
        >
          <i class="pi pi-download"></i>
        </button>
        <button type="button" class="text-button" data-te-back-button="pill" @click="emit('back')">
          返回
        </button>
      </div>
    </header>

    <p
      v-if="message"
      class="rack-message"
      :class="{ error: graphApplyState === 'failed' }"
      :role="graphApplyState === 'failed' ? 'alert' : 'status'"
    >
      {{ message }}
    </p>

    <div class="rack-layout">
      <aside class="scene-pane">
        <div class="pane-heading">
          <h2>场景</h2>
          <button type="button" class="icon-button" title="新建场景" @click="addScene">
            <i class="pi pi-plus"></i>
          </button>
        </div>
        <button
          v-for="scene in scenes"
          :key="scene.id"
          type="button"
          class="scene-row"
          :class="{ selected: scene.id === selectedScene?.id, active: scene.id === activeSceneId }"
          @click="selectScene(scene.id)"
        >
          <i :class="scene.id === activeSceneId ? 'pi pi-play-circle' : 'pi pi-sliders-v'"></i>
          <span>{{ scene.name }}</span>
          <small>P{{ scene.priority }}</small>
        </button>
        <div class="scene-actions">
          <button type="button" class="icon-button" title="复制场景" @click="duplicateScene">
            <i class="pi pi-copy"></i>
          </button>
          <button
            type="button"
            class="icon-button"
            title="删除场景"
            :disabled="scenes.length <= 1"
            @click="removeScene"
          >
            <i class="pi pi-trash"></i>
          </button>
        </div>
        <div class="factory-template-picker">
          <select v-model="factoryTemplateToAdd" aria-label="Factory DSP template">
            <option
              v-for="template in DSP_FACTORY_SCENE_TEMPLATES"
              :key="template.id"
              :value="template.id"
            >
              {{ template.name }}
            </option>
          </select>
          <button
            type="button"
            class="icon-button"
            title="Add factory template"
            @click="addFactoryScene"
          >
            <i class="pi pi-plus"></i>
          </button>
        </div>
      </aside>

      <section class="graph-pane">
        <template v-if="selectedScene">
          <div class="scene-toolbar">
            <label>名称<input v-model="selectedScene.name" maxlength="64" /></label>
            <label
              >优先级<input v-model.number="selectedScene.priority" type="number" step="1"
            /></label>
            <label class="switch-field"
              ><input v-model="selectedScene.enabled" type="checkbox" /> 场景启用</label
            >
            <button
              type="button"
              class="icon-text-button"
              :class="{ selected: isPinned }"
              @click="togglePin"
            >
              <i class="pi pi-thumbtack"></i>{{ isPinned ? '取消 Pin' : 'Pin 场景' }}
            </button>
            <button type="button" class="icon-text-button" @click="toggleSnapshot">
              <i class="pi pi-clone"></i>{{ snapshotA ? '恢复 A' : '记录 A' }}
            </button>
            <button
              type="button"
              class="primary-button"
              :disabled="busy"
              @click="applySelectedScene"
            >
              <i class="pi pi-play"></i>应用
            </button>
            <button type="button" class="icon-text-button" :disabled="busy" @click="saveScenes">
              <i class="pi pi-save"></i>保存
            </button>
          </div>

          <div v-if="state?.requiresPcmFallback && !state.dsdPcmFallbackApplied" class="dsd-notice">
            <i class="pi pi-info-circle"></i
            ><span>当前 DSD Direct/DoP 保持直通。应用 DSP 需要明确确认 PCM 回退。</span>
          </div>

          <div v-if="vst3HelpersNotice" class="dsd-notice" role="status">
            <i class="pi pi-exclamation-triangle"></i>
            <span>{{ vst3HelpersNotice }}</span>
          </div>

          <div class="graph-heading">
            <div>
              <h2>串行处理图</h2>
              <span>{{ selectedScene.graph.nodes.length }} 个节点</span>
            </div>
            <div class="node-add">
              <select v-model="nodeTypeToAdd">
                <option v-for="item in nodeCatalog" :key="item.type" :value="item.type">
                  {{ item.label }}
                </option></select
              ><button type="button" class="icon-button" title="添加节点" @click="addNode">
                <i class="pi pi-plus"></i>
              </button>
            </div>
          </div>

          <section class="output-stage">
            <label
              >Output rate
              <select
                :value="String(selectedScene.graph.outputStage.targetSampleRate)"
                @change="setOutputTarget(($event.target as HTMLSelectElement).value)"
              >
                <option value="device">Device</option>
                <option value="44100">44.1 kHz</option>
                <option value="48000">48 kHz</option>
                <option value="88200">88.2 kHz</option>
                <option value="96000">96 kHz</option>
                <option value="176400">176.4 kHz</option>
                <option value="192000">192 kHz</option>
              </select>
            </label>
            <label
              >SRC
              <select
                :value="selectedScene.graph.outputStage.resamplerQuality"
                @change="setOutputQuality(($event.target as HTMLSelectElement).value)"
              >
                <option value="native">Native</option>
                <option value="high">High</option>
                <option value="ultra">Ultra</option>
                <option value="soxrHq">
                  SoX HQ{{ soxrFallbackActive ? '（不可用，回退 Ultra）' : '' }}
                </option>
                <option value="soxrVhq">
                  SoX VHQ (最高){{ soxrFallbackActive ? '（不可用，回退 Ultra）' : '' }}
                </option>
              </select>
            </label>
            <label
              >Dither
              <select
                :value="selectedScene.graph.outputStage.dither"
                @change="setOutputDither(($event.target as HTMLSelectElement).value)"
              >
                <option value="off">Off</option>
                <option value="tpdf">TPDF</option>
                <option value="highpassTpdf">High-pass TPDF</option>
                <option value="noiseShaped">Noise-shaped</option>
              </select>
            </label>
            <label class="switch-field"
              ><input v-model="selectedScene.graph.outputStage.safetyClamp" type="checkbox" />
              Safety clamp</label
            >
          </section>

          <div class="node-list" aria-label="DSP graph nodes">
            <article
              v-for="node in selectedScene.graph.nodes"
              :key="node.id"
              draggable="true"
              class="graph-node"
              data-te-interactive
              :class="{ selected: node.id === selectedNode?.id, bypassed: !node.enabled }"
              @dragstart="draggedNodeId = node.id"
              @dragover.prevent
              @drop="onDrop(node.id)"
              @click="selectNode(node.id)"
            >
              <i class="pi pi-bars drag-handle" aria-hidden="true"></i>
              <i
                :class="nodeCatalog.find((item) => item.type === node.type)?.icon ?? 'pi pi-circle'"
              ></i>
              <div>
                <strong>{{ nodeLabel(node.type) }}</strong
                ><small>{{ node.id }}</small>
              </div>
              <button
                type="button"
                class="icon-button small"
                :title="node.enabled ? '旁路节点' : '启用节点'"
                @click.stop="node.enabled = !node.enabled"
              >
                <i :class="node.enabled ? 'pi pi-eye' : 'pi pi-eye-slash'"></i>
              </button>
              <button
                type="button"
                class="icon-button small danger"
                title="移除节点"
                @click.stop="removeNode(node.id)"
              >
                <i class="pi pi-times"></i>
              </button>
            </article>
          </div>
          <p class="v1-note">
            ABI v1 原生插件固定在图末端、输出安全保护之前；仅 ABI v2 节点可参与此排序。
          </p>
        </template>
      </section>

      <aside class="detail-pane">
        <template v-if="selectedScene && selectedNode">
          <div class="pane-heading">
            <h2>{{ nodeLabel(selectedNode.type) }}</h2>
            <label class="switch-field"
              ><input v-model="selectedNode.enabled" type="checkbox" /> 启用</label
            >
          </div>
          <label class="full-field"
            >节点 ID<input v-model="selectedNode.id" maxlength="96"
          /></label>
          <label v-if="selectedNode.type === 'nativePlugin'" class="full-field"
            >插件 ID<input v-model="selectedNode.pluginId" placeholder="com.example.dsp"
          /></label>
          <section class="node-controls">
            <template v-if="selectedNode.type === 'replayGain'">
              <label
                >Mode<select
                  :value="stringParam(selectedNode, 'mode', 'track')"
                  @change="
                    setStringParam(selectedNode, 'mode', ($event.target as HTMLSelectElement).value)
                  "
                >
                  <option value="off">Off</option>
                  <option value="track">Track</option>
                  <option value="album">Album</option>
                </select></label
              >
              <label
                >Preamp dB<input
                  :value="numberParam(selectedNode, 'preampDb', 0)"
                  type="number"
                  min="-24"
                  max="24"
                  step="0.1"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'preampDb',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
              <label class="switch-field"
                ><input
                  :checked="booleanParam(selectedNode, 'clip', true)"
                  type="checkbox"
                  @change="
                    setBooleanParam(
                      selectedNode,
                      'clip',
                      ($event.target as HTMLInputElement).checked
                    )
                  "
                />
                Clip guard</label
              >
            </template>

            <template v-else-if="selectedNode.type === 'equalizer'">
              <label
                >Mode<select
                  :value="stringParam(selectedNode, 'mode', 'parametric')"
                  @change="
                    setStringParam(selectedNode, 'mode', ($event.target as HTMLSelectElement).value)
                  "
                >
                  <option value="parametric">Parametric</option>
                  <option value="graphic">Graphic</option>
                </select></label
              >
              <label
                >Preamp dB<input
                  :value="numberParam(selectedNode, 'preampDb', 0)"
                  type="number"
                  min="-24"
                  max="24"
                  step="0.1"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'preampDb',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
              <div class="control-heading">
                <h3>Correction profile</h3>
                <button
                  type="button"
                  class="icon-button small"
                  title="Import REW, Equalizer APO, or AutoEq profile"
                  :disabled="busy"
                  @click="importCorrectionProfile"
                >
                  <i class="pi pi-upload"></i>
                </button>
              </div>
              <label
                >Managed profile<select
                  :value="stringParam(selectedNode, 'correctionAssetId')"
                  :disabled="busy"
                  @change="selectCorrectionAsset(($event.target as HTMLSelectElement).value)"
                >
                  <option value="">None</option>
                  <option
                    v-for="asset in assets.filter((asset) => asset.kind === 'correctionProfile')"
                    :key="asset.id"
                    :value="asset.id"
                  >
                    {{ asset.name }}
                  </option>
                </select></label
              >
            </template>

            <template v-else-if="selectedNode.type === 'crossfeed'">
              <label
                >Algorithm<select
                  :value="stringParam(selectedNode, 'algorithm', 'custom')"
                  @change="
                    setStringParam(
                      selectedNode,
                      'algorithm',
                      ($event.target as HTMLSelectElement).value
                    )
                  "
                >
                  <option value="custom">Custom</option>
                  <option value="bauer">Bauer</option>
                  <option value="bs2b">BS2B</option>
                  <option value="meier">Meier</option>
                </select></label
              >
              <label
                >Strength<input
                  :value="numberParam(selectedNode, 'strength', 0.35)"
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'strength',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
              <label
                :class="{ muted: stringParam(selectedNode, 'algorithm', 'custom') !== 'custom' }"
                >Delay ms<input
                  :value="numberParam(selectedNode, 'delayMs', 0.35)"
                  type="number"
                  min="0.05"
                  max="2"
                  step="0.01"
                  :disabled="stringParam(selectedNode, 'algorithm', 'custom') !== 'custom'"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'delayMs',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
              <label
                :class="{ muted: stringParam(selectedNode, 'algorithm', 'custom') !== 'custom' }"
                >Cutoff Hz<input
                  :value="numberParam(selectedNode, 'cutoffHz', 700)"
                  type="number"
                  min="80"
                  max="4000"
                  step="1"
                  :disabled="stringParam(selectedNode, 'algorithm', 'custom') !== 'custom'"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'cutoffHz',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
            </template>

            <template v-else-if="selectedNode.type === 'channelMatrix'">
              <label
                >Layout<select
                  :value="layoutForNode(selectedNode)"
                  @change="setNodeLayout(selectedNode, ($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="layout in channelLayouts" :key="layout" :value="layout">
                    {{ layout }}
                  </option>
                </select></label
              >
              <div class="control-heading">
                <h3>Routing matrix</h3>
                <button
                  type="button"
                  class="icon-button small"
                  title="Reset to identity"
                  @click="resetMatrix(selectedNode)"
                >
                  <i class="pi pi-refresh"></i>
                </button>
              </div>
              <label
                >Preset<select
                  value=""
                  aria-label="Apply matrix preset"
                  @change="applyMatrixPreset(selectedNode, $event)"
                >
                  <option value="" disabled>Apply preset…</option>
                  <option
                    v-for="preset in channelMatrixPresetsForLayout(layoutForNode(selectedNode))"
                    :key="preset.id"
                    :value="preset.id"
                  >
                    {{ preset.label }}
                  </option>
                </select></label
              >
              <div
                class="matrix-grid"
                :style="{
                  gridTemplateColumns: `44px repeat(${matrixChannelCount(selectedNode)}, minmax(42px, 1fr))`
                }"
              >
                <span class="matrix-corner">Out/In</span>
                <span
                  v-for="label in channelLabelsForNode(selectedNode)"
                  :key="`input-${label}`"
                  class="matrix-axis"
                  >{{ label }}</span
                >
                <template
                  v-for="(outputLabel, output) in channelLabelsForNode(selectedNode)"
                  :key="`output-${outputLabel}`"
                >
                  <strong class="matrix-axis">{{ outputLabel }}</strong>
                  <input
                    v-for="(_, input) in channelLabelsForNode(selectedNode)"
                    :key="`${output}-${input}`"
                    :aria-label="`${outputLabel} from ${channelLabelsForNode(selectedNode)[input]}`"
                    :value="matrixValue(selectedNode, output, input)"
                    type="number"
                    min="-4"
                    max="4"
                    step="0.01"
                    @input="
                      setMatrixValue(
                        selectedNode,
                        output,
                        input,
                        ($event.target as HTMLInputElement).value
                      )
                    "
                  />
                </template>
              </div>
            </template>

            <template v-else-if="selectedNode.type === 'channelStrip'">
              <label
                >Layout<select
                  :value="layoutForNode(selectedNode)"
                  @change="setNodeLayout(selectedNode, ($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="layout in channelLayouts" :key="layout" :value="layout">
                    {{ layout }}
                  </option>
                </select></label
              >
              <div
                v-for="(channel, index) in channelStripRows(selectedNode)"
                :key="index"
                class="channel-strip-row"
              >
                <strong>{{ channelLabelsForNode(selectedNode)[index] }}</strong>
                <label
                  >Gain dB<input
                    :value="bandNumber(channel, 'gainDb', 0)"
                    type="number"
                    min="-60"
                    max="24"
                    step="0.1"
                    @input="
                      setBandNumber(channel, 'gainDb', ($event.target as HTMLInputElement).value)
                    "
                /></label>
                <label
                  >Delay ms<input
                    :value="bandNumber(channel, 'delayMs', 0)"
                    type="number"
                    min="0"
                    max="250"
                    step="0.01"
                    @input="
                      setBandNumber(channel, 'delayMs', ($event.target as HTMLInputElement).value)
                    "
                /></label>
                <label class="switch-field"
                  ><input
                    :checked="bandBoolean(channel, 'polarityInverted', false)"
                    type="checkbox"
                    @change="
                      setBandBoolean(
                        channel,
                        'polarityInverted',
                        ($event.target as HTMLInputElement).checked
                      )
                    "
                  />
                  Invert</label
                >
                <label class="switch-field"
                  ><input
                    :checked="bandBoolean(channel, 'muted', false)"
                    type="checkbox"
                    @change="
                      setBandBoolean(channel, 'muted', ($event.target as HTMLInputElement).checked)
                    "
                  />
                  Mute</label
                >
              </div>
            </template>

            <template v-else-if="selectedNode.type === 'bassManagement'">
              <label
                >Crossover Hz<input
                  :value="numberParam(selectedNode, 'crossoverHz', 80)"
                  type="number"
                  min="20"
                  max="500"
                  step="1"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'crossoverHz',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
              <label
                >LFE gain dB<input
                  :value="numberParam(selectedNode, 'lfeGainDb', 0)"
                  type="number"
                  min="-24"
                  max="12"
                  step="0.1"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'lfeGainDb',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
              <label class="switch-field"
                ><input
                  :checked="booleanParam(selectedNode, 'redirectLfe', true)"
                  type="checkbox"
                  @change="
                    setBooleanParam(
                      selectedNode,
                      'redirectLfe',
                      ($event.target as HTMLInputElement).checked
                    )
                  "
                />
                Redirect bass to LFE</label
              >
            </template>

            <template v-else-if="selectedNode.type === 'dynamicEqualizer'">
              <div class="control-heading">
                <h3>Bands</h3>
                <button
                  type="button"
                  class="icon-button small"
                  title="Add band"
                  @click="addDynamicEqBand(selectedNode)"
                >
                  <i class="pi pi-plus"></i>
                </button>
              </div>
              <div v-for="(band, index) in bandsFor(selectedNode)" :key="index" class="band-grid">
                <label
                  >Hz<input
                    :value="bandNumber(band, 'frequency', 1000)"
                    type="number"
                    min="10"
                    max="96000"
                    @input="
                      setBandNumber(band, 'frequency', ($event.target as HTMLInputElement).value)
                    "
                /></label>
                <label
                  >Q<input
                    :value="bandNumber(band, 'q', 1)"
                    type="number"
                    min="0.1"
                    max="20"
                    step="0.1"
                    @input="setBandNumber(band, 'q', ($event.target as HTMLInputElement).value)"
                /></label>
                <label
                  >Static dB<input
                    :value="bandNumber(band, 'gainDb', 0)"
                    type="number"
                    min="-24"
                    max="24"
                    step="0.1"
                    @input="
                      setBandNumber(band, 'gainDb', ($event.target as HTMLInputElement).value)
                    "
                /></label>
                <label
                  >Threshold<input
                    :value="bandNumber(band, 'thresholdDb', -24)"
                    type="number"
                    min="-100"
                    max="0"
                    step="0.1"
                    @input="
                      setBandNumber(band, 'thresholdDb', ($event.target as HTMLInputElement).value)
                    "
                /></label>
                <label
                  >Range<input
                    :value="bandNumber(band, 'rangeDb', -6)"
                    type="number"
                    min="-24"
                    max="24"
                    step="0.1"
                    @input="
                      setBandNumber(band, 'rangeDb', ($event.target as HTMLInputElement).value)
                    "
                /></label>
                <label
                  >Ratio<input
                    :value="bandNumber(band, 'ratio', 2)"
                    type="number"
                    min="1"
                    max="20"
                    step="0.1"
                    @input="
                      setBandNumber(band, 'ratio', ($event.target as HTMLInputElement).value)
                    "
                /></label>
                <label
                  >Attack ms<input
                    :value="bandNumber(band, 'attackMs', 15)"
                    type="number"
                    min="0.1"
                    max="1000"
                    step="0.1"
                    @input="
                      setBandNumber(band, 'attackMs', ($event.target as HTMLInputElement).value)
                    "
                /></label>
                <label
                  >Release ms<input
                    :value="bandNumber(band, 'releaseMs', 180)"
                    type="number"
                    min="1"
                    max="5000"
                    step="1"
                    @input="
                      setBandNumber(band, 'releaseMs', ($event.target as HTMLInputElement).value)
                    "
                /></label>
                <label
                  >Channel mask<input
                    :value="bandNumber(band, 'channelMask', 255)"
                    type="number"
                    min="0"
                    max="255"
                    step="1"
                    @input="
                      setBandNumber(band, 'channelMask', ($event.target as HTMLInputElement).value)
                    "
                /></label>
                <label
                  >Filter<select
                    :value="bandString(band, 'filterType', 'peak')"
                    @change="
                      setBandString(band, 'filterType', ($event.target as HTMLSelectElement).value)
                    "
                  >
                    <option value="peak">Peak</option>
                    <option value="lowShelf">Low shelf</option>
                    <option value="highShelf">High shelf</option>
                    <option value="bandPass">Band pass</option>
                    <option value="notch">Notch</option>
                  </select></label
                >
                <label class="switch-field"
                  ><input
                    :checked="bandBoolean(band, 'enabled', true)"
                    type="checkbox"
                    @change="
                      setBandBoolean(band, 'enabled', ($event.target as HTMLInputElement).checked)
                    "
                  />
                  On</label
                >
                <button
                  type="button"
                  class="icon-button small danger"
                  title="Remove band"
                  @click="removeBand(selectedNode, index)"
                >
                  <i class="pi pi-trash"></i>
                </button>
              </div>
            </template>

            <template v-else-if="selectedNode.type === 'convolver'">
              <label
                >Impulse response<select
                  :value="stringParam(selectedNode, 'impulseResponseAssetId')"
                  @change="selectImpulseAsset(($event.target as HTMLSelectElement).value)"
                >
                  <option value="">Select asset</option>
                  <option
                    v-for="asset in assets.filter((asset) => asset.kind === 'impulseResponse')"
                    :key="asset.id"
                    :value="asset.id"
                  >
                    {{ asset.name }}
                  </option>
                </select></label
              >
              <button
                type="button"
                class="icon-text-button"
                @click="importAsset('impulseResponse')"
              >
                <i class="pi pi-upload"></i>Import IR
              </button>
              <label
                >Wet<input
                  :value="numberParam(selectedNode, 'wet', 1)"
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  @input="
                    setNumberParam(selectedNode, 'wet', ($event.target as HTMLInputElement).value)
                  "
              /></label>
              <label
                >Dry<input
                  :value="numberParam(selectedNode, 'dry', 0)"
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  @input="
                    setNumberParam(selectedNode, 'dry', ($event.target as HTMLInputElement).value)
                  "
              /></label>
              <label
                >Wet gain dB<input
                  :value="numberParam(selectedNode, 'gainDb', 0)"
                  type="number"
                  min="-60"
                  max="24"
                  step="0.1"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'gainDb',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
              <label
                >Wet delay ms<input
                  :value="numberParam(selectedNode, 'delayMs', 0)"
                  type="number"
                  min="0"
                  max="250"
                  step="0.01"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'delayMs',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
              <label class="switch-field"
                ><input
                  :checked="booleanParam(selectedNode, 'polarityInverted', false)"
                  type="checkbox"
                  @change="
                    setBooleanParam(
                      selectedNode,
                      'polarityInverted',
                      ($event.target as HTMLInputElement).checked
                    )
                  "
                />
                Invert wet</label
              >
              <label
                >Partition<input
                  :value="numberParam(selectedNode, 'partitionSize', 0)"
                  type="number"
                  min="0"
                  max="8192"
                  step="64"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'partitionSize',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
              <label
                >Routing<select
                  :value="convolverRoutingMode(selectedNode)"
                  @change="
                    setConvolverRoutingMode(
                      selectedNode,
                      ($event.target as HTMLSelectElement).value
                    )
                  "
                >
                  <option value="diagonal">Diagonal</option>
                  <option value="monoToMany">1 x N</option>
                  <option value="matrix">N x N</option>
                </select></label
              >
              <template v-if="convolverRoutingMode(selectedNode) !== 'diagonal'">
                <label
                  >Routing layout<select
                    :value="layoutForNode(selectedNode)"
                    @change="
                      setConvolverRoutingLayout(
                        selectedNode,
                        ($event.target as HTMLSelectElement).value
                      )
                    "
                  >
                    <option v-for="layout in channelLayouts" :key="layout" :value="layout">
                      {{ layout }}
                    </option>
                  </select></label
                >
                <div class="control-heading">
                  <h3>IR routing</h3>
                  <button
                    type="button"
                    class="icon-button small"
                    title="Reset routing"
                    @click="resetConvolverRouting(selectedNode)"
                  >
                    <i class="pi pi-refresh"></i>
                  </button>
                </div>
                <div
                  v-if="convolverRoutingMode(selectedNode) === 'monoToMany'"
                  class="matrix-grid"
                  :style="{ gridTemplateColumns: '44px minmax(42px, 1fr)' }"
                >
                  <span class="matrix-corner">Out</span><span class="matrix-axis">Mono</span>
                  <template
                    v-for="(outputLabel, output) in channelLabelsForNode(selectedNode)"
                    :key="`ir-output-${outputLabel}`"
                  >
                    <strong class="matrix-axis">{{ outputLabel }}</strong>
                    <input
                      :aria-label="`${outputLabel} from mono`"
                      :value="convolverRoutingValue(selectedNode, output)"
                      type="number"
                      min="-4"
                      max="4"
                      step="0.01"
                      @input="
                        setConvolverRoutingValue(
                          selectedNode,
                          output,
                          0,
                          ($event.target as HTMLInputElement).value
                        )
                      "
                    />
                  </template>
                </div>
                <div
                  v-else
                  class="matrix-grid"
                  :style="{
                    gridTemplateColumns: `44px repeat(${matrixChannelCount(selectedNode)}, minmax(42px, 1fr))`
                  }"
                >
                  <span class="matrix-corner">Out/In</span>
                  <span
                    v-for="label in channelLabelsForNode(selectedNode)"
                    :key="`ir-input-${label}`"
                    class="matrix-axis"
                    >{{ label }}</span
                  >
                  <template
                    v-for="(outputLabel, output) in channelLabelsForNode(selectedNode)"
                    :key="`ir-output-${outputLabel}`"
                  >
                    <strong class="matrix-axis">{{ outputLabel }}</strong>
                    <input
                      v-for="(_, input) in channelLabelsForNode(selectedNode)"
                      :key="`${output}-${input}`"
                      :aria-label="`${outputLabel} from ${channelLabelsForNode(selectedNode)[input]}`"
                      :value="convolverRoutingValue(selectedNode, output, input)"
                      type="number"
                      min="-4"
                      max="4"
                      step="0.01"
                      @input="
                        setConvolverRoutingValue(
                          selectedNode,
                          output,
                          input,
                          ($event.target as HTMLInputElement).value
                        )
                      "
                    />
                  </template>
                </div>
              </template>
            </template>

            <template
              v-else-if="selectedNode.type === 'gate' || selectedNode.type === 'compressor'"
            >
              <label
                >Threshold dB<input
                  :value="
                    numberParam(
                      selectedNode,
                      'thresholdDb',
                      selectedNode.type === 'gate' ? -60 : -18
                    )
                  "
                  type="number"
                  min="-100"
                  max="0"
                  step="0.1"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'thresholdDb',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
              <label v-if="selectedNode.type === 'compressor'"
                >Ratio<input
                  :value="numberParam(selectedNode, 'ratio', 2)"
                  type="number"
                  min="1"
                  max="20"
                  step="0.1"
                  @input="
                    setNumberParam(selectedNode, 'ratio', ($event.target as HTMLInputElement).value)
                  "
              /></label>
              <label
                >Attack ms<input
                  :value="numberParam(selectedNode, 'attackMs', 15)"
                  type="number"
                  min="0.1"
                  max="1000"
                  step="0.1"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'attackMs',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
              <label
                >Release ms<input
                  :value="numberParam(selectedNode, 'releaseMs', 180)"
                  type="number"
                  min="1"
                  max="5000"
                  step="1"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'releaseMs',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
              <label v-if="selectedNode.type === 'compressor'"
                >Makeup dB<input
                  :value="numberParam(selectedNode, 'makeupDb', 0)"
                  type="number"
                  min="-24"
                  max="24"
                  step="0.1"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'makeupDb',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
            </template>

            <template v-else-if="selectedNode.type === 'multibandCompressor'">
              <div class="control-heading">
                <h3>Bands</h3>
                <button
                  type="button"
                  class="icon-button small"
                  title="Add band"
                  @click="addMultibandBand(selectedNode)"
                >
                  <i class="pi pi-plus"></i>
                </button>
              </div>
              <div v-if="bandsFor(selectedNode).length >= 2" class="crossover-grid">
                <label
                  v-for="(crossover, index) in normalizeMultibandCrossovers(selectedNode)"
                  :key="index"
                  >Crossover {{ index + 1 }} Hz<input
                    :value="crossover"
                    type="number"
                    min="20"
                    max="24000"
                    step="1"
                    @input="
                      setMultibandCrossover(
                        selectedNode,
                        index,
                        ($event.target as HTMLInputElement).value
                      )
                    "
                /></label>
              </div>
              <div
                v-for="(band, index) in bandsFor(selectedNode)"
                :key="index"
                class="band-grid compact"
              >
                <label
                  >Threshold<input
                    :value="bandNumber(band, 'thresholdDb', -18)"
                    type="number"
                    min="-80"
                    max="0"
                    @input="
                      setBandNumber(band, 'thresholdDb', ($event.target as HTMLInputElement).value)
                    "
                /></label>
                <label
                  >Ratio<input
                    :value="bandNumber(band, 'ratio', 2)"
                    type="number"
                    min="1"
                    max="20"
                    step="0.1"
                    @input="
                      setBandNumber(band, 'ratio', ($event.target as HTMLInputElement).value)
                    "
                /></label>
                <label
                  >Attack ms<input
                    :value="bandNumber(band, 'attackMs', 15)"
                    type="number"
                    min="0.1"
                    max="1000"
                    step="0.1"
                    @input="
                      setBandNumber(band, 'attackMs', ($event.target as HTMLInputElement).value)
                    "
                /></label>
                <label
                  >Release ms<input
                    :value="bandNumber(band, 'releaseMs', 180)"
                    type="number"
                    min="1"
                    max="5000"
                    step="1"
                    @input="
                      setBandNumber(band, 'releaseMs', ($event.target as HTMLInputElement).value)
                    "
                /></label>
                <label
                  >Makeup<input
                    :value="bandNumber(band, 'makeupDb', 0)"
                    type="number"
                    min="-24"
                    max="24"
                    step="0.1"
                    @input="
                      setBandNumber(band, 'makeupDb', ($event.target as HTMLInputElement).value)
                    "
                /></label>
                <label class="switch-field"
                  ><input
                    :checked="bandBoolean(band, 'enabled', true)"
                    type="checkbox"
                    @change="
                      setBandBoolean(band, 'enabled', ($event.target as HTMLInputElement).checked)
                    "
                  />
                  On</label
                >
                <button
                  type="button"
                  class="icon-button small danger"
                  title="Remove band"
                  :disabled="bandsFor(selectedNode).length <= 2"
                  @click="removeMultibandBand(selectedNode, index)"
                >
                  <i class="pi pi-trash"></i>
                </button>
              </div>
            </template>

            <template v-else-if="selectedNode.type === 'stereoField'">
              <label
                >Width<input
                  :value="numberParam(selectedNode, 'width', 1)"
                  type="number"
                  min="0"
                  max="2"
                  step="0.01"
                  @input="
                    setNumberParam(selectedNode, 'width', ($event.target as HTMLInputElement).value)
                  "
              /></label>
              <label
                >Balance<input
                  :value="numberParam(selectedNode, 'balance', 0)"
                  type="number"
                  min="-1"
                  max="1"
                  step="0.01"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'balance',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
              <label
                >Mid dB<input
                  :value="numberParam(selectedNode, 'midGainDb', 0)"
                  type="number"
                  min="-24"
                  max="24"
                  step="0.1"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'midGainDb',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
              <label
                >Side dB<input
                  :value="numberParam(selectedNode, 'sideGainDb', 0)"
                  type="number"
                  min="-24"
                  max="24"
                  step="0.1"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'sideGainDb',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
              <label class="switch-field"
                ><input
                  :checked="booleanParam(selectedNode, 'swap')"
                  type="checkbox"
                  @change="
                    setBooleanParam(
                      selectedNode,
                      'swap',
                      ($event.target as HTMLInputElement).checked
                    )
                  "
                />
                Swap L/R</label
              >
              <label class="switch-field"
                ><input
                  :checked="booleanParam(selectedNode, 'mono')"
                  type="checkbox"
                  @change="
                    setBooleanParam(
                      selectedNode,
                      'mono',
                      ($event.target as HTMLInputElement).checked
                    )
                  "
                />
                Mono sum</label
              >
              <label class="switch-field"
                ><input
                  :checked="booleanParam(selectedNode, 'invertLeft')"
                  type="checkbox"
                  @change="
                    setBooleanParam(
                      selectedNode,
                      'invertLeft',
                      ($event.target as HTMLInputElement).checked
                    )
                  "
                />
                Invert L</label
              >
              <label class="switch-field"
                ><input
                  :checked="booleanParam(selectedNode, 'invertRight')"
                  type="checkbox"
                  @change="
                    setBooleanParam(
                      selectedNode,
                      'invertRight',
                      ($event.target as HTMLInputElement).checked
                    )
                  "
                />
                Invert R</label
              >
            </template>

            <template v-else-if="selectedNode.type === 'loudnessContour'">
              <label
                >Amount<input
                  :value="numberParam(selectedNode, 'amount', 0)"
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'amount',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
              <label
                >Reference volume<input
                  :value="numberParam(selectedNode, 'referenceVolume', 0.75)"
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'referenceVolume',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
            </template>

            <template v-else-if="selectedNode.type === 'truePeakLimiter'">
              <label
                >Ceiling dB<input
                  :value="numberParam(selectedNode, 'ceilingDb', -0.1)"
                  type="number"
                  min="-12"
                  max="0"
                  step="0.1"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'ceilingDb',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
              <label
                >Attack ms<input
                  :value="numberParam(selectedNode, 'attackMs', 0.2)"
                  type="number"
                  min="0.1"
                  max="1000"
                  step="0.1"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'attackMs',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
              <label
                >Release ms<input
                  :value="numberParam(selectedNode, 'releaseMs', 80)"
                  type="number"
                  min="1"
                  max="5000"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'releaseMs',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
              <label
                >Lookahead ms<input
                  :value="numberParam(selectedNode, 'lookaheadMs', 1)"
                  type="number"
                  min="0.1"
                  max="20"
                  step="0.1"
                  @input="
                    setNumberParam(
                      selectedNode,
                      'lookaheadMs',
                      ($event.target as HTMLInputElement).value
                    )
                  "
              /></label>
            </template>

            <template v-else-if="selectedNode.type === 'vst3Plugin'">
              <label
                >VST3 module<select
                  :value="selectedNode.vst3?.catalogId ?? ''"
                  @change="selectVst3(($event.target as HTMLSelectElement).value)"
                >
                  <option value="">Select module</option>
                  <option
                    v-for="entry in vst3Catalog?.entries.filter(
                      (entry) => entry.status === 'available'
                    ) ?? []"
                    :key="entry.id"
                    :value="entry.id"
                  >
                    {{ entry.vendor }} - {{ entry.name }}
                  </option>
                </select></label
              >
              <label
                >Managed state<select
                  :value="selectedNode.vst3?.stateAssetId ?? ''"
                  :disabled="!selectedNode.vst3"
                  @change="selectVst3State(($event.target as HTMLSelectElement).value)"
                >
                  <option value="">No preset or component state</option>
                  <option v-for="asset in vst3StateAssets" :key="asset.id" :value="asset.id">
                    {{ asset.kind === 'vst3Preset' ? 'Preset' : 'Component state' }} -
                    {{ asset.name }}
                  </option>
                </select></label
              >
              <button
                type="button"
                class="icon-text-button"
                :disabled="!selectedNode.vst3"
                @click="importAsset('vst3Preset')"
              >
                <i class="pi pi-upload"></i>Import preset
              </button>
              <button
                type="button"
                class="icon-text-button"
                :disabled="!selectedNode.vst3"
                @click="importAsset('vst3State')"
              >
                <i class="pi pi-upload"></i>Import state
              </button>
              <button
                type="button"
                class="icon-text-button"
                :disabled="busy || !vst3HelpersReady"
                @click="scanVst3"
              >
                <i class="pi pi-search"></i>Scan VST3
              </button>
              <div
                v-if="vst3Catalog?.entries.some((entry) => entry.status !== 'available')"
                class="vst3-catalog-status"
              >
                <div
                  v-for="entry in vst3Catalog?.entries.filter(
                    (entry) => entry.status !== 'available'
                  ) ?? []"
                  :key="entry.id"
                  class="vst3-catalog-entry"
                >
                  <div>
                    <strong>{{ entry.vendor || 'Unknown vendor' }} - {{ entry.name }}</strong>
                    <small>{{ entry.status }}{{ entry.error ? `: ${entry.error}` : '' }}</small>
                  </div>
                  <button
                    type="button"
                    class="icon-button small"
                    :disabled="busy"
                    :title="`Re-scan and manually re-enable ${entry.name}`"
                    :aria-label="`Re-scan and manually re-enable ${entry.name}`"
                    @click="recoverVst3Module(entry.id)"
                  >
                    <i class="pi pi-refresh"></i>
                  </button>
                </div>
              </div>
              <div v-if="selectedVst3Entry" class="vst3-parameter-grid">
                <template v-for="parameter in visibleVst3Parameters" :key="parameter.id">
                  <label v-if="parameter.stepCount === 1" class="switch-field">
                    <input
                      type="checkbox"
                      :checked="
                        vst3ParameterValue(
                          selectedNode,
                          parameter.id,
                          parameter.defaultNormalizedValue
                        ) >= 0.5
                      "
                      :disabled="isReadOnlyVst3Parameter(parameter.flags)"
                      @change="
                        setVst3Parameter(
                          selectedNode,
                          parameter.id,
                          ($event.target as HTMLInputElement).checked ? 1 : 0
                        )
                      "
                    />
                    {{ parameter.title }}
                  </label>
                  <label v-else class="vst3-parameter-field">
                    <span
                      >{{ parameter.title
                      }}<small v-if="parameter.unit">{{ parameter.unit }}</small></span
                    >
                    <input
                      type="range"
                      min="0"
                      max="1"
                      :step="vst3ParameterStep(parameter.stepCount)"
                      :value="
                        vst3ParameterValue(
                          selectedNode,
                          parameter.id,
                          parameter.defaultNormalizedValue
                        )
                      "
                      :disabled="isReadOnlyVst3Parameter(parameter.flags)"
                      @input="
                        setVst3Parameter(
                          selectedNode,
                          parameter.id,
                          ($event.target as HTMLInputElement).value
                        )
                      "
                    />
                    <output>{{
                      formatMetric(
                        vst3ParameterValue(
                          selectedNode,
                          parameter.id,
                          parameter.defaultNormalizedValue
                        ),
                        3
                      )
                    }}</output>
                  </label>
                </template>
              </div>
            </template>

            <template v-else-if="selectedNode.type === 'nativePlugin'">
              <label
                >Module path<input
                  :value="stringParam(selectedNode, 'path')"
                  @input="
                    setStringParam(selectedNode, 'path', ($event.target as HTMLInputElement).value)
                  "
              /></label>
            </template>
          </section>
          <details class="raw-config">
            <summary>Raw configuration</summary>
            <pre>{{ JSON.stringify(selectedNode.params, null, 2) }}</pre>
          </details>

          <section class="rule-editor">
            <h3>自动规则</h3>
            <label
              >设备<input
                :value="selectedScene.rules.deviceIds?.join(', ') ?? ''"
                placeholder="device-id, device-id"
                @change="updateRuleList('deviceIds', ($event.target as HTMLInputElement).value)"
            /></label>
            <label
              >后端<input
                :value="selectedScene.rules.backends?.join(', ') ?? ''"
                placeholder="wasapi, asio"
                @change="updateRuleList('backends', ($event.target as HTMLInputElement).value)"
            /></label>
            <label
              >布局<input
                :value="selectedScene.rules.channelLayouts?.join(', ') ?? ''"
                placeholder="stereo, 5.1, 7.1"
                @change="
                  updateRuleList('channelLayouts', ($event.target as HTMLInputElement).value)
                "
            /></label>
            <label
              >格式<input
                :value="selectedScene.rules.sourceKinds?.join(', ') ?? ''"
                placeholder="pcm, dsd"
                @change="updateRuleList('sourceKinds', ($event.target as HTMLInputElement).value)"
            /></label>
            <div class="rate-fields">
              <label
                >最低 Hz<input
                  v-model.number="selectedScene.rules.minSampleRate"
                  type="number"
                  min="0" /></label
              ><label
                >最高 Hz<input
                  v-model.number="selectedScene.rules.maxSampleRate"
                  type="number"
                  min="0"
              /></label>
            </div>
          </section>

          <section class="diagnostic-panel">
            <h3>节点诊断</h3>
            <dl>
              <div>
                <dt>状态</dt>
                <dd>
                  {{
                    selectedStatus?.bypassed
                      ? selectedStatus.bypassReason || '旁路'
                      : selectedStatus?.active
                        ? '运行中'
                        : '待命'
                  }}
                </dd>
              </div>
              <div>
                <dt>延迟</dt>
                <dd>{{ selectedStatus?.latencyFrames ?? 0 }} frames</dd>
              </div>
              <div>
                <dt>Tail</dt>
                <dd>{{ selectedStatus?.tailFrames ?? 0 }} frames</dd>
              </div>
              <div>
                <dt>CPU</dt>
                <dd>{{ (selectedStatus?.lastProcessMs ?? 0).toFixed(3) }} ms</dd>
              </div>
              <div>
                <dt>CPU average</dt>
                <dd>{{ formatMetric(selectedStatus?.averageProcessMs, 3, ' ms') }}</dd>
              </div>
              <div>
                <dt>CPU peak</dt>
                <dd>{{ formatMetric(selectedStatus?.maxProcessMs, 3, ' ms') }}</dd>
              </div>
              <div>
                <dt>Overruns</dt>
                <dd>{{ selectedStatus?.overrunCount ?? 0 }}</dd>
              </div>
              <div>
                <dt>Clips</dt>
                <dd>{{ selectedStatus?.clipCount ?? 0 }}</dd>
              </div>
              <div>
                <dt>Format</dt>
                <dd>{{ selectedStatus?.format || '-' }}</dd>
              </div>
            </dl>
            <h3>Graph diagnostics</h3>
            <dl>
              <div>
                <dt>Compile</dt>
                <dd>{{ status?.compileState ?? '-' }}</dd>
              </div>
              <div>
                <dt>Apply</dt>
                <dd :class="['apply-state', graphApplyState]">{{ graphApplyLabel }}</dd>
              </div>
              <div>
                <dt>Requested / applied</dt>
                <dd>{{ status?.requestedRevision ?? 0 }} / {{ status?.appliedRevision ?? 0 }}</dd>
              </div>
              <div v-if="status?.applyError">
                <dt>Apply error</dt>
                <dd class="apply-error">{{ status.applyError }}</dd>
              </div>
              <div v-if="status?.compileError">
                <dt>Compile error</dt>
                <dd>{{ status.compileError }}</dd>
              </div>
              <div>
                <dt>Output rate</dt>
                <dd>{{ status?.outputStage?.actualSampleRate ?? '-' }} Hz</dd>
              </div>
              <div>
                <dt>SRC / dither</dt>
                <dd>
                  {{ status?.outputStage?.resamplerQuality ?? '-' }}
                  <template v-if="status?.outputStage?.resamplerEngine"
                    >({{ status.outputStage.resamplerEngine
                    }}{{ soxrFallbackActive ? ' 回退' : '' }})</template
                  >
                  /
                  {{ status?.outputStage?.dither ?? '-' }}
                </dd>
              </div>
              <div>
                <dt>Graph overruns</dt>
                <dd>{{ graphOverrunCount }}</dd>
              </div>
              <div>
                <dt>Post-DSP clips</dt>
                <dd>{{ status?.meter?.clipCount ?? 0 }}</dd>
              </div>
              <div>
                <dt>Momentary</dt>
                <dd>{{ formatMetric(status?.meter?.momentaryLufs, 1, ' LUFS') }}</dd>
              </div>
              <div>
                <dt>Short-term</dt>
                <dd>{{ formatMetric(status?.meter?.shortTermLufs, 1, ' LUFS') }}</dd>
              </div>
              <div>
                <dt>Integrated</dt>
                <dd>{{ formatMetric(status?.meter?.integratedLufs, 1, ' LUFS') }}</dd>
              </div>
              <div>
                <dt>LRA</dt>
                <dd>{{ formatMetric(status?.meter?.loudnessRangeLu, 1, ' LU') }}</dd>
              </div>
              <div>
                <dt>True peak</dt>
                <dd>{{ formatMetric(status?.meter?.truePeakDb, 2, ' dBTP') }}</dd>
              </div>
              <div>
                <dt>Correlation</dt>
                <dd>{{ formatMetric(status?.meter?.correlation, 3) }}</dd>
              </div>
            </dl>
          </section>
        </template>
        <div v-else class="empty-detail">选择一个节点来编辑参数。</div>
      </aside>
    </div>

    <footer class="rack-footer">
      <span>图延迟 {{ activeGraphLatency }} frames</span
      ><span>尾音 {{ activeGraphTail }} frames</span
      ><span>图 revision {{ status?.revision ?? 0 }}</span
      ><span :class="['apply-state', graphApplyState]">
        {{ graphApplyLabel }} {{ status?.appliedRevision ?? 0 }}/{{
          status?.requestedRevision ?? 0
        }}
      </span>
    </footer>
  </main>
</template>

<style scoped>
.dsp-rack-page {
  height: 100vh;
  min-height: 0;
  min-width: 0;
  padding: calc(28px + 28px) 32px 24px;
  background-color: var(--te-settings-bg, #f5f6f8);
  background-image: var(--te-settings-bg-image, none);
  color: var(--te-settings-text, #1a1a1a);
  font-family: var(--te-font-sans);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  -webkit-font-smoothing: antialiased;
}
.rack-header,
.pane-heading,
.graph-heading,
.scene-toolbar,
.rack-footer,
.rack-header-actions,
.node-add,
.scene-actions {
  display: flex;
  align-items: center;
}
.rack-header {
  justify-content: space-between;
  max-width: 1540px;
  margin: 0 auto 18px;
}
.rack-header h1 {
  margin: 4px 0 0;
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--te-settings-text, #1a1a1a);
}
.eyebrow {
  margin: 0;
  font-size: 12px;
  color: var(--te-settings-text-muted, #8a8f98);
  font-weight: 600;
  letter-spacing: 0.04em;
}
.rack-header-actions {
  gap: 8px;
}
.rack-message {
  max-width: 1540px;
  margin: 0 auto 14px;
  padding: 10px 14px;
  background: var(--te-success-soft-bg, #f0fdf4);
  border: 1px solid color-mix(in srgb, var(--te-success-soft-fg, #16a34a) 28%, transparent);
  border-radius: 12px;
  color: var(--te-success-soft-fg, #16a34a);
  font-size: 13px;
}
.rack-message.error {
  background: var(--te-danger-soft-bg, #fef2f2);
  border-color: color-mix(in srgb, var(--te-danger-soft-fg, #b91c1c) 28%, transparent);
  color: var(--te-danger-soft-fg, #b91c1c);
}
.rack-layout {
  max-width: 1540px;
  min-height: 640px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 230px minmax(420px, 1fr) 320px;
  gap: 14px;
  border: none;
  border-radius: 0;
  background: transparent;
  overflow: visible;
}
.scene-pane,
.graph-pane,
.detail-pane {
  border: 1px solid var(--te-settings-panel-border, transparent);
  border-radius: var(--te-equalizer-panel-radius, 20px);
  background: var(--te-settings-control-bg, var(--te-card-bg, #ffffff));
  box-shadow: var(--te-settings-shadow, 0 2px 16px rgba(15, 23, 42, 0.04));
  padding: 16px;
  min-width: 0;
}
.scene-pane,
.detail-pane {
  background: var(--te-settings-control-bg, #ffffff);
}
.pane-heading {
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
h2,
h3 {
  margin: 0;
  letter-spacing: 0;
  color: var(--te-settings-text, #1a1a1a);
}
h2 {
  font-size: 15px;
  font-weight: 600;
}
h3 {
  font-size: 13px;
  font-weight: 500;
  color: var(--te-settings-text-muted, #8a8f98);
}
.scene-row {
  width: 100%;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 10px 10px;
  color: var(--te-settings-nav-text, #5c6370);
  background: transparent;
  border: 0;
  border-radius: 12px;
  cursor: pointer;
  text-align: left;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}
.scene-row:hover {
  background: var(--te-settings-nav-hover, rgba(15, 23, 42, 0.04));
  color: var(--te-settings-text, #1a1a1a);
}
.scene-row.selected {
  background: var(--te-settings-nav-active, #ffffff);
  color: var(--te-settings-text, #1a1a1a);
  box-shadow: var(--te-settings-shadow-soft, 0 1px 4px rgba(15, 23, 42, 0.04));
}
.scene-row.active strong,
.scene-row.active i {
  color: var(--te-primary-500);
}
.scene-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scene-row small {
  color: var(--te-settings-text-muted, #8a8f98);
}
.scene-actions {
  gap: 6px;
  margin-top: 12px;
}
.factory-template-picker {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 32px;
  gap: 6px;
  margin-top: 10px;
}
.factory-template-picker select {
  min-width: 0;
}
.graph-pane {
  min-width: 0;
}
.scene-toolbar {
  flex-wrap: wrap;
  gap: 9px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--te-settings-control-border, rgba(15, 23, 42, 0.06));
}
.scene-toolbar label,
.switch-field {
  font-size: 12px;
  color: var(--te-settings-text-muted, #8a8f98);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.scene-toolbar input {
  width: 86px;
}
input,
select,
textarea {
  font: inherit;
  color: var(--te-settings-text, #1a1a1a);
  border: 1px solid var(--te-settings-control-border, rgba(15, 23, 42, 0.06));
  border-radius: 12px;
  background: var(--te-settings-control-bg, #ffffff);
  padding: 8px 10px;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
input:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: var(--te-primary-500);
  box-shadow: 0 0 0 3px rgba(var(--te-primary-rgb), 0.14);
}
button {
  font: inherit;
}
.icon-button,
.text-button,
.icon-text-button,
.primary-button {
  border: none;
  background: var(--te-settings-search-bg, #eef0f3);
  color: var(--te-settings-text, #1a1a1a);
  cursor: pointer;
  min-height: 34px;
  border-radius: 999px;
  transition:
    background 0.16s ease,
    color 0.16s ease,
    box-shadow 0.16s ease;
}
.icon-button:hover,
.text-button:hover,
.icon-text-button:hover {
  background: rgba(15, 23, 42, 0.08);
  color: var(--te-primary-500);
}
.icon-button {
  width: 34px;
  padding: 0;
  display: inline-grid;
  place-items: center;
  color: var(--te-settings-text-muted, #8a8f98);
}
.icon-button.small {
  width: 28px;
  min-height: 28px;
}
.text-button,
.icon-text-button,
.primary-button {
  padding: 7px 14px;
}
.icon-text-button i,
.primary-button i {
  margin-right: 6px;
}
.primary-button {
  background: rgba(var(--te-primary-rgb), 0.12);
  color: var(--te-primary-500);
  font-weight: 600;
}
.primary-button:hover {
  background: rgba(var(--te-primary-rgb), 0.18);
}
.icon-text-button.selected {
  background: rgba(var(--te-primary-rgb), 0.12);
  color: var(--te-primary-500);
}
.danger {
  color: var(--te-danger-soft-fg, #b91c1c);
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.dsd-notice {
  display: flex;
  gap: 8px;
  margin: 12px 0;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--te-warning-soft-fg, #d97706) 28%, transparent);
  background: var(--te-warning-soft-bg, #fff7ed);
  color: var(--te-warning-soft-fg, #d97706);
  border-radius: 12px;
  font-size: 12px;
}
.graph-heading {
  justify-content: space-between;
  margin: 15px 0 10px;
}
.graph-heading div:first-child {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.graph-heading span {
  color: var(--te-settings-text-muted, #8a8f98);
  font-size: 12px;
}
.node-add {
  gap: 6px;
}
.node-add select {
  min-width: 150px;
}
.output-stage {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 0 0 12px;
  padding: 12px;
  border: 1px solid var(--te-card-border, rgba(15, 23, 42, 0.08));
  border-radius: 14px;
  background: var(--te-subtle-bg, #f8fafc);
}
.output-stage label,
.node-controls > label {
  display: grid;
  gap: 5px;
  min-width: 0;
  font-size: 12px;
  color: var(--te-settings-text-muted, #8a8f98);
}
.output-stage .switch-field {
  display: inline-flex;
  align-items: end;
  padding-bottom: 7px;
}
.node-list {
  display: grid;
  gap: 8px;
}
.graph-node {
  display: grid;
  grid-template-columns: 18px 18px minmax(0, 1fr) 28px 28px;
  align-items: center;
  gap: 8px;
  min-height: 54px;
  padding: 8px 10px;
  border: 1px solid var(--te-card-border, rgba(15, 23, 42, 0.08));
  border-radius: 14px;
  background: var(--te-card-bg, #ffffff);
  box-shadow: var(--te-settings-shadow-soft, 0 1px 4px rgba(15, 23, 42, 0.04));
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;
}
.graph-node:hover,
.graph-node.selected {
  border-color: color-mix(in srgb, var(--te-primary-500) 35%, transparent);
  background: rgba(var(--te-primary-rgb), 0.04);
}
.graph-node.bypassed {
  opacity: 0.58;
}
.graph-node strong,
.graph-node small {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.graph-node strong {
  font-size: 13px;
  color: var(--te-settings-text, #1a1a1a);
}
.graph-node small {
  font-size: 11px;
  color: var(--te-settings-text-muted, #8a8f98);
  margin-top: 2px;
}
.drag-handle {
  color: var(--te-settings-text-muted, #8a8f98);
  cursor: grab;
}
.v1-note {
  margin: 13px 0 0;
  color: var(--te-settings-text-muted, #8a8f98);
  font-size: 11px;
  line-height: 1.55;
}
.node-controls {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
}
.node-controls .switch-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.node-controls .muted {
  opacity: 0.55;
}
.control-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.matrix-grid {
  display: grid;
  gap: 4px;
  align-items: center;
  overflow-x: auto;
  padding: 10px;
  border: 1px solid var(--te-card-border, rgba(15, 23, 42, 0.08));
  border-radius: 14px;
  background: var(--te-subtle-bg, #f8fafc);
}
.matrix-grid input {
  min-width: 42px;
  padding: 5px 4px;
  text-align: center;
  font-size: 11px;
}
.matrix-axis,
.matrix-corner {
  color: var(--te-settings-text-muted, #8a8f98);
  font-size: 10px;
  font-weight: 700;
  text-align: center;
}
.matrix-corner {
  text-align: left;
}
.channel-strip-row {
  display: grid;
  grid-template-columns: 30px repeat(2, minmax(0, 1fr));
  gap: 7px;
  align-items: end;
  padding: 10px;
  border: 1px solid var(--te-card-border, rgba(15, 23, 42, 0.08));
  border-radius: 14px;
  background: var(--te-subtle-bg, #f8fafc);
}
.channel-strip-row strong {
  align-self: center;
  color: var(--te-primary-500);
  font-size: 12px;
}
.channel-strip-row label,
.crossover-grid label {
  display: grid;
  gap: 4px;
  min-width: 0;
  color: var(--te-settings-text-muted, #8a8f98);
  font-size: 11px;
}
.channel-strip-row .switch-field {
  padding-bottom: 7px;
}
.crossover-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}
.band-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  padding: 10px;
  border: 1px solid var(--te-card-border, rgba(15, 23, 42, 0.08));
  border-radius: 14px;
  background: var(--te-subtle-bg, #f8fafc);
}
.band-grid.compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.band-grid label {
  display: grid;
  gap: 4px;
  min-width: 0;
  color: var(--te-settings-text-muted, #8a8f98);
  font-size: 11px;
}
.band-grid .switch-field {
  display: inline-flex;
  align-items: end;
  padding-bottom: 7px;
}
.vst3-parameter-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  padding: 10px;
  border: 1px solid var(--te-card-border, rgba(15, 23, 42, 0.08));
  border-radius: 14px;
  background: var(--te-subtle-bg, #f8fafc);
}
.vst3-catalog-status {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--te-warning-soft-fg, #d97706) 28%, transparent);
  border-radius: 12px;
  background: var(--te-warning-soft-bg, #fff7ed);
}
.vst3-catalog-entry {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px;
  gap: 8px;
  align-items: center;
  color: var(--te-warning-soft-fg, #d97706);
}
.vst3-catalog-entry strong,
.vst3-catalog-entry small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vst3-catalog-entry strong {
  font-size: 11px;
}
.vst3-catalog-entry small {
  margin-top: 2px;
  font-size: 10px;
  opacity: 0.85;
}
.vst3-parameter-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 54px;
  gap: 5px 8px;
  align-items: center;
  min-width: 0;
  color: var(--te-settings-text-muted, #8a8f98);
  font-size: 11px;
}
.vst3-parameter-field span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vst3-parameter-field small {
  margin-left: 4px;
  color: var(--te-settings-text-muted, #8a8f98);
}
.vst3-parameter-field input {
  min-width: 0;
  padding: 0;
}
.vst3-parameter-field output {
  color: var(--te-settings-text-muted, #8a8f98);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.raw-config {
  border-top: 1px solid var(--te-settings-control-border, rgba(15, 23, 42, 0.06));
  padding-top: 12px;
  color: var(--te-settings-text-muted, #8a8f98);
  font-size: 12px;
}
.raw-config pre {
  max-height: 150px;
  margin: 8px 0 0;
  overflow: auto;
  padding: 10px;
  border: 1px solid var(--te-card-border, rgba(15, 23, 42, 0.08));
  border-radius: 12px;
  background: var(--te-subtle-bg, #f8fafc);
  color: var(--te-settings-text, #1a1a1a);
  font:
    11px/1.45 Consolas,
    monospace;
  white-space: pre-wrap;
}
.full-field,
.rule-editor > label {
  display: grid;
  gap: 5px;
  font-size: 12px;
  color: var(--te-settings-text-muted, #8a8f98);
  margin-bottom: 10px;
}
.full-field input,
.full-field textarea,
.rule-editor input {
  width: 100%;
  box-sizing: border-box;
}
.full-field textarea {
  height: 155px;
  resize: vertical;
  font-family: Consolas, monospace;
  font-size: 11px;
  line-height: 1.45;
}
.apply-params {
  width: 100%;
  margin-bottom: 16px;
}
.rule-editor {
  border-top: 1px solid var(--te-settings-control-border, rgba(15, 23, 42, 0.06));
  padding-top: 14px;
}
.rule-editor h3,
.diagnostic-panel h3 {
  margin-bottom: 11px;
}
.diagnostic-panel h3:not(:first-child) {
  margin-top: 16px;
}
.rate-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.rate-fields label {
  display: grid;
  gap: 5px;
  font-size: 12px;
  color: var(--te-settings-text-muted, #8a8f98);
}
.diagnostic-panel {
  border-top: 1px solid var(--te-settings-control-border, rgba(15, 23, 42, 0.06));
  margin-top: 15px;
  padding-top: 14px;
}
.diagnostic-panel dl {
  margin: 0;
  display: grid;
  gap: 7px;
}
.diagnostic-panel dl div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.diagnostic-panel dt {
  color: var(--te-settings-text-muted, #8a8f98);
}
.diagnostic-panel dd {
  margin: 0;
  text-align: right;
  color: var(--te-settings-text, #1a1a1a);
  overflow-wrap: anywhere;
}
.apply-state.pending {
  color: var(--te-warning-soft-fg, #d97706);
}
.apply-state.applied {
  color: var(--te-success-soft-fg, #16a34a);
}
.apply-state.failed,
.apply-error {
  color: var(--te-danger-soft-fg, #b91c1c);
}
.empty-detail {
  padding-top: 36px;
  color: var(--te-settings-text-muted, #8a8f98);
  font-size: 13px;
  text-align: center;
}
.rack-footer {
  max-width: 1540px;
  gap: 18px;
  margin: 12px auto 0;
  color: var(--te-settings-text-muted, #8a8f98);
  font-size: 12px;
}
@media (max-width: 1080px) {
  .dsp-rack-page {
    padding: 20px;
  }
  .rack-layout {
    grid-template-columns: 200px minmax(380px, 1fr);
  }
  .detail-pane {
    grid-column: 1 / -1;
  }
  .detail-pane :deep(textarea) {
    max-height: 140px;
  }
}
@media (max-width: 720px) {
  .dsp-rack-page {
    padding: 16px;
  }
  .rack-layout {
    display: flex;
    flex-direction: column;
  }
  .scene-pane,
  .graph-pane,
  .detail-pane {
    width: 100%;
  }
  .graph-pane {
    padding: 14px;
  }
  .rack-header {
    align-items: flex-start;
  }
  .scene-toolbar {
    align-items: stretch;
  }
  .rack-footer {
    flex-wrap: wrap;
  }
  .rack-header h1 {
    font-size: 22px;
  }
  .output-stage {
    grid-template-columns: 1fr 1fr;
  }
  .band-grid {
    grid-template-columns: 1fr 1fr;
  }
  .vst3-parameter-grid {
    grid-template-columns: 1fr;
  }
}
:global(html[data-te-equalizer-panel] .dsp-rack-page .scene-pane),
:global(html[data-te-equalizer-panel] .dsp-rack-page .graph-pane),
:global(html[data-te-equalizer-panel] .dsp-rack-page .detail-pane),
:global(html[data-te-equalizer-panel] .dsp-rack-page .output-stage),
:global(html[data-te-equalizer-panel] .dsp-rack-page .graph-node) {
  border-color: var(--te-equalizer-panel-border);
  background: var(--te-equalizer-panel-bg);
  border-radius: var(--te-equalizer-panel-radius);
}

:global(html[data-te-equalizer-panel='tinted'] .dsp-rack-page .scene-pane),
:global(html[data-te-equalizer-panel='tinted'] .dsp-rack-page .graph-pane),
:global(html[data-te-equalizer-panel='tinted'] .dsp-rack-page .detail-pane) {
  background: color-mix(in srgb, var(--te-equalizer-panel-bg) 84%, var(--te-primary-500));
}

:global(html[data-te-equalizer-panel='glass'] .dsp-rack-page .scene-pane),
:global(html[data-te-equalizer-panel='glass'] .dsp-rack-page .graph-pane),
:global(html[data-te-equalizer-panel='glass'] .dsp-rack-page .detail-pane) {
  background: color-mix(in srgb, var(--te-equalizer-panel-bg) 68%, transparent);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
}

:global(html[data-te-equalizer-button] .dsp-rack-page .icon-button),
:global(html[data-te-equalizer-button] .dsp-rack-page .text-button),
:global(html[data-te-equalizer-button] .dsp-rack-page .icon-text-button),
:global(html[data-te-equalizer-button] .dsp-rack-page .primary-button) {
  border-radius: var(--te-equalizer-button-radius);
}

:global(html[data-te-equalizer-button='soft'] .dsp-rack-page .icon-button),
:global(html[data-te-equalizer-button='soft'] .dsp-rack-page .text-button),
:global(html[data-te-equalizer-button='soft'] .dsp-rack-page .icon-text-button) {
  border-color: transparent;
  background: var(--te-equalizer-button-bg);
}

:global(html[data-te-equalizer-button='outline'] .dsp-rack-page .icon-button),
:global(html[data-te-equalizer-button='outline'] .dsp-rack-page .text-button),
:global(html[data-te-equalizer-button='outline'] .dsp-rack-page .icon-text-button) {
  border: 1px solid var(--te-equalizer-panel-border);
  background: transparent;
}

:global(html[data-te-equalizer-button='solid'] .dsp-rack-page .icon-button),
:global(html[data-te-equalizer-button='solid'] .dsp-rack-page .text-button),
:global(html[data-te-equalizer-button='solid'] .dsp-rack-page .icon-text-button),
:global(html[data-te-equalizer-button='solid'] .dsp-rack-page .primary-button) {
  border-color: var(--te-primary-500);
  background: var(--te-primary-500);
  color: var(--te-neutral-50);
}

:global(html[data-te-equalizer-slider] .dsp-rack-page input[type='range']) {
  accent-color: var(--te-primary-500);
}

:global(
  html[data-te-equalizer-slider] .dsp-rack-page input[type='range']::-webkit-slider-runnable-track
) {
  border-radius: 999px;
  background: var(--te-equalizer-slider-track);
}

:global(html[data-te-equalizer-slider] .dsp-rack-page input[type='range']::-webkit-slider-thumb) {
  width: var(--te-equalizer-slider-thumb-size);
  height: var(--te-equalizer-slider-thumb-size);
  border: 2px solid var(--te-primary-500);
  border-radius: 50%;
  background: var(--te-equalizer-slider-thumb);
}

:global(
  html[data-te-equalizer-slider='solid'] .dsp-rack-page input[type='range']::-webkit-slider-thumb
) {
  border: 0;
  background: var(--te-primary-500);
}
</style>
