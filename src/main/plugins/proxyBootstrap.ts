// src/main/plugins/proxyBootstrap.ts
// Auto-detects local HTTP proxy and patches globalThis.fetch for the plugin utility process.
//
// Node.js fetch() does not respect system proxy settings (no HTTP_PROXY support).
// In regions where YouTube is blocked (DNS pollution), plugins can't reach
// external APIs without a proxy tunnel. This module:
//   1. Checks HTTPS_PROXY / HTTP_PROXY env vars
//   2. Probes common local proxy ports (Clash, V2Ray, etc.)
//   3. If a proxy is found, monkey-patches globalThis.fetch to route external
//      HTTPS through HTTP CONNECT tunneling
//   4. Localhost / 127.0.0.1 requests always use direct fetch
//
// This runs BEFORE any plugin code loads, so all plugins benefit automatically.

import { connect as netConnect } from 'net'
import { connect as tlsConnect } from 'tls'
import { Agent, request as httpsRequest, type RequestOptions } from 'https'
import type { Duplex } from 'stream'
import { Readable } from 'stream'
import { Buffer } from 'buffer'
import type { IncomingMessage } from 'http'

const COMMON_PROXY_PORTS = [7897, 7890, 7891, 1080, 10809, 8080, 2080, 7898]

interface ProxyEndpoint {
  host: string
  port: number
}

// ─── Proxy Detection ──────────────────────────────────────────────────

function isPortOpen(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = netConnect(port, host)
    const timer = setTimeout(() => { sock.destroy(); resolve(false) }, timeoutMs)
    sock.on('connect', () => { clearTimeout(timer); sock.destroy(); resolve(true) })
    sock.on('error', () => { clearTimeout(timer); resolve(false) })
  })
}

function testProxyTunnel(host: string, port: number, target: string, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = netConnect(port, host)
    const timer = setTimeout(() => { sock.destroy(); resolve(false) }, timeoutMs)
    sock.on('connect', () => {
      sock.write(`CONNECT ${target}:443 HTTP/1.1\r\nHost: ${target}:443\r\n\r\n`)
    })
    let buf = ''
    const onData = (chunk: Buffer): void => {
      buf += chunk.toString()
      const idx = buf.indexOf('\r\n\r\n')
      if (idx === -1) return
      clearTimeout(timer)
      sock.destroy()
      resolve(buf.split('\r\n')[0].includes('200'))
    }
    sock.on('data', onData)
    sock.on('error', () => { clearTimeout(timer); resolve(false) })
  })
}

