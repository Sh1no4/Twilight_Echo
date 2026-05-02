import { spawn, ChildProcess } from 'child_process'
import * as net from 'net'
import type { Socket } from 'net'
import { EventEmitter } from 'events'
import { join } from 'path'
import { app } from 'electron'
import { existsSync } from 'fs'

export interface MpvConfig {
  exclusiveMode: boolean
  audioDevice?: string
  sampleRate?: number | 'auto'
}

interface MpvRequest {
  command: unknown[]
  request_id: number
}

interface MpvResponse {
  error: string
  request_id?: number
  data?: unknown
  event?: string
  name?: string
  reason?: string
}

function findMpv(): string {
  const bundledCandidates = [
    join(process.resourcesPath ?? '', 'mpv', 'mpv.exe'),
    join(app.getAppPath(), 'resources', 'mpv', 'mpv.exe')
  ]

  for (const candidate of bundledCandidates) {
    if (existsSync(candidate)) return candidate
  }

  return 'mpv'
}

export class MpvManager extends EventEmitter {
  private process: ChildProcess | null = null
  private socket: Socket | null = null
  private requestId = 0
  private pendingRequests = new Map<number, (response: MpvResponse) => void>()
  private buffer = ''
  private pipeName: string
  private config: MpvConfig
  private destroyed = false

  constructor(config: MpvConfig = { exclusiveMode: true }) {
    super()
    this.config = config
    this.pipeName = `\\\\.\\pipe\\mpv-te-${process.pid}`
  }

  private printBanner(mpvPath: string): void {
    const samplingInfo =
      this.config.sampleRate && this.config.sampleRate !== 'auto'
        ? `固定 ${this.config.sampleRate} Hz`
        : '自动切换（匹配音源原始采样率）'

    const exclLabel = this.config.exclusiveMode
      ? '已启用 — 绕过 Windows 混音器，直通 DAC'
      : '未启用 — 经过 Windows 混音器处理'

    const deviceInfo = this.config.audioDevice
      ? `wasapi/${this.config.audioDevice}`
      : '系统默认设备'

    const width = 54
    const pad = (s: string, w: number): string => {
      const stripped = s.replace(/\[[0-9;]*m/g, '')
      const len = [...stripped].length
      return s + ' '.repeat(Math.max(0, w - len))
    }

    const line = (label: string, value: string): string =>
      `  │  ${label}${pad(value, width - 6 - [...label].length)}│`

    console.log('')
    console.log('  ┌' + '─'.repeat(width) + '┐')
    console.log('  │  Twilight Echo — mpv Hi-Fi 音频引擎' + ' '.repeat(width - 39) + '│')
    console.log('  │' + ' '.repeat(width) + '│')
    console.log(line('  引擎路径   ', mpvPath))
    console.log(line('  音频输出   ', 'WASAPI'))
    console.log(line('  独占模式   ', exclLabel))
    console.log(line('  采样率     ', samplingInfo))
    console.log(line('  输出设备   ', deviceInfo))
    console.log('  └' + '─'.repeat(width) + '┘')
    console.log('')
  }

  async start(): Promise<void> {
    const mpvPath = findMpv()
    this.printBanner(mpvPath)

    const args = [
      '--idle=yes',
      `--input-ipc-server=${this.pipeName}`,
      '--ao=wasapi',
      '--config=no',
      '--no-video',
      '--no-terminal',
      '--volume=70',
      '--volume-max=100',
      '--gapless-audio=yes',
      '--keep-open=yes',
      '--msg-level=all=status'
    ]

    if (this.config.exclusiveMode) {
      args.push('--audio-exclusive=yes')
    }

    if (this.config.audioDevice) {
      args.push(`--audio-device=wasapi/${this.config.audioDevice}`)
    }

    if (this.config.sampleRate && this.config.sampleRate !== 'auto') {
      args.push(`--audio-samplerate=${this.config.sampleRate}`)
    }

    this.process = spawn(mpvPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8').trim()
      if (text) {
        console.log('[mpv stderr]', text)
        if (text.includes('error') || text.includes('Error') || text.includes('fail')) {
          this.emit('error', new Error(text))
        }
      }
    })

    this.process.on('error', (err) => {
      this.emit('error', new Error(`无法启动 mpv，请确认已安装 mpv 播放器: ${err.message}`))
    })

    this.process.on('exit', (code) => {
      this.socket?.destroy()
      this.socket = null
      if (!this.destroyed && code !== 0) {
        this.emit('error', new Error(`mpv 异常退出 (code=${code})`))
      }
    })

    await this.connectToPipe(15, 400)
    this.emit('ready')
  }

