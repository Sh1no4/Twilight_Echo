import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { AudioEngineServiceBinding } from './audioEngineServiceClient.ts'

class SilentUtilityProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  postMessage(): void {}
  kill(): void {
    this.emit('exit', 0)
  }
}

test('cached audio service calls swallow timeout rejections', async () => {
  const child = new SilentUtilityProcess()
  const electron = {
      utilityProcess: {
        fork: () => child
      }
  }
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason)
  }
  process.on('unhandledRejection', onUnhandled)

  try {
    const binding = new AudioEngineServiceBinding({
      serviceEntry: 'audioEngineService.js',
      requestTimeoutMs: 5,
      restartDelayMs: 1000,
      electron
    })
    assert.equal(binding.EnumerateDevices(), '[]')
    assert.equal(binding.GetPlaybackInfo(), '{"state":"stopped"}')
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(unhandled.length, 0)
    assert.match(binding.GetLastError(), /音频服务调用超时/)
    binding.destroy()
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})
