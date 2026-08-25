'use strict'

// Twilight Insights MCP server: zero-dependency stdio JSON-RPC endpoint that
// exposes the IPC channel inventory (scripts/ipc-channel-report.cjs) as query
// tools for AI agents. Registered in .mcp.json as "twilight-insights".

const readline = require('node:readline')
const { buildDetailedReport } = require('./ipc-channel-report.cjs')

const PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'twilight-insights', version: '1.0.0' }

function buildIndex(details) {
  const channels = new Map()
  const ensure = (channel) => {
    if (!channels.has(channel)) {
      channels.set(channel, {
        channel,
        main: [],
        preloadInvoke: [],
        preloadSend: [],
        preloadOn: [],
        rendererUses: []
      })
    }
    return channels.get(channel)
  }
  for (const item of details.main) {
    ensure(item.channel).main.push({ kind: item.kind, file: item.file, line: item.line })
  }
  for (const item of details.preloadInvokes) {
    ensure(item.channel).preloadInvoke.push({ file: item.file, line: item.line })
  }
  for (const item of details.preloadSends) {
    ensure(item.channel).preloadSend.push({ file: item.file, line: item.line })
  }
  for (const item of details.preloadEvents) {
    ensure(item.channel).preloadOn.push({ file: item.file, line: item.line })
  }
  for (const use of details.rendererApiUses) {
    const guessed = `${use.domain}:${use.action}`
    if (channels.has(guessed)) {
      channels.get(guessed).rendererUses.push({ file: use.file, line: use.line })
    }
  }
  const domains = new Map()
  for (const use of details.rendererApiUses) {
    if (!domains.has(use.domain))
      domains.set(use.domain, { domain: use.domain, actions: new Set() })
    domains.get(use.domain).actions.add(use.action)
  }
  const domainList = [...domains.values()]
    .map((entry) => ({ domain: entry.domain, actions: [...entry.actions].sort() }))
    .sort((a, b) => a.domain.localeCompare(b.domain))
  return { channels, domains: domainList, rendererApiUses: details.rendererApiUses }
}

let cachedIndex = null

function ensureIndex(refresh) {
  if (refresh || cachedIndex === null) cachedIndex = buildIndex(buildDetailedReport())
  return cachedIndex
}

function toolDefinitions() {
  return [
    {
      name: 'ipc_summary',
      description:
        'Twilight Echo IPC surface summary: channel counts per kind, renderer window.api domains, and orphan channels.',
      inputSchema: {
        type: 'object',
        properties: {
          refresh: { type: 'boolean', description: 'Rescan the repository before answering.' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'ipc_search',
      description:
        "Search IPC channels by substring (e.g. 'settings', 'audioEngine:play'). Returns matching channels with their main/preload/renderer sites.",
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Case-insensitive substring of a channel name.' },
          limit: {
            type: 'integer',
            description: 'Max channels to return (default 20).',
            minimum: 1
          },
          refresh: { type: 'boolean', description: 'Rescan the repository before answering.' }
        },
        required: ['query'],
        additionalProperties: false
      }
    },
    {
      name: 'ipc_channel_details',
      description:
        "Full map of one IPC channel ('domain:action'): main registrations, preload invoke/send/on sites, renderer window.api call sites.",
      inputSchema: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: "Exact channel name, e.g. 'settings:get'." },
          refresh: { type: 'boolean', description: 'Rescan the repository before answering.' }
        },
        required: ['channel'],
        additionalProperties: false
      }
    },
    {
      name: 'renderer_api_usage',
      description:
        'Renderer window.api.<domain>.<action> call sites, optionally filtered by domain.',
      inputSchema: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Optional window.api domain filter.' },
          limit: {
            type: 'integer',
            description: 'Max call sites to return (default 100).',
            minimum: 1
          },
          refresh: { type: 'boolean', description: 'Rescan the repository before answering.' }
        },
        additionalProperties: false
      }
    }
  ]
}

