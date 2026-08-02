<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  PARAMETRIC_EQ_MAX_BANDS,
  PARAMETRIC_EQ_MAX_FREQUENCY,
  PARAMETRIC_EQ_MAX_GAIN,
  PARAMETRIC_EQ_MAX_Q,
  PARAMETRIC_EQ_MIN_FREQUENCY,
  PARAMETRIC_EQ_MIN_GAIN,
  PARAMETRIC_EQ_MIN_Q,
  adjustQByWheel,
  clampEqValue,
  displayBandGain,
  filterUsesGain,
  frequencyToPercent,
  gainToPercent,
  percentToFrequency,
  percentToGain
} from '@renderer/utils/parametricEqInteraction'
import type { EqualizerBand, EqualizerFilterType } from '../../types/settings'

interface BandResponsePath {
  index: number
  path: string
}

interface FilterOption {
  value: EqualizerFilterType
  label: string
  usesGain: boolean
}

const props = defineProps<{
  bands: EqualizerBand[]
  selectedIndex: number
  filterTypes: FilterOption[]
  responseView: 'dsp' | 'headphone'
  responsePath: string
  responseFillPath: string
  spectrumPath: string
  spectrumVisible: boolean
  measuredSourcePath: string
  targetResponsePath: string
  correctedAcousticPath: string
  bandResponsePaths: BandResponsePath[]
  eqEnabled: boolean
  status: string
  statusState: string
  error: string
}>()

const emit = defineEmits<{
  select: [index: number]
  add: [frequency: number, gain: number]
  preview: [index: number, patch: Partial<EqualizerBand>]
  commit: []
  delete: [index: number]
  toggle: [index: number]
  filter: [index: number, filterType: EqualizerFilterType]
  'toggle-spectrum': []
}>()

const surfaceRef = ref<HTMLElement | null>(null)
const hoveredIndex = ref<number | null>(null)
const pointerPosition = ref<{ x: number; y: number } | null>(null)
const drag = ref<{ index: number; pointerId: number; rect: DOMRect } | null>(null)
const bandColors = [
  'var(--te-eq-band-blue, #4ea1ff)',
  'var(--te-eq-band-cyan, #35d2e8)',
  'var(--te-eq-band-green, #38d98a)',
  'var(--te-eq-band-yellow, #f2cf45)',
  'var(--te-eq-band-orange, #ff9d3d)',
  'var(--te-eq-band-magenta, #db62df)',
  'var(--te-eq-band-violet, #9b7cff)',
  'var(--te-eq-band-red, #ff6680)'
]
const frequencyTicks = [
  20, 30, 50, 70, 100, 200, 300, 500, 700, 1000, 2000, 3000, 5000, 7000, 10000, 20000
]
const majorFrequencyTicks = new Set([20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000])
const gainTicks = [18, 12, 6, 0, -6, -12, -18]
const filterGlyphs: Record<EqualizerFilterType, string> = {
  peak: '⌁',
  lowShelf: '╰',
  highShelf: '╮',
  bandPass: '∩',
  lowPass: '╲',
  highPass: '╱',
  allPass: '∿',
  notch: '∨'
}

const selectedBand = computed(() => props.bands[props.selectedIndex] ?? null)
const hoveredBand = computed(() =>
  hoveredIndex.value === null ? null : (props.bands[hoveredIndex.value] ?? null)
)
const tooltipBand = computed(() => hoveredBand.value ?? (drag.value ? selectedBand.value : null))
const tooltipIndex = computed(() => hoveredIndex.value ?? (drag.value ? props.selectedIndex : null))
const spectrumFillPath = computed(() =>
  props.spectrumPath ? `${props.spectrumPath} L100,100 L0,100 Z` : ''
)
const selectedResponsePath = computed(
  () => props.bandResponsePaths.find((item) => item.index === props.selectedIndex)?.path ?? ''
)
const selectedResponseFillPath = computed(() =>
  selectedResponsePath.value ? `${selectedResponsePath.value} L100,50 L0,50 Z` : ''
)
const activeBandCount = computed(() => props.bands.filter((band) => band.enabled !== false).length)

function bandColor(index: number): string {
  return bandColors[index % bandColors.length]
}

function bandFilterLabel(band: EqualizerBand): string {
  return props.filterTypes.find((filter) => filter.value === band.filterType)?.label ?? '峰值'
}

function formatFrequency(frequency: number): string {
  if (frequency >= 1000) return `${(frequency / 1000).toFixed(frequency >= 10000 ? 1 : 2)} kHz`
  return `${Math.round(frequency)} Hz`
}

function formatGain(gain: number): string {
  return `${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB`
}

function formatTickFrequency(frequency: number): string {
  if (frequency >= 1000) return `${frequency / 1000}k`
  return String(frequency)
}

function filterGlyph(filterType: EqualizerFilterType): string {
  return filterGlyphs[filterType]
}

function knobProgress(value: number, min: number, max: number): string {
  const ratio = (clampEqValue(value, min, max) - min) / (max - min)
  return `${Math.round(ratio * 270 - 135)}deg`
}

function frequencyKnobProgress(frequency: number): string {
  return `${Math.round((frequencyToPercent(frequency) / 100) * 270 - 135)}deg`
}

function nudgeNumeric(field: 'frequency' | 'gain' | 'q', direction: -1 | 1, fine = false): void {
  const band = selectedBand.value
  if (!band) return
  const next =
    field === 'frequency'
      ? clampEqValue(
          band.frequency * (fine ? (direction > 0 ? 1.005 : 0.995) : direction > 0 ? 1.025 : 0.975),
          PARAMETRIC_EQ_MIN_FREQUENCY,
          PARAMETRIC_EQ_MAX_FREQUENCY
        )
      : field === 'gain'
        ? clampEqValue(
            band.gain + direction * (fine ? 0.1 : 0.5),
            PARAMETRIC_EQ_MIN_GAIN,
            PARAMETRIC_EQ_MAX_GAIN
          )
        : clampEqValue(
            band.q * (fine ? (direction > 0 ? 1.01 : 0.99) : direction > 0 ? 1.08 : 0.92),
            PARAMETRIC_EQ_MIN_Q,
            PARAMETRIC_EQ_MAX_Q
          )
  emit('preview', props.selectedIndex, {
    [field]: field === 'frequency' ? Math.round(next) : Math.round(next * 100) / 100
  })
  emit('commit')
}

function eventCoordinates(
  event: PointerEvent | MouseEvent,
  rect: DOMRect
): {
  x: number
  y: number
  frequency: number
  gain: number
} {
  const x = Math.min(
    100,
    Math.max(0, ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100)
  )
  const y = Math.min(
    100,
    Math.max(0, ((event.clientY - rect.top) / Math.max(1, rect.height)) * 100)
  )
  return { x, y, frequency: percentToFrequency(x), gain: percentToGain(y) }
}

