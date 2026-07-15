export interface NativePlaybackInfoIntent {
  loadToken: number
  trackId: string
  queueIndex: number
  source: string
  expiresAt: number
  confirmedAt: number | null
}

export interface NativePlaybackInfoCandidate {
  trackId: string
  source: string
}

export type NativePlaybackInfoIntentDecision = 'match' | 'ignore' | 'expired'

export function evaluateNativePlaybackInfoIntent(
  intent: NativePlaybackInfoIntent,
  candidate: NativePlaybackInfoCandidate,
  now: number,
  postConfirmationGraceMs: number
): NativePlaybackInfoIntentDecision {
  if (now > intent.expiresAt) return 'expired'

  const candidateTrackId = candidate.trackId.trim()
  const candidateSource = candidate.source.trim()
  const expectedSource = intent.source.trim()
  const matchesTrack = candidateTrackId.length > 0 && candidateTrackId === intent.trackId
  const matchesSource =
    candidateSource.length > 0 &&
    (candidateSource === expectedSource || candidateSource === intent.trackId)

  if (matchesTrack || matchesSource) return 'match'

  if (
    intent.confirmedAt !== null &&
    now > intent.confirmedAt + Math.max(0, postConfirmationGraceMs)
  ) {
    return 'expired'
  }

  return 'ignore'
}