function summarizeIndex(index) {
  let handles = 0
  let ons = 0
  for (const info of index.channels.values()) {
    if (info.main.some((site) => site.kind === 'handle')) handles += 1
    if (info.main.some((site) => site.kind === 'on')) ons += 1
  }
  const missingPreload = []
  const missingRenderer = []
  for (const info of index.channels.values()) {
    const preloadTouched =
      info.preloadInvoke.length + info.preloadSend.length + info.preloadOn.length > 0
    if (!preloadTouched) missingPreload.push(info.channel)
    if (info.rendererUses.length === 0) missingRenderer.push(info.channel)
  }
  return {
    channels: index.channels.size,
    mainHandles: handles,
    mainOn: ons,
    rendererDomains: index.domains.length,
    rendererApiCallSites: index.rendererApiUses.length,
    channelsWithoutPreloadSite: missingPreload.sort(),
    channelsWithoutRendererUse: missingRenderer.sort()
  }
}

function searchChannels(index, query, limit) {
  const needle = String(query).toLowerCase()
  const matches = []
  for (const info of index.channels.values()) {
    if (info.channel.toLowerCase().includes(needle)) matches.push(info)
    if (matches.length >= limit) break
  }
  matches.sort((a, b) => a.channel.localeCompare(b.channel))
  return matches
}

function dispatchTool(index, name, args) {
  switch (name) {
    case 'ipc_summary':
      return summarizeIndex(index)
    case 'ipc_search': {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      if (query === '') throw new Error('ipc_search requires a non-empty "query" string')
      return {
        query,
        matches: searchChannels(index, query, positiveInt(args.limit, 20))
      }
    }
    case 'ipc_channel_details': {
      const channel = typeof args.channel === 'string' ? args.channel.trim() : ''
      if (channel === '')
        throw new Error('ipc_channel_details requires a non-empty "channel" string')
      const info = index.channels.get(channel)
      if (!info) {
        const seen = new Set()
        const suggestions = []
        for (const part of channel.split(':').filter(Boolean)) {
          for (const candidate of searchChannels(index, part, 5)) {
            if (!seen.has(candidate.channel)) {
              seen.add(candidate.channel)
              suggestions.push(candidate.channel)
            }
          }
        }
        return { channel, found: false, suggestions: suggestions.slice(0, 5) }
      }
      return { ...info, found: true }
    }
    case 'renderer_api_usage': {
      const domain = typeof args.domain === 'string' ? args.domain.trim() : ''
      const limit = positiveInt(args.limit, 100)
      const uses = index.rendererApiUses.filter((use) => domain === '' || use.domain === domain)
      return {
        domain: domain === '' ? null : domain,
        totalCallSites: uses.length,
        callSites: uses.slice(0, limit)
      }
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

function positiveInt(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function handleRequest(message) {
  if (message.method === 'initialize') {
    return jsonRpcResult(message.id, {
      protocolVersion:
        typeof message.params?.protocolVersion === 'string'
          ? message.params.protocolVersion
          : PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO
    })
  }
  if (message.method === 'ping') return jsonRpcResult(message.id, {})
  if (message.method === 'tools/list') {
    return jsonRpcResult(message.id, { tools: toolDefinitions() })
  }
  if (message.method === 'tools/call') {
    const name = message.params?.name
    const args = message.params?.arguments ?? {}
    const refresh = args.refresh === true
    try {
      const index = ensureIndex(refresh)
      const payload = dispatchTool(index, name, args)
      return jsonRpcResult(message.id, {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        isError: false
      })
    } catch (error) {
      return jsonRpcResult(message.id, {
        content: [{ type: 'text', text: `twilight-insights error: ${error.message}` }],
        isError: true
      })
    }
  }
  if (message.id !== undefined) {
    return jsonRpcError(message.id, -32601, `Method not found: ${message.method}`)
  }
  return null
}

function startServer(input, output) {
  const rl = readline.createInterface({ input, terminal: false })
  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (trimmed === '') return
    let message
    try {
      message = JSON.parse(trimmed)
    } catch {
      output.write(JSON.stringify(jsonRpcError(null, -32700, 'Parse error')) + '\n')
      return
    }
    if (message.id === undefined) return
    const response = handleRequest(message)
    if (response !== null) output.write(JSON.stringify(response) + '\n')
  })
}

module.exports = {
  buildIndex,
  ensureIndex,
  summarizeIndex,
  searchChannels,
  dispatchTool,
  handleRequest,
  startServer,
  toolDefinitions
}

if (require.main === module) {
  startServer(process.stdin, process.stdout)
}