function updatePointer(event: PointerEvent): void {
  const surface = surfaceRef.value
  if (!surface) return
  const point = eventCoordinates(event, surface.getBoundingClientRect())
  pointerPosition.value = { x: point.x, y: point.y }
  if (!drag.value || drag.value.pointerId !== event.pointerId) return
  const band = props.bands[drag.value.index]
  if (!band) return
  emit('preview', drag.value.index, {
    frequency: point.frequency,
    ...(filterUsesGain(band.filterType) ? { gain: point.gain } : {})
  })
}

function addBand(event: MouseEvent): void {
  if (props.responseView !== 'dsp' || drag.value) return
  if ((event.target as HTMLElement).closest('.parametric-band-handle')) return
  if (hoveredIndex.value !== null) return
  if (props.bands.length >= PARAMETRIC_EQ_MAX_BANDS) return
  const surface = surfaceRef.value
  if (!surface) return
  const point = eventCoordinates(event, surface.getBoundingClientRect())
  emit('add', point.frequency, point.gain)
}

function beginDrag(index: number, event: PointerEvent): void {
  if (props.responseView !== 'dsp') return
  const element = event.currentTarget as HTMLElement
  const surface = surfaceRef.value
  if (!surface) return
  emit('select', index)
  hoveredIndex.value = index
  drag.value = { index, pointerId: event.pointerId, rect: surface.getBoundingClientRect() }
  element.setPointerCapture(event.pointerId)
}

function endDrag(event: PointerEvent): void {
  if (!drag.value || drag.value.pointerId !== event.pointerId) return
  const element = event.currentTarget as HTMLElement
  if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
  drag.value = null
  emit('commit')
}

function adjustQ(index: number, event: WheelEvent): void {
  const band = props.bands[index]
  if (!band) return
  emit('select', index)
  emit('preview', index, { q: adjustQByWheel(band.q, event.deltaY, event.shiftKey) })
  emit('commit')
}

function resetBandGain(index: number): void {
  const band = props.bands[index]
  if (!band || !filterUsesGain(band.filterType)) return
  emit('select', index)
  emit('preview', index, { gain: 0 })
  emit('commit')
}

function handleBandKeydown(index: number, event: KeyboardEvent): void {
  const band = props.bands[index]
  if (!band) return
  const frequencyDirection = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  const gainDirection = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0
  if (frequencyDirection === 0 && gainDirection === 0) return
  event.preventDefault()
  emit('select', index)
  const frequency = clampEqValue(
    band.frequency *
      (event.shiftKey
        ? frequencyDirection > 0
          ? 1.005
          : 0.995
        : frequencyDirection > 0
          ? 1.025
          : 0.975),
    PARAMETRIC_EQ_MIN_FREQUENCY,
    PARAMETRIC_EQ_MAX_FREQUENCY
  )
  emit('preview', index, {
    ...(frequencyDirection !== 0 ? { frequency: Math.round(frequency) } : {}),
    ...(gainDirection !== 0 && filterUsesGain(band.filterType)
      ? {
          gain: clampEqValue(
            band.gain + gainDirection * (event.shiftKey ? 0.1 : 0.5),
            PARAMETRIC_EQ_MIN_GAIN,
            PARAMETRIC_EQ_MAX_GAIN
          )
        }
      : {})
  })
  emit('commit')
}

function updateNumeric(field: 'frequency' | 'gain' | 'q', event: Event): void {
  const band = selectedBand.value
  if (!band) return
  emit('preview', props.selectedIndex, {
    [field]: Number((event.target as HTMLInputElement).value)
  })
  emit('commit')
}
</script>

<template>
  <section class="parametric-workspace" data-te-parametric-eq-workspace>
    <div class="parametric-stage-header">
      <div class="stage-brand">
        <span class="brand-mark">EQ</span>
        <div>
          <strong>PARAMETRIC ANALYZER</strong>
          <small>{{ activeBandCount }} ACTIVE BANDS</small>
        </div>
      </div>
      <div class="stage-help">拖动 FREQ / GAIN · 滚轮 Q · 双击归零 · 方向键微调 · Shift 精调</div>
      <div class="stage-actions">
        <div class="stage-status" :class="`is-${statusState}`" :title="error || status">
          <span class="status-dot"></span>
          <span>{{ status }}</span>
        </div>
        <button
          type="button"
          class="spectrum-toggle"
          :class="{ active: spectrumVisible }"
          :aria-pressed="spectrumVisible"
          @click="emit('toggle-spectrum')"
        >
          <i class="pi pi-chart-line"></i>
          ANALYZER
        </button>
      </div>
    </div>

    <div
      ref="surfaceRef"
      class="parametric-graph-surface"
      :class="{ disabled: !eqEnabled, dragging: drag }"
      role="application"
      aria-label="参数均衡器频响编辑区"
      @pointermove="updatePointer"
      @pointerleave="pointerPosition = null"
      @click.self="addBand"
    >
      <div class="analyzer-vignette"></div>
      <div class="gain-shade positive"></div>
      <div class="gain-shade negative"></div>
      <div
        v-for="frequency in frequencyTicks"
        :key="`frequency-grid-${frequency}`"
        class="frequency-grid-line"
        :class="{ major: majorFrequencyTicks.has(frequency) }"
        :style="{ left: frequencyToPercent(frequency) + '%' }"
      ></div>
      <div
        v-for="gain in gainTicks"
        :key="`gain-grid-${gain}`"
        class="gain-grid-line"
        :class="{ zero: gain === 0 }"
        :style="{ top: gainToPercent(gain) + '%' }"
      ></div>

      <div class="gain-labels" aria-hidden="true">
        <span v-for="gain in gainTicks" :key="gain" :style="{ top: gainToPercent(gain) + '%' }">
          {{ gain > 0 ? '+' + gain : gain }}
        </span>
      </div>
      <div class="frequency-labels" aria-hidden="true">
        <span
          v-for="frequency in frequencyTicks.filter((tick) => majorFrequencyTicks.has(tick))"
          :key="frequency"
          :style="{ left: frequencyToPercent(frequency) + '%' }"
        >
          {{ formatTickFrequency(frequency) }}
        </span>
      </div>

      <svg
        class="parametric-plot"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="parametricEqFill" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stop-color="var(--selected-band-color, var(--te-primary-500))"
              stop-opacity="0.24"
            />
            <stop
              offset="50%"
              stop-color="var(--selected-band-color, var(--te-primary-500))"
              stop-opacity="0.08"
            />
            <stop
              offset="100%"
              stop-color="var(--selected-band-color, var(--te-primary-500))"
              stop-opacity="0.015"
            />
          </linearGradient>
          <linearGradient id="selectedBandFill" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stop-color="var(--selected-band-color, var(--te-primary-500))"
              stop-opacity="0.36"
            />
            <stop
              offset="100%"
              stop-color="var(--selected-band-color, var(--te-primary-500))"
              stop-opacity="0.04"
            />
          </linearGradient>
          <linearGradient id="spectrumFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--eq-spectrum)" stop-opacity="0.16" />
            <stop offset="100%" stop-color="var(--eq-spectrum)" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path
          v-if="responseView === 'dsp' && spectrumVisible && spectrumFillPath"
          class="live-spectrum-fill"
          :d="spectrumFillPath"
        />
        <path
          v-if="responseView === 'dsp' && spectrumVisible && spectrumPath"
          class="live-spectrum-line"
          :d="spectrumPath"
          vector-effect="non-scaling-stroke"
        />
        <path
          v-if="responseView === 'headphone' && measuredSourcePath"
          class="measured-source-line"
          :d="measuredSourcePath"
          vector-effect="non-scaling-stroke"
        />
        <path
          v-if="responseView === 'headphone' && targetResponsePath"
          class="target-response-line"
          :d="targetResponsePath"
          vector-effect="non-scaling-stroke"
        />
        <path
          v-if="responseView === 'headphone' && correctedAcousticPath"
          class="corrected-acoustic-line"
          :d="correctedAcousticPath"
          vector-effect="non-scaling-stroke"
        />
        <template v-if="responseView === 'dsp'">
          <path
            v-if="selectedResponseFillPath"
            class="selected-band-fill"
            :style="{ '--selected-band-color': bandColor(selectedIndex) }"
            :d="selectedResponseFillPath"
          />
          <path
            v-for="item in bandResponsePaths"
            :key="item.index"
            class="individual-band-line"
            :class="{ selected: selectedIndex === item.index }"
            :style="{ '--band-color': bandColor(item.index) }"
            :d="item.path"
            vector-effect="non-scaling-stroke"
          />
          <path
            class="composite-fill"
            :style="{ '--selected-band-color': bandColor(selectedIndex) }"
            :d="responseFillPath"
          />
          <path
            class="composite-response-line"
            :d="responsePath"
            vector-effect="non-scaling-stroke"
          />
        </template>
      </svg>

      <template v-if="responseView === 'dsp'">
        <div
          v-if="selectedBand"
          class="selected-band-focus"
          :style="{
            left: frequencyToPercent(selectedBand.frequency) + '%',
            top: gainToPercent(displayBandGain(selectedBand)) + '%',
            '--band-color': bandColor(selectedIndex),
            '--focus-width': Math.max(38, Math.min(240, 150 / Math.sqrt(selectedBand.q))) + 'px'
          }"
          aria-hidden="true"
        ></div>
        <button
          v-for="(band, index) in bands"
          :key="`${index}-${band.filterType}`"
          type="button"
          class="parametric-band-handle"
          :class="{
            selected: selectedIndex === index,
            hovered: hoveredIndex === index,
            bypassed: band.enabled === false,
            dragging: drag?.index === index
          }"
          :style="{
            left: frequencyToPercent(band.frequency) + '%',
            top: gainToPercent(displayBandGain(band)) + '%',
            '--band-color': bandColor(index)
          }"
          :aria-label="`频段 ${index + 1}，${formatFrequency(band.frequency)}，${formatGain(displayBandGain(band))}，Q ${band.q.toFixed(2)}`"
          :aria-pressed="selectedIndex === index"
          @click.stop="emit('select', index)"
          @pointerenter="hoveredIndex = index"
          @pointerleave="hoveredIndex = null"
          @pointerdown.prevent.stop="beginDrag(index, $event)"
          @pointermove.prevent.stop="updatePointer"
          @pointerup.prevent.stop="endDrag"
          @pointercancel.prevent.stop="endDrag"
          @wheel.prevent.stop="adjustQ(index, $event)"
          @dblclick.prevent.stop="resetBandGain(index)"
          @keydown="handleBandKeydown(index, $event)"
        >
          <span class="handle-glyph">{{ filterGlyph(band.filterType) }}</span>
          <span class="handle-index">{{ index + 1 }}</span>
        </button>
      </template>

      <div
        v-if="tooltipBand && tooltipIndex !== null"
        class="band-tooltip"
        :style="{
          left: frequencyToPercent(tooltipBand.frequency) + '%',
          top: gainToPercent(displayBandGain(tooltipBand)) + '%',
          '--band-color': bandColor(tooltipIndex)
        }"
      >
        <strong>{{ bandFilterLabel(tooltipBand) }}</strong>
        <span>{{ formatFrequency(tooltipBand.frequency) }}</span>
        <span>{{ formatGain(displayBandGain(tooltipBand)) }}</span>
        <span>Q {{ tooltipBand.q.toFixed(2) }}</span>
      </div>

      <div
        v-if="pointerPosition && responseView === 'dsp' && !drag"
        class="graph-crosshair"
        :style="{ left: pointerPosition.x + '%', top: pointerPosition.y + '%' }"
        aria-hidden="true"
      ></div>

      <div v-if="bands.length >= PARAMETRIC_EQ_MAX_BANDS" class="band-limit-notice">
        已达到 {{ PARAMETRIC_EQ_MAX_BANDS }} 个频段上限
      </div>
    </div>

    <div
      v-if="selectedBand"
      class="floating-band-inspector"
      :style="{ '--band-color': bandColor(selectedIndex) }"
    >
      <div class="inspector-topbar">
        <div class="inspector-identity">
          <button
            type="button"
            class="band-power"
            :class="{ bypassed: selectedBand.enabled === false }"
            :aria-label="selectedBand.enabled === false ? '启用频段' : '旁路频段'"
            @click="emit('toggle', selectedIndex)"
          >
            <i class="pi pi-power-off"></i>
          </button>
          <span class="selected-band-badge">{{ selectedIndex + 1 }}</span>
          <div>
            <small>SELECTED BAND</small>
            <strong>{{ bandFilterLabel(selectedBand) }}</strong>
          </div>
        </div>

        <div class="filter-strip" aria-label="滤波器类型">
          <button
            v-for="filter in filterTypes"
            :key="filter.value"
            type="button"
            :class="{ active: selectedBand.filterType === filter.value }"
            :title="filter.label"
            :aria-label="filter.label"
            :aria-pressed="selectedBand.filterType === filter.value"
            @click="emit('filter', selectedIndex, filter.value)"
          >
            {{ filterGlyph(filter.value) }}
          </button>
        </div>

        <button
          type="button"
          class="delete-band"
          aria-label="删除所选频段"
          @click="emit('delete', selectedIndex)"
        >
          <i class="pi pi-times"></i>
        </button>
      </div>

      <div class="precision-controls">
        <label
          class="precision-control"
          :style="{ '--knob-angle': frequencyKnobProgress(selectedBand.frequency) }"
        >
          <span class="control-label">FREQUENCY</span>
          <div class="knob-shell frequency-knob">
            <button
              type="button"
              aria-label="降低频率"
              @click="nudgeNumeric('frequency', -1, $event.shiftKey)"
            >
              −
            </button>
            <div class="knob-face"><span></span></div>
            <button
              type="button"
              aria-label="提高频率"
              @click="nudgeNumeric('frequency', 1, $event.shiftKey)"
            >
              +
            </button>
          </div>
          <div class="precision-readout">
            <input
              type="number"
              min="20"
              max="20000"
              step="1"
              :value="Math.round(selectedBand.frequency)"
              @change="updateNumeric('frequency', $event)"
            />
            <small>Hz</small>
          </div>
        </label>

        <label
          class="precision-control"
          :class="{ disabled: !filterUsesGain(selectedBand.filterType) }"
          :style="{
            '--knob-angle': knobProgress(
              selectedBand.gain,
              PARAMETRIC_EQ_MIN_GAIN,
              PARAMETRIC_EQ_MAX_GAIN
            )
          }"
        >
          <span class="control-label">GAIN</span>
          <div class="knob-shell gain-knob">
            <button
              type="button"
              aria-label="降低增益"
              :disabled="!filterUsesGain(selectedBand.filterType)"
              @click="nudgeNumeric('gain', -1, $event.shiftKey)"
            >
              −
            </button>
            <div class="knob-face"><span></span></div>
            <button
              type="button"
              aria-label="提高增益"
              :disabled="!filterUsesGain(selectedBand.filterType)"
              @click="nudgeNumeric('gain', 1, $event.shiftKey)"
            >
              +
            </button>
          </div>
          <div class="precision-readout">
            <input
              type="number"
              min="-18"
              max="18"
              step="0.1"
              :value="selectedBand.gain.toFixed(1)"
              :disabled="!filterUsesGain(selectedBand.filterType)"
              @change="updateNumeric('gain', $event)"
            />
            <small>dB</small>
          </div>
        </label>

        <label
          class="precision-control"
          :style="{
            '--knob-angle': knobProgress(selectedBand.q, PARAMETRIC_EQ_MIN_Q, PARAMETRIC_EQ_MAX_Q)
          }"
        >
          <span class="control-label">Q / SLOPE</span>
          <div class="knob-shell q-knob">
            <button
              type="button"
              aria-label="降低 Q 值"
              @click="nudgeNumeric('q', -1, $event.shiftKey)"
            >
              −
            </button>
            <div class="knob-face"><span></span></div>
            <button
              type="button"
              aria-label="提高 Q 值"
              @click="nudgeNumeric('q', 1, $event.shiftKey)"
            >
              +
            </button>
          </div>
          <div class="precision-readout">
            <input
              type="number"
              min="0.1"
              max="20"
              step="0.01"
              :value="selectedBand.q.toFixed(2)"
              @change="updateNumeric('q', $event)"
            />
            <small>Q</small>
          </div>
        </label>
      </div>
    </div>
  </section>
