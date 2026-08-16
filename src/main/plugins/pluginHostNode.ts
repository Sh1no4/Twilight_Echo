import { runPluginHost } from './hostCore.ts'
import { createNodeStdioHostTransport } from './hostTransport.ts'

// stdout is the framed JSON-lines protocol channel; incidental diagnostics from
// Node internals (proxy detection, module warnings) must never interleave with
// framed messages, so route them to stderr before the host starts.
const diagnostics = (...args: unknown[]): void => {
  console.error('[plugin-host]', ...args)
}
console.log = diagnostics
console.warn = diagnostics

/**
 * Node sidecar entry point for the Tauri plugin host.
 *
 * Tauri spawns this file with a fixed Node runtime and drives the host over
 * stdin/stdout as JSON lines (see `createNodeStdioHostTransport`). The message
 * protocol is identical to the Electron utility-process host, so the same
 * `hostCore` implementation runs in both transports.
 */
runPluginHost(createNodeStdioHostTransport())
