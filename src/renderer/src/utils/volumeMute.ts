export interface VolumeMuteState {
  volume: number
  muted: boolean
  lastAudibleVolume: number
}

export function toggleVolumeMute(state: VolumeMuteState): VolumeMuteState {
  if (state.muted || state.volume <= 0) {
    return {
      volume: Math.max(0.01, state.lastAudibleVolume),
      muted: false,
      lastAudibleVolume: Math.max(0.01, state.lastAudibleVolume)
    }
  }

  return {
    volume: 0,
    muted: true,
    lastAudibleVolume: state.volume
  }
}