</template>

<style scoped>
.parametric-workspace {
  --eq-surface: color-mix(in srgb, var(--te-card-bg) 96%, var(--te-neutral-100));
  --eq-surface-soft: color-mix(in srgb, var(--te-card-bg) 88%, var(--te-neutral-100));
  --eq-panel: color-mix(in srgb, var(--te-card-bg) 94%, var(--te-neutral-100));
  --eq-panel-raised: var(--te-card-bg);
  --eq-text: var(--te-neutral-900);
  --eq-text-muted: color-mix(in srgb, var(--te-neutral-900) 56%, transparent);
  --eq-text-subtle: color-mix(in srgb, var(--te-neutral-900) 34%, transparent);
  --eq-border: color-mix(in srgb, var(--te-neutral-900) 12%, transparent);
  --eq-border-soft: color-mix(in srgb, var(--te-neutral-900) 7%, transparent);
  --eq-grid: color-mix(in srgb, var(--te-neutral-900) 7%, transparent);
  --eq-grid-major: color-mix(in srgb, var(--te-neutral-900) 12%, transparent);
  --eq-zero-axis: color-mix(in srgb, var(--te-neutral-900) 24%, transparent);
  --eq-response: color-mix(in srgb, var(--te-neutral-900) 86%, transparent);
  --eq-spectrum: color-mix(in srgb, var(--te-neutral-900) 34%, transparent);
  --eq-control-bg: color-mix(in srgb, var(--te-neutral-900) 4%, transparent);
  --eq-tooltip-bg: color-mix(in srgb, var(--te-card-bg) 96%, var(--te-neutral-100));
  --eq-shadow: color-mix(in srgb, var(--te-neutral-900) 14%, transparent);
  --eq-shadow-strong: color-mix(in srgb, var(--te-neutral-900) 22%, transparent);
  --eq-highlight: color-mix(in srgb, var(--te-card-bg) 74%, transparent);
  --eq-handle-on-color: var(--te-neutral-50);
  color: var(--eq-text);
  background: var(--eq-surface);
  border: 1px solid var(--eq-border);
  border-radius: 22px;
  overflow: hidden;
  box-shadow: 0 24px 60px var(--eq-shadow);
}

.parametric-stage-header {
  min-height: 48px;
  padding: 9px 14px;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--te-neutral-50) 10%, transparent);
  background: var(--eq-surface-soft);
}

.stage-status,
.spectrum-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--te-neutral-300);
  font-size: 11px;
  font-weight: 700;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--te-success-500);
  box-shadow: 0 0 12px var(--te-success-500);
}

.stage-status.is-applying .status-dot,
.stage-status.is-editing .status-dot {
  background: var(--te-warning-500);
  box-shadow: 0 0 12px var(--te-warning-500);
  animation: statusPulse 0.9s ease-in-out infinite alternate;
}

.stage-status.is-failed .status-dot {
  background: var(--te-danger-soft-fg);
  box-shadow: 0 0 12px var(--te-danger-soft-fg);
}

