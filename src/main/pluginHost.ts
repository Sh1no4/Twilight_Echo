import { runPluginHost, type PluginHostTransport } from './plugins/hostCore.ts'

type ParentPort = {
  postMessage: (message: unknown) => void
  on: (event: 'message', listener: (event: { data: unknown }) => void) => void
  removeListener: (event: 'message', listener: (event: { data: unknown }) => void) => void
}

const maybeParentPort = (process as unknown as { parentPort?: ParentPort }).parentPort
if (!maybeParentPort) {
  throw new Error('Twilight plugin host must run as an Electron utilityProcess')
}
const parentPort = maybeParentPort

const transport: PluginHostTransport = {
  postMessage: (message) => parentPort.postMessage(message),
  onMessage: (listener) => {
    const handle = (event: { data: unknown }): void => {
      listener(event.data as Parameters<typeof listener>[0])
    }
    parentPort.on('message', handle)
    return () => parentPort.removeListener('message', handle)
  }
}

runPluginHost(transport)
