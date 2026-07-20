import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PluginOperationQueue } from './operationQueue.ts'
import { PluginRpcCoordinator } from './rpcCoordinator.ts'

test('plugin operation queue serializes concurrent work for the same plugin id', async () => {
  const queue = new PluginOperationQueue()
  const order: string[] = []
  let releaseFirst!: () => void
  let signalFirstStart!: () => void
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const firstStarted = new Promise<void>((resolve) => {
    signalFirstStart = resolve
  })

  const first = queue.run('com.example.same', async () => {
    order.push('first:start')
    signalFirstStart()
    await firstGate
    order.push('first:end')
  })
  const second = queue.run('com.example.same', async () => {
    order.push('second:start')
    order.push('second:end')
  })

  await firstStarted
  assert.deepEqual(order, ['first:start'])
  assert.equal(queue.activePluginCount, 1)
  releaseFirst()
  await Promise.all([first, second])

  assert.deepEqual(order, ['first:start', 'first:end', 'second:start', 'second:end'])
  await waitForQueueCleanup()
  assert.equal(queue.activePluginCount, 0)
})

test('plugin operation queue permits unrelated plugin ids to proceed independently', async () => {
  const queue = new PluginOperationQueue()
  let releaseFirst!: () => void
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  let secondStarted = false

  const first = queue.run('com.example.first', () => firstGate)
  const second = queue.run('com.example.second', async () => {
    secondStarted = true
  })

  await second
  assert.equal(secondStarted, true)
  await waitForQueueCleanup()
  assert.equal(queue.activePluginCount, 1)
  releaseFirst()
  await first
  await waitForQueueCleanup()
  assert.equal(queue.activePluginCount, 0)
})

test('plugin operation queue rejects an unbounded backlog for one plugin id', async () => {
  const queue = new PluginOperationQueue(1)
  let releaseFirst!: () => void
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const first = queue.run('com.example.busy', () => firstGate)

  await assert.rejects(
    () => queue.run('com.example.busy', async () => undefined),
    /too many pending lifecycle operations/
  )

  releaseFirst()
  await first
  await waitForQueueCleanup()
  assert.equal(queue.activePluginCount, 0)
})

test('queued uninstall wins after a staged update barrier and rejects its outstanding RPC', async (t) => {
  const pluginId = 'com.example.transactional'
  const root = await mkdtemp(join(tmpdir(), 'twilight-plugin-lifecycle-race-'))
  const pluginRoot = join(root, 'plugins', pluginId)
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const queue = new PluginOperationQueue()
  const rpc = new PluginRpcCoordinator()
  const state = new Map([[pluginId, { activeVersion: '2.0.0' }]])
  let releaseTrial!: () => void
  let signalTrialStarted!: () => void
  const trialBarrier = new Promise<void>((resolve) => {
    releaseTrial = resolve
  })
  const trialStarted = new Promise<void>((resolve) => {
    signalTrialStarted = resolve
  })
  let pendingRpc!: Promise<unknown>

  const update = queue.run(pluginId, async () => {
    await mkdir(pluginRoot, { recursive: true })
    pendingRpc = rpc.request({
      requestId: 'update-provider-call',
      pluginId,
      kind: 'provider',
      timeoutMs: 60_000,
      metadata: null,
      dispatch: () => undefined
    })
    signalTrialStarted()
    await trialBarrier
  })

  await trialStarted
  const rpcRejected = assert.rejects(pendingRpc, /uninstalled during queued lifecycle transition/)
  let uninstallStarted = false
  const uninstall = queue.run(pluginId, async () => {
    uninstallStarted = true
    rpc.cancelPlugin(pluginId, 'Plugin was uninstalled during queued lifecycle transition.')
    await rm(pluginRoot, { recursive: true, force: true })
    state.delete(pluginId)
  })

  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(uninstallStarted, false)
  assert.equal(state.has(pluginId), true)
  assert.equal(rpc.getPendingCount(pluginId), 1)
  await access(pluginRoot)

  releaseTrial()
  await Promise.all([update, uninstall])
  await rpcRejected
  await assert.rejects(() => access(pluginRoot))
  assert.equal(state.has(pluginId), false)
  assert.equal(rpc.getPendingCount(pluginId), 0)
})

async function waitForQueueCleanup(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}