.stage-help {
  overflow: hidden;
  color: var(--te-neutral-500);
  font-size: 11px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spectrum-toggle {
  appearance: none;
  border: 1px solid color-mix(in srgb, var(--te-neutral-50) 12%, transparent);
  border-radius: 9px;
  padding: 7px 10px;
  background: transparent;
  cursor: pointer;
}

.spectrum-toggle.active {
  border-color: color-mix(in srgb, var(--te-primary-500) 55%, transparent);
  color: var(--te-primary-400);
  background: color-mix(in srgb, var(--te-primary-500) 12%, transparent);
}

.parametric-graph-surface {
  position: relative;
  height: clamp(310px, 48vh, 520px);
  min-height: 310px;
  overflow: hidden;
  cursor: crosshair;
  touch-action: none;
  user-select: none;
  background:
    radial-gradient(
      circle at 50% 50%,
      color-mix(in srgb, var(--te-primary-500) 7%, transparent),
      transparent 54%
    ),
    var(--eq-surface);
}

.parametric-graph-surface.disabled .composite-response-line,
.parametric-graph-surface.disabled .composite-fill,
.parametric-graph-surface.disabled .individual-band-line {
  opacity: 0.35;
}

.graph-grid,
.gain-shade,
.zero-axis {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.graph-grid.minor {
  opacity: 0.5;
  background-image:
    linear-gradient(to right, var(--eq-grid) 1px, transparent 1px),
    linear-gradient(to bottom, var(--eq-grid) 1px, transparent 1px);
  background-size:
    2.5% 100%,
    100% calc(100% / 12);
}

.graph-grid.major {
  background-image:
    linear-gradient(to right, var(--eq-grid-major) 1px, transparent 1px),
    linear-gradient(to bottom, var(--eq-grid-major) 1px, transparent 1px);
  background-size:
    10% 100%,
    100% calc(100% / 6);
}

.gain-shade.positive {
  bottom: 50%;
  background: linear-gradient(
    to bottom,
    color-mix(in srgb, var(--te-primary-500) 4%, transparent),
    transparent
  );
}

.gain-shade.negative {
  top: 50%;
  background: linear-gradient(
    to bottom,
    transparent,
    color-mix(in srgb, var(--te-info-soft-fg) 3%, transparent)
  );
}

.zero-axis {
  top: 50%;
  bottom: auto;
  height: 1px;
  background: color-mix(in srgb, var(--te-neutral-50) 35%, transparent);
}

.parametric-plot {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

.parametric-plot path {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.live-spectrum-line {
  stroke: color-mix(in srgb, var(--te-neutral-50) 36%, transparent);
  stroke-width: 1px;
  opacity: 0.7;
}

.individual-band-line {
  stroke: var(--band-color);
  stroke-width: 1.15px;
  opacity: 0.38;
  transition:
    opacity 140ms ease,
    stroke-width 140ms ease;
}

.individual-band-line.selected {
  stroke-width: 1.8px;
  opacity: 0.8;
}

.composite-fill {
  fill: url(#parametricEqFill);
  stroke: none;
  opacity: 0.72;
}

.composite-response-line {
  stroke: var(--te-neutral-50);
  stroke-width: 2.4px;
  filter: drop-shadow(0 0 5px color-mix(in srgb, var(--te-primary-500) 55%, transparent));
}

.measured-source-line {
  stroke: var(--te-info-soft-fg);
  stroke-width: 1.4px;
}

.target-response-line {
  stroke: var(--te-neutral-500);
  stroke-width: 1.2px;
  stroke-dasharray: 5 4;
}

.corrected-acoustic-line {
  stroke: var(--te-success-500);
  stroke-width: 2.3px;
}

.gain-labels span,
.frequency-labels span {
  position: absolute;
  z-index: 4;
  color: var(--te-neutral-500);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.gain-labels span {
  left: 9px;
  transform: translateY(-50%);
}

.frequency-labels span {
  bottom: 8px;
  transform: translateX(-50%);
}

.frequency-labels span:first-child {
  transform: none;
}

.frequency-labels span:last-child {
  transform: translateX(-100%);
}

.parametric-band-handle {
  position: absolute;
  z-index: 12;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  transform: translate(-50%, -50%);
  appearance: none;
  border: 2px solid var(--band-color);
  border-radius: 50%;
  color: var(--te-neutral-900);
  background: var(--band-color);
  box-shadow:
    0 0 0 2px var(--eq-surface),
    0 0 14px color-mix(in srgb, var(--band-color) 58%, transparent);
  cursor: grab;
  transition:
    width 130ms ease,
    height 130ms ease,
    filter 130ms ease,
    opacity 130ms ease;
  touch-action: none;
}

.parametric-band-handle span {
  font-size: 10px;
  font-weight: 900;
  line-height: 1;
}

.parametric-band-handle:hover,
.parametric-band-handle.hovered,
.parametric-band-handle.selected {
  width: 28px;
  height: 28px;
  filter: brightness(1.12);
}

.parametric-band-handle.selected {
  box-shadow:
    0 0 0 3px var(--eq-surface),
    0 0 0 4px var(--band-color),
    0 0 24px var(--band-color);
}

.parametric-band-handle.dragging {
  cursor: grabbing;
  transition: none;
}

.parametric-band-handle.bypassed {
  opacity: 0.38;
  background: var(--eq-surface);
  color: var(--band-color);
}

.band-tooltip {
  position: absolute;
  z-index: 20;
  display: grid;
  grid-template-columns: repeat(3, auto);
  gap: 3px 10px;
  transform: translate(-50%, calc(-100% - 22px));
  min-width: max-content;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--band-color) 55%, transparent);
  border-radius: 9px;
  color: var(--te-neutral-200);
  background: color-mix(in srgb, var(--te-neutral-900) 94%, transparent);
  box-shadow: 0 10px 24px color-mix(in srgb, var(--te-neutral-900) 45%, transparent);
  pointer-events: none;
}

.band-tooltip strong {
  grid-column: 1 / -1;
  color: var(--band-color);
  font-size: 11px;
}

.band-tooltip span {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.graph-crosshair {
  position: absolute;
  z-index: 6;
  width: 7px;
  height: 7px;
  transform: translate(-50%, -50%);
  border: 1px solid color-mix(in srgb, var(--te-neutral-50) 65%, transparent);
  border-radius: 50%;
  pointer-events: none;
}

.band-limit-notice {
  position: absolute;
  right: 12px;
  bottom: 32px;
  z-index: 8;
  padding: 5px 8px;
  border-radius: 7px;
  color: var(--te-warning-soft-fg);
  background: var(--te-warning-soft-bg);
  font-size: 10px;
  font-weight: 700;
}

.floating-band-inspector {
  min-height: 86px;
  display: grid;
  grid-template-columns:
    minmax(150px, 1.25fr) minmax(140px, 1.1fr) repeat(3, minmax(105px, 1fr))
    42px;
  align-items: stretch;
  gap: 1px;
  background: color-mix(in srgb, var(--te-neutral-50) 10%, transparent);
  border-top: 1px solid color-mix(in srgb, var(--te-neutral-50) 12%, transparent);
}

.inspector-identity,
.inspector-field,
.delete-band {
  background: var(--eq-surface-soft);
}

.inspector-identity {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}

.inspector-identity > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.inspector-identity span,
.inspector-field > span {
  color: var(--te-neutral-500);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.inspector-identity strong {
  color: var(--band-color);
  font-size: 13px;
}

.band-power,
.delete-band {
  appearance: none;
  border: 0;
  color: var(--te-success-500);
  cursor: pointer;
}

.band-power {
  width: 34px;
  height: 34px;
  border: 1px solid color-mix(in srgb, var(--te-success-500) 38%, transparent);
  border-radius: 50%;
  background: color-mix(in srgb, var(--te-success-500) 10%, transparent);
}

.band-power.bypassed {
  color: var(--te-neutral-500);
  border-color: color-mix(in srgb, var(--te-neutral-50) 12%, transparent);
  background: transparent;
}

.inspector-field {
  min-width: 0;
  padding: 11px 13px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 7px;
}

.inspector-field select,
.numeric-control input {
  width: 100%;
  min-width: 0;
  appearance: none;
  border: 0;
  outline: none;
  color: var(--te-neutral-100);
  background: transparent;
  font: inherit;
  font-size: 14px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}

.inspector-field select {
  cursor: pointer;
}

.inspector-field select option {
  color: var(--te-neutral-900);
  background: var(--te-card-bg);
}

.numeric-control {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  gap: 4px;
}

.numeric-control small {
  color: var(--te-neutral-500);
  font-size: 10px;
}

.numeric-control input:disabled {
  opacity: 0.36;
}

.delete-band {
  color: var(--te-neutral-500);
  font-size: 14px;
}

.delete-band:hover {
  color: var(--te-danger-soft-fg);
  background: var(--te-danger-soft-bg);
}

@keyframes statusPulse {
  to {
    opacity: 0.45;
  }
}

@media (max-width: 1100px) {
  .floating-band-inspector {
    grid-template-columns: repeat(4, 1fr);
  }

  .inspector-identity {
    grid-column: span 2;
  }

  .filter-field {
    grid-column: span 2;
  }

  .delete-band {
    min-height: 54px;
  }
}

@media (max-width: 760px) {
  .parametric-stage-header {
    grid-template-columns: 1fr auto;
  }

  .stage-help {
    display: none;
  }

  .parametric-graph-surface {
    height: 340px;
  }

  .floating-band-inspector {
    grid-template-columns: repeat(2, 1fr);
  }

  .inspector-identity,
  .filter-field {
    grid-column: span 2;
  }
}

/* Professional analyzer presentation */
.parametric-workspace {
  position: relative;
  isolation: isolate;
  border-color: var(--eq-border);
  border-radius: 14px;
  background: var(--eq-surface);
  box-shadow:
    0 28px 70px var(--eq-shadow),
    inset 0 1px var(--eq-highlight);
}

:global(html[data-theme='dark']) .parametric-workspace {
  --eq-surface: color-mix(in srgb, var(--te-neutral-50) 96%, var(--te-card-bg));
  --eq-surface-soft: color-mix(in srgb, var(--te-neutral-50) 90%, var(--te-card-bg));
  --eq-panel: color-mix(in srgb, var(--te-neutral-50) 88%, var(--te-card-bg));
  --eq-panel-raised: color-mix(in srgb, var(--te-neutral-50) 82%, var(--te-card-bg));
  --eq-text: var(--te-neutral-900);
  --eq-text-muted: color-mix(in srgb, var(--te-neutral-900) 58%, transparent);
  --eq-text-subtle: color-mix(in srgb, var(--te-neutral-900) 30%, transparent);
  --eq-border: color-mix(in srgb, var(--te-neutral-900) 9%, transparent);
  --eq-border-soft: color-mix(in srgb, var(--te-neutral-900) 6%, transparent);
  --eq-grid: color-mix(in srgb, var(--te-neutral-900) 4.5%, transparent);
  --eq-grid-major: color-mix(in srgb, var(--te-neutral-900) 8.5%, transparent);
  --eq-zero-axis: color-mix(in srgb, var(--te-neutral-900) 26%, transparent);
  --eq-response: color-mix(in srgb, var(--te-neutral-900) 78%, transparent);
  --eq-spectrum: color-mix(in srgb, var(--te-neutral-900) 23%, transparent);
  --eq-control-bg: color-mix(in srgb, var(--te-neutral-50) 70%, transparent);
  --eq-tooltip-bg: color-mix(in srgb, var(--te-neutral-50) 94%, var(--te-card-bg));
  --eq-shadow: color-mix(in srgb, var(--te-neutral-50) 50%, transparent);
  --eq-shadow-strong: color-mix(in srgb, var(--te-neutral-50) 72%, transparent);
  --eq-highlight: color-mix(in srgb, var(--te-neutral-900) 6%, transparent);
  --eq-handle-on-color: var(--te-neutral-50);
}

.parametric-stage-header {
  min-height: 42px;
  padding: 5px 8px 5px 12px;
  grid-template-columns: minmax(210px, auto) 1fr auto;
  gap: 12px;
  border-bottom-color: var(--eq-border-soft);
  background: linear-gradient(180deg, var(--eq-highlight), transparent), var(--eq-surface-soft);
}

.stage-brand,
.stage-actions,
.inspector-identity,
.knob-shell,
.precision-readout {
  display: flex;
  align-items: center;
}

.stage-brand {
  gap: 9px;
}

.brand-mark {
  width: 28px;
  height: 20px;
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--te-primary-400) 48%, transparent);
  border-radius: 4px;
  color: var(--te-primary-400);
  background: color-mix(in srgb, var(--te-primary-500) 7%, transparent);
  font-size: 9px;
  font-weight: 850;
  letter-spacing: 0.08em;
}

.stage-brand > div {
  display: grid;
  line-height: 1.1;
}

.stage-brand strong {
  color: var(--eq-text);
  font-size: 9px;
  font-weight: 760;
  letter-spacing: 0.11em;
}

.stage-brand small {
  margin-top: 3px;
  color: var(--eq-text-subtle);
  font-size: 7px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.1em;
}

.stage-help {
  color: var(--eq-text-subtle);
  font-size: 9px;
  letter-spacing: 0.02em;
}

.stage-actions {
  gap: 6px;
}

.stage-status {
  min-height: 28px;
  padding: 0 8px;
  border: 1px solid var(--eq-border-soft);
  border-radius: 5px;
  color: var(--eq-text-muted);
  background: var(--eq-control-bg);
  font-size: 8px;
  font-weight: 650;
}

.status-dot {
  width: 5px;
  height: 5px;
  box-shadow: 0 0 8px currentColor;
}

.spectrum-toggle {
  min-height: 28px;
  padding: 0 9px;
  border-color: var(--eq-border-soft);
  border-radius: 5px;
  color: var(--eq-text-muted);
  background: var(--eq-control-bg);
  font-size: 8px;
  letter-spacing: 0.06em;
}

.spectrum-toggle.active {
  border-color: color-mix(in srgb, var(--te-info-soft-fg) 36%, transparent);
  color: var(--te-info-soft-fg);
  background: color-mix(in srgb, var(--te-info-soft-fg) 7%, var(--eq-surface-soft));
}

.parametric-graph-surface {
  height: clamp(420px, 58vh, 620px);
  min-height: 420px;
  background:
    radial-gradient(
      ellipse at 50% 52%,
      color-mix(in srgb, var(--te-primary-500) 3.6%, transparent),
      transparent 62%
    ),
    linear-gradient(180deg, var(--eq-highlight), transparent 28%), var(--eq-surface);
}

.analyzer-vignette,
.frequency-grid-line,
.gain-grid-line {
  position: absolute;
  z-index: 1;
  pointer-events: none;
}

.analyzer-vignette {
  inset: 0;
  z-index: 9;
  box-shadow:
    inset 0 18px 24px color-mix(in srgb, var(--eq-shadow) 38%, transparent),
    inset 0 -28px 40px color-mix(in srgb, var(--eq-shadow) 48%, transparent),
    inset 18px 0 28px color-mix(in srgb, var(--eq-shadow) 32%, transparent),
    inset -18px 0 28px color-mix(in srgb, var(--eq-shadow) 32%, transparent);
}

.frequency-grid-line {
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--eq-grid);
}

.frequency-grid-line.major {
  background: var(--eq-grid-major);
}

.gain-grid-line {
  left: 0;
  right: 0;
  height: 1px;
  background: var(--eq-grid);
}

.gain-grid-line.zero {
  z-index: 5;
  height: 1px;
  background: var(--eq-zero-axis);
  box-shadow: 0 1px var(--eq-highlight);
}

.graph-grid,
.zero-axis {
  display: none;
}

.gain-shade.positive,
.gain-shade.negative {
  opacity: 0.34;
}

.parametric-plot {
  z-index: 4;
}

.live-spectrum-fill {
  fill: url(#spectrumFill) !important;
  stroke: none !important;
  opacity: 0.78;
}

.live-spectrum-line {
  stroke: var(--eq-spectrum);
  stroke-width: 0.72px;
  opacity: 0.88;
}

.selected-band-fill {
  fill: url(#selectedBandFill) !important;
  stroke: none !important;
  opacity: 0.72;
  filter: saturate(0.92);
}

.individual-band-line {
  stroke-width: 0.78px;
  opacity: 0.25;
  filter: saturate(0.82);
}

.individual-band-line.selected {
  stroke-width: 1.35px;
  opacity: 0.96;
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--band-color) 42%, transparent));
}

.composite-fill {
  opacity: 0.17;
}

.composite-response-line {
  stroke: var(--eq-response);
  stroke-width: 1.25px;
  opacity: 0.92;
  filter: drop-shadow(0 1px 2px var(--eq-shadow-strong));
}

.gain-labels span,
.frequency-labels span {
  z-index: 10;
  color: var(--eq-text-subtle);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 8px;
  font-weight: 520;
}

.gain-labels span {
  left: 7px;
}

.frequency-labels span {
  bottom: 8px;
}

.selected-band-focus {
  position: absolute;
  z-index: 6;
  width: var(--focus-width);
  height: 34px;
  transform: translate(-50%, -50%);
  border: 1px solid color-mix(in srgb, var(--band-color) 9%, transparent);
  border-radius: 50%;
  background: radial-gradient(
    ellipse,
    color-mix(in srgb, var(--band-color) 7%, transparent),
    transparent 70%
  );
  box-shadow: 0 0 22px color-mix(in srgb, var(--band-color) 5%, transparent);
  pointer-events: none;
}

.parametric-band-handle {
  width: 13px;
  height: 13px;
  border: 1px solid color-mix(in srgb, var(--band-color) 88%, var(--eq-panel-raised) 10%);
  color: var(--band-color);
  background: color-mix(in srgb, var(--eq-surface) 84%, var(--band-color));
  box-shadow:
    0 0 0 1px var(--eq-shadow-strong),
    0 0 8px color-mix(in srgb, var(--band-color) 32%, transparent);
  transition:
    scale 120ms var(--te-ease-soft),
    opacity 120ms ease,
    box-shadow 120ms ease;
}

.handle-glyph {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 8px;
  font-weight: 650;
  line-height: 1;
}

.handle-index {
  position: absolute;
  top: 15px;
  left: 50%;
  min-width: 12px;
  transform: translateX(-50%);
  color: color-mix(in srgb, var(--band-color) 72%, var(--eq-text));
  font-size: 7px;
  font-weight: 680;
  opacity: 0;
  transition: opacity 120ms ease;
}

.parametric-band-handle:hover,
.parametric-band-handle.hovered,
.parametric-band-handle.selected {
  width: 13px;
  height: 13px;
  scale: 1.32;
  filter: none;
}

.parametric-band-handle.selected {
  border-color: color-mix(in srgb, var(--band-color) 74%, var(--eq-panel-raised) 26%);
  color: var(--eq-handle-on-color);
  background: var(--band-color);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--band-color) 13%, transparent),
    0 0 0 1px var(--band-color),
    0 0 16px color-mix(in srgb, var(--band-color) 55%, transparent);
}

