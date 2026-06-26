export function getTrackSource(track: { id: string; source?: string } | null | undefined): string {
  if (!track) return 'local'
  if (track.source) return track.source
  if (/^[a-zA-Z]:[\\/]/.test(track.id) || /^[\\/]/.test(track.id)) return 'local'
  const separatorIndex = track.id.indexOf(':')
  return separatorIndex > 0 ? track.id.slice(0, separatorIndex) : 'local'
}

export function shouldReserveLyricsColumn({
  source,
  hasLyrics,
  lyrics,
  translatedLyrics
}: {
  source: string
  hasLyrics: boolean
  lyrics: string | null | undefined
  translatedLyrics: string | null | undefined
}): boolean {
  if (hasLyrics) return true
  return source === 'local' && lyrics == null && translatedLyrics == null
}
