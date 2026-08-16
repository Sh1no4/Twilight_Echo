import { resolve } from 'path'
import { defineConfig } from 'vite'

/**
 * Bundles the Tauri plugin host sidecar entry (`src/main/plugins/pluginHostNode.ts`)
 * into a single self-contained CommonJS script. This is the "fixed Node runtime"
 * plugin host that Tauri spawns for each enabled plugin. Node built-in modules are
 * externalized; plugin host internals (hostCore, transport, settings store, proxy)
 * are inlined so the output is distributable as a Tauri resource without Node
 * modules or an `node_modules` directory.
 */
export default defineConfig({
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
      }
    }
  }
})