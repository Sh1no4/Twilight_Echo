import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('./EqualizerPage.vue', import.meta.url), 'utf8')

test('graphic equalizer preamp and band sliders support 0.1 dB adjustments', () => {
  assert.match(
    source,
    /<input[\s\S]*?type="range"[\s\S]*?min="-24"[\s\S]*?max="24"[\s\S]*?step="0\.1"[\s\S]*?:value="audioProcessing\.eqPreamp"/
  )
  assert.match(
    source,
    /<input[\s\S]*?type="range"[\s\S]*?min="-12"[\s\S]*?max="12"[\s\S]*?step="0\.1"[\s\S]*?:value="band\.gain"/
  )
})

test('theme modes change only equalizer presentation and use stable chart classes', () => {
  assert.equal(source.match(/class="equalizer-spectrum-line"/g)?.length, 1)
  assert.equal(source.match(/class="equalizer-spectrum-area"/g)?.length, 1)
  assert.match(source, /ParametricEqWorkspace/)
  assert.match(source, /data-te-equalizer-panel='tinted'/)
  assert.match(source, /data-te-equalizer-slider='solid'/)
  assert.match(source, /data-te-equalizer-knob='dot'/)
  assert.match(source, /data-te-equalizer-spectrum='area'/)
  assert.match(source, /data-te-equalizer-button='outline'/)
  assert.match(source, /data-te-visible-equalizer-grid='false'/)
  assert.match(source, /data-te-visible-equalizer-frequency-guides='false'/)
  assert.match(source, /data-te-visible-equalizer-spectrum='false'/)
})

