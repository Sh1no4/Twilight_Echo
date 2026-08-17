// NCM gateway sidecar entry for the Tauri runtime.
//
// Mirrors the Electron main-process `setupNcmApi()` (`src/main/ncm/api.ts`)
// as a standalone Node process: creates `<tmp>/anonymous_token`, then serves
// the real NetEase gateway via `@neteasecloudmusicapienhanced/api/server.js`.
//
// This file is BUNDLED by `vite.ncm-gateway.config.ts` into a single CJS
// `out/ncm-gateway/ncmGateway.js` (all third-party deps inlined) and shipped
// as a Tauri resource (`sidecar/ncmGateway.js`). It never imports Electron.
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// Static import so the sidecar bundler (`vite.ncm-gateway.config.ts` ssr.noExternal)
// rewrites this to the inlined server module graph — a require/import path left
// external would crash the packaged sidecar with MODULE_NOT_FOUND.
import { serveNcmApi } from '@neteasecloudmusicapienhanced/api/server.js'
// Build-time registry (see scripts/generate-ncm-module-defs.cjs): every route
// module is statically imported here so the single-file bundle needs no
// runtime readdir/dynamic require of `module/*.js`.
import { NCM_MODULE_DEFS } from './moduleDefs.generated.ts'

const PORT = Number(process.env.NCM_GATEWAY_PORT || 3100)
const HOST = process.env.NCM_GATEWAY_HOST || '127.0.0.1'

// util/request.js reads <tmpdir>/anonymous_token at request time and would
// throw if missing; Electron creates it first, so mirror that here.
const tokenPath = join(tmpdir(), 'anonymous_token')
if (!existsSync(tokenPath)) {
  writeFileSync(tokenPath, '', 'utf-8')
}

async function main() {
  const app = await serveNcmApi({
    port: PORT,
    host: HOST,
    checkVersion: false,
    moduleDefs: NCM_MODULE_DEFS
  })
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
}

void main()
