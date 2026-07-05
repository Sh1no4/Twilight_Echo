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
  killCount = 0
  postMessage(message: unknown): void {
    this.messages.push(message)
  }
  kill(): void {
    this.killCount += 1
    this.emit('exit', 0)
  }
}

class ThrowingUtilityProcess extends ManualUtilityProcess {
  override postMessage(): void {
    throw new Error('utility pipe closed')
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

test('audio service postMessage failures clear pending RPCs immediately', async () => {
  const child = new ThrowingUtilityProcess()
  const electron = {
    utilityProcess: {
      fork: () => child
    }
  }

  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 1000,
    restartDelayMs: 1000,
    maxInFlightRequests: 1,
    electron
  })
  const internals = binding as unknown as {
    pending: Map<string, unknown>
  }

  try {
    await assert.rejects(() => binding.getMetadataAsync('pipe-closed.flac'), /utility pipe closed/)
    assert.equal(internals.pending.size, 0)

    await assert.rejects(() => binding.getMetadataAsync('second-call.flac'), /utility pipe closed/)
    assert.equal(internals.pending.size, 0)
  } finally {
    binding.destroy()
  }
})

test('audio service async RPCs reject beyond the in-flight request cap', async () => {
  const child = new ManualUtilityProcess()
  const electron = {
    utilityProcess: {
      fork: () => child
    }
  }

  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 1000,
    restartDelayMs: 1000,
    maxInFlightRequests: 2,
    electron
  })
  const internals = binding as unknown as {
    pending: Map<string, unknown>
  }

  const first = binding.getMetadataAsync('slow-track-1.flac')
  const second = binding.getMetadataAsync('slow-track-2.flac')
  const third = binding.getMetadataAsync('slow-track-3.flac')
  const thirdRejected = assert.rejects(third, /音频服务请求过多/)

  try {
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(child.messages.length, 2)
    assert.equal(internals.pending.size, 2)
    await thirdRejected

    for (const message of child.messages as Array<{ requestId: string }>) {
      child.emit('message', {
        kind: 'response',
        requestId: message.requestId,
        ok: true,
        value: '{"title":"ok"}'
      })
    }

    await Promise.all([first, second])
    assert.equal(internals.pending.size, 0)
  } finally {
    binding.destroy()
    await Promise.allSettled([first, second, third])
  }
})

