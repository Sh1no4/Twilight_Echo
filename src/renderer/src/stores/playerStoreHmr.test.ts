import assert from 'node:assert/strict'
import test from 'node:test'
import { configurePlayerStoreHmr, type PlayerStoreHmrApi } from './playerStoreHmr.ts'

test('player-store HMR disposes the old runtime and reloads mounted ref consumers', () => {
  let accepts = 0
  let disposed: (() => void) | undefined
  const hot: PlayerStoreHmrApi = {
    accept() {
      accepts += 1
    },
    dispose(callback) {
      disposed = callback
    }
  }
  let reloads = 0
  let disposals = 0

  configurePlayerStoreHmr(
    hot,
    () => {
      reloads += 1
    },
    () => {
      disposals += 1
    }
  )

  disposed?.()
  assert.equal(accepts, 1)
  assert.equal(disposals, 1)
  assert.equal(reloads, 1)
})

test('player-store HMR configuration is inert outside Vite', () => {
  let reloads = 0
  let disposals = 0

  configurePlayerStoreHmr(
    undefined,
    () => {
      reloads += 1
    },
    () => {
      disposals += 1
    }
  )

  assert.equal(disposals, 0)
  assert.equal(reloads, 0)
})
