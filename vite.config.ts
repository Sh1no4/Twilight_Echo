import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  publicDir: resolve(__dirname, 'resources'),
  plugins: [vue()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  clearScreen: false,
  server: {
    host: host || '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 5174
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**']
    }
  },
  build: {
    outDir: resolve(__dirname, 'out/renderer'),
    emptyOutDir: true,
    manifest: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-vue': ['vue'],
          'vendor-music-metadata': ['music-metadata'],
          'vendor-qrcode': ['qrcode']
        }
      }
    }
  }
})