test('fire-and-forget backpressure does not fail existing in-flight RPCs', async () => {
  const child = new ManualUtilityProcess()
  const electron = {
    utilityProcess: {
      fork: () => child
    }
  }

  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 1000,
    restartDelayMs: 1000,
    maxInFlightRequests: 1,
    electron
  })
  const internals = binding as unknown as {
    pending: Map<string, unknown>
  }

  const metadata = binding.getMetadataAsync('slow-track.flac')
  const metadataSettled = metadata.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  )

  try {
    binding.SetOutputDevice('wasapi:busy-device')
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(child.messages.length, 1)
    assert.equal(internals.pending.size, 1)

    child.emit('message', {
      kind: 'response',
      requestId: (child.messages[0] as { requestId: string }).requestId,
      ok: true,
      value: '{"title":"ok"}'
    })

    assert.deepEqual(await metadataSettled, { ok: true, value: '{"title":"ok"}' })
  } finally {
    binding.destroy()
    await metadataSettled
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

test('audio service crash clears service-derived caches', async () => {
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

  const child = children[0]
  const inactive =
    '{"spectrum":[],"waveform":[],"peakDb":-120,"rmsDb":-120,"lufsMomentary":null,"spectrogram":[],"sampleRate":0,"active":false}'
  const visualization =
    '{"spectrum":[0.5],"waveform":[0.25],"peakDb":-1,"rmsDb":-8,"lufsMomentary":-10,"spectrogram":[],"sampleRate":48000,"active":true}'
  const devices = '[{"id":"wasapi:old","name":"Old DAC"}]'
  const upcoming = '{"source":"old-track.flac","title":"Old Track"}'
  const convolver = '{"loaded":true,"active":true,"name":"old-ir.wav"}'

  assert.equal(binding.GetVisualizationData('{"spectrumPoints":64}'), inactive)
  assert.equal(binding.EnumerateDevices(), '[]')
  assert.equal(binding.GetUpcomingTrack(), null)
  assert.equal(binding.GetConvolverInfo(), '{"loaded":false,"active":false}')

  const [visualizationRequest, devicesRequest, upcomingRequest, convolverRequest] = child.messages as Array<{
    requestId: string
  }>
  child.emit('message', {
    kind: 'response',
    requestId: visualizationRequest.requestId,
    ok: true,
    value: visualization
  })
  child.emit('message', {
    kind: 'response',
    requestId: devicesRequest.requestId,
    ok: true,
    value: devices
  })
  child.emit('message', {
    kind: 'response',
    requestId: upcomingRequest.requestId,
    ok: true,
    value: upcoming
  })
  child.emit('message', {
    kind: 'response',
    requestId: convolverRequest.requestId,
    ok: true,
    value: convolver
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(binding.GetVisualizationData('{"spectrumPoints":64}'), visualization)
  assert.equal(binding.EnumerateDevices(), devices)
  assert.equal(binding.GetUpcomingTrack(), upcoming)
  assert.equal(binding.GetConvolverInfo(), convolver)

  child.emit('exit', 1)
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.equal(binding.GetVisualizationData('{"spectrumPoints":64}'), inactive)
  assert.equal(binding.EnumerateDevices(), '[]')
  assert.equal(binding.GetUpcomingTrack(), null)
  assert.equal(binding.GetConvolverInfo(), '{"loaded":false,"active":false}')

  binding.destroy()
})

test('fatal audio service startup errors terminate the failed utility process without restart loop', async () => {
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
  const child = children[0]

  let crashReason = ''
  binding.on('crash', (reason) => {
    crashReason = reason
  })

  child.emit('message', {
    kind: 'fatal',
    error: 'native addon failed to load'
  })

  assert.equal(child.killCount, 1)
  assert.equal(crashReason, 'native addon failed to load')
  assert.match(binding.GetLastError(), /native addon failed to load/)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(children.length, 1)

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

test('cache refreshes keep distinct visualization options in flight independently', () => {
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

  binding.GetVisualizationData('{"spectrumPoints":64}')
  binding.GetVisualizationData('{"spectrumPoints":4096}')

  assert.equal(child.messages.length, 2)
  assert.deepEqual(
    child.messages.map((message) => (message as { args: unknown[] }).args),
    [['{"spectrumPoints":64}'], ['{"spectrumPoints":4096}']]
  )

  binding.destroy()
})

test('visualization cache is isolated by requested options', async () => {
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

  const smallOptions = '{"spectrumPoints":64}'
  const largeOptions = '{"spectrumPoints":4096}'
  const inactive =
    '{"spectrum":[],"waveform":[],"peakDb":-120,"rmsDb":-120,"lufsMomentary":null,"spectrogram":[],"sampleRate":0,"active":false}'
  const smallData =
    '{"spectrum":[0.25],"waveform":[],"peakDb":-6,"rmsDb":-18,"lufsMomentary":null,"spectrogram":[],"sampleRate":44100,"active":true}'
  const largeData =
    '{"spectrum":[0.75,0.5],"waveform":[],"peakDb":-3,"rmsDb":-12,"lufsMomentary":null,"spectrogram":[],"sampleRate":48000,"active":true}'

  assert.equal(binding.GetVisualizationData(smallOptions), inactive)
  child.emit('message', {
    kind: 'response',
    requestId: (child.messages[0] as { requestId: string }).requestId,
    ok: true,
    value: smallData
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(binding.GetVisualizationData(smallOptions), smallData)
  assert.equal(binding.GetVisualizationData(largeOptions), inactive)
  child.emit('message', {
    kind: 'response',
    requestId: (child.messages[2] as { requestId: string }).requestId,
    ok: true,
    value: largeData
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(binding.GetVisualizationData(largeOptions), largeData)
  assert.equal(binding.GetVisualizationData(smallOptions), smallData)

  binding.destroy()
})

test('visualization cache retains only a small bounded set of option keys', async () => {
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
  const internals = binding as unknown as {
    lastVisualizationDataByKey: Map<string, unknown>
    cacheRequestSerial: Map<string, number>
  }

  for (let index = 0; index < 12; ++index) {
    binding.GetVisualizationData(`{"spectrumPoints":${64 + index}}`)
  }
  for (let index = 0; index < child.messages.length; ++index) {
    const request = child.messages[index] as { requestId: string }
    child.emit('message', {
      kind: 'response',
      requestId: request.requestId,
      ok: true,
      value: `{"spectrum":[${index}],"waveform":[],"peakDb":-3,"rmsDb":-12,"lufsMomentary":null,"spectrogram":[],"sampleRate":48000,"active":true}`
    })
  }
  await new Promise((resolve) => setTimeout(resolve, 0))

  const visualizationSerialKeys = [...internals.cacheRequestSerial.keys()].filter((key) =>
    key.startsWith('GetVisualizationData:')
  )
  assert.ok(internals.lastVisualizationDataByKey.size <= 8)
  assert.ok(visualizationSerialKeys.length <= 8)

  binding.destroy()
})

test('high-frequency seek and volume service controls coalesce to the latest value', async () => {
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

  binding.Seek(1)
  binding.Seek(2)
  binding.Seek(3)
  binding.SetVolume(0.1)
  binding.SetVolume(0.8)

  assert.equal(child.messages.length, 0)
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(child.messages.length, 2)
  assert.deepEqual(
    child.messages.map((message) => ({
      method: (message as { method: string }).method,
      args: (message as { args: unknown[] }).args
    })),
    [
      { method: 'Seek', args: [3] },
      { method: 'SetVolume', args: [0.8] }
    ]
  )

  binding.Seek(4)
  binding.Seek(5)
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(child.messages.length, 2)

  const firstSeek = child.messages.find(
    (message) => (message as { method: string }).method === 'Seek'
  ) as { requestId: string }
  child.emit('message', {
    kind: 'response',
    requestId: firstSeek.requestId,
    ok: true,
    value: undefined
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(child.messages.length, 3)
  assert.deepEqual(child.messages[2], {
    ...(child.messages[2] as { requestId: string }),
    kind: 'request',
    method: 'Seek',
    args: [5]
  })

  binding.destroy()
})
