import { isBuiltin } from 'node:module'
import { resolve } from 'path'
import { defineConfig } from 'vite'

/**
 * Bundles the Tauri plugin host sidecar entry (`src/main/plugins/pluginHostNode.ts`)
 * into a single self-contained CommonJS script. This is the "fixed Node runtime"
 * plugin host that Tauri spawns for each enabled plugin. Node built-in modules are
 * externalized; plugin host internals (hostCore, transport, settings store, proxy)
 * are inlined so the output is distributable as a Tauri resource without Node
 * modules or an `node_modules` directory.
 *
 * Only Node builtins stay external. Third-party deps (e.g. `undici` used by the
 * proxy bootstrap) must be INLINED — the packaged app has no `node_modules`, and a
 * stray `require('undici')` crashes the sidecar with MODULE_NOT_FOUND. Vite's SSR
 * build externalizes every `dependencies` entry by default; `ssr.noExternal: true`
 * disables that so only real Node builtins remain external.
 */
export default defineConfig({
  ssr: {
    // Inline every third-party dependency into the sidecar bundle. Only true
    // Node builtins remain external (Node provides them at runtime).
    noExternal: true
  },
  build: {
    ssr: resolve(__dirname, 'src/main/plugins/pluginHostNode.ts'),
    outDir: 'out/plugin-host',
    emptyOutDir: true,
    target: 'node22',
    // Node sidecar stdout is a framed JSON-lines channel; minify/sourcemaps off
    // to keep stack traces readable against the exact source line numbers.
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        format: 'cjs',
        entryFileNames: 'pluginHostNode.js'
      },
      // Belt-and-suspenders: externalize only Node builtins, never bare deps.
      external: (id) => isBuiltin(id.replace(/^node:/, ''))
    }
  }
})
