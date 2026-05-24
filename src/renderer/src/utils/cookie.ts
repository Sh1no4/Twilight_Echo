const COOKIE_ATTRS = new Set([
  'path',
  'domain',
  'expires',
  'max-age',
  'httponly',
  'secure',
  'samesite',
  'priority'
])

export function cleanCookie(raw: string): string {
  if (!raw) return ''
  const pairs: string[] = []
  for (const part of raw.split(';')) {
    const trimmed = part.trim()
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim().toLowerCase()
    if (COOKIE_ATTRS.has(key)) continue
    pairs.push(`${key}=${trimmed.slice(eqIdx + 1).trim()}`)
  }
  return pairs.join('; ')
}
