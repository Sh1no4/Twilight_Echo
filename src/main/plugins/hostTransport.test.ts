import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

/**
 * Stage 5D — Node stdio host transport framing round-trip.
 *
 * The Tauri plugin host sidecar exchanges messages over stdin/stdout as JSON
 * lines. This test spawns a child that runs `createNodeStdioHostTransport` and
 * verifies a message written to the child's stdin is delivered intact and the
 * child's response is a single framed JSON line the parent can parse. It also
 * verifies the parent can shut the sidecar down gracefully by closing the
 * child's stdin (the same teardown the Rust supervisor performs).
 */

const CHILD_MODE = process.env.HOST_TRANSPORT_CHILD === '1'

if (CHILD_MODE) {
  // Route incidental diagnostics to stderr; stdout stays reserved for framing.
  console.log = (...args) => console.error('[child]', ...args)
  const { createNodeStdioHostTransport } = await import('./hostTransport.ts')
  const transport = createNodeStdioHostTransport()
  transport.onMessage((message) => {
    // The parent is driving this child with synthetic messages that exercise
    // framing (including a host→parent api-call shape), so read it as a record.
    const record = message as unknown as Record<string, unknown>
    if (record.kind === 'api-call') {
      transport.postMessage({ kind: 'activated', pluginId: `echo:${String(record.requestId)}` })
    } else if (record.kind === 'deactivate') {
      transport.postMessage({ kind: 'deactivated', requestId: String(record.requestId) })
    }
  })
  // Keep the child alive until the parent closes stdin (EOF).
} else {
  interface ChildHandle {
    send: (message: unknown) => void
    end: () => void
    next: (timeoutMs?: number) => Promise<Record<string, unknown>>
    close: () => void
    exit: Promise<number | null>
  }

  function spawnChild(): ChildHandle {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', fileURLToPath(new URL('./hostTransport.test.ts', import.meta.url))],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, HOST_TRANSPORT_CHILD: '1' }
      }
    )
    child.stderr.on('data', () => undefined)
    const lines = createInterface({ input: child.stdout })
    const queue: Record<string, unknown>[] = []
    const waiters: Array<{ resolve: (v: Record<string, unknown>) => void }> = []
    lines.on('line', (line) => {
      const parsed = JSON.parse(line) as Record<string, unknown>
      const waiter = waiters.shift()
      if (waiter) waiter.resolve(parsed)
      else queue.push(parsed)
    })
    const exit = new Promise<number | null>((resolve) => child.on('exit', resolve))
    return {
      send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
      end: () => child.stdin.end(),
      next: (timeoutMs = 2000) =>
        new Promise((resolve, reject) => {
          const pending = queue.shift()
          if (pending) {
            resolve(pending)
            return
          }
          const timer = setTimeout(() => reject(new Error('timed out waiting for framed message')), timeoutMs)
          waiters.push({
            resolve: (value) => {
              clearTimeout(timer)
              resolve(value)
            }
          })
        }),
      close: () => child.kill(),
      exit
    }
  }

  test('stdio transport round-trips a framed host message', async () => {
    const child = spawnChild()
    try {
      child.send({ kind: 'api-call', requestId: 'r1', namespace: 'player', method: 'getPlaybackInfo', args: [] })
      const response = await child.next()
      assert.deepEqual(response, { kind: 'activated', pluginId: 'echo:r1' })
    } finally {
      child.close()
    }
  })

  test('stdio transport delivers multiple messages and handles deactivate flush', async () => {
    const child = spawnChild()
    try {
      child.send({ kind: 'api-call', requestId: 'a', namespace: 'player', method: 'play', args: [] })
      child.send({ kind: 'api-call', requestId: 'b', namespace: 'player', method: 'pause', args: [] })
      const first = await child.next()
      const second = await child.next()
      assert.equal(first.kind, 'activated')
      assert.equal(second.kind, 'activated')
      const ids = [first.pluginId, second.pluginId].sort()
      assert.deepEqual(ids, ['echo:a', 'echo:b'])
    } finally {
      child.close()
    }
  })

  test('parent can shut the sidecar down gracefully by closing its stdin', async () => {
    const child = spawnChild()
    try {
      child.send({ kind: 'deactivate', requestId: 'bye' })
      const response = await child.next()
      assert.deepEqual(response, { kind: 'deactivated', requestId: 'bye' })
      // The supervisor ends the child's stdin to signal shutdown; the sidecar
      // sees EOF on stdin and exits with a clean code.
      child.end()
      const code = await Promise.race([
        child.exit,
        new Promise<number | null>((_, reject) =>
          setTimeout(() => reject(new Error('child did not exit after stdin closed')), 3000)
        )
      ])
      assert.equal(code, 0)
    } finally {
      child.close()
    }
  })
}