async function detectProxy(): Promise<ProxyEndpoint | null> {
  // 1. Check environment variables
  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy ||
                   process.env.HTTP_PROXY || process.env.http_proxy ||
                   process.env.ALL_PROXY || process.env.all_proxy
  if (envProxy) {
    const cleaned = envProxy.replace(/^https?:\/\//, '')
    const colonIdx = cleaned.lastIndexOf(':')
    if (colonIdx > 0) {
      const h = cleaned.slice(0, colonIdx)
      const p = parseInt(cleaned.slice(colonIdx + 1), 10)
      if (h && p > 0) {
        console.log(`[proxy] Using proxy from env: ${h}:${p}`)
        return { host: h, port: p }
      }
    }
  }

  // 2. Probe common local proxy ports
  for (const port of COMMON_PROXY_PORTS) {
    if (await isPortOpen('127.0.0.1', port)) {
      if (await testProxyTunnel('127.0.0.1', port, 'www.youtube.com')) {
        console.log(`[proxy] Detected local proxy: 127.0.0.1:${port}`)
        return { host: '127.0.0.1', port }
      }
    }
  }

  console.log('[proxy] No proxy detected; using direct connections')
  return null
}

// ─── Proxy HTTPS Agent (CONNECT tunnel) ───────────────────────────────

class ProxyAgent extends Agent {
  private readonly proxyHost: string
  private readonly proxyPort: number

  constructor(proxyHost: string, proxyPort: number) {
    super({ rejectUnauthorized: false })
    this.proxyHost = proxyHost
    this.proxyPort = proxyPort
  }

  createConnection(options: RequestOptions, callback?: (err: Error | null, stream: Duplex) => void): Duplex | undefined {
    const targetHost = options.host || options.hostname || ''
    const targetPort = options.port || 443
    const servername = options.servername || targetHost
    const sock = netConnect(this.proxyPort, this.proxyHost)
    sock.setTimeout(10000)
    sock.on('timeout', () => { sock.destroy(); callback?.(new Error('Proxy connect timeout'), sock as unknown as Duplex) })
    sock.on('connect', () => {
      sock.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`)
    })
    let buf = ''
    const onData = (chunk: Buffer): void => {
      buf += chunk.toString('binary')
      const idx = buf.indexOf('\r\n\r\n')
      if (idx === -1) return
      sock.removeListener('data', onData)
      const statusLine = buf.slice(0, buf.indexOf('\r\n'))
      if (!statusLine.includes('200')) {
        sock.destroy()
        callback?.(new Error(`Proxy CONNECT failed: ${statusLine}`), sock as unknown as Duplex)
        return
      }
      const tlsSock = tlsConnect({
        socket: sock,
        servername,
        rejectUnauthorized: false
      }) as unknown as Duplex
      tlsSock.on('secureConnect', () => callback?.(null, tlsSock))
      tlsSock.on('error', (err: Error) => callback?.(err, sock as unknown as Duplex))
    }
    sock.on('data', onData)
    sock.on('error', (err: Error) => callback?.(err, sock as unknown as Duplex))
    return undefined
  }
}

// ─── Fetch Wrapper ────────────────────────────────────────────────────

function proxiedFetch(
  urlStr: string,
  init: RequestInit,
  agent: ProxyAgent,
  originalFetch: typeof fetch,
  redirectCount = 0
): Promise<Response> {
  return new Promise((resolve) => {
    let urlObj: URL
    try {
      urlObj = new URL(urlStr)
    } catch {
      resolve(originalFetch(urlStr as RequestInfo | URL, init))
      return
    }

    const method = init.method || 'GET'
    const headers: Record<string, string> = {}

    // Normalize headers from init
    const initHeaders = init.headers
    if (initHeaders) {
      if (typeof (initHeaders as Headers).forEach === 'function') {
        ;(initHeaders as Headers).forEach((v: string, k: string) => { headers[k] = v })
      } else if (Array.isArray(initHeaders)) {
        for (const [k, v] of initHeaders as [string, string][]) headers[k] = v
      } else {
        Object.assign(headers, initHeaders as Record<string, string>)
      }
    }
    headers['Host'] = urlObj.hostname

    // Prepare body
    let body: string | Buffer | undefined
    const rawBody = init.body as unknown
    if (rawBody && typeof rawBody === 'string') {
      body = rawBody
    } else if (rawBody && typeof rawBody === 'object' && !(rawBody instanceof Buffer)) {
      body = JSON.stringify(rawBody)
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json'
      }
    } else if (rawBody instanceof Buffer) {
      body = rawBody
    }
    if (body && !headers['Content-Length'] && !headers['content-length']) {
      headers['Content-Length'] = String(Buffer.byteLength(body))
    }

    const req = httpsRequest({
      hostname: urlObj.hostname,
      port: urlObj.port ? parseInt(urlObj.port, 10) : 443,
      path: urlObj.pathname + urlObj.search,
      method,
      headers,
      agent
    }, (res: IncomingMessage) => {
      // Follow redirects (up to 5)
      if (redirectCount < 5 && res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, urlStr).href
        res.resume()
        resolve(proxiedFetch(redirectUrl, init, agent, originalFetch, redirectCount + 1))
        return
      }

      const status = res.statusCode || 0
      // Build response headers
      const responseHeaders = new Headers()
      for (const [k, v] of Object.entries(res.headers)) {
        if (v != null) responseHeaders.set(k, Array.isArray(v) ? v.join(', ') : String(v))
      }

      // Convert Node.js stream to Web ReadableStream for streaming Response
      // (avoids buffering entire response body in memory — critical for audio)
      const webStream = Readable.toWeb(res) as unknown as BodyInit
      resolve(new Response(webStream, {
        status,
        statusText: res.statusMessage || '',
        headers: responseHeaders
      }))
    })

    // Handle abort signal
    if (init.signal) {
      const signal = init.signal as AbortSignal
      if (signal.aborted) {
        req.destroy()
        resolve(originalFetch(urlStr as RequestInfo | URL, init))
        return
      }
      signal.addEventListener('abort', () => req.destroy())
    }

    req.on('error', (err: Error) => {
      console.log(`[proxy] Fetch failed (${err.message}), falling back to direct`)
      resolve(originalFetch(urlStr as RequestInfo | URL, init))
    })
    req.setTimeout(15000, () => { req.destroy(new Error('Proxy request timeout')) })

    if (body) req.write(body)
    req.end()
  })
}

// ─── Initialization ───────────────────────────────────────────────────

let initialized = false

export async function initProxy(): Promise<void> {
  if (initialized) return
  initialized = true

  const proxy = await detectProxy()
  if (!proxy) return

  const agent = new ProxyAgent(proxy.host, proxy.port)
  const originalFetch = globalThis.fetch

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : (input as Request).url

    // Only proxy external HTTPS requests
    if (!urlStr.startsWith('https://') ||
        urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
      return originalFetch(input, init)
    }

    return proxiedFetch(urlStr, init || {}, agent, originalFetch)
  }) as typeof fetch

  console.log(`[proxy] Global fetch patched: external HTTPS → ${proxy.host}:${proxy.port}`)
}