.parametric-band-handle:hover .handle-index,
.parametric-band-handle.selected .handle-index {
  opacity: 1;
}

.parametric-band-handle.bypassed {
  border-style: dashed;
  background: var(--eq-surface);
  opacity: 0.36;
}

.band-tooltip {
  gap: 4px 12px;
  transform: translate(-50%, calc(-100% - 15px));
  padding: 7px 9px;
  border-color: color-mix(in srgb, var(--band-color) 34%, transparent);
  border-radius: 5px;
  color: var(--eq-text-muted);
  background: var(--eq-tooltip-bg);
  box-shadow:
    0 12px 28px var(--eq-shadow-strong),
    inset 0 1px var(--eq-highlight);
  backdrop-filter: blur(12px);
}

.band-tooltip strong,
.band-tooltip span {
  font-size: 8px;
  letter-spacing: 0.035em;
}

.graph-crosshair {
  width: 1px;
  height: 1px;
  border: 0;
  background: var(--eq-text-muted);
  box-shadow: 0 0 0 3px var(--eq-border-soft);
}

.graph-crosshair::before,
.graph-crosshair::after {
  position: absolute;
  content: '';
  opacity: 0.18;
  background: var(--eq-text);
}

.graph-crosshair::before {
  width: 1px;
  height: 26px;
  left: 0;
  top: -13px;
}

