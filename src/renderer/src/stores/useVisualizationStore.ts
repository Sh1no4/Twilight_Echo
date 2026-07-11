import { defineStore } from 'pinia'
import { usePlayerStore } from './usePlayerStore'

export const useVisualizationStore = defineStore('visualization', () => {
  const player = usePlayerStore()

  return {
    visualizerActive: player.visualizerActive,
    visualizationData: player.visualizationData
  }
})
