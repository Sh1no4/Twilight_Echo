// Prototype: stand up the NetEase cloud music gateway as a standalone Node
// process for the Tauri side. Mirrors src/main/ncm/api.ts `setupNcmApi()`.
//
// NOT part of the shipped app — an experimental bridge so Tauri's
// `providers_call` can proxy to a real gateway instead of the current
// "gateway unavailable" structured error. Lives under scripts/ (untracked).
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PORT = Number(process.env.NCM_GATEWAY_PORT || 3100)
const HOST = process.env.NCM_GATEWAY_HOST || '127.0.0.1'

// util/request.js reads <tmpdir>/anonymous_token at request time and would
// throw if missing; Electron creates it first, so mirror that here.
const tokenPath = join(tmpdir(), 'anonymous_token')
if (!existsSync(tokenPath)) {
  writeFileSync(tokenPath, '', 'utf-8')
}

const serverJs = join(
  import.meta.dirname,
  '../node_modules/@neteasecloudmusicapienhanced/api/server.js'
)
const { serveNcmApi } = await import(pathToFileURL(serverJs).href)
const app = await serveNcmApi({ port: PORT, host: HOST, checkVersion: false })

app.server.on('error', (err) => {
  const code = err?.code
  if (code === 'EADDRINUSE') {
    // Someone already serves the gateway on this port (e.g. Electron dev).
    console.log(`NCM gateway already running on ${HOST}:${PORT}`)
    process.exit(0)
  }
  console.error('NCM gateway error:', err)
  process.exit(1)
})