.graph-crosshair::after {
  width: 26px;
  height: 1px;
  left: -13px;
  top: 0;
}

.floating-band-inspector {
  position: absolute;
  z-index: 30;
  left: 50%;
  bottom: 18px;
  width: min(660px, calc(100% - 44px));
  min-height: 0;
  display: block;
  overflow: hidden;
  transform: translateX(-50%);
  border: 1px solid var(--eq-border);
  border-radius: 9px;
  background: color-mix(in srgb, var(--eq-panel-raised) 94%, transparent);
  box-shadow:
    0 24px 60px var(--eq-shadow-strong),
    0 0 0 1px color-mix(in srgb, var(--band-color) 9%, transparent),
    inset 0 1px var(--eq-highlight);
  backdrop-filter: blur(18px) saturate(1.1);
}

.inspector-topbar {
  min-height: 37px;
  display: grid;
  grid-template-columns: minmax(160px, auto) 1fr 32px;
  align-items: center;
  gap: 10px;
  padding: 4px 5px 4px 8px;
  border-bottom: 1px solid var(--eq-border-soft);
  background: var(--eq-control-bg);
}

.inspector-identity {
  gap: 7px;
  padding: 0;
  background: transparent;
}

.inspector-identity > div {
  gap: 1px;
}

.inspector-identity small {
  color: var(--eq-text-subtle);
  font-size: 6px;
  font-weight: 680;
  letter-spacing: 0.12em;
}

