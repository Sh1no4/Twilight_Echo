import { defineStore } from 'pinia'
import type { ComputedRef, Ref } from 'vue'
import type { OutputInfo, PlaybackInfo } from '../../../preload/types'
import { usePlayerStore } from './usePlayerStore'

// Output routing and DSP controls are exposed independently from queue state.
export const useAudioOutputDspStore = defineStore('audio-output-dsp', () => {
  const player = usePlayerStore()

  return {
    audioEngineReady: player.audioEngineReady,
    audioEngineError: player.audioEngineError,
    audioEngineRecoveryNotice: player.audioEngineRecoveryNotice,
    exclusiveMode: player.exclusiveMode,
    audioOutput: player.audioOutput,
    audioDevice: player.audioDevice,
    audioOutputOptions: player.audioOutputOptions,
    audioDeviceOptions: player.audioDeviceOptions,
    audioProcessing: player.audioProcessing,
    audioOutputConfig: player.audioOutputConfig,
    audioOutputConfigApplyStatus: player.audioOutputConfigApplyStatus,
    dspOutputStage: player.dspOutputStage,
    dspStereoImage: player.dspStereoImage,
    playbackInfo: player.playbackInfo as Ref<PlaybackInfo | null>,
    outputInfo: player.outputInfo as ComputedRef<OutputInfo | null>,
    loudnormStatus: player.loudnormStatus,
    loudnormStatusSource: player.loudnormStatusSource,
    toggleExclusiveMode: player.toggleExclusiveMode,
    setAudioOutput: player.setAudioOutput,
    setAudioDevice: player.setAudioDevice,
    setAudioOutputConfig: player.setAudioOutputConfig,
    refreshAudioOutputState: player.refreshAudioOutputState,
    dismissAudioEngineRecoveryNotice: player.dismissAudioEngineRecoveryNotice,
    setAudioProcessing: player.setAudioProcessing,
    setOutputStage: player.setOutputStage,
    setStereoImage: player.setStereoImage,
    toggleDspEnabled: player.toggleDspEnabled,
    toggleEqEnabled: player.toggleEqEnabled,
    toggleCrossfeed: player.toggleCrossfeed,
    toggleGapless: player.toggleGapless,
    setReplayGainMode: player.setReplayGainMode,
    setCrossfeedStrength: player.setCrossfeedStrength,
    selectImpulseResponse: player.selectImpulseResponse,
    clearImpulseResponse: player.clearImpulseResponse,
    clearBpmAnalysisFromPlaybackState: player.clearBpmAnalysisFromPlaybackState
  }
})
