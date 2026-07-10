import { isAbsolute, win32 } from 'path'

export type AudioSourceCandidate =
  | { kind: 'local'; source: string }
  | { kind: 'remote'; source: string }

export function classifyAudioSource(source: string): AudioSourceCandidate {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Audio source is invalid')
  const normalized = source.trim()
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)
  if (!hasScheme || isAbsolute(normalized) || win32.isAbsolute(normalized)) {
    return { kind: 'local', source: normalized }
  }

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error('Audio source URL is invalid')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Audio source protocol is not authorized')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Audio source URL must not include credentials')
  }
  return { kind: 'remote', source: normalized }
}
