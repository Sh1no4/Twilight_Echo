import type { RendererClosePersistenceOutcome } from '../shared/closePersistence.ts'

export type ClosePersistenceCallback = () => Promise<void> | void

export async function collectClosePersistenceOutcome(
  callbacks: Iterable<ClosePersistenceCallback>
): Promise<RendererClosePersistenceOutcome> {
  try {
    await Promise.all([...callbacks].map((callback) => Promise.resolve().then(callback)))
    return { status: 'saved' }
  } catch (error) {
    return {
      status: 'failed',
      error:
        error instanceof Error && error.message ? error.message : String(error || 'Unknown error')
    }
  }
}
