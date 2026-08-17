import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { isBuiltin } from 'node:module'
import { join, resolve } from 'path'
import { defineConfig } from 'vite'

/**
 * Bundles the NCM gateway sidecar entry (`src/main/ncm/ncmGatewayNode.ts`)
 * into a single self-contained CommonJS script that the Tauri Rust supervisor
 * spawns with the pinned Node runtime (`sidecar/ncmGateway.js`). It inlines
 * `@neteasecloudmusicapienhanced/api` and its whole dependency tree (express,
 * crypto-js, unblock-music, …) so the packaged app needs no `node_modules`.
 *
 * Only Node builtins stay external. `ssr.noExternal: true` disables Vite's
 * default "externalize all dependencies" so every third-party module is bundled.
 *
 * Before bundling, `scripts/generate-ncm-module-defs.cjs` emits
 * `src/main/ncm/moduleDefs.generated.ts` which statically imports every route
 * module; `ncmGatewayNode` passes the resolved `moduleDefs` to `serveNcmApi`,
 * so no runtime readdir/dynamic require of `module/*.js` remains.
 *
 * The NCM util reads `china_ip_ranges.txt` at runtime from
 * `<bundleDir>/../data/` — copied to `out/data/` in `closeBundle`.
 */
export default defineConfig({
  ssr: {
    // Inline every third-party dependency (NCM API server is big — ~5 MiB
    // bundled) so the sidecar runs on the shipped Node runtime alone.
    noExternal: true
  },
  build: {
    ssr: resolve(__dirname, 'src/main/ncm/ncmGatewayNode.ts'),
    outDir: 'out/ncm-gateway',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        format: 'cjs',
        entryFileNames: 'ncmGateway.js'
      },
      // Externalize only Node builtins, never bare deps.
      external: (id) => isBuiltin(id.replace(/^node:/, ''))
    }
  },
  plugins: [
    {
      name: 'ncm-gateway-preflight',
      buildStart() {
        execSync(
          'node ' + resolve(__dirname, 'scripts/generate-ncm-module-defs.cjs'),
          { stdio: 'inherit' }
        )
      }
    },
    {
      name: 'ncm-gateway-data',
      closeBundle() {
        const outDir = join(__dirname, 'out', 'ncm-gateway')
        const apiDataDir = resolve(
          __dirname,
          'node_modules/@neteasecloudmusicapienhanced/api/data'
        )
        // util/index.js reads `<__dirname>/../data/china_ip_ranges.txt` at
        // startup; with __dirname = out/ncm-gateway that is out/data/.
        mkdirSync(join(__dirname, 'out', 'data'), { recursive: true })
        for (const file of ['china_ip_ranges.txt', 'deviceid.txt']) {
          copyFileSync(join(apiDataDir, file), join(__dirname, 'out', 'data', file))
        }
        // Sanity: no external bare deps may remain in the bundle (the packaged
        // app ships no node_modules). The rollup commonjs plugin may leave a dead
        // `commonjsRequire` shim function, but with `moduleDefs` provided the
        // runtime never calls it — only actual external requires are fatal. Match
        // only prelude-style `const x = require("bare")` statements, not string
        // literals that merely mention a package name.
        const bundle = readFileSync(join(outDir, 'ncmGateway.js'), 'utf8')
        const externalBare = [
          ...bundle.matchAll(/^const \w+ = require\((['"])([^'"]+)\1\)/gm)
        ]
          .map((m) => m[2])
          .filter(
            (id) =>
              !id.startsWith('node:') &&
              !id.startsWith('.') &&
              !isBuiltin(id.replace(/^node:/, ''))
          )
        if (externalBare.length > 0) {
          throw new Error(
            `ncmGateway.js has external bare requires: ${[...new Set(externalBare)].join(', ')}`
          )
        }
      }
    }
  ]
})
