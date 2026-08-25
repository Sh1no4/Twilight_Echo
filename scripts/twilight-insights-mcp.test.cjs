'use strict'

const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const test = require('node:test')
const {
  buildIndex,
  dispatchTool,
  ensureIndex,
  handleRequest,
  searchChannels,
  summarizeIndex,
  toolDefinitions
} = require('./twilight-insights-mcp.cjs')

function fixtureDetails() {
  return {
    main: [
      { channel: 'settings:get', kind: 'handle', file: 'src/main/ipc/settingsIpc.ts', line: 131 },
      {
        channel: 'settings:update',
        kind: 'handle',
        file: 'src/main/ipc/settingsIpc.ts',
        line: 136
      },
      { channel: 'audioEngine:event', kind: 'on', file: 'src/main/audio/engineIpc.ts', line: 42 }
    ],
    preloadInvokes: [
      { channel: 'settings:get', file: 'src/preload/domains/settingsApi.ts', line: 12 },
      { channel: 'settings:update', file: 'src/preload/domains/settingsApi.ts', line: 18 }
    ],
    preloadSends: [],
    preloadEvents: [
      { channel: 'audioEngine:event', file: 'src/preload/domains/audioEngineApi.ts', line: 7 }
    ],
    rendererApiUses: [
      {
        domain: 'settings',
        action: 'get',
        file: 'src/renderer/src/stores/useSettingsStore.ts',
        line: 20
      },
      {
        domain: 'settings',
        action: 'update',
        file: 'src/renderer/src/stores/useSettingsStore.ts',
        line: 33
      }
    ]
  }
}

test('buildIndex groups main, preload, and renderer sites per channel', () => {
  const index = buildIndex(fixtureDetails())
  assert.equal(index.channels.size, 3)
  const settingsGet = index.channels.get('settings:get')
  assert.deepEqual(settingsGet.main, [
    { kind: 'handle', file: 'src/main/ipc/settingsIpc.ts', line: 131 }
  ])
  assert.equal(settingsGet.preloadInvoke.length, 1)
  assert.equal(settingsGet.rendererUses.length, 1)
  assert.deepEqual(
    index.domains.map((entry) => entry.domain),
    ['settings']
  )
})

test('summarizeIndex reports counts and orphan channels', () => {
  const details = fixtureDetails()
  details.main.push({ channel: 'orphan:internal', kind: 'handle', file: 'src/main/x.ts', line: 1 })
  const summary = summarizeIndex(buildIndex(details))
  assert.equal(summary.channels, 4)
  assert.equal(summary.mainHandles, 3)
  assert.equal(summary.mainOn, 1)
  assert.deepEqual(summary.channelsWithoutPreloadSite, ['orphan:internal'])
  assert.ok(summary.channelsWithoutRendererUse.includes('audioEngine:event'))
})

test('dispatchTool ipc_search matches substrings and honors limit', () => {
  const index = buildIndex(fixtureDetails())
  const result = dispatchTool(index, 'ipc_search', { query: 'settings' })
  assert.deepEqual(
    result.matches.map((match) => match.channel),
    ['settings:get', 'settings:update']
  )
  const limited = dispatchTool(index, 'ipc_search', { query: 'settings', limit: 1 })
  assert.equal(limited.matches.length, 1)
  assert.throws(() => dispatchTool(index, 'ipc_search', { query: '  ' }))
})

test('dispatchTool ipc_channel_details returns sites or suggestions', () => {
  const index = buildIndex(fixtureDetails())
  const found = dispatchTool(index, 'ipc_channel_details', { channel: 'settings:get' })
  assert.equal(found.found, true)
  assert.equal(found.main.length, 1)
  const missing = dispatchTool(index, 'ipc_channel_details', { channel: 'settings:getAll' })
  assert.equal(missing.found, false)
  assert.deepEqual(missing.suggestions, ['settings:get', 'settings:update'])
})

test('dispatchTool renderer_api_usage filters by domain', () => {
  const index = buildIndex(fixtureDetails())
  const all = dispatchTool(index, 'renderer_api_usage', {})
  assert.equal(all.totalCallSites, 2)
  const none = dispatchTool(index, 'renderer_api_usage', { domain: 'themes' })
  assert.equal(none.totalCallSites, 0)
})

test('searchChannels is case-insensitive', () => {
  const index = buildIndex(fixtureDetails())
  assert.equal(searchChannels(index, 'AUDIOENGINE', 10).length, 1)
})

test('handleRequest implements initialize, tools/list, and unknown-method errors', () => {
  const init = handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18' }
  })
  assert.equal(init.result.protocolVersion, '2025-06-18')
  assert.equal(init.result.serverInfo.name, 'twilight-insights')

  const list = handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  assert.deepEqual(
    list.result.tools.map((tool) => tool.name).sort(),
    toolDefinitions()
      .map((tool) => tool.name)
      .sort()
  )

  const unknown = handleRequest({ jsonrpc: '2.0', id: 3, method: 'resources/list' })
  assert.equal(unknown.error.code, -32601)

  const notification = handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' })
  assert.equal(notification, null)
})

test('handleRequest tools/call resolves a real repository channel', () => {
  ensureIndex(true)
  const response = handleRequest({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'ipc_channel_details', arguments: { channel: 'settings:get' } }
  })
  assert.equal(response.result.isError, false)
  const payload = JSON.parse(response.result.content[0].text)
  assert.equal(payload.found, true)
  assert.ok(payload.main.length > 0)
  assert.match(payload.main[0].file, /^src\/main\//)

  const summaryResponse = handleRequest({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'ipc_summary', arguments: {} }
  })
  const summary = JSON.parse(summaryResponse.result.content[0].text)
  assert.ok(summary.mainHandles >= 100, 'expected the real repository to expose >100 handles')
})

test('stdio server answers the MCP handshake end to end', async () => {
  const child = spawn(process.execPath, [__filename.replace(/\.test\.cjs$/, '.cjs')], {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  try {
    const messages = []
    let buffer = ''
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        messages.push(JSON.parse(buffer.slice(0, newline)))
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
    })
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18' }
      }) + '\n'
    )
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
    )
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n')
    await waitFor(() => messages.length >= 2, 15000)
    assert.equal(messages[0].result.serverInfo.name, 'twilight-insights')
    assert.equal(messages[1].result.tools.length, 4)
  } finally {
    child.kill()
  }
})

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting for MCP server responses')
}
