import type { TrackSource } from '../types/music'

const RENDERER_DIRECT_TARGET_PATTERN = /^(?:https?:|blob:|data:)/i

export function isRendererDirectAudioTarget(target: string): boolean {
  return RENDERER_DIRECT_TARGET_PATTERN.test(target.trim())
}

export function shouldUseNativePlaybackTarget(source: TrackSource, target: string): boolean {
  return source === 'local' && !isRendererDirectAudioTarget(target)
}

export function shouldReuseResolvedStreamUrl(source: TrackSource): boolean {
  return source !== 'bili'
}
