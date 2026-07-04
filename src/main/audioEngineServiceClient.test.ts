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

class ManualUtilityProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  messages: unknown[] = []
  postMessage(message: unknown): void {
    this.messages.push(message)
  }
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

test('stale audio service responses after crash do not repopulate playback cache', async () => {
  const children: ManualUtilityProcess[] = []
  const electron = {
    utilityProcess: {
      fork: () => {
        const child = new ManualUtilityProcess()
        children.push(child)
        return child
      }
    }
  }

  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 100,
    restartDelayMs: 5,
    electron
  })

  assert.equal(binding.GetPlaybackInfo(), '{"state":"stopped"}')
  const firstChild = children[0]
  const request = firstChild.messages[0] as { requestId: string }
  firstChild.emit('exit', 1)
  await new Promise((resolve) => setTimeout(resolve, 20))

  firstChild.emit('message', {
    kind: 'response',
    requestId: request.requestId,
    ok: true,
    value: '{"state":"playing"}'
  })

  assert.equal(binding.GetPlaybackInfo(), '{"state":"stopped"}')
  binding.destroy()
})

test('cache refreshes coalesce while a same-method service request is in flight', async () => {
  const child = new ManualUtilityProcess()
  const electron = {
    utilityProcess: {
      fork: () => child
    }
  }

  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 100,
    restartDelayMs: 1000,
    electron
  })

  assert.equal(
    binding.GetVisualizationData('{"spectrumPoints":4096}'),
    '{"spectrum":[],"waveform":[],"peakDb":-120,"rmsDb":-120,"lufsMomentary":null,"spectrogram":[],"sampleRate":0,"active":false}'
  )
  assert.equal(
    binding.GetVisualizationData('{"spectrumPoints":4096}'),
    '{"spectrum":[],"waveform":[],"peakDb":-120,"rmsDb":-120,"lufsMomentary":null,"spectrogram":[],"sampleRate":0,"active":false}'
  )
  assert.equal(child.messages.length, 1)

  const request = child.messages[0] as { requestId: string }

  child.emit('message', {
    kind: 'response',
    requestId: request.requestId,
    ok: true,
    value:
      '{"spectrum":[1],"waveform":[],"peakDb":-3,"rmsDb":-12,"lufsMomentary":null,"spectrogram":[],"sampleRate":48000,"active":true}'
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(
    binding.GetVisualizationData('{"spectrumPoints":4096}'),
    '{"spectrum":[1],"waveform":[],"peakDb":-3,"rmsDb":-12,"lufsMomentary":null,"spectrogram":[],"sampleRate":48000,"active":true}'
  )
  assert.equal(child.messages.length, 2)

  binding.destroy()
})
