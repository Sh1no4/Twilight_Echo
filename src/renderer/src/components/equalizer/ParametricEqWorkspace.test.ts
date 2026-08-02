import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./ParametricEqWorkspace.vue', import.meta.url), 'utf8')

test('frequency response graph supports adding, selecting, dragging, Q wheel edits, and deletion', () => {
  assert.match(source, /class="parametric-graph-surface"/)
  assert.match(source, /@click\.self="addBand"/)
  assert.match(source, /class="parametric-band-handle"/)
  assert.match(source, /setPointerCapture\(event\.pointerId\)/)
  assert.match(source, /@pointermove\.prevent\.stop="updatePointer"/)
  assert.match(source, /@wheel\.prevent\.stop="adjustQ\(index, \$event\)"/)
  assert.match(source, /emit\('delete', selectedIndex\)/)
  assert.match(source, /emit\('toggle', selectedIndex\)/)
})

test('workspace exposes filter, frequency, gain, and Q controls with gain-type semantics', () => {
  assert.match(source, /v-for="filter in filterTypes"/)
  assert.match(source, /updateNumeric\('frequency', \$event\)/)
  assert.match(source, /updateNumeric\('gain', \$event\)/)
  assert.match(source, /updateNumeric\('q', \$event\)/)
  assert.match(source, /:disabled="!filterUsesGain\(selectedBand\.filterType\)"/)
  assert.match(source, /displayBandGain\(band\)/)
})

test('workspace includes spectrum, hover tooltip, status feedback, responsiveness, and reduced motion', () => {
  assert.match(source, /class="live-spectrum-fill"/)
  assert.match(source, /class="live-spectrum-line"/)
  assert.match(source, /class="band-tooltip"/)
  assert.match(source, /class="stage-status"/)
  assert.match(source, /PARAMETRIC_EQ_MAX_BANDS/)
  assert.match(source, /@media \(max-width: 620px\)/)
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/)
})

test('professional analyzer uses logarithmic grid, selected-band focus, and floating precision controls', () => {
  assert.match(source, /frequencyTicks/)
  assert.match(source, /frequencyToPercent\(frequency\)/)
  assert.match(source, /class="selected-band-fill"/)
  assert.match(source, /class="selected-band-focus"/)
  assert.match(source, /class="filter-strip"/)
  assert.match(source, /class="precision-controls"/)
  assert.match(source, /class="knob-face"/)
  assert.match(source, /frequencyKnobProgress/)
})

test('band handles support double-click reset and keyboard precision editing', () => {
  assert.match(source, /@dblclick\.prevent\.stop="resetBandGain\(index\)"/)
  assert.match(source, /@keydown="handleBandKeydown\(index, \$event\)"/)
  assert.match(source, /event\.key === 'ArrowRight'/)
  assert.match(source, /event\.shiftKey/)
  assert.match(source, /emit\('preview', index, \{ gain: 0 \}\)/)
})

test('analyzer defaults to semantic light surfaces and preserves an explicit dark theme', () => {
  assert.match(
    source,
    /--eq-surface:\s*color-mix\(in srgb, var\(--te-card-bg\) 96%, var\(--te-neutral-100\)\)/
  )
  assert.match(source, /--eq-text:\s*var\(--te-neutral-900\)/)
  assert.match(source, /--eq-grid:\s*color-mix\(/)
  assert.match(source, /--eq-response:\s*color-mix\(/)
  assert.match(source, /--eq-spectrum:\s*color-mix\(/)
  assert.match(source, /:global\(html\[data-theme='dark'\]\) \.parametric-workspace/)
  assert.match(source, /stop-color="var\(--eq-spectrum\)"/)
  assert.match(source, /\.composite-response-line \{[\s\S]*?stroke: var\(--eq-response\)/)
  assert.match(
    source,
    /\.floating-band-inspector \{[\s\S]*?background:[\s\S]*?var\(--eq-panel-raised\)/
  )
})
