import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

/**
 * Stage 5D — plugin host core end-to-end over the Node stdio sidecar.
 *
 * Spawns `pluginHostNode.ts` as a real Node process and drives the full host
 * protocol over JSON lines: activate → providers.register api-call →
 * activated, provider-call results, ui-command results, cancel propagation,
 * deactivate, and plugin settings persistence. This is the same protocol the
 * Tauri Rust supervisor will speak.
 */

interface HostClient {
  send: (message: unknown) => void
  close: () => void
  waitFor: (
    predicate: (message: Record<string, unknown>) => boolean,
    timeoutMs?: number
  ) => Promise<Record<string, unknown>>
  expectNo: (predicate: (message: Record<string, unknown>) => boolean, windowMs?: number) => Promise<void>
  exit: Promise<number | null>
  stderr: () => string
}

function spawnHost(): HostClient {
  const entry = fileURLToPath(new URL('./pluginHostNode.ts', import.meta.url))
  const child = spawn(process.execPath, ['--experimental-strip-types', entry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TWILIGHT_PLUGIN_PROXY_MODE: 'off' }
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
    close: () => child.stdin.end(),
    waitFor: (predicate, timeoutMs = 3000) => {
      const index = received.findIndex(predicate)
      if (index >= 0) {
        return Promise.resolve(received.splice(index, 1)[0])
      }
      return new Promise((resolve, reject) => {
        let entry: (typeof waiters)[number]
        const timer = setTimeout(() => {
          waiters = waiters.filter((waiter) => waiter !== entry)
          reject(new Error(`timed out waiting for host message\nstderr:\n${stderrChunks.join('')}`))
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
    expectNo: async (predicate, windowMs = 250) => {
      await new Promise<void>((resolve) => setTimeout(resolve, windowMs))
      assert.equal(received.some(predicate), false, 'unexpected message arrived during cancel window')
    },
    exit: new Promise((resolve) => child.on('exit', resolve)),
    stderr: () => stderrChunks.join('')
  }
}

const FIXTURE_MANIFEST = {
  id: 'com.test.fixture',
  name: 'Fixture Provider',
  version: '1.0.0',
  description: 'offline host-core fixture',
  author: 'test',
  license: 'MIT',
  type: ['provider'],
  main: 'index.mjs',
  engines: { twilightEcho: '>=0.20.0' },
  apiVersion: 1,
  permissions: ['settings', 'network', 'library:read', 'library:write']
}

const FIXTURE_PLUGIN = `
export async function activate(context) {
  context.logger.info('fixture activated')
  await context.settings.set('greeting', 'hello')
  await context.twilight.providers.register({
    id: 'fixture',
    name: 'Fixture Provider',
    capabilities: ['search', 'playbackUrl'],
    getPlaybackUrl: (track) => 'fixture://' + (track?.id ?? 'none'),
    searchSongs: async (keywords) => ({ items: [{ id: 1, name: keywords }], total: 1 }),
    fetchPlaylistTracks: async (_id, options) =>
      new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('fixture aborted')))
      })
  })
  context.twilight.ui.onCommand('fixture.hello', (name) => 'hello ' + (name ?? 'world'))
}

export function deactivate() {}
`

interface FixtureDirs {
  pluginDir: string
  dataDir: string
}

function writeFixture(): FixtureDirs {
  const root = mkdtempSync(join(tmpdir(), 'twilight-host-fixture-'))
  const pluginDir = join(root, 'plugin')
  const dataDir = join(root, 'data')
  mkdirSync(pluginDir, { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(pluginDir, 'index.mjs'), FIXTURE_PLUGIN, 'utf-8')
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(FIXTURE_MANIFEST, null, 2), 'utf-8')
  return { pluginDir, dataDir }
}

async function awaitHostExit(host: HostClient): Promise<number | null> {
  host.close()
  return Promise.race([
    host.exit,
    new Promise<number | null>((_, reject) =>
      setTimeout(() => reject(new Error('host did not exit; stderr:\n' + host.stderr())), 3000)
    )
  ])
}

function cleanupFixture(dirs: FixtureDirs): void {
  rmSync(join(dirs.pluginDir, '..'), { recursive: true, force: true })
}

test('host core runs over the Node stdio sidecar: activate/register/call/command/deactivate', async () => {
  const dirs = writeFixture()
  const host = spawnHost()
  try {
    host.send({
      kind: 'activate',
      pluginId: FIXTURE_MANIFEST.id,
      manifest: FIXTURE_MANIFEST,
      mainPath: join(dirs.pluginDir, 'index.mjs'),
      dataDir: dirs.dataDir,
      apiVersion: 1
    })

    // The plugin's providers.register crosses the wire as an api-call.
    const register = await host.waitFor((m) => m.kind === 'api-call' && m.namespace === 'providers')
    assert.equal(register.method, 'register')
    const registerArgs = register.args as Array<Record<string, unknown>>
    assert.equal(registerArgs[0].id, 'fixture')
    host.send({ kind: 'api-result', requestId: String(register.requestId), ok: true, value: null })

    const activated = await host.waitFor((m) => m.kind === 'activated')
    assert.equal(activated.pluginId, FIXTURE_MANIFEST.id)

    // Provider call with a plain return value.
    host.send({
      kind: 'provider-call',
      requestId: 'p1',
      providerId: 'fixture',
      method: 'getPlaybackUrl',
      args: [{ id: 42 }]
    })
    const playback = await host.waitFor((m) => m.kind === 'provider-result' && m.requestId === 'p1')
    assert.equal(playback.ok, true)
    assert.equal(playback.value, 'fixture://42')

    // Provider call with an async payload.
    host.send({
      kind: 'provider-call',
      requestId: 'p2',
      providerId: 'fixture',
      method: 'searchSongs',
      args: ['量子']
    })
    const search = await host.waitFor((m) => m.kind === 'provider-result' && m.requestId === 'p2')
    assert.equal(search.ok, true)
    const searchValue = search.value as { items: Array<{ name: string }> }
    assert.equal(searchValue.items[0].name, '量子')

    // UI command routed to the registered command handler.
    host.send({ kind: 'ui-command', requestId: 'u1', command: 'fixture.hello', args: ['世界'] })
    const command = await host.waitFor((m) => m.kind === 'ui-command-result' && m.requestId === 'u1')
    assert.equal(command.ok, true)
    assert.equal(command.value, 'hello 世界')

    // Cancel propagation aborts a hanging provider call and never posts a result.
    host.send({
      kind: 'provider-call',
      requestId: 'c1',
      providerId: 'fixture',
      method: 'fetchPlaylistTracks',
      args: [{ id: 7 }]
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    host.send({ kind: 'cancel', requestId: 'c1', reason: 'user cancelled' })
    await host.expectNo((m) => m.kind === 'provider-result' && m.requestId === 'c1', 300)

    // The host is still responsive after the cancellation.
    host.send({
      kind: 'provider-call',
      requestId: 'p3',
      providerId: 'fixture',
      method: 'getPlaybackUrl',
      args: [{ id: 9 }]
    })
    const afterCancel = await host.waitFor((m) => m.kind === 'provider-result' && m.requestId === 'p3')
    assert.equal(afterCancel.value, 'fixture://9')

    // Settings written by the plugin landed on disk under its data dir.
    const settings = JSON.parse(readFileSync(join(dirs.dataDir, 'settings.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    assert.equal(settings.greeting, 'hello')

    // Deactivate tears the plugin down cleanly.
    host.send({ kind: 'deactivate', requestId: 'd1' })
    const deactivated = await host.waitFor((m) => m.kind === 'deactivated' && m.requestId === 'd1')
    assert.ok(deactivated)
  } finally {
    const code = await awaitHostExit(host)
    assert.equal(code, 0)
    cleanupFixture(dirs)
  }
})

test('host core rejects an unhandled provider method with a structured error result', async () => {
  const dirs = writeFixture()
  const host = spawnHost()
  try {
    host.send({
      kind: 'activate',
      pluginId: FIXTURE_MANIFEST.id,
      manifest: FIXTURE_MANIFEST,
      mainPath: join(dirs.pluginDir, 'index.mjs'),
      dataDir: dirs.dataDir,
      apiVersion: 1
    })
    const register = await host.waitFor((m) => m.kind === 'api-call' && m.namespace === 'providers')
    host.send({ kind: 'api-result', requestId: String(register.requestId), ok: true, value: null })
    await host.waitFor((m) => m.kind === 'activated')

    host.send({ kind: 'provider-call', requestId: 'x1', providerId: 'fixture', method: 'getLyrics', args: [] })
    const result = await host.waitFor((m) => m.kind === 'provider-result' && m.requestId === 'x1')
    assert.equal(result.ok, false)
    assert.match(String(result.error), /does not implement getLyrics/)
  } finally {
    const code = await awaitHostExit(host)
    assert.equal(code, 0)
    cleanupFixture(dirs)
  }
})
