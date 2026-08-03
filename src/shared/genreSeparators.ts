export const DEFAULT_GENRE_SEPARATORS = ',，;；、/'

const MAX_GENRE_SEPARATOR_COUNT = 32

export function normalizeGenreSeparators(
  value: unknown,
  fallback = DEFAULT_GENRE_SEPARATORS
): string {
  if (typeof value !== 'string') return fallback

  const separators: string[] = []
  const seen = new Set<string>()
  for (const separator of value) {
    if (separator === '\r' || separator === '\n' || separator === '\t') continue
    if (seen.has(separator)) continue
    seen.add(separator)
    separators.push(separator)
    if (separators.length >= MAX_GENRE_SEPARATOR_COUNT) break
  }

  return separators.length > 0 ? separators.join('') : fallback
}

export function splitGenreValues(
  value: string | null | undefined,
  separators = DEFAULT_GENRE_SEPARATORS
): string[] {
  const source = value?.trim()
  if (!source) return []

  const separatorSet = new Set(normalizeGenreSeparators(separators))
  const values: string[] = []
  const seen = new Set<string>()
  let current = ''

  function appendCurrent(): void {
    const genre = current.trim()
    current = ''
    if (!genre) return
    const normalized = genre.toLocaleLowerCase()
    if (seen.has(normalized)) return
    seen.add(normalized)
    values.push(genre)
  }

  for (const character of source) {
    if (separatorSet.has(character)) {
      appendCurrent()
    } else {
      current += character
    }
  }
  appendCurrent()

  return values
}