  private connectToPipe(retries: number, delay: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let attempts = 0

      const tryConnect = (): void => {
        attempts++

        const sock = net.createConnection(this.pipeName, async () => {
          this.socket = sock
          this.setupSocket()
          await this.observeProperties()
          resolve()
        })

        sock.on('error', () => {
          sock.removeAllListeners()
          if (this.destroyed) {
            reject(new Error('Manager destroyed'))
            return
          }
          if (attempts < retries) {
            setTimeout(tryConnect, delay)
          } else {
            reject(new Error('无法连接到 mpv IPC，请确认 mpv 已安装且支持 JSON IPC'))
          }
        })
      }

      setTimeout(tryConnect, 600)
    })
  }

  private setupSocket(): void {
    if (!this.socket) return

    this.socket.on('data', (data: Buffer) => {
      this.buffer += data.toString('utf-8')

      let newlineIndex: number
      while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.substring(0, newlineIndex).trim()
        this.buffer = this.buffer.substring(newlineIndex + 1)

        if (!line) continue

        try {
          const msg: MpvResponse = JSON.parse(line)
          this.handleMessage(msg)
        } catch {
          // 忽略 JSON 解析错误
        }
      }
    })

    this.socket.on('error', (err) => {
      if (!this.destroyed) {
        this.emit('error', err)
      }
    })

    this.socket.on('close', () => {
      this.socket = null
      if (!this.destroyed) {
        this.emit('disconnected')
      }
    })
  }

  private handleMessage(msg: MpvResponse): void {
    if (msg.request_id !== undefined && this.pendingRequests.has(msg.request_id)) {
      const resolve = this.pendingRequests.get(msg.request_id)!
      this.pendingRequests.delete(msg.request_id)
      if (msg.error !== 'success') {
        console.error('[mpv cmd error]', JSON.stringify(msg))
      }
      resolve(msg)
      return
    }

    if (msg.event === 'property-change') {
      this.emit('property-change', { name: msg.name, data: msg.data })
      return
    }

    if (msg.event === 'end-file') {
      this.emit('end-file', { reason: msg.reason || 'unknown' })
      return
    }

    if (msg.event === 'start-file') {
      console.log('[mpv] 开始播放文件')
      this.emit('start-file')
    }
  }

  private sendCommand(command: unknown[]): Promise<MpvResponse> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        reject(new Error('mpv 未连接'))
        return
      }

      const requestId = ++this.requestId
      const request: MpvRequest = {
        command,
        request_id: requestId
      }

      this.pendingRequests.set(requestId, resolve)

      const json = JSON.stringify(request) + '\n'
      this.socket.write(json)
    })
  }

  private async observeProperties(): Promise<void> {
    const props: [number, string][] = [
      [1, 'time-pos'],
      [2, 'duration'],
      [3, 'pause'],
      [4, 'volume']
    ]

    for (const [id, prop] of props) {
      try {
        const resp = await this.sendCommand(['observe_property', id, prop])
        if (resp.error !== 'success') {
          console.error(`[mpv] 注册属性监听失败 ${prop}:`, resp.error)
        }
      } catch (err) {
        console.error(`[mpv] 注册属性监听异常 ${prop}:`, err)
      }
    }
  }

  async play(filePath: string): Promise<void> {
    console.log('[mpv] loadfile:', filePath)
    const resp = await this.sendCommand(['loadfile', filePath, 'replace'])
    if (resp.error !== 'success') {
      throw new Error(`mpv loadfile 失败: ${resp.error}`)
    }
    await this.sendCommand(['set_property', 'pause', false])
  }

  async togglePause(): Promise<void> {
    await this.sendCommand(['cycle', 'pause'])
  }

  async seek(time: number): Promise<void> {
    await this.sendCommand(['seek', time, 'absolute'])
  }

  async setVolume(volume: number): Promise<void> {
    await this.sendCommand(['set_property', 'volume', Math.round(volume * 100)])
  }

  async stop(): Promise<void> {
    try {
      await this.sendCommand(['stop'])
    } catch {
      // ignore if not connected
    }
  }

  async getProperty(name: string): Promise<unknown> {
    const response = await this.sendCommand(['get_property', name])
    return response.data
  }

  async setExclusiveMode(enabled: boolean): Promise<void> {
    this.config.exclusiveMode = enabled
    await this.sendCommand(['set_property', 'audio-exclusive', enabled ? 'yes' : 'no'])
  }

  async getExclusiveMode(): Promise<boolean> {
    return this.config.exclusiveMode
  }

  destroy(): void {
    this.destroyed = true
    if (this.socket) {
      try {
        this.socket.write(JSON.stringify({ command: ['quit'], request_id: 0 }) + '\n')
      } catch {
        // ignore
      }
      this.socket.destroy()
      this.socket = null
    }
    if (this.process && !this.process.killed) {
      this.process.kill()
      this.process = null
    }
  }
}
