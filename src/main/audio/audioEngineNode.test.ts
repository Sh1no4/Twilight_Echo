import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

/**
 * Stage 6A — audio runtime Node sidecar protocol.
 *
 * Spawns `audioEngineNode.ts` as a real Node process and drives the JSON-lines
 * protocol the Rust supervisor speaks: init → ready, getPlaybackInfo /
 * getAudioOutputState / setVolume calls, native-missing play fallback, event
 * forwarding (playback-info), and deinit teardown. Mirrors the Rust
 * `audio_runtime::audio_runtime_runs_real_sidecar` end-to-end test.
 */

interface AudioClient {
  send: (message: unknown) => void
  waitFor: (
    predicate: (message: Record<string, unknown>) => boolean,
    timeoutMs?: number
  ) => Promise<Record<string, unknown>>
  stderr: () => string
  exit: Promise<number | null>
}

function spawnAudioEngine(): AudioClient {
  const entry = fileURLToPath(new URL('./audioEngineNode.ts', import.meta.url))
  // Spawn from an empty temp directory so the staged `resources/audio-engine`
  // addon (when the repo has a native MinGW build) is never resolved. This test
  // deterministically exercises the native-missing fallback contract regardless
  // of whether `twilight_audio_node.node` has been built on this machine.
  const sandboxCwd = fs.mkdtempSync(join(os.tmpdir(), 'twilight-audio-sidecar-'))
  const child = spawn(process.execPath, ['--experimental-strip-types', entry], {
    cwd: sandboxCwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TWILIGHT_ENABLE_HTMLAUDIO_FALLBACK: '1',
      TWILIGHT_AUDIO_SERVICE_NODE: '0'
    }
  })
  const stderrChunks: string[] = []
  child.stderr.on('data', (chunk) => stderrChunks.push(chunk.toString()))
  const lines = createInterface({ input: child.stdout })
  let received: Array<Record<string, unknown>> = []
  let waiters: Array<{
    predicate: (message: Record<string, unknown>) => boolean
    resolve: (message: Record<string, unknown>) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }> = []

  lines.on('line', (line) => {
    if (!line.trim()) return
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }
    const index = waiters.findIndex((waiter) => waiter.predicate(message))
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1)
      clearTimeout(waiter.timer)
      waiter.resolve(message)
    } else {
      received.push(message)
    }
  })

  return {
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
    waitFor: (predicate, timeoutMs = 5000) => {
      const index = received.findIndex(predicate)
      if (index >= 0) {
        return Promise.resolve(received.splice(index, 1)[0])
      }
      return new Promise((resolve, reject) => {
        let entry: (typeof waiters)[number]
        const timer = setTimeout(() => {
          waiters = waiters.filter((waiter) => waiter !== entry)
          reject(new Error(`timed out waiting for audio message\nstderr:\n${stderrChunks.join('')}`))
        }, timeoutMs)
        entry = {
          predicate,
          resolve,
          reject,
          timer
        }
        waiters.push(entry)
      })
    },
    stderr: () => stderrChunks.join(''),
    exit: new Promise((resolve) => child.on('exit', resolve))
  }
}

test('audio engine sidecar: init / calls / native-missing fallback / deinit', async () => {
  const audio = spawnAudioEngine()
  try {
    audio.send({ kind: 'init', config: { exclusiveMode: false } })
    const ready = await audio.waitFor((m) => m.kind === 'ready')
    // No native addon in the test environment: the runtime honestly reports it.
    assert.equal((ready.capabilities as { nativeAvailable: boolean }).nativeAvailable, false)
    assert.equal((ready.capabilities as { fallbackAllowed: boolean }).fallbackAllowed, true)

    // getPlaybackInfo returns the default stopped snapshot without pretending.
    audio.send({ kind: 'call', requestId: 'c1', method: 'getPlaybackInfo', args: [] })
    const info = await audio.waitFor((m) => m.kind === 'result' && m.requestId === 'c1')
    assert.equal(info.ok, true)
    assert.equal((info.value as { state: string }).state, 'stopped')
    assert.equal((info.value as { nativePlaybackActive: boolean }).nativePlaybackActive, false)

    // Output routing reports structured native-unavailable (not a WASAPI
    // default) when the addon is absent (Stage 6B task 5).
    audio.send({ kind: 'call', requestId: 'c2', method: 'getAudioOutputState', args: [] })
    const output = await audio.waitFor((m) => m.kind === 'result' && m.requestId === 'c2')
    assert.equal(output.ok, false)
    const unavailable = JSON.parse(String(output.error)) as {
      capability: string
      surface: string
      method: string
      reasonCode: string
      recoverable: boolean
    }
    assert.equal(unavailable.capability, 'audioEngine')
    assert.equal(unavailable.method, 'getAudioOutputState')
    assert.equal(unavailable.reasonCode, 'native-unavailable')
    assert.equal(unavailable.recoverable, true)

    // Volume call is accepted and normalized.
    audio.send({ kind: 'call', requestId: 'c3', method: 'setVolume', args: [0.7] })
    const volume = await audio.waitFor((m) => m.kind === 'result' && m.requestId === 'c3')
    assert.equal(volume.ok, true)

    // Unsupported method returns a structured error, not a fake success.
    audio.send({ kind: 'call', requestId: 'c4', method: 'notARealMethod', args: [] })
    const unsupported = await audio.waitFor((m) => m.kind === 'result' && m.requestId === 'c4')
    assert.equal(unsupported.ok, false)
    assert.match(String(unsupported.error), /不支持方法/)

    // Native-missing play reports nativeStarted:false + fallbackReason so the
    // renderer can fall back to HTMLAudio without believing native succeeded.
    audio.send({
      kind: 'call',
      requestId: 'c5',
      method: 'play',
      args: ['D:/nonexistent/track.flac', 0]
    })
    const play = await audio.waitFor((m) => m.kind === 'result' && m.requestId === 'c5')
    assert.equal(play.ok, true)
    assert.equal((play.value as { nativeStarted: boolean }).nativeStarted, false)
    assert.match(String((play.value as { fallbackReason: string }).fallbackReason), /twilight_audio_node/)

    // Graceful deinit acks before the process exits.
    audio.send({ kind: 'deinit', requestId: 'd1' })
    const deinit = await audio.waitFor((m) => m.kind === 'deinitialized' && m.requestId === 'd1')
    assert.ok(deinit)
  } finally {
    audio.send({ kind: 'deinit', requestId: 'cleanup' })
    const code = await audio.exit
    assert.equal(code, 0, `audio sidecar should exit cleanly\nstderr:\n${audio.stderr()}`)
  }
})

test('audio engine sidecar: Stage 6B slice services (VST3/DSP/analysis/diagnostics)', async () => {
  const dataDir = fs.mkdtempSync(join(os.tmpdir(), 'audio-slice-'))
  const audio = spawnAudioEngine()
  try {
    audio.send({ kind: 'init', config: { exclusiveMode: false, dataDir } })
    await audio.waitFor((m) => m.kind === 'ready')

    // VST3 catalog is a real service backed by a scanner; state is round-tripped.
    audio.send({ kind: 'call', requestId: 's1', method: 'vst3GetState', args: [] })
    const vst3 = await audio.waitFor((m) => m.kind === 'result' && m.requestId === 's1')
    assert.equal(vst3.ok, true)
    const catalogState = vst3.value as {
      enabled: boolean
      searchPaths: string[]
      entries: unknown[]
      helpers?: { platformSupported: boolean }
    }
    assert.equal(typeof catalogState.enabled, 'boolean')
    assert.ok(Array.isArray(catalogState.searchPaths))
    assert.ok(Array.isArray(catalogState.entries))

    // DSP asset library list starts empty and is a real persisted service.
    audio.send({ kind: 'call', requestId: 's2', method: 'dspList', args: [] })
    const dspList = await audio.waitFor((m) => m.kind === 'result' && m.requestId === 's2')
    assert.equal(dspList.ok, true)
    assert.ok(Array.isArray(dspList.value))

    // Analysis cache queries.
    audio.send({ kind: 'call', requestId: 's3', method: 'bpmGetCacheSize', args: [] })
    const bpmSize = await audio.waitFor((m) => m.kind === 'result' && m.requestId === 's3')
    assert.equal(bpmSize.ok, true)
    assert.equal(typeof bpmSize.value, 'number')

    audio.send({ kind: 'call', requestId: 's4', method: 'loudnessGetCacheSize', args: [] })
    const loudnessSize = await audio.waitFor((m) => m.kind === 'result' && m.requestId === 's4')
    assert.equal(loudnessSize.ok, true)
    assert.equal(typeof loudnessSize.value, 'number')

    // Invalid analysis requests are skipped honestly, not fabricated as success.
    audio.send({ kind: 'call', requestId: 's5', method: 'bpmRequest', args: [{}] })
    const bpmReq = await audio.waitFor((m) => m.kind === 'result' && m.requestId === 's5')
    assert.equal(bpmReq.ok, true)
    assert.equal((bpmReq.value as { status: string }).status, 'skipped')

    audio.send({ kind: 'call', requestId: 's6', method: 'loudnessGetStatus', args: [] })
    const loudStatus = await audio.waitFor((m) => m.kind === 'result' && m.requestId === 's6')
    assert.equal(loudStatus.ok, true)
    assert.equal((loudStatus.value as { status: string }).status, 'idle')

    // Diagnostic export writes a JSON report to the requested path.
    const exportPath = join(dataDir, 'diag.json')
    audio.send({ kind: 'call', requestId: 's7', method: 'diagExport', args: [exportPath] })
    const diag = await audio.waitFor((m) => m.kind === 'result' && m.requestId === 's7')
    assert.equal(diag.ok, true)
    assert.equal((diag.value as { filePath: string | null }).filePath, exportPath)
    assert.ok(fs.existsSync(exportPath), 'diagnostic report should be written')
  } finally {
    audio.send({ kind: 'deinit', requestId: 'cleanup-slice' })
    const code = await audio.exit
    assert.equal(code, 0, `audio sidecar should exit cleanly\nstderr:\n${audio.stderr()}`)
  }
})
