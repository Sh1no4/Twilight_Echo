import type { TrackSource } from '../types/music'

const RENDERER_DIRECT_TARGET_PATTERN = /^(?:blob:|data:)/i
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/
const URI_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/
const NATIVE_SUPPORTED_URI_SCHEMES = new Set(['file', 'http', 'https'])

export function isRendererDirectAudioTarget(target: string): boolean {
  return RENDERER_DIRECT_TARGET_PATTERN.test(target.trim())
}

export function shouldUseNativePlaybackTarget(source: TrackSource, target: string): boolean {
  const normalized = target.trim()
  if (!normalized || isRendererDirectAudioTarget(normalized)) return false
  if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(normalized)) return true
  const schemeMatch = normalized.match(URI_SCHEME_PATTERN)
  if (schemeMatch) {
    return NATIVE_SUPPORTED_URI_SCHEMES.has(schemeMatch[0].slice(0, -1).toLowerCase())
  }
  return source === 'local' || normalized.includes('/') || normalized.includes('\\') || /\.[a-z0-9]{2,5}(?:$|[?#])/i.test(normalized)
}

export function shouldReuseResolvedStreamUrl(source: TrackSource): boolean {
  return source !== 'bili'
}
