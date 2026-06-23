import { app, dialog, shell, utilityProcess, type UtilityProcess } from 'electron'
import extract from 'extract-zip'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { cp, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'path'
import { tmpdir } from 'os'
import { EventEmitter } from 'events'
import { planPluginStartup } from './dependencies'
import { isCompatibleTwilightRange, validatePluginManifest } from './manifest'
import { dedupeProviderRegistrations, findProviderRoute } from './providerRouting'
import { isRecoverableBundledPluginFailure } from './stateRecovery'
import type {
  PluginHostApiResult,
  PluginHostRequest,
  PluginHostResponse,
  TwilightMediaProviderMethod,
  TwilightMediaProviderRegistration,
  TwilightPluginExtensionContribution,
  TwilightProviderStreamingSection,
  TwilightProviderUiMetadata,
  TwilightThemeContribution,
  TwilightUiContribution,
  TwilightPluginDescriptor,
  TwilightPluginInstallResult,
  TwilightPluginManifest,
  TwilightPluginSource,
  TwilightPluginStateRecord,
  TwilightPluginUninstallOptions
} from './types'

type PluginStateFile = Record<string, TwilightPluginStateRecord>

export interface TwilightPluginManagerOptions {
  appVersion: string
  hostEntry: string
  bundledPlugins?: Array<{
    id: string
    sourcePath: string
    defaultEnabled?: boolean
  }>
  ncm?: {
    request: (path: string, cookie?: string) => Promise<unknown>
    officialLogin: () => Promise<string>
    getCachedSong: (songId: number) => Promise<string | null>
    cacheSong: (songId: number, url: string, fileName?: string) => Promise<string | null>
  }
  getPlaybackInfo: () => Promise<unknown> | unknown
  applyNativeDspPluginChain: (chainJson: string) => Promise<void> | void
  player: {
    play: () => Promise<void> | void
    pause: () => Promise<void> | void
    togglePause: () => Promise<void> | void
    stop: () => Promise<void> | void
    next: () => Promise<void> | void
    previous: () => Promise<void> | void
  }
,
  getProxyEnv?: () => Record<string, string>
}

interface RunningPlugin {
  process: UtilityProcess
  descriptor: TwilightPluginDescriptor
  subscriptions: Set<string>
  providers: TwilightMediaProviderRegistration[]
  ui: TwilightUiContribution[]
  themes: TwilightThemeContribution[]
}

interface InstallFromPathOptions {
  source?: TwilightPluginSource
  sourceLabel?: string
}

const STATE_FILE = 'plugin-state.json'
const PLUGIN_ACTIVATE_TIMEOUT_MS = 5000
const PLUGIN_DEACTIVATE_TIMEOUT_MS = 1500
const PLUGIN_UI_COMMAND_TIMEOUT_MS = 5000
const PLUGIN_PROVIDER_DEFAULT_TIMEOUT_MS = 15000
const PLUGIN_PROVIDER_MEDIUM_TIMEOUT_MS = 30000
const PLUGIN_PROVIDER_SLOW_TIMEOUT_MS = 120000
const INTERNAL_NCM_PLUGIN_ID = 'com.twilightecho.provider.ncm'

function getProviderCallTimeoutMs(method: TwilightMediaProviderMethod): number {
  if (
    [
      'fetchPlaylistTracks',
      'fetchLikedTracks',
      'fetchUserLibrary',
      'fetchRecommendSongs',
      'fetchRecommendPlaylists',
      'fetchPersonalFm',
      'fetchPrivateContent',
      'fetchArtistTopSongs',
      'fetchArtistPlaylists',
      'fetchUserPlaylistsByUid',
      'fetchUserFollows',
      'fetchUserFolloweds',
      'fetchPlayRecords',
      'fetchRecentSongs'
    ].includes(method)
  ) {
    return PLUGIN_PROVIDER_SLOW_TIMEOUT_MS
  }
  if (['getPlaybackUrl', 'getLyrics', 'searchSongs', 'searchPlaylists', 'searchArtists'].includes(method)) {
    return PLUGIN_PROVIDER_MEDIUM_TIMEOUT_MS
  }
  return PLUGIN_PROVIDER_DEFAULT_TIMEOUT_MS
}

export class TwilightPluginManager extends EventEmitter {
  private readonly appVersion: string
  private readonly hostEntry: string
  private readonly bundledPlugins: NonNullable<TwilightPluginManagerOptions['bundledPlugins']>
  private readonly ncm: TwilightPluginManagerOptions['ncm']
  private readonly getPlaybackInfo: TwilightPluginManagerOptions['getPlaybackInfo']
  private readonly applyNativeDspPluginChain: TwilightPluginManagerOptions['applyNativeDspPluginChain']
  private readonly player: TwilightPluginManagerOptions['player']
  private readonly getProxyEnv: TwilightPluginManagerOptions['getProxyEnv']
  private readonly running = new Map<string, RunningPlugin>()
  private readonly stopping = new Set<string>()
  private shuttingDown = false
  private readonly providerCalls = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: NodeJS.Timeout
    }
  >()
  private readonly uiCommandCalls = new Map<
    string,
    {
      pluginId: string
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
    this.bundledPlugins = options.bundledPlugins ?? []
    this.ncm = options.ncm
    this.getPlaybackInfo = options.getPlaybackInfo
    this.applyNativeDspPluginChain = options.applyNativeDspPluginChain
    this.player = options.player
    this.getProxyEnv = options.getProxyEnv
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
    await this.syncBundledPlugins()
    await this.scanAndStartEnabled()
    await this.syncNativeDspChain()
  }

  async list(): Promise<TwilightPluginDescriptor[]> {
    this.ensureRoots()
    const descriptorsById = new Map<string, TwilightPluginDescriptor>()
    const rootEntries = await safeReadDir(this.roots.plugins)
    for (const pluginDir of rootEntries) {
      const idRoot = join(this.roots.plugins, pluginDir)
      const versionEntries = await safeReadDir(idRoot)
      for (const version of versionEntries) {
        const descriptor = await this.readDescriptor(join(idRoot, version), 'scan')
        const current = descriptorsById.get(descriptor.id)
        if (!current || compareSemver(descriptor.version, current.version) > 0) {
          descriptorsById.set(descriptor.id, descriptor)
        }
      }
    }
    return [...descriptorsById.values()].sort((left, right) => left.name.localeCompare(right.name))
  }

  async installFromPath(
    sourcePath: string,
    options: InstallFromPathOptions = {}
  ): Promise<TwilightPluginInstallResult> {
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
      if (this.isBundledPluginId(manifest.id)) {
        throw new Error('自带插件随 Twilight Echo 分发，不能用本地包覆盖安装')
      }
      await this.confirmTrustBasedInstall(manifest, options.sourceLabel ?? source)
      const previousState = this.state[manifest.id]
      const wasEnabled = previousState?.enabled === true
      await this.stopPlugin(manifest.id).catch(() => undefined)
      const target = this.versionRoot(manifest.id, manifest.version)
      await rm(target, { recursive: true, force: true })
      mkdirSync(dirname(target), { recursive: true })
      await cp(installSource, target, {
        recursive: true,
        filter: (path) => !isInsidePath(path, this.roots.plugins)
      })
      await this.removeOtherPluginVersions(manifest.id, manifest.version)
      const now = new Date().toISOString()
      this.state[manifest.id] = {
        enabled: wasEnabled,
        installedAt: previousState?.installedAt ?? now,
        updatedAt: now,
        source: options.source ?? (isTep ? 'tep' : 'directory')
      }
      await this.saveState()
      const plugin = await this.readDescriptor(target, this.state[manifest.id].source)
      if (wasEnabled) {
        try {
          if (plugin.main) {
            await this.startPlugin(plugin)
          } else {
            this.markStarted(plugin)
          }
          await this.syncNativeDspChain()
        } catch (error) {
          this.markFailed(manifest.id, error instanceof Error ? error.message : String(error), plugin)
          throw error
        }
      }
      this.emit('changed')
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
    try {
      this.setEnabled(id, true)
      const descriptors = await this.list()
      const startupPlan = planPluginStartup(descriptors)
      const dependencyError = startupPlan.failures.get(id)
      if (dependencyError) throw new Error(dependencyError)
      const refreshed = await this.findDescriptor(id)
      if (refreshed.main) {
        await this.startPlugin(refreshed)
      } else {
        this.markStarted(refreshed)
      }
      await this.syncNativeDspChain()
    } catch (error) {
      this.markFailed(id, error instanceof Error ? error.message : String(error), descriptor)
      throw error
    }
    return this.findDescriptor(id)
  }

  async disable(id: string): Promise<TwilightPluginDescriptor> {
    this.setEnabled(id, false)
    await this.stopPlugin(id)
    await this.syncNativeDspChain()
    return this.findDescriptor(id)
  }

  async uninstall(id: string, options: TwilightPluginUninstallOptions = {}): Promise<void> {
    if (this.isBundledPluginId(id)) {
      throw new Error('自带插件不能卸载；如需关闭，请在插件页停用')
    }
    await this.disable(id).catch(() => undefined)
    await rm(join(this.roots.plugins, id), { recursive: true, force: true })
    if (options.removeData) {
      await rm(join(this.roots.data, id), { recursive: true, force: true })
    }
    delete this.state[id]
    await this.saveState()
    await this.syncNativeDspChain()
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

  async handleNativeDspHostCrash(reason: string): Promise<void> {
    const descriptors = await this.list()
    for (const descriptor of descriptors) {
      if (!descriptor.enabled || !descriptor.type.includes('dsp')) continue
      const message = `原生 DSP 音频服务崩溃，已旁路：${reason}`
      this.markFailed(descriptor.id, message, descriptor)
      this.appendLog(descriptor, 'error', message)
    }
    await this.applyNativeDspPluginChain(JSON.stringify({ plugins: [] }))
    await this.saveState()
    this.emit('changed')
  }

  async setNativeDspPluginParameters(id: string, parameters: Record<string, number>): Promise<TwilightPluginDescriptor> {
    const descriptor = await this.findDescriptor(id)
    if (!descriptor.type.includes('dsp')) throw new Error('只有 DSP 插件支持原生参数')
    const normalized: Record<string, number> = {}
    for (const [key, value] of Object.entries(parameters)) {
      const name = key.trim()
      if (!name) continue
      if (!Number.isFinite(value)) throw new Error(`DSP 参数不是有限数字：${name}`)
      normalized[name] = value
    }
    const state = this.state[id]
    if (!state) throw new Error('插件状态不存在')
    state.nativeDspParameters = normalized
    state.updatedAt = new Date().toISOString()
    await this.saveState()
    await this.syncNativeDspChain()
    this.emit('changed')
    return this.findDescriptor(id)
  }

  async broadcastEvent(name: string, payload: unknown): Promise<void> {
    for (const running of this.running.values()) {
      if (running.subscriptions.has(name)) {
        running.process.postMessage({ kind: 'event', name, payload } satisfies PluginHostRequest)
      }
    }
  }

  listProviders(): TwilightMediaProviderRegistration[] {
    return dedupeProviderRegistrations(this.running.values())
  }

  listExtensions(): TwilightPluginExtensionContribution[] {
    return [...this.running.values()]
      .filter((running) => running.ui.length > 0 || running.themes.length > 0)
      .map((running) => ({
        pluginId: running.descriptor.id,
        ui: running.ui,
        themes: running.themes
      }))
  }

  async executeUiCommand(command: string, args: unknown[] = []): Promise<unknown> {
    const normalized = command.trim()
    if (!normalized) throw new Error('UI command 不能为空')
    const running = [...this.running.values()].find((candidate) =>
      candidate.ui.some((contribution) => contribution.command === normalized)
    )
    if (!running) throw new Error(`UI command 未注册：${normalized}`)
    const requestId = randomUUID()
    running.process.postMessage({
      kind: 'ui-command',
      requestId,
      command: normalized,
      args
    } satisfies PluginHostRequest)
    return new Promise((resolveCommand, rejectCommand) => {
      const timer = setTimeout(() => {
        this.uiCommandCalls.delete(requestId)
        const latestRunning = this.running.get(running.descriptor.id)
        this.markFailed(
          running.descriptor.id,
          `UI command 调用超时：${normalized}`,
          latestRunning?.descriptor ?? running.descriptor
        )
        void this.stopPlugin(running.descriptor.id)
        rejectCommand(new Error(`UI command 调用超时：${normalized}`))
      }, PLUGIN_UI_COMMAND_TIMEOUT_MS)
      this.uiCommandCalls.set(requestId, {
        pluginId: running.descriptor.id,
        resolve: resolveCommand,
        reject: rejectCommand,
        timer
      })
    })
  }

  async callProvider(
    providerId: string,
    method: TwilightMediaProviderMethod,
    args: unknown[]
  ): Promise<unknown> {
    const normalizedProviderId = providerId.trim().toLowerCase()
    const running = findProviderRoute(this.running.values(), normalizedProviderId, method)
    const hasProvider = [...this.running.values()].some((candidate) =>
      candidate.providers.some((provider) => provider.id === normalizedProviderId)
    )
    if (!running) {
      throw new Error(
        hasProvider
          ? `Provider ${normalizedProviderId} does not implement ${method}`
          : `Provider 未启用：${normalizedProviderId}`
      )
    }

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
      }, getProviderCallTimeoutMs(method))
      this.providerCalls.set(requestId, {
        resolve: resolveCall,
        reject: rejectCall,
        timer
      })
    })
  }

  async destroy(): Promise<void> {
    this.shuttingDown = true
    await Promise.all([...this.running.keys()].map((id) => this.stopPlugin(id)))
  }

  private async scanAndStartEnabled(): Promise<void> {
    const descriptors = await this.list()
    const startupPlan = planPluginStartup(descriptors)
    for (const [id, error] of startupPlan.failures) {
      const descriptor = descriptors.find((candidate) => candidate.id === id)
      this.markFailed(id, error, descriptor)
    }
    for (const descriptor of startupPlan.ordered) {
      if (descriptor.main) {
        await this.startPlugin(descriptor).catch((error) => {
          this.markFailed(descriptor.id, error instanceof Error ? error.message : String(error), descriptor)
        })
      }
    }
  }

  private async syncBundledPlugins(): Promise<void> {
    for (const bundled of this.bundledPlugins) {
      try {
        if (!existsSync(bundled.sourcePath)) continue
        const manifest = await this.readManifest(bundled.sourcePath)
        if (manifest.id !== bundled.id) {
          throw new Error(`自带插件 ID 不匹配：${manifest.id} !== ${bundled.id}`)
        }

        const targetRoot = join(this.roots.plugins, manifest.id)
        const target = this.versionRoot(manifest.id, manifest.version)
        await rm(targetRoot, { recursive: true, force: true })
        mkdirSync(dirname(target), { recursive: true })
        await cp(bundled.sourcePath, target, { recursive: true })

        const now = new Date().toISOString()
        const previous = this.state[manifest.id]
        const shouldRecoverBundledFailure =
          previous?.enabled === false &&
          previous?.source === 'bundled' &&
          isRecoverableBundledPluginFailure(previous.lastError)
        this.state[manifest.id] = {
          enabled: shouldRecoverBundledFailure
            ? bundled.defaultEnabled === true
            : previous?.enabled ?? bundled.defaultEnabled === true,
          installedAt: previous?.installedAt ?? now,
          updatedAt: previous?.updatedAt ?? now,
          source: 'bundled',
          lastError: shouldRecoverBundledFailure ? undefined : previous?.lastError
        }
      } catch (error) {
        console.error(
          `[插件系统] 同步自带插件失败：${bundled.id}`,
          error instanceof Error ? error.message : error
        )
      }
    }
    await this.saveState()
  }

  private async syncNativeDspChain(): Promise<void> {
    const descriptors = await this.list()
    const enabled = descriptors
      .filter((descriptor) => descriptor.enabled && descriptor.status !== 'invalid' && descriptor.type.includes('dsp'))
      .filter((descriptor) => this.resolveNativeDspBinary(descriptor) !== null)
      .sort((left, right) => left.id.localeCompare(right.id))
    const chain = {
      plugins: enabled.map((descriptor) => ({
        id: descriptor.id,
        path: this.resolveNativeDspBinary(descriptor),
        enabled: true,
        parameters: this.state[descriptor.id]?.nativeDspParameters ?? {}
      }))
    }
    await this.applyNativeDspPluginChain(JSON.stringify(chain))
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
    const proxyEnv = this.getProxyEnv?.() ?? {}
    const env = Object.keys(proxyEnv).length > 0 ? { ...process.env, ...proxyEnv } : undefined
    const child = utilityProcess.fork(this.hostEntry, [], {
      serviceName: `twilight-plugin-${descriptor.id}`,
      stdio: 'pipe',
      env
    })
    const running: RunningPlugin = {
      process: child,
      descriptor,
      subscriptions: new Set(),
      providers: [],
      ui: [],
      themes: []
    }
    this.running.set(descriptor.id, running)
    child.on('message', (message: PluginHostResponse) => {
      void this.handleHostMessage(descriptor.id, message)
    })
    child.on('exit', (code) => {
      const wasStopping = this.stopping.delete(descriptor.id)
      this.running.delete(descriptor.id)
      if (this.state[descriptor.id]?.enabled && !wasStopping && !this.shuttingDown) {
        this.markFailed(descriptor.id, `插件宿主进程退出：${code}`)
      }
    })
    child.on('error', (_type, location) => {
      this.markFailed(descriptor.id, `插件宿主进程错误：${location}`)
    })
    child.stdout?.on('data', (chunk) => this.appendLog(descriptor, 'info', chunk.toString()))
    child.stderr?.on('data', (chunk) => this.appendLog(descriptor, 'error', chunk.toString()))
    const activation = this.waitForActivation(child, descriptor)
    child.postMessage({
      kind: 'activate',
      pluginId: descriptor.id,
      manifest: this.toManifest(descriptor),
      mainPath,
      dataDir: descriptor.paths.dataDir,
      apiVersion: descriptor.apiVersion
    } satisfies PluginHostRequest)
    try {
      await activation
      this.markStarted(descriptor)
      this.appendLog(descriptor, 'info', '插件已激活')
    } catch (error) {
      await this.stopPlugin(descriptor.id).catch(() => undefined)
      throw error
    }
  }

  private async stopPlugin(id: string): Promise<void> {
    const running = this.running.get(id)
    if (!running) return
    this.stopping.add(id)
    const requestId = randomUUID()
    running.process.postMessage({ kind: 'deactivate', requestId } satisfies PluginHostRequest)
    await new Promise<void>((resolveDone) => {
      const timer = setTimeout(resolveDone, PLUGIN_DEACTIVATE_TIMEOUT_MS)
      const onMessage = (message: PluginHostResponse): void => {
        if (message.kind === 'deactivated' && message.requestId === requestId) {
          clearTimeout(timer)
          running.process.off('message', onMessage)
          resolveDone()
        }
      }
      running.process.on('message', onMessage)
    })
    await new Promise<void>((resolveDone) => {
      const timer = setTimeout(resolveDone, PLUGIN_DEACTIVATE_TIMEOUT_MS)
      running.process.once('exit', () => {
        clearTimeout(timer)
        resolveDone()
      })
      running.process.kill()
    })
    this.running.delete(id)
  }

  private waitForActivation(child: UtilityProcess, descriptor: TwilightPluginDescriptor): Promise<void> {
    return new Promise((resolveReady, rejectReady) => {
      let settled = false
      const cleanup = (): void => {
        clearTimeout(timer)
        child.off('message', onMessage)
        child.off('exit', onExit)
        child.off('error', onError)
      }
      const settle = (error?: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        if (error) rejectReady(error)
        else resolveReady()
      }
      const timer = setTimeout(() => {
        this.appendLog(descriptor, 'error', `插件启动超时：${PLUGIN_ACTIVATE_TIMEOUT_MS}ms`)
        settle(new Error(`插件启动超时：${PLUGIN_ACTIVATE_TIMEOUT_MS}ms`))
      }, PLUGIN_ACTIVATE_TIMEOUT_MS)
      const onMessage = (message: PluginHostResponse): void => {
        if (message.kind === 'activated' && message.pluginId === descriptor.id) {
          settle()
        } else if (message.kind === 'host-error') {
          settle(new Error(message.message))
        }
      }
      const onExit = (code: number | null): void => {
        settle(new Error(`插件宿主进程退出：${code}`))
      }
      const onError = (_type: unknown, location: unknown): void => {
        settle(new Error(`插件宿主进程错误：${String(location)}`))
      }
      child.on('message', onMessage)
      child.on('exit', onExit)
      child.on('error', onError)
    })
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
    if (message.kind === 'ui-command-result') {
      this.handleUiCommandResult(id, message)
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
      if (message.namespace === 'extensions') {
        return {
          kind: 'api-result',
          requestId: message.requestId,
          ok: true,
          value: this.registerExtensionFromPlugin(id, message)
        }
      }
      if (message.namespace === 'internal') {
        return {
          kind: 'api-result',
          requestId: message.requestId,
          ok: true,
          value: await this.handleInternalApiCall(id, message)
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
    const ui = this.normalizeProviderUi(record.ui, capabilities)
    const provider: TwilightMediaProviderRegistration = { id: providerId, name, capabilities, ui }
    running.providers.push(provider)
    this.emit('changed')
    return provider
  }

  /**
   * 解析插件声明的 UI 元数据。如果插件未声明 ui，则根据 capabilities 生成默认值。
   * 只要插件声明了 login 能力，就必须有 icon 和 qrStatusCodes（否则登录页无法渲染）。
   */
  private normalizeProviderUi(
    raw: unknown,
    _capabilities: TwilightMediaProviderRegistration['capabilities']
  ): TwilightMediaProviderRegistration['ui'] {
    if (!raw || typeof raw !== 'object') return undefined
    const record = raw as Record<string, unknown>
    const icon = typeof record.icon === 'string' ? record.icon.trim() : ''
    const authType =
      record.authType === 'qr' || record.authType === 'oauth' || record.authType === 'cookie'
        ? record.authType
        : 'qr'
    // 解析 qrStatusCodes
    let qrStatusCodes: TwilightProviderUiMetadata['qrStatusCodes'] | undefined
    if (record.qrStatusCodes && typeof record.qrStatusCodes === 'object') {
      const codes = record.qrStatusCodes as Record<string, unknown>
      qrStatusCodes = {
        waiting: typeof codes.waiting === 'number' ? codes.waiting : -1,
        scanned: typeof codes.scanned === 'number' ? codes.scanned : null,
        expired: typeof codes.expired === 'number' ? codes.expired : -1,
        denied: typeof codes.denied === 'number' ? codes.denied : undefined,
        success: typeof codes.success === 'number' ? codes.success : 0
      }
    }
    // 解析 streamingSections
    let streamingSections: TwilightProviderStreamingSection[] | undefined
    if (Array.isArray(record.streamingSections)) {
      streamingSections = record.streamingSections
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((item) => ({
          id: typeof item.id === 'string' ? item.id : '',
          title: typeof item.title === 'string' ? item.title : '',
          icon: typeof item.icon === 'string' ? item.icon : 'pi pi-music',
          method: typeof item.method === 'string' ? item.method : '',
          args: Array.isArray(item.args) ? item.args : undefined
        }))
        .filter((section) => section.id && section.title && section.method)
    }
    return {
      icon,
      color: typeof record.color === 'string' ? record.color : undefined,
      description: typeof record.description === 'string' ? record.description : undefined,
      authType,
      loginInstructions: typeof record.loginInstructions === 'string' ? record.loginInstructions : undefined,
      qrStatusCodes,
      showBrowserButton: typeof record.showBrowserButton === 'boolean' ? record.showBrowserButton : undefined,
      loginExtraActions: Array.isArray(record.loginExtraActions)
        ? record.loginExtraActions
            .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
            .map((item) => ({
              label: typeof item.label === 'string' ? item.label : '',
              icon: typeof item.icon === 'string' ? item.icon : 'pi pi-external-link',
              method: typeof item.method === 'string' ? item.method : ''
            }))
            .filter((action) => action.label && action.method)
        : undefined,
      streamingSections,
      streamingLibraryTab: typeof record.streamingLibraryTab === 'boolean' ? record.streamingLibraryTab : undefined,
      streamingSearch: typeof record.streamingSearch === 'boolean' ? record.streamingSearch : undefined
    }
  }

  private async handleInternalApiCall(
    pluginId: string,
    message: Extract<PluginHostResponse, { kind: 'api-call' }>
  ): Promise<unknown> {
    if (pluginId !== INTERNAL_NCM_PLUGIN_ID) {
      throw new Error('内部 API 仅允许自带网易云插件访问')
    }
    if (!this.ncm) throw new Error('网易云内部服务不可用')
    if (message.method === 'ncmRequest') {
      const [path, cookie] = message.args
      if (typeof path !== 'string') throw new Error('ncmRequest path 必须是字符串')
      return this.ncm.request(path, typeof cookie === 'string' ? cookie : undefined)
    }
    if (message.method === 'ncmOfficialLogin') {
      return this.ncm.officialLogin()
    }
    if (message.method === 'ncmGetCachedSong') {
      const songId = Number(message.args[0])
      if (!Number.isFinite(songId)) throw new Error('ncmGetCachedSong songId 无效')
      return this.ncm.getCachedSong(songId)
    }
    if (message.method === 'ncmCacheSong') {
      const songId = Number(message.args[0])
      const url = message.args[1]
      const fileName = message.args[2]
      if (!Number.isFinite(songId)) throw new Error('ncmCacheSong songId 无效')
      if (typeof url !== 'string') throw new Error('ncmCacheSong url 必须是字符串')
      return this.ncm.cacheSong(songId, url, typeof fileName === 'string' ? fileName : undefined)
    }
    throw new Error('未知内部 API')
  }

  private registerExtensionFromPlugin(
    pluginId: string,
    message: Extract<PluginHostResponse, { kind: 'api-call' }>
  ): TwilightUiContribution | TwilightThemeContribution {
    const running = this.running.get(pluginId)
    if (!running) throw new Error('插件未运行')
    if (message.method === 'registerUi') {
      const contribution = this.normalizeUiContribution(running, message.args[0])
      running.ui.push(contribution)
      this.emit('changed')
      return contribution
    }
    if (message.method === 'registerTheme') {
      const contribution = this.normalizeThemeContribution(running, message.args[0])
      running.themes.push(contribution)
      this.emit('changed')
      return contribution
    }
    throw new Error('未知扩展 API')
  }

  private normalizeUiContribution(running: RunningPlugin, raw: unknown): TwilightUiContribution {
    if (!running.descriptor.type.includes('ui') && !running.descriptor.type.includes('tool')) {
      throw new Error('只有 ui 或 tool 类型插件可以注册 UI 扩展点')
    }
    if (!running.descriptor.permissions.includes('ui:inject')) {
      throw new Error('UI 扩展插件必须声明 ui:inject 权限')
    }
    if (!raw || typeof raw !== 'object') throw new Error('UI 扩展注册信息必须是对象')
    const record = raw as Record<string, unknown>
    const id = normalizeContributionId(record.id)
    const kind = typeof record.kind === 'string' ? record.kind : ''
    if (!['sidebarPage', 'playerBarButton', 'settingsPanel', 'localSidebarItem', 'streamingHome'].includes(kind)) {
      throw new Error('未知 UI 扩展点')
    }
    const title = normalizeText(record.title, 'UI 扩展标题必填')
    const command = typeof record.command === 'string' ? record.command.trim() : undefined
    if ((kind === 'playerBarButton' || kind === 'sidebarPage' || kind === 'localSidebarItem') && !command) {
      throw new Error(`${kind} 扩展必须声明 command`)
    }
    const renderMode = record.renderMode === 'html' ? 'html' : 'command'
    const autoLoad = typeof record.autoLoad === 'boolean' ? record.autoLoad : renderMode === 'html'
    return {
      id,
      kind: kind as TwilightUiContribution['kind'],
      title,
      description: typeof record.description === 'string' ? record.description.trim() : undefined,
      icon: typeof record.icon === 'string' ? record.icon.trim() : undefined,
      command,
      renderMode,
      autoLoad
    }
  }

  private normalizeThemeContribution(
    running: RunningPlugin,
    raw: unknown
  ): TwilightThemeContribution {
    if (!running.descriptor.type.includes('theme')) {
      throw new Error('只有 theme 类型插件可以注册主题')
    }
    if (!raw || typeof raw !== 'object') throw new Error('主题注册信息必须是对象')
    const record = raw as Record<string, unknown>
    const id = normalizeContributionId(record.id)
    const name = normalizeText(record.name, '主题名称必填')
    const variables =
      record.variables && typeof record.variables === 'object'
        ? normalizeCssVariables(record.variables as Record<string, unknown>)
        : undefined
    const stylesheet =
      typeof record.stylesheet === 'string' && record.stylesheet.trim()
        ? this.resolveThemeStylesheet(running.descriptor, record.stylesheet.trim())
        : undefined
    if (!variables && !stylesheet) throw new Error('主题必须声明 variables 或 stylesheet')
    return {
      id,
      name,
      description: typeof record.description === 'string' ? record.description.trim() : undefined,
      variables,
      stylesheet
    }
  }

  private resolveThemeStylesheet(descriptor: TwilightPluginDescriptor, stylesheet: string): string {
    const stylesheetPath = resolve(descriptor.paths.versionRoot, stylesheet)
    if (!isInsidePath(stylesheetPath, descriptor.paths.versionRoot) || !existsSync(stylesheetPath)) {
      throw new Error('主题 stylesheet 不存在或越界')
    }
    return stylesheetPath
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

  private handleUiCommandResult(
    pluginId: string,
    message: Extract<PluginHostResponse, { kind: 'ui-command-result' }>
  ): void {
    const pending = this.uiCommandCalls.get(message.requestId)
    if (!pending || pending.pluginId !== pluginId) return
    this.uiCommandCalls.delete(message.requestId)
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
      const descriptorSource = state?.source ?? source
      return {
        ...manifest,
        status: error ? 'invalid' : state?.lastError ? 'failed' : state?.enabled ? 'enabled' : 'disabled',
        enabled: state?.enabled === true && !error,
        builtIn: this.isBundledPluginId(manifest.id) || descriptorSource === 'bundled',
        error: error ?? state?.lastError ?? null,
        isDsp: manifest.type.includes('dsp'),
        source: descriptorSource,
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
        builtIn: this.isBundledPluginId(id),
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
    if (manifest.type.includes('dsp')) {
      const binary = this.resolveNativeDspBinary({
        ...manifest,
        paths: this.pathsFor(manifest.id, manifest.version)
      } as TwilightPluginDescriptor)
      if (!binary) return 'DSP 插件缺少当前平台 binary'
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
      source: this.state[id]?.source ?? this.defaultStateSource(id)
    }
    void this.saveState()
    this.emit('changed')
  }

  private markFailed(id: string, message: string, descriptor?: TwilightPluginDescriptor): void {
    const now = new Date().toISOString()
    this.state[id] = {
      enabled: false,
      installedAt: this.state[id]?.installedAt ?? now,
      updatedAt: now,
      source: this.state[id]?.source ?? this.defaultStateSource(id),
      lastError: message
    }
    if (descriptor) this.appendLog(descriptor, 'error', message)
    void this.saveState()
    this.emit('changed')
  }

  private markStarted(descriptor: TwilightPluginDescriptor): void {
    const now = new Date().toISOString()
    this.state[descriptor.id] = {
      enabled: true,
      installedAt: this.state[descriptor.id]?.installedAt ?? descriptor.installedAt ?? now,
      updatedAt: this.state[descriptor.id]?.updatedAt ?? descriptor.updatedAt ?? now,
      source: this.state[descriptor.id]?.source ?? this.defaultStateSource(descriptor.id)
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

  private async removeOtherPluginVersions(id: string, keepVersion: string): Promise<void> {
    const pluginRoot = join(this.roots.plugins, id)
    const versions = await safeReadDir(pluginRoot)
    await Promise.all(
      versions
        .filter((version) => version !== keepVersion)
        .map((version) => rm(join(pluginRoot, version), { recursive: true, force: true }))
    )
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
      dependencies: descriptor.dependencies,
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

  private resolveNativeDspBinary(descriptor: TwilightPluginDescriptor | TwilightPluginManifest): string | null {
    const binary = descriptor.binary
    if (!binary) return null
    const key = `${process.platform}-${process.arch}`
    const relPath = binary[key] ?? binary[process.platform]
    if (!relPath) return null
    const resolved = resolve(
      'paths' in descriptor ? descriptor.paths.versionRoot : this.versionRoot(descriptor.id, descriptor.version),
      relPath
    )
    const root = 'paths' in descriptor ? descriptor.paths.versionRoot : this.versionRoot(descriptor.id, descriptor.version)
    return isInsidePath(resolved, root) && existsSync(resolved) ? resolved : null
  }

  private isBundledPluginId(id: string): boolean {
    return this.bundledPlugins.some((plugin) => plugin.id === id)
  }

  private defaultStateSource(id: string): TwilightPluginSource {
    return this.isBundledPluginId(id) ? 'bundled' : 'directory'
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

function compareSemver(left: string, right: string): number {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10) || 0)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1
    if (leftParts[index] < rightParts[index]) return -1
  }
  return 0
}

function normalizeContributionId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id || !/^[a-z][a-z0-9-_.]*$/.test(id)) {
    throw new Error('扩展 id 必须是小写标识符')
  }
  return id
}

function normalizeText(value: unknown, message: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new Error(message)
  return text.slice(0, 120)
}

function normalizeCssVariables(raw: Record<string, unknown>): Record<string, string> {
  const variables: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!/^--te-[a-z0-9-_]+$/.test(key)) continue
    if (typeof value !== 'string') continue
    const normalized = value.trim()
    if (!normalized || /url\s*\(|@import|expression\s*\(/i.test(normalized)) continue
    variables[key] = normalized.slice(0, 240)
  }
  return variables
}