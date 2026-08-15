// Prototype: remote plugin marketplace gateway as a standalone Node process
// for the Tauri side. Mirrors `src/main/plugins/indexService.ts` fetch behavior
// (remote index JSON + .tep package download), since the offline Rust crate set
// has no HTTP/TLS client.
//
// NOT part of the shipped app — an experimental bridge under scripts/ (untracked).
import { createServer } from 'node:http'

const PORT = Number(process.env.PLUGIN_INDEX_GATEWAY_PORT || 3101)
const HOST = process.env.PLUGIN_INDEX_GATEWAY_HOST || '127.0.0.1'

// Mirrors indexService.ts `OFFICIAL_PLUGIN_INDEX_URL`.
const INDEX_URL =
  process.env.TWILIGHT_PLUGIN_INDEX_URL ||
  'https://raw.githubusercontent.com/asenyarzc-cpu/Twilight-Echo-plugins/main/plugins.json'

// Mirrors indexService.ts DEFAULT_INDEX_SIZE_LIMIT_BYTES / DEFAULT_PACKAGE_SIZE_LIMIT_BYTES.
const INDEX_SIZE_LIMIT_BYTES = 1024 * 1024
const PACKAGE_SIZE_LIMIT_BYTES = 50 * 1024 * 1024

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  })
  res.end(body)
}

/** Fetch a remote resource into memory, enforcing a byte ceiling while reading. */
async function fetchBounded(url, limitBytes, label) {
  const upstream = await fetch(url)
  if (!upstream.ok) {
    throw new Error(`${label} 返回 HTTP ${upstream.status}`)
  }
  if (!upstream.body) {
    throw new Error(`${label} 没有响应体`)
  }
  const reader = upstream.body.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limitBytes) {
      throw new Error(`${label} 超过 ${limitBytes} 字节上限`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`)
  try {
    if (req.method === 'GET' && url.pathname === '/index') {
      const bytes = await fetchBounded(INDEX_URL, INDEX_SIZE_LIMIT_BYTES, '插件索引')
      // 以 JSON 返回（代理侧按 1MB 上限解析）。
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': bytes.length
      })
      res.end(bytes)
      return
    }

    if (req.method === 'GET' && url.pathname === '/package') {
      const sourceUrl = url.searchParams.get('url') || ''
      let parsed
      try {
        parsed = new URL(sourceUrl)
      } catch {
        json(res, 400, { error: '缺少合法的 package url 参数' })
        return
      }
      if (parsed.protocol !== 'https:') {
        json(res, 400, { error: '插件包 url 必须是 https' })
        return
      }
      const bytes = await fetchBounded(parsed.href, PACKAGE_SIZE_LIMIT_BYTES, '插件包')
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': bytes.length
      })
      res.end(bytes)
      return
    }

    json(res, 404, { error: `未知路径：${url.pathname}` })
  } catch (err) {
    json(res, 502, { error: err?.message || String(err) })
  }
})

server.on('error', (err) => {
  const code = err?.code
  if (code === 'EADDRINUSE') {
    // Someone already serves the gateway on this port (e.g. Electron dev).
    console.log(`Plugin index gateway already running on ${HOST}:${PORT}`)
    process.exit(0)
  }
  console.error('Plugin index gateway error:', err)
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  console.log(`Plugin index gateway listening on http://${HOST}:${PORT}`)
})
