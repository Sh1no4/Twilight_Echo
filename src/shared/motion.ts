export const MOTION_PREFERENCES = ['system', 'full', 'reduced', 'off'] as const

export type MotionPreference = (typeof MOTION_PREFERENCES)[number]
export type ResolvedMotionMode = Exclude<MotionPreference, 'system'>

export function normalizeMotionPreference(value: unknown): MotionPreference {
  return value === 'full' || value === 'reduced' || value === 'off' ? value : 'system'
}

export function resolveMotionMode(
  preference: MotionPreference,
  prefersReducedMotion: boolean
): ResolvedMotionMode {
  if (preference === 'system') return prefersReducedMotion ? 'reduced' : 'full'
  return preference
}
