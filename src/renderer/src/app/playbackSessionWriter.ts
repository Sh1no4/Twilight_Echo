import type { PlaybackSession } from '../types/music.ts'
import {
  isPersistentDataRevisionConflict,
  type VersionedDataEnvelope
} from '../../../shared/versionedPersistence.ts'

const MAX_REVISION_CONFLICT_ATTEMPTS = 3

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
    return this.enqueue((expectedRevision) => api.savePlaybackSession(session, expectedRevision))
  }

  clear(api: PlaybackSessionWriteApi): PlaybackSessionWriteReceipt {
    return this.enqueue((expectedRevision) => api.clearPlaybackSession(expectedRevision))
  }

  whenIdle(): Promise<void> {
    return this.tail
  }

  setRevision(revision: number): void {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error('Playback session revision must be a non-negative safe integer')
    }
    this.revision = Math.max(this.revision, revision)
  }

  getRevision(): number {
    return this.revision
  }

  getCommittedSequence(): number {
    return this.committedSequence
  }

  private enqueue(
    operation: (
      expectedRevision: number
    ) => Promise<VersionedDataEnvelope<PlaybackSession | null> | void>
  ): PlaybackSessionWriteReceipt {
    const sequence = ++this.nextSequence
    const completion = this.tail.then(async () => {
      for (let attempt = 0; attempt < MAX_REVISION_CONFLICT_ATTEMPTS; attempt++) {
        try {
          const receipt = await operation(this.revision)
          if (receipt) this.revision = receipt.revision
          this.committedSequence = sequence
          return
        } catch (error) {
          if (!isPersistentDataRevisionConflict(error)) throw error
          // Always adopt the authoritative revision so a later Retry close /
          // queued write does not keep sending the stale expected revision.
          const currentRevision = error.current?.revision ?? 0
          if (!Number.isSafeInteger(currentRevision) || currentRevision < 0) throw error
          this.revision = currentRevision
          if (attempt === MAX_REVISION_CONFLICT_ATTEMPTS - 1) throw error
        }
      }
    })
    this.tail = completion.then(
      () => {},
      () => {}
    )
    return { sequence, completion }
  }
}

export const playbackSessionWriter = new PlaybackSessionWriter()
