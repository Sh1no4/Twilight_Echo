import { createPinia, defineStore, setActivePinia, storeToRefs } from 'pinia'
import { ref, computed } from 'vue'

setActivePinia(createPinia())

// Mimic usePlayerStore: state lives in refs, and updates REPLACE the object.
const usePlayerStore = defineStore('player', () => {
  const audioProcessing = ref({ eqPreamp: 0, eqBands: [{ gain: 0 }] })
  const audioEngineReady = ref(false)
  const outputInfo = computed(() => ({ sampleRate: 48000 }))

  function applyAudioProcessingState(next) {
    // clone-and-replace, exactly like cloneAudioProcessingSettings(...)
    audioProcessing.value = { ...next, eqBands: next.eqBands.map((b) => ({ ...b })) }
  }
  return { audioProcessing, audioEngineReady, outputInfo, applyAudioProcessingState }
})

// Mimic useAudioOutputDspStore: forwards `player.x` (property access on a reactive store).
const useDspStore = defineStore('dsp', () => {
  const player = usePlayerStore()
  return {
    audioProcessing: player.audioProcessing,
    audioEngineReady: player.audioEngineReady,
    outputInfo: player.outputInfo,
    applyAudioProcessingState: player.applyAudioProcessingState
  }
})

const player = usePlayerStore()
const dsp = useDspStore()
const { audioProcessing, audioEngineReady, outputInfo } = storeToRefs(dsp)

console.log('typeof forwarded audioProcessing:', typeof dsp.audioProcessing)
console.log('audioEngineReady ref from storeToRefs:', audioEngineReady)
console.log('outputInfo ref from storeToRefs:', outputInfo)

console.log('\n-- before edit --')
console.log('player  :', JSON.stringify(player.audioProcessing))
console.log('via dsp :', JSON.stringify(audioProcessing?.value))

dsp.applyAudioProcessingState({ eqPreamp: 6, eqBands: [{ gain: 9 }] })
player.audioEngineReady = true

console.log('\n-- after edit (preamp 6, band gain 9, ready true) --')
console.log('player  :', JSON.stringify(player.audioProcessing))
console.log('via dsp :', JSON.stringify(audioProcessing?.value))
console.log('ready via dsp:', audioEngineReady?.value)
