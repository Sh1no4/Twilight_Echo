export interface RendererRuntimeLease {
  generation: number
  release(): void
}

interface ActiveRendererRuntime {
  generation: number
  release(): void
}

/**
 * Keeps a renderer-wide runtime singleton across Vite module replacement.
 * A replacement owns the next generation only after releasing the old one.
 */
export function claimRendererRuntime(
  key: symbol,
  release: () => void,
  host: Record<PropertyKey, unknown> = globalThis
): RendererRuntimeLease {
  const previous = host[key] as ActiveRendererRuntime | undefined
  previous?.release()

  const generation = (previous?.generation ?? 0) + 1
  let released = false
  const active: ActiveRendererRuntime = {
    generation,
    release: () => {
      if (released) return
      released = true
      try {
        release()
      } finally {
        if (host[key] === active) delete host[key]
      }
    }
  }
  host[key] = active

  return { generation, release: active.release }
}
