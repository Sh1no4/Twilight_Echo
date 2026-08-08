import assert from 'node:assert/strict'
import test from 'node:test'
import { createDebouncedVolumePersistence } from './volumePersistence.ts'

test('flush persists the final volume before the debounce delay expires', async () => {
  const callbacks = new Map<number, () => void>()
  const writes: number[] = []
  let nextTimer = 0
  const persistence = createDebouncedVolumePersistence(
    async (value) => {
      writes.push(value)
    },
    {
      setTimeout(callback) {
        const id = ++nextTimer
        callbacks.set(id, callback)
        return id as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeout(timer) {
        callbacks.delete(timer as unknown as number)
      }
    }
  )

  persistence.schedule(0.35)
  persistence.schedule(0.82)
  await persistence.flush(0.82)

  assert.deepEqual(writes, [0.82])
  assert.equal(callbacks.size, 0)
})
