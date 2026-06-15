import { loadNativeBinding, type NativeAudioBinding } from './audioEngineManager'

type AudioServiceRequest = {
  kind: 'request'
  requestId: string
  method: keyof NativeAudioBinding
  args: unknown[]
}

type AudioServiceResponse = {
  kind: 'response'
  requestId: string
  ok: boolean
  value?: unknown
  error?: string
}

type ParentPort = {
  postMessage: (message: AudioServiceResponse | { kind: 'ready' } | { kind: 'fatal'; error: string }) => void
  on: (event: 'message', listener: (event: { data: AudioServiceRequest }) => void) => void
}

const maybeParentPort = (process as unknown as { parentPort?: ParentPort }).parentPort
if (!maybeParentPort) {
  throw new Error('Twilight audio engine service must run as an Electron utilityProcess')
}

const parentPort = maybeParentPort
const native = loadNativeBinding()

if (!native) {
  parentPort.postMessage({ kind: 'fatal', error: '未加载 twilight_audio_node.node' })
} else {
  parentPort.postMessage({ kind: 'ready' })
}

parentPort.on('message', (event) => {
  const message = event.data
  if (message.kind !== 'request') return
  void handleRequest(message)
})

async function handleRequest(message: AudioServiceRequest): Promise<void> {
  if (!native) {
    post({
      kind: 'response',
      requestId: message.requestId,
      ok: false,
      error: '未加载 twilight_audio_node.node'
    })
    return
  }
  try {
    const method = native[message.method]
    if (typeof method !== 'function') {
      throw new Error(`原生音频服务不支持方法：${String(message.method)}`)
    }
    const value = (method as (...args: unknown[]) => unknown)(...message.args)
    post({ kind: 'response', requestId: message.requestId, ok: true, value })
  } catch (error) {
    post({
      kind: 'response',
      requestId: message.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

function post(message: AudioServiceResponse): void {
  parentPort.postMessage(message)
}
