import { defineStore } from 'pinia'
import type { Ref } from 'vue'
import type { VisualizationData } from '../../../preload/types'
import { usePlayerStore } from './usePlayerStore'

export const useVisualizationStore = defineStore('visualization', () => {
  const player = usePlayerStore()

  return {
    visualizerActive: player.visualizerActive,
    visualizationData: player.visualizationData as Ref<VisualizationData>
  }
})
