import { app, dialog, shell, utilityProcess, type UtilityProcess } from 'electron'
import extract from 'extract-zip'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { cp, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'path'
import { tmpdir } from 'os'
import { EventEmitter } from 'events'
import { isCompatibleTwilightRange, validatePluginManifest } from './manifest'
import type {
  PluginHostApiResult,
  PluginHostRequest,
  PluginHostResponse,
  TwilightMediaProviderMethod,
  TwilightMediaProviderRegistration,
  TwilightPluginDescriptor,
  TwilightPluginInstallResult,
  TwilightPluginManifest,
  TwilightPluginStateRecord,
  TwilightPluginUninstallOptions
} from './types'

type PluginStateFile = Record<string, TwilightPluginStateRecord>

export interface TwilightPluginManagerOptions {
  appVersion: string
  hostEntry: string
  getPlaybackInfo: () => Promise<unknown> | unknown
  player: {
    play: () => Promise<void> | void
    pause: () => Promise<void> | void
    togglePause: () => Promise<void> | void
    stop: () => Promise<void> | void
    next: () => Promise<void> | void
    previous: () => Promise<void> | void
  }
}

interface RunningPlugin {
  process: UtilityProcess
  descriptor: TwilightPluginDescriptor
  subscriptions: Set<string>
  providers: TwilightMediaProviderRegistration[]
}

const STATE_FILE = 'plugin-state.json'

export class TwilightPluginManager extends EventEmitter {
  private readonly appVersion: string
  private readonly hostEntry: string
  private readonly getPlaybackInfo: TwilightPluginManagerOptions['getPlaybackInfo']
  private readonly player: TwilightPluginManagerOptions['player']
  private readonly running = new Map<string, RunningPlugin>()
  private readonly providerCalls = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: NodeJS.Timeout
    }
  >()
  private state: PluginStateFile = {}

  constructor(options: TwilightPluginManagerOptions) {
    super()
    this.appVersion = options.appVersion
    this.hostEntry = options.hostEntry
    this.getPlaybackInfo = options.getPlaybackInfo
    this.player = options.player
  }

  get roots(): {
    plugins: string
    data: string
    logs: string
    stateFile: string
  } {
    const userData = app.getPath('userData')
    return {
      plugins: join(userData, 'plugins'),
      data: join(userData, 'plugin-data'),
      logs: join(userData, 'logs', 'plugins'),
      stateFile: join(userData, STATE_FILE)
    }
  }

  async initialize(): Promise<void> {
    this.ensureRoots()
    await this.loadState()
    await this.scanAndStartEnabled()
  }

  async list(): Promise<TwilightPluginDescriptor[]> {
    this.ensureRoots()
    const descriptors: TwilightPluginDescriptor[] = []
    const rootEntries = await safeReadDir(this.roots.plugins)
    for (const pluginDir of rootEntries) {
      const idRoot = join(this.roots.plugins, pluginDir)
      const versionEntries = await safeReadDir(idRoot)
      for (const version of versionEntries) {
        descriptors.push(await this.readDescriptor(join(idRoot, version), 'scan'))
      }
    }
    return descriptors.sort((left, right) => left.name.localeCompare(right.name))
  }

  async installFromPath(sourcePath: string): Promise<TwilightPluginInstallResult> {
    const source = resolve(sourcePath)
    if (!existsSync(source)) throw new Error('插件来源不存在')
    const sourceStats = await stat(source)
    const isTep = sourceStats.isFile() && extname(source).toLowerCase() === '.tep'
    if (!sourceStats.isDirectory() && !isTep) {
      throw new Error('插件来源必须是目录或 .tep 文件')
    }
    const tempRoot = await mkdtemp(join(tmpdir(), 'twilight-plugin-'))
    try {
      const installSource =
        isTep
          ? await this.extractTep(source, tempRoot)
          : source
      const manifest = await this.readManifest(installSource)
      await this.confirmTrustBasedInstall(manifest, source)
      const target = this.versionRoot(manifest.id, manifest.version)
      await rm(target, { recursive: true, force: true })
      mkdirSync(dirname(target), { recursive: true })
      await cp(installSource, target, {
        recursive: true,
        filter: (path) => !isInsidePath(path, this.roots.plugins)
      })
      const now = new Date().toISOString()
      this.state[manifest.id] = {
        enabled: false,
        installedAt: this.state[manifest.id]?.installedAt ?? now,
        updatedAt: now,
        source: isTep ? 'tep' : 'directory'
      }
      await this.saveState()
      const plugin = await this.readDescriptor(target, this.state[manifest.id].source)
      return {
        plugin,
        warning: '信任式安装：插件拥有与应用相同的权限，请仅安装可信来源。'
      }
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  }

  async chooseAndInstall(): Promise<TwilightPluginInstallResult | null> {
    const result = await dialog.showOpenDialog({
      title: '安装 Twilight Echo 插件',
      properties: ['openFile', 'openDirectory'],
      filters: [
        { name: 'Twilight Echo Plugin', extensions: ['tep'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return this.installFromPath(result.filePaths[0])
  }

  async enable(id: string): Promise<TwilightPluginDescriptor> {
    const descriptor = await this.findDescriptor(id)
    if (descriptor.status === 'invalid') throw new Error(descriptor.error ?? '插件无效')
    if (descriptor.isDsp && !descriptor.main) {
      throw new Error('DSP 原生插件将在 Phase 4 单独启用；Phase 1 仅展示风险信息')
    }
    try {
      this.setEnabled(id, true)
      await this.startPlugin(descriptor)
    } catch (error) {
      this.markFailed(id, error instanceof Error ? error.message : String(error))
      throw error
    }
    return this.findDescriptor(id)
  }

  async disable(id: string): Promise<TwilightPluginDescriptor> {
    this.setEnabled(id, false)
    await this.stopPlugin(id)
    return this.findDescriptor(id)
  }

  async uninstall(id: string, options: TwilightPluginUninstallOptions = {}): Promise<void> {
    await this.disable(id).catch(() => undefined)
    await rm(join(this.roots.plugins, id), { recursive: true, force: true })
    if (options.removeData) {
      await rm(join(this.roots.data, id), { recursive: true, force: true })
    }
    delete this.state[id]
    await this.saveState()
    this.emit('changed')
  }

  async openLog(id: string): Promise<void> {
    const descriptor = await this.findDescriptor(id)
    ensureParent(descriptor.paths.logPath)
    if (!existsSync(descriptor.paths.logPath)) await writeFile(descriptor.paths.logPath, '', 'utf-8')
    shell.showItemInFolder(descriptor.paths.logPath)
  }

  async getLog(id: string): Promise<string> {
    const descriptor = await this.findDescriptor(id)
    try {
      const raw = await readFile(descriptor.paths.logPath, 'utf-8')
      return raw.slice(-20000)
    } catch {
      return ''
    }
  }

  async broadcastEvent(name: string, payload: unknown): Promise<void> {
    for (const running of this.running.values()) {
      if (running.subscriptions.has(name)) {
        running.process.postMessage({ kind: 'event', name, payload } satisfies PluginHostRequest)
      }
    }
  }

  listProviders(): TwilightMediaProviderRegistration[] {
    return [...this.running.values()].flatMap((running) => running.providers)
  }

  async callProvider(
    providerId: string,
    method: TwilightMediaProviderMethod,
    args: unknown[]
  ): Promise<unknown> {
    const normalizedProviderId = providerId.trim().toLowerCase()
    const running = [...this.running.values()].find((candidate) =>
      candidate.providers.some((provider) => provider.id === normalizedProviderId)
    )
    if (!running) throw new Error(`Provider 未启用：${normalizedProviderId}`)

    const requestId = randomUUID()
    running.process.postMessage({
      kind: 'provider-call',
      requestId,
      providerId: normalizedProviderId,
      method,
      args
    } satisfies PluginHostRequest)

    return new Promise((resolveCall, rejectCall) => {
      const timer = setTimeout(() => {
        this.providerCalls.delete(requestId)
        rejectCall(new Error(`Provider 调用超时：${normalizedProviderId}.${method}`))
      }, 10000)
      this.providerCalls.set(requestId, {
        resolve: resolveCall,
        reject: rejectCall,
        timer
      })
    })
  }

  async destroy(): Promise<void> {
    await Promise.all([...this.running.keys()].map((id) => this.stopPlugin(id)))
  }

  private async scanAndStartEnabled(): Promise<void> {
    const descriptors = await this.list()
    for (const descriptor of descriptors) {
      if (descriptor.enabled && descriptor.status !== 'invalid') {
        await this.startPlugin(descriptor).catch((error) => {
          this.markFailed(descriptor.id, error instanceof Error ? error.message : String(error))
        })
      }
    }
  }

  private async startPlugin(descriptor: TwilightPluginDescriptor): Promise<void> {
    if (this.running.has(descriptor.id)) return
    if (!descriptor.main) throw new Error('JS 插件缺少 main 入口')
    if (!isCompatibleTwilightRange(descriptor.engines.twilightEcho, this.appVersion)) {
      throw new Error(`插件要求 Twilight Echo ${descriptor.engines.twilightEcho}`)
    }
    const mainPath = resolve(descriptor.paths.versionRoot, descriptor.main)
    if (!isInsidePath(mainPath, descriptor.paths.versionRoot) || !existsSync(mainPath)) {
      throw new Error('插件 main 入口不存在或越界')
    }
    mkdirSync(descriptor.paths.dataDir, { recursive: true })
    const child = utilityProcess.fork(this.hostEntry, [], {
      serviceName: `twilight-plugin-${descriptor.id}`,
      stdio: 'pipe'
    })
    const running: RunningPlugin = {
      process: child,
      descriptor,
      subscriptions: new Set(),
      providers: []
    }
    this.running.set(descriptor.id, running)
    child.on('message', (message: PluginHostResponse) => {
      void this.handleHostMessage(descriptor.id, message)
    })
    child.on('exit', (code) => {
      this.running.delete(descriptor.id)
      if (this.state[descriptor.id]?.enabled) {
        this.markFailed(descriptor.id, `插件宿主进程退出：${code}`)
      }
    })
    child.on('error', (_type, location) => {
      this.markFailed(descriptor.id, `插件宿主进程错误：${location}`)
    })
    child.stdout?.on('data', (chunk) => this.appendLog(descriptor, 'info', chunk.toString()))
    child.stderr?.on('data', (chunk) => this.appendLog(descriptor, 'error', chunk.toString()))
    child.postMessage({
      kind: 'activate',
      pluginId: descriptor.id,
      manifest: this.toManifest(descriptor),
      mainPath,
      dataDir: descriptor.paths.dataDir,
      apiVersion: descriptor.apiVersion
    } satisfies PluginHostRequest)
  }

  private async stopPlugin(id: string): Promise<void> {
    const running = this.running.get(id)
    if (!running) return
    const requestId = randomUUID()
    running.process.postMessage({ kind: 'deactivate', requestId } satisfies PluginHostRequest)
    await new Promise<void>((resolveDone) => {
      const timer = setTimeout(resolveDone, 1500)
      const onMessage = (message: PluginHostResponse): void => {
        if (message.kind === 'deactivated' && message.requestId === requestId) {
          clearTimeout(timer)
          running.process.off('message', onMessage)
          resolveDone()
        }
      }
      running.process.on('message', onMessage)
    })
    running.process.kill()
    this.running.delete(id)
  }

  private async handleHostMessage(id: string, message: PluginHostResponse): Promise<void> {
    const running = this.running.get(id)
    if (!running) return
    if (message.kind === 'log') {
      this.appendLog(running.descriptor, message.level, message.message)
      return
    }
    if (message.kind === 'host-error') {
      this.markFailed(id, message.message)
      await this.stopPlugin(id)
      return
    }
    if (message.kind === 'api-event-subscribe') {
      running.subscriptions.add(message.eventName)
      return
    }
    if (message.kind === 'api-call') {
      const result = await this.handleApiCall(id, message)
      running.process.postMessage(result)
    }
    if (message.kind === 'provider-result') {
      this.handleProviderResult(message)
    }
  }

  private async handleApiCall(
    id: string,
    message: Extract<PluginHostResponse, { kind: 'api-call' }>
  ): Promise<PluginHostApiResult> {
    try {
      if (message.namespace === 'providers') {
        return {
          kind: 'api-result',
          requestId: message.requestId,
          ok: true,
          value: this.registerProviderFromPlugin(id, message)
        }
      }
      if (message.namespace !== 'player') throw new Error('未知 API 命名空间')
      const method = message.method
      if (method === 'getPlaybackInfo') {
        return { kind: 'api-result', requestId: message.requestId, ok: true, value: await this.getPlaybackInfo() }
      }
      if (['play', 'pause', 'togglePause', 'stop', 'next', 'previous'].includes(method)) {
        await this.player[method as keyof typeof this.player]()
        return { kind: 'api-result', requestId: message.requestId, ok: true, value: null }
      }
      throw new Error('未知播放器 API')
    } catch (error) {
      return {
        kind: 'api-result',
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private registerProviderFromPlugin(
    pluginId: string,
    message: Extract<PluginHostResponse, { kind: 'api-call' }>
  ): TwilightMediaProviderRegistration {
    if (message.method !== 'register') throw new Error('未知 Provider API')
    const running = this.running.get(pluginId)
    if (!running) throw new Error('插件未运行')
    if (!running.descriptor.type.includes('provider')) {
      throw new Error('只有 provider 类型插件可以注册 MediaProvider')
    }
    const raw = message.args[0]
    if (!raw || typeof raw !== 'object') throw new Error('Provider 注册信息必须是对象')
    const record = raw as Record<string, unknown>
    const providerId = typeof record.id === 'string' ? record.id.trim().toLowerCase() : ''
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const capabilities = Array.isArray(record.capabilities)
      ? record.capabilities.filter((item): item is TwilightMediaProviderRegistration['capabilities'][number] =>
          typeof item === 'string' &&
          ['search', 'playbackUrl', 'lyrics', 'cover', 'playlist', 'library', 'login'].includes(item)
        )
      : []
    if (!providerId || !/^[a-z][a-z0-9-]*$/.test(providerId)) {
      throw new Error('Provider id 必须是小写前缀，例如 bili 或 ncm')
    }
    if (!name) throw new Error('Provider name 必填')
    if (capabilities.length === 0) throw new Error('Provider capabilities 必须声明至少一项能力')
    const provider = { id: providerId, name, capabilities }
    running.providers.push(provider)
    this.emit('changed')
    return provider
  }

  private handleProviderResult(message: Extract<PluginHostResponse, { kind: 'provider-result' }>): void {
    const pending = this.providerCalls.get(message.requestId)
    if (!pending) return
    this.providerCalls.delete(message.requestId)
    clearTimeout(pending.timer)
    if (message.ok) {
      pending.resolve(message.value)
    } else {
      pending.reject(new Error(message.error))
    }
  }

  private async readDescriptor(versionRoot: string, source: TwilightPluginDescriptor['source']): Promise<TwilightPluginDescriptor> {
    try {
      const manifest = await this.readManifest(versionRoot)
      const state = this.state[manifest.id]
      const paths = this.pathsFor(manifest.id, manifest.version)
      const error = this.validateRuntimeDescriptor(manifest, paths.versionRoot)
      return {
        ...manifest,
        status: error ? 'invalid' : state?.lastError ? 'failed' : state?.enabled ? 'enabled' : 'disabled',
        enabled: state?.enabled === true && !error,
        error: error ?? state?.lastError ?? null,
        isDsp: manifest.type.includes('dsp'),
        source: state?.source ?? source,
        installedAt: state?.installedAt ?? null,
        updatedAt: state?.updatedAt ?? null,
        paths
      }
    } catch (error) {
      const id = basename(dirname(versionRoot)) || 'unknown'
      const version = basename(versionRoot) || 'unknown'
      return {
        id,
        name: id,
        version,
        description: '',
        author: '',
        license: '',
        type: [],
        engines: { twilightEcho: '*' },
        apiVersion: 1,
        permissions: [],
        status: 'invalid',
        enabled: false,
        error: error instanceof Error ? error.message : String(error),
        isDsp: false,
        source,
        installedAt: null,
        updatedAt: null,
        paths: this.pathsFor(id, version)
      }
    }
  }

  private validateRuntimeDescriptor(manifest: TwilightPluginManifest, versionRoot: string): string | null {
    if (!isCompatibleTwilightRange(manifest.engines.twilightEcho, this.appVersion)) {
      return `插件要求 Twilight Echo ${manifest.engines.twilightEcho}`
    }
    if (manifest.main) {
      const mainPath = resolve(versionRoot, manifest.main)
      if (!isInsidePath(mainPath, versionRoot) || !existsSync(mainPath)) {
        return '插件 main 入口不存在或越界'
      }
    }
    return null
  }

  private async readManifest(root: string): Promise<TwilightPluginManifest> {
    const raw = await readFile(join(root, 'plugin.json'), 'utf-8')
    return validatePluginManifest(JSON.parse(raw))
  }

  private async findDescriptor(id: string): Promise<TwilightPluginDescriptor> {
    const descriptors = await this.list()
    const descriptor = descriptors.find((candidate) => candidate.id === id)
    if (!descriptor) throw new Error('插件未安装')
    return descriptor
  }

  private async extractTep(source: string, tempRoot: string): Promise<string> {
    await extract(source, { dir: tempRoot })
    if (existsSync(join(tempRoot, 'plugin.json'))) return tempRoot
    const entries = await safeReadDir(tempRoot)
    if (entries.length === 1 && existsSync(join(tempRoot, entries[0], 'plugin.json'))) {
      return join(tempRoot, entries[0])
    }
    throw new Error('.tep 包根目录必须包含 plugin.json')
  }

  private async confirmTrustBasedInstall(
    manifest: TwilightPluginManifest,
    source: string
  ): Promise<void> {
    const result = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['安装', '取消'],
      cancelId: 1,
      defaultId: 1,
      title: '安装 Twilight Echo 插件',
      message: `安装 ${manifest.name}？`,
      detail: [
        `来源：${source}`,
        `作者：${manifest.author}`,
        `权限：${manifest.permissions.join(', ') || '无'}`,
        '',
        '当前为信任式安装：插件拥有与应用相同的权限。请仅安装可信来源。'
      ].join('\n')
    })
    if (result.response !== 0) {
      throw new Error('已取消插件安装')
    }
  }

  private setEnabled(id: string, enabled: boolean): void {
    const now = new Date().toISOString()
    this.state[id] = {
      enabled,
      installedAt: this.state[id]?.installedAt ?? now,
      updatedAt: now,
      source: this.state[id]?.source ?? 'directory'
    }
    void this.saveState()
    this.emit('changed')
  }

  private markFailed(id: string, message: string): void {
    const now = new Date().toISOString()
    this.state[id] = {
      enabled: false,
      installedAt: this.state[id]?.installedAt ?? now,
      updatedAt: now,
      source: this.state[id]?.source ?? 'directory',
      lastError: message
    }
    void this.saveState()
    this.emit('changed')
  }

  private appendLog(descriptor: TwilightPluginDescriptor, level: string, message: string): void {
    ensureParent(descriptor.paths.logPath)
    const line = `[${new Date().toISOString()}] [${level}] ${message.trim()}\n`
    void writeFile(descriptor.paths.logPath, line, { flag: 'a', encoding: 'utf-8' })
  }

  private pathsFor(id: string, version: string) {
    const versionRoot = this.versionRoot(id, version)
    return {
      root: join(this.roots.plugins, id),
      versionRoot,
      manifestPath: join(versionRoot, 'plugin.json'),
      dataDir: join(this.roots.data, id),
      logPath: join(this.roots.logs, `${id}.log`)
    }
  }

  private versionRoot(id: string, version: string): string {
    return join(this.roots.plugins, id, version)
  }

  private ensureRoots(): void {
    mkdirSync(this.roots.plugins, { recursive: true })
    mkdirSync(this.roots.data, { recursive: true })
    mkdirSync(this.roots.logs, { recursive: true })
  }

  private async loadState(): Promise<void> {
    try {
      this.state = JSON.parse(readFileSync(this.roots.stateFile, 'utf-8')) as PluginStateFile
    } catch {
      this.state = {}
    }
  }

  private async saveState(): Promise<void> {
    ensureParent(this.roots.stateFile)
    await writeFile(this.roots.stateFile, JSON.stringify(this.state, null, 2), 'utf-8')
  }

  private toManifest(descriptor: TwilightPluginDescriptor): TwilightPluginManifest {
    return {
      id: descriptor.id,
      name: descriptor.name,
      version: descriptor.version,
      description: descriptor.description,
      author: descriptor.author,
      license: descriptor.license,
      type: descriptor.type,
      main: descriptor.main,
      binary: descriptor.binary,
      engines: descriptor.engines,
      apiVersion: descriptor.apiVersion,
      permissions: descriptor.permissions,
      contributes: descriptor.contributes,
      homepage: descriptor.homepage,
      repository: descriptor.repository,
      icon: descriptor.icon,
      signature: descriptor.signature
    }
  }
}

async function safeReadDir(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

function ensureParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
}

function isInsidePath(child: string, parent: string): boolean {
  const resolvedChild = resolve(child)
  const resolvedParent = resolve(parent)
  const pathBetween = relative(resolvedParent, resolvedChild)
  return pathBetween === '' || (pathBetween !== '..' && !pathBetween.startsWith(`..${sepForPlatform()}`) && !isAbsoluteLike(pathBetween))
}

function isAbsoluteLike(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/')
}

function sepForPlatform(): string {
  return process.platform === 'win32' ? '\\' : '/'
}
