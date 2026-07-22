export function getTrackSource(track: { id: string; source?: string } | null | undefined): string {
  if (!track) return 'local'
  if (track.source) return track.source
  if (/^[a-zA-Z]:[\\/]/.test(track.id) || /^[\\/]/.test(track.id)) return 'local'
  const separatorIndex = track.id.indexOf(':')
  return separatorIndex > 0 ? track.id.slice(0, separatorIndex) : 'local'
}

export function shouldReserveLyricsColumn({
  source: _source,
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
  // null = still resolving (local LRC / provider / online). Keep the column for
  // every source so track switches on the now-playing page do not unmount the
  // lyrics pane and flash blank until async load finishes.
  return lyrics == null && translatedLyrics == null
}
