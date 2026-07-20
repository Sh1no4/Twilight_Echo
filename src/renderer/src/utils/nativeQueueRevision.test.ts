import assert from 'node:assert/strict'
import test from 'node:test'
import { NativeQueueRevisionFence, synchronizeLatestNativeQueue } from './nativeQueueRevision.ts'

test('native queue revision fence rejects a stale asynchronous queue request', () => {
  const fence = new NativeQueueRevisionFence()
  const first = fence.next()
  const second = fence.next()

  assert.equal(fence.isCurrent(first), false)
  assert.equal(fence.isCurrent(second), true)
  assert.equal(fence.current, second)
})

test('a stale native queue operation cannot commit after a newer revision is queued', async () => {
  const fence = new NativeQueueRevisionFence()
  const staleRevision = fence.next()
  let release: (() => void) | undefined
  const pending = fence.runLatest(
    staleRevision,
    () =>
      new Promise<string>((resolve) => {
        release = () => resolve('stale queue loaded')
      })
  )

  const latestRevision = fence.next()
  release?.()

  assert.deepEqual(await pending, { applied: false })
  assert.deepEqual(await fence.runLatest(latestRevision, async () => 'latest queue loaded'), {
    applied: true,
    value: 'latest queue loaded'
  })
})

test('out-of-order native queue sync never runs stale loadQueue or setPlayMode', async () => {
  const fence = new NativeQueueRevisionFence()
  const calls: string[] = []
  let releaseOldPrepare: (() => void) | undefined
  const oldRevision = fence.next()
  const oldSync = synchronizeLatestNativeQueue(fence, oldRevision, {
    prepare: () =>
      new Promise<{ id: string }>((resolve) => {
        releaseOldPrepare = () => resolve({ id: 'old' })
      }),
    loadQueue: async (prepared) => {
      calls.push(`load:${prepared.id}`)
    },
    setPlayMode: async () => {
      calls.push('mode:old')
    }
  })

  await new Promise<void>((resolve) => queueMicrotask(resolve))
  const newestRevision = fence.next()
  const newestSync = synchronizeLatestNativeQueue(fence, newestRevision, {
    prepare: async () => ({ id: 'new' }),
    loadQueue: async (prepared) => {
      calls.push(`load:${prepared.id}`)
    },
    setPlayMode: async () => {
      calls.push('mode:new')
    }
  })

  releaseOldPrepare?.()
  assert.deepEqual(await oldSync, { applied: false, prepared: null })
  assert.deepEqual(await newestSync, { applied: true, prepared: { id: 'new' } })
  assert.deepEqual(calls, ['load:new', 'mode:new'])
})
