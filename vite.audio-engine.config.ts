import { resolve } from 'path'
import { defineConfig } from 'vite'

/**
 * Bundles the Tauri audio runtime sidecar (`src/main/audio/audioEngineNode.ts`)
 * into a single self-contained CommonJS script. This is the "fixed Node runtime"
 * audio engine that Tauri spawns; it runs the real `AudioEngineManager` (playback
 * controller, output router, DSP orchestrator) and loads the native addon
 * (`twilight_audio_node.node`) in-process when it ships with the bundle. Node
 * built-in modules are externalized; the manager internals are inlined so the
 * output is distributable as a Tauri resource without `node_modules`.
 */
export default defineConfig({
  build: {
    ssr: resolve(__dirname, 'src/main/audio/audioEngineNode.ts'),
    outDir: 'out/audio-engine',
    emptyOutDir: true,
    target: 'node22',
    // Node sidecar stdout is a framed JSON-lines channel; minify/sourcemaps off
    // to keep stack traces readable against the exact source line numbers.
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        format: 'cjs',
        entryFileNames: 'audioEngineNode.js'
      }
    }
  }
})
