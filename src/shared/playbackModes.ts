import type { PlayMode } from './audioEngineTypes.ts'

/**
 * Play mode ids the native engine accepts.
 *
 * - `sequential`: auto-advance stops after the last queue entry.
 * - `listLoop`: auto-advance wraps into a new cycle, and `upcoming()` wraps with
 *   it so the last -> first hop keeps its gapless preload.
 * - `repeat`: EOF reloads the current entry.
 */
export type NativePlayMode = 'sequential' | 'listLoop' | 'repeat'

/**
 * Collapses the app's play modes onto the engine's. Both the main process and the
 * renderer route through here — keeping two copies of this mapping is what let
 * `listLoop` silently degrade to a non-wrapping native `sequential`.
 *
 * `shuffle` maps to `listLoop`, not to a native shuffle: the renderer already
 * shuffles `queue` out of `originalQueue`, so the queue handed to the engine *is*
 * the shuffled cycle. Letting the engine permute it a second time yields a play
 * order the renderer cannot mirror, which is what broke queue-index tracking and
 * end-of-queue detection for shuffle.
 *
 * `heart` stays `sequential` because the renderer loads only the current track in
 * that mode and owns every boundary itself.
 */
export function toNativePlayMode(mode: PlayMode): NativePlayMode {
  if (mode === 'repeat') return 'repeat'
  if (mode === 'listLoop' || mode === 'shuffle') return 'listLoop'
  return 'sequential'
}

/** Whether the mode continues past the last queue entry instead of stopping. */
export function playModeWrapsAtQueueEnd(mode: PlayMode): boolean {
  return mode === 'listLoop' || mode === 'shuffle'
}