.inspector-identity strong {
  color: color-mix(in srgb, var(--band-color) 80%, var(--eq-text) 12%);
  font-size: 9px;
  font-weight: 680;
}

.selected-band-badge {
  min-width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--band-color) 72%, transparent);
  border-radius: 50%;
  color: var(--band-color);
  background: color-mix(in srgb, var(--band-color) 8%, transparent);
  font-size: 8px;
  font-weight: 760;
}

.band-power {
  width: 23px;
  height: 23px;
  padding: 0;
  border-color: color-mix(in srgb, var(--te-success-500) 26%, transparent);
  color: color-mix(in srgb, var(--te-success-500) 75%, transparent);
  background: color-mix(in srgb, var(--te-success-500) 5%, transparent);
  font-size: 9px;
}

.filter-strip {
  display: flex;
  justify-content: center;
  gap: 2px;
}

.filter-strip button,
.delete-band {
  width: 26px;
  height: 25px;
  display: grid;
  place-items: center;
  appearance: none;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--eq-text-subtle);
  background: transparent;
  cursor: pointer;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}

.filter-strip button:hover,
.filter-strip button.active {
  border-color: color-mix(in srgb, var(--band-color) 24%, transparent);
  color: var(--band-color);
  background: color-mix(in srgb, var(--band-color) 7%, transparent);
}

.delete-band {
  color: var(--eq-text-subtle);
}

.precision-controls {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  padding: 9px 12px 11px;
}

.precision-control {
  min-width: 0;
  display: grid;
  justify-items: center;
  gap: 4px;
  padding: 0 14px;
  border-right: 1px solid var(--eq-border-soft);
}

.precision-control:last-child {
  border-right: 0;
}

.precision-control.disabled {
  opacity: 0.34;
}

.control-label {
  color: var(--eq-text-subtle);
  font-size: 6px;
  font-weight: 690;
  letter-spacing: 0.13em;
}

.knob-shell {
  gap: 8px;
}

.knob-shell button {
  width: 17px;
  height: 17px;
  padding: 0;
  appearance: none;
  border: 0;
  border-radius: 50%;
  color: var(--eq-text-subtle);
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
}

.knob-shell button:hover:not(:disabled) {
  color: var(--band-color);
  background: color-mix(in srgb, var(--band-color) 7%, transparent);
}

.knob-face {
  position: relative;
  width: 34px;
  height: 34px;
  border: 1px solid var(--eq-border);
  border-radius: 50%;
  background:
    radial-gradient(circle at 42% 35%, var(--eq-highlight), transparent 34%),
    radial-gradient(circle, var(--eq-panel-raised), var(--eq-panel));
  box-shadow:
    inset 0 1px 1px var(--eq-highlight),
    0 4px 9px var(--eq-shadow-strong);
}

.knob-face::before {
  position: absolute;
  inset: -3px;
  content: '';
  border: 1px solid color-mix(in srgb, var(--band-color) 15%, transparent);
  border-radius: 50%;
  clip-path: polygon(0 0, 100% 0, 100% 68%, 50% 50%, 0 68%);
}

.knob-face span {
  position: absolute;
  top: 4px;
  left: 50%;
  width: 1px;
  height: 10px;
  transform: translateX(-50%) rotate(var(--knob-angle));
  transform-origin: 50% 13px;
  border-radius: 1px;
  background: var(--band-color);
  box-shadow: 0 0 5px color-mix(in srgb, var(--band-color) 60%, transparent);
}

.precision-readout {
  justify-content: center;
  gap: 3px;
}

.precision-readout input {
  width: 58px;
  padding: 0;
  appearance: textfield;
  border: 0;
  outline: none;
  color: var(--eq-text);
  background: transparent;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  font-weight: 620;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.precision-readout input::-webkit-inner-spin-button,
.precision-readout input::-webkit-outer-spin-button {
  appearance: none;
}

.precision-readout small {
  color: var(--eq-text-subtle);
  font-size: 7px;
}

@media (max-width: 900px) {
  .parametric-stage-header {
    grid-template-columns: 1fr auto;
  }

  .stage-help {
    display: none;
  }

  .floating-band-inspector {
    width: min(580px, calc(100% - 24px));
  }

  .inspector-topbar {
    grid-template-columns: 1fr auto;
  }

  .filter-strip {
    grid-column: 1 / -1;
    grid-row: 2;
    padding-bottom: 2px;
  }
}

@media (max-width: 620px) {
  .stage-status {
    display: none;
  }

  .parametric-graph-surface {
    height: 430px;
    min-height: 430px;
  }

  .floating-band-inspector {
    position: absolute;
    bottom: 10px;
  }

  .inspector-identity {
    min-width: 0;
  }

  .precision-controls {
    padding-inline: 4px;
  }

  .precision-control {
    padding-inline: 5px;
  }

  .knob-shell {
    gap: 3px;
  }

  .knob-face {
    width: 30px;
    height: 30px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .parametric-band-handle,
  .individual-band-line,
  .handle-index,
  .status-dot {
    transition: none;
    animation: none;
  }
}
</style>