test('OPRA compensation is reflected in the plotted response curve', () => {
  assert.match(
    source,
    /const displayEqBands = computed\([\s\S]*?opraCompensationEnabled\.value[\s\S]*?headphoneCompensation\.value\.bands/
  )
  assert.match(
    source,
    /computeCompositeResponse\(\s*displayEqBands\.value,\s*displayEqPreamp\.value/
  )
  assert.match(source, /mode: displayEqMode\.value/)
})

test('DSP chart splits manual, OPRA, and effective total response curves', () => {
  assert.match(
    source,
    /const manualResponsePath = computed\([\s\S]*?computeCompositeResponse\(audioProcessing\.value\.eqBands, audioProcessing\.value\.eqPreamp/
  )
  assert.match(
    source,
    /const opraResponsePath = computed\([\s\S]*?computeCompositeResponse\([\s\S]*?headphoneCompensation\.value\.bands,[\s\S]*?headphoneCompensation\.value\.preampDb/
  )
  assert.match(source, /class="equalizer-manual-response-line"/)
  assert.match(source, /class="equalizer-opra-response-line"/)
  assert.equal(source.match(/>总 DSP 合成<\/span>/g)?.length, 1)
  assert.match(source, /:response-path="responsePath"/)
  assert.match(source, /:meter-peak-db="visualizationData\.peakDb"/)
  assert.match(source, /:meter-rms-db="visualizationData\.rmsDb"/)
})

test('OPRA estimated source deviation is explicitly non-measured and excludes preamp', () => {
  assert.match(
    source,
    /computeEstimatedSourceDeviation\(headphoneCompensation\.value\.bands, responseOptions\.value\)/
  )
  assert.match(source, /class="equalizer-estimated-deviation-line"/)
  assert.equal(source.match(/相对隐含目标 0 dB · 非实测/g)?.length, 1)
  assert.match(source, /排除前级增益，不代表实测频响/)
})

test('AutoEq CSV import switches to a distinct headphone response view with precise data semantics', () => {
  assert.match(source, /window\.api\.audioEngine\.importFrequencyResponse\(\)/)
  assert.match(source, /type ResponseView = 'dsp' \| 'headphone'/)
  assert.equal(source.match(/>\s*DSP 响应\s*<\/button>/g)?.length, 2)
  assert.equal(source.match(/>\s*耳机频响\s*<\/button>/g)?.length, 2)
  assert.match(source, /AutoEq smoothed 列/)
  assert.match(source, /AutoEq raw 列/)
  assert.doesNotMatch(source, /原始测量/)
})

test('headphone comparison exposes source, target, individual, combined, and corrected curves', () => {
  assert.match(source, /computeFrequencyResponseComparison\(/)
  assert.match(
    source,
    /computeCompositeResponse\(displayEqBands\.value, 0,[\s\S]*?mode: displayEqMode\.value/
  )
  assert.match(source, /源频响 M\(f\)/)
  assert.match(source, /目标曲线 T\(f\)/)
  assert.match(source, /单个滤波 Hn\(f\)/)
  assert.match(source, /合并滤波 H\(f\)/)
  assert.match(source, /滤波结果 R\(f\)/)
  assert.match(source, /class="equalizer-measured-source-line"/)
  assert.match(source, /class="equalizer-target-response-line"/)
  assert.match(source, /class="equalizer-combined-filter-line"/)
  assert.match(source, /class="equalizer-corrected-acoustic-line"/)
  assert.match(source, /R\(f\) = M\(f\) \+ H\(f\) · 排除数字前级 · 预计值，非校正后实测/)
})

test('headphone curves have independent accessible visibility controls in both EQ workspaces', () => {
  for (const state of [
    'showMeasuredSource',
    'showTargetResponse',
    'showIndividualFilters',
    'showCombinedFilter',
    'showCorrectedResponse'
  ]) {
    assert.match(source, new RegExp(`const ${state} = ref\\(true\\)`))
    assert.match(source, new RegExp(`:aria-pressed="${state}"`))
  }
  assert.match(source, /@toggle-headphone-curve="toggleHeadphoneCurve"/)
  assert.match(
    source,
    /:band-response-paths="\s*responseView === 'headphone' \? headphoneBandResponsePaths : bandResponsePaths\s*"/
  )
})

test('scene EQ keeps OPRA parameters but obeys DSP and equalizer bypass switches', () => {
  assert.match(source, /node\.enabled = nextSettings\.dspEnabled && nextSettings\.eqEnabled/)
  assert.doesNotMatch(
    source,
    /node\.enabled = nextSettings\.eqEnabled \|\| opraCompensationEnabled\.value/
  )
  assert.match(
    source,
    /bands: opraCompensationEnabled\.value\s*\? \[\.\.\.cloneBands\(headphoneCompensation\.value\.bands\), \.\.\.cloneBands\(nextSettings\.eqBands\)\]/
  )
})

test('applying or disabling OPRA re-syncs the DSP scene', () => {
  assert.equal(source.match(/await syncActiveSceneEq\(audioProcessing\.value\)/g)?.length, 2)
})

test('OPRA-stacked scene bands never overwrite the manual editor state', () => {
  assert.match(source, /if \(opraCompensationEnabled\.value\) return/)
})

test('parametric editor exposes direct manipulation and throttled DSP commits', () => {
  assert.match(source, /import ParametricEqWorkspace/)
  assert.match(source, /@add="addBand"/)
  assert.match(source, /@preview="stageBandPatch"/)
  assert.match(source, /@commit="commitStagedBands"/)
  assert.match(source, /@delete="deleteBand"/)
  assert.match(source, /@toggle="toggleBandEnabled"/)
  assert.match(source, /window\.requestAnimationFrame/)
  assert.match(source, /runEqApply/)
})

test('parametric page keeps one Chinese heading without duplicate English labels', () => {
  assert.match(source, /class="tab-pane active parametric-pane"/)
  assert.equal(source.match(/<header class="parametric-page-header">/g)?.length, 1)
  assert.match(source, /<h1>参数均衡器<\/h1>/)
  assert.match(source, />32 频段 · 实时处理</)
  assert.doesNotMatch(source, />DSP \/ EQUALIZATION</)
  assert.doesNotMatch(source, />32 BAND · REAL-TIME</)
  assert.doesNotMatch(source, /class="parametric-toolbar-label">ANALYZER SOURCE/)
  assert.match(source, /\.parametric-pane \{[\s\S]*?gap: 10px/)
  assert.match(source, /\.parametric-toolbar-card \{[\s\S]*?border-radius: 8px/)
  assert.match(source, /@media \(max-width: 620px\)/)
  assert.match(source, /:global\(html\[data-theme='pureWhite'\] \.parametric-pane\)/)
  assert.match(source, /:global\(html\[data-theme='pureWhite'\] \.parametric-toolbar-card\)/)
  assert.doesNotMatch(source, /:global\(html:not\(\[data-theme='dark'\]\)\)/)
})

test('parametric editor reuses native player visualization data and cleans up animation work', () => {
  assert.match(source, /const \{ visualizationData, isPlaying \} = playerStore/)
  assert.match(source, /spectrumToPath\(smoothedSpectrum/)
  assert.match(source, /watch\(\[spectrumVisible, responseView, isPlaying\]/)
  assert.match(source, /onBeforeUnmount/)
  assert.match(source, /cancelAnimationFrame\(spectrumAnimationFrame\)/)
})
