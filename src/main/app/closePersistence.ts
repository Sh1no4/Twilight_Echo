export type ClosePersistenceAttempt = 'closed' | 'cancelled' | 'retry'

export interface ClosePersistenceCoordinatorOptions {
  requestPersistence(): Promise<void>
  close(): void
  showFailure(error: Error): Promise<'retry' | 'cancel'>
}

export class ClosePersistenceAttemptGate {
  private activeAttempt: Promise<'closed' | 'cancelled'> | null = null

  run(options: ClosePersistenceCoordinatorOptions): Promise<'closed' | 'cancelled'> {
    if (this.activeAttempt) return this.activeAttempt

    const attempt = this.runUntilSettled(options)
    this.activeAttempt = attempt
    void attempt.then(
      () => {
        if (this.activeAttempt === attempt) this.activeAttempt = null
      },
      () => {
        if (this.activeAttempt === attempt) this.activeAttempt = null
      }
    )
    return attempt
  }

  private async runUntilSettled(
    options: ClosePersistenceCoordinatorOptions
  ): Promise<'closed' | 'cancelled'> {
    while (true) {
      const result = await closeOnlyAfterRendererPersistence(options)
      if (result !== 'retry') return result
    }
  }
}

export async function closeOnlyAfterRendererPersistence(
  options: ClosePersistenceCoordinatorOptions
): Promise<ClosePersistenceAttempt> {
  try {
    await options.requestPersistence()
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error || 'Unknown persistence error')
    return (await options.showFailure(new Error(message))) === 'retry' ? 'retry' : 'cancelled'
  }

  options.close()
  return 'closed'
}
