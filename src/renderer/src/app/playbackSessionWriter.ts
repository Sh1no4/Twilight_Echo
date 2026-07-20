import type { PlaybackSession } from '../types/music.ts'
import type { VersionedDataEnvelope } from '../../../shared/versionedPersistence.ts'

export interface PlaybackSessionWriteApi {
  clearPlaybackSession: (
    expectedRevision: number
  ) => Promise<VersionedDataEnvelope<PlaybackSession | null> | void>
  savePlaybackSession: (
    session: PlaybackSession,
    expectedRevision: number
  ) => Promise<VersionedDataEnvelope<PlaybackSession> | void>
}

export interface PlaybackSessionWriteReceipt {
  sequence: number
  completion: Promise<void>
}

export class PlaybackSessionWriter {
  private tail: Promise<void> = Promise.resolve()
  private nextSequence = 0
  private committedSequence = 0
  private revision = 0

  save(api: PlaybackSessionWriteApi, session: PlaybackSession): PlaybackSessionWriteReceipt {
    return this.enqueue(() => api.savePlaybackSession(session, this.revision))
  }

  clear(api: PlaybackSessionWriteApi): PlaybackSessionWriteReceipt {
    return this.enqueue(() => api.clearPlaybackSession(this.revision))
  }

  whenIdle(): Promise<void> {
    return this.tail
  }

  setRevision(revision: number): void {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error('Playback session revision must be a non-negative safe integer')
    }
    this.revision = revision
  }

  getRevision(): number {
    return this.revision
  }

  getCommittedSequence(): number {
    return this.committedSequence
  }

  private enqueue(
    operation: () => Promise<VersionedDataEnvelope<PlaybackSession | null> | void>
  ): PlaybackSessionWriteReceipt {
    const sequence = ++this.nextSequence
    const completion = this.tail.then(operation).then((receipt) => {
      if (receipt) this.revision = receipt.revision
      this.committedSequence = sequence
    })
    this.tail = completion.then(
      () => {},
      () => {}
    )
    return { sequence, completion }
  }
}

export const playbackSessionWriter = new PlaybackSessionWriter()
