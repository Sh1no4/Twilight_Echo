import { createInterface } from 'node:readline'
import type { PluginHostTransport } from './hostCore.ts'
import type { PluginHostApiResult, PluginHostRequest } from './types.ts'

/**
 * Node stdio transport for the plugin host sidecar.
 *
 * Tauri spawns `node pluginHostNode.js` and exchanges JSON messages over
 * stdin/stdout, one JSON object per line. The transport parses each line and
 * delivers the decoded message to the host core; writes are serialized so a
 * burst of responses cannot interleave mid-line.
 */
export function createNodeStdioHostTransport(): PluginHostTransport {
  let writeTail: Promise<void> = Promise.resolve()
  let closed = false
  let disconnectListener: (() => void) | null = null

  const onDisconnect = (listener: () => void): (() => void) => {
    disconnectListener = listener
    return () => {
      if (disconnectListener === listener) disconnectListener = null
    }
  }

  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity })
  reader.on('line', (line) => {
    if (!line.trim()) return
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      // A malformed control line is not a valid host message; drop it. Plugin
      // payloads are always JSON from a trusted parent, so corruption here is
      // treated as a transport fault rather than forwarded into plugin code.
      return
    }
    // Dispatch to the host core's registered listener. The listener is the
    // single consumer that `runPluginHost` installs via `onMessage`. The parent
    // is trusted to speak the host protocol, so the parsed payload is narrowed
    // to the host message union here.
    queueMicrotask(() => {
      dispatch(message as PluginHostRequest | PluginHostApiResult)
    })
  })
  reader.on('close', () => {
    if (closed) return
    closed = true
    disconnectListener?.()
  })

  let dispatch: (message: PluginHostRequest | PluginHostApiResult) => void = () => {}

  const postMessage = (message: unknown): void => {
    if (closed) return
    const line = `${JSON.stringify(message)}\n`
    // Serialize writes so stdout never interleaves two JSON lines; tolerate the
    // parent exiting (EPIPE) by treating it as a disconnect.
    writeTail = writeTail.then(() => {
      if (closed) return
      process.stdout.write(line, (error?: Error | null) => {
        if (error && !closed) {
          closed = true
          disconnectListener?.()
        }
      })
    })
  }

  return {
    postMessage: postMessage as PluginHostTransport['postMessage'],
    onMessage: (listener) => {
      dispatch = listener
      return () => {
        dispatch = () => {}
      }
    },
    onDisconnect
  }
}