import type { MiniPlayerStateSnapshot } from './miniPlayer.ts'

export type TrayNavigationTarget = 'local' | 'streaming'

export interface TrayPlayerBootstrap {
  state: MiniPlayerStateSnapshot
}

export function normalizeTrayNavigationTarget(value: unknown): TrayNavigationTarget | null {
  return value === 'local' || value === 'streaming' ? value : null
}
