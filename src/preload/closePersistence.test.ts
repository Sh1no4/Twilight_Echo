import assert from 'node:assert/strict'
import test from 'node:test'
import { collectClosePersistenceOutcome } from './closePersistence.ts'

test('renderer close persistence reports failure when a registered writer rejects', async () => {
  const outcome = await collectClosePersistenceOutcome([
    async () => {
      throw new Error('playlist write failed')
    }
  ])

  assert.deepEqual(outcome, { status: 'failed', error: 'playlist write failed' })
})

test('renderer close persistence reports saved only after every writer succeeds', async () => {
  const calls: string[] = []
  const outcome = await collectClosePersistenceOutcome([
    async () => {
      calls.push('playlist')
    },
    () => {
      calls.push('playback')
    }
  ])

  assert.deepEqual(outcome, { status: 'saved' })
  assert.deepEqual(calls.sort(), ['playback', 'playlist'])
})
