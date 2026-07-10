export {}

interface TrackData {
  id: string
  title: string
  artist: string
  album: string
  filePath: string
  fileName: string
  dir?: string
  duration: number
  size: number
  cover: string | null
  lyrics: string | null
  translatedLyrics?: string | null
  metadataMatch?: TrackMetadataMatch | null
  source?: TrackSource
  ncmSongId?: number
  streamUrl?: string | null
  format?: string
  sampleRate?: number
  bitrate?: number
  bitDepth?: number
  bpm?: number
  bpmAnalysis?: BpmAnalysisResult
}

interface AudioEngineEvent {
  name: string
  data: unknown
}

type AudioOutputId = 'wasapi' | 'asio' | 'coreaudio' | 'alsa'
type PlayMode = 'sequential' | 'repeat' | 'shuffle'
type PlayerShortcutAction = 'previous' | 'next' | 'playPause'
interface PlayerShortcutStatus {
  accelerator: string
  action: PlayerShortcutAction
  label: string
  registered: boolean
  error: string | null
}
type AppTheme = 'system' | 'pureWhite' | 'dark'
type PlaybackResumeMode = 'off' | 'track' | 'trackAndPosition'
type StartupHomePage = 'local' | 'streaming'
type UiDensity = 'compact' | 'standard' | 'comfortable'
type NowPlayingBackground = 'blur' | 'fluid' | 'solid'
type LyricAlign = 'center' | 'left'
type LibraryChange = { kind: 'add' | 'remove' | 'unknown'; path?: string }
type ProxyMode = 'auto' | 'custom' | 'off'
type StreamingAudioCachePolicy = 'off' | 'provider'
type BuiltInTrackSource = 'local' | 'ncm'
type TrackSource = BuiltInTrackSource | (string & {})
type MetadataMatchConfidence = 'high' | 'medium'
interface TrackMetadataMatch {
  providerId: string
  trackId: string
  confidence: MetadataMatchConfidence
  score: number
}
interface BpmTempoSegment {
  startMs: number
  endMs: number
  bpm: number
  confidence: number
}
interface BpmAnalysisResult {
  bpm: number
  confidence: number
  source: 'analyzed'
  analyzedAt: string
  algorithmVersion: number
  variableTempo?: boolean
  bpmRange?: [number, number]
  tempoMap?: BpmTempoSegment[]
}
interface BpmAnalysisRequest {
  trackId: string
  filePath: string
  referenceBpm?: number
}
type BpmAnalysisRequestResult =
  | { status: 'completed'; analysis: BpmAnalysisResult }
  | { status: 'cached'; analysis: BpmAnalysisResult }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string }
interface BpmAnalysisCompletedEvent {
  trackId: string
  filePath: string
  analysis: BpmAnalysisResult
}
type TwilightPluginType = 'provider' | 'tool' | 'ui' | 'theme' | 'dsp'
type TwilightPluginStatus = 'installed' | 'enabled' | 'disabled' | 'invalid' | 'failed'
type TwilightPluginIndexInstallState =
  | 'not-installed'
  | 'installed'
  | 'update-available'
  | 'incompatible'
  | 'built-in-blocked'
type TwilightPluginIndexSourceKind = 'github' | 'custom' | 'bundled'
type TwilightPluginIndexLoadedFrom = 'remote' | 'cache' | 'bundled'
type TwilightMediaProviderCapability =
  | 'search'
  | 'playbackUrl'
  | 'lyrics'
  | 'cover'
  | 'playlist'
  | 'library'
  | 'login'
type TwilightMediaProviderMethod =
  | 'getPlaybackUrl'
  | 'getLyrics'
  | 'searchSongs'
  | 'searchPlaylists'
  | 'searchArtists'
  | 'fetchPlaylistTracks'
  | 'checkLogin'
  | 'getProfile'
  | 'logout'
  | 'openOfficialLogin'
  | 'sendCaptcha'
  | 'loginByPhonePassword'
  | 'loginByPhoneCaptcha'
  | 'loginByEmailPassword'
  | 'getQrLogin'
  | 'getQrKey'
  | 'getQrImage'
  | 'checkQrLogin'
  | 'fetchUserLibrary'
  | 'fetchLikedTracks'
  | 'fetchLikedTracksPage'
  | 'fetchRecommendSongs'
  | 'fetchRecommendPlaylists'
  | 'fetchPersonalFm'
  | 'fetchPrivateContent'
  | 'fetchArtistTopSongs'
  | 'fetchArtistAlbums'
  | 'fetchArtistIntro'
  | 'fetchArtistFollowState'
  | 'fetchAlbumTracks'
  | 'fetchArtistPlaylists'
  | 'fetchUserPlaylistsByUid'
  | 'fetchUserFollows'
  | 'fetchUserFolloweds'
  | 'fetchPlayRecords'
  | 'fetchRecentSongs'
  | 'followArtist'
  | 'followUser'
  | 'likeTrack'
  | 'isTrackLiked'
type EqMode = 'graphic' | 'parametric'
type VolumeNormalizationMode = 'off' | 'track' | 'album' | 'loudnorm'
type ChannelRoutingMode =
  | 'auto'
  | 'stereo'
  | 'stereo-to-5.1'
  | 'stereo-to-7.1'
  | 'mono-to-stereo'
  | 'mono-to-multichannel'
type DsdOutputMode = 'auto' | 'pcm' | 'dop' | 'native'
type SacdProgramMode = 'auto' | 'stereo' | 'multichannel'
type EqualizerFilterType =
  | 'peak'
  | 'lowShelf'
  | 'highShelf'
  | 'bandPass'
  | 'lowPass'
  | 'highPass'
  | 'allPass'

interface AudioEngineQueueItem {
  id: string
  source: string
  title?: string
  artist?: string
  album?: string
  duration?: number
  codec?: string
  sampleRate?: number
  bitrate?: number
  bitDepth?: number
}

interface EqualizerBand {
  frequency: number
  gain: number
  q: number
  filterType: EqualizerFilterType
}

interface AudioProcessingSettings {
  dspEnabled: boolean
  clipGuard: boolean
  fftEnabled: boolean
  fftResolution: number
  highResolution: boolean
  dsdToPcm: boolean
  dsdOutputMode: DsdOutputMode
  sacdProgramMode: SacdProgramMode
  eqEnabled: boolean
  eqMode: EqMode
  eqPreamp: number
  eqBands: EqualizerBand[]
  volumeNormalization: VolumeNormalizationMode
  replayGainPreamp: number
  replayGainFallback: number
  replayGainClip: boolean
  convolverEnabled: boolean
  convolverIrPath: string
  crossfeedEnabled: boolean
  crossfeedStrength: number
  crossfeedDelayMs: number
  crossfeedCutoffHz: number
  gapless: boolean
  crossfadeSeconds: number
}

interface HeadphoneCompensationSettings {
  enabled: boolean
  productId: string
  productName: string
  vendorName: string
  eqId: string
  author: string
  details: string
  link: string
  preampDb: number
  bands: EqualizerBand[]
}

interface VisualizationOptions {
  spectrumPoints?: number
  waveformPoints?: number
  spectrogramFrames?: number
  oscilloscopePoints?: number
  visualizerBarCount?: number
}

interface VisualizationData {
  spectrum: number[]
  visualizerBars?: number[]
  waveform: number[]
  oscilloscope: number[]
  peakDb: number
  rmsDb: number
  lufsMomentary: number | null
  spectrogram: number[][]
  sampleRate: number
  maxFrequency: number
  active: boolean
  tapStatus: VisualizationTapStatus
  reason: string
}

type VisualizationTapStatus =
  | 'active'
  | 'stopped'
  | 'disabled'
  | 'no-samples'
  | 'native-unavailable'
  | 'synthetic-fallback'

interface AudioEqPreset {
  id: string
  name: string
  eqMode: EqMode
  eqPreamp: number
  eqBands: EqualizerBand[]
}

interface WindowTransparencyEffectSettings {
  surfaceOpacity: number
  surfaceBlur: number
  cardOpacity: number
  cardBlur: number
}

interface DesktopLyricsSettings {
  enabled: boolean
  fontSize: number
  fontFamily: string
  fontWeight: number
  color: string
  highlightColor: string
  bgColor: string
  bgOpacity: number
  align: LyricAlign
  showTranslation: boolean
  lineSpacing: number
  shadow: boolean
  shadowBlur: number
  shadowColor: string
  windowWidth: number
  windowHeight: number
  windowX: number
  windowY: number
  alwaysOnTop: boolean
  clickThrough: boolean
  maxLines: number
}

interface MusicCachePolicySettings {
  cover: boolean
  lyrics: boolean
  metadata: boolean
  streamingAudio: StreamingAudioCachePolicy
}

type AppBackgroundPage = 'local' | 'settings' | 'streaming' | 'player'
type AppBackgroundKind = 'color' | 'image'

interface AppBackgroundColorPair {
  light: string
  dark: string
  kind: AppBackgroundKind
  image: string
}

interface AppBackgroundPageOverride extends AppBackgroundColorPair {
  inherit: boolean
}

interface AppBackgroundSettings {
  global: AppBackgroundColorPair
  pages: Record<AppBackgroundPage, AppBackgroundPageOverride>
}

type CardShadowStrength = 'none' | 'subtle' | 'medium' | 'strong'
type CardHoverEffect = 'none' | 'lift' | 'zoom' | 'glow'

interface CardAppearanceTheme {
  blurRadius: number
  blurSaturation: number
  backgroundColor: string
  backgroundOpacity: number
  borderColor: string
  borderOpacity: number
  borderWidth: number
  borderRadius: number
  shadowStrength: CardShadowStrength
  hoverEffect: CardHoverEffect
  glassHighlight: boolean
}

interface BackgroundEffectTheme {
  blur: number
  brightness: number
  dim: number
}

interface BackgroundEffectSettings {
  enabled: boolean
  light: BackgroundEffectTheme
  dark: BackgroundEffectTheme
}

interface CardAppearanceSettings {
  enabled: boolean
  light: CardAppearanceTheme
  dark: CardAppearanceTheme
  background: BackgroundEffectSettings
}

interface AppSettings {
  autoCheckLogin: boolean
  autoLaunch: boolean
  launchAtLogin: boolean
  hardwareAcceleration: boolean
  globalShortcuts: boolean
  minimizeToTray: boolean
  musicCachePath: string
  cachePath: string
  cachePolicy: MusicCachePolicySettings
  autoAnalyzeBpm: boolean
  closeToTray: boolean
  startupHomePage: StartupHomePage
  theme: AppTheme
  pluginThemeId: string | null
  blurEffect: boolean
  windowTransparency: boolean
  windowTransparencyEffect: WindowTransparencyEffectSettings
  useCoverTheme: boolean
  lyricFontSize: number
  libraryFolders: string[]
  watchLibrary: boolean
  smtcEnabled: boolean
  discordRpcEnabled: boolean
  accentColor: string
  lightAccentColor: string
  darkAccentColor: string
  fontFamily: string
  uiDensity: UiDensity
  appBackground: AppBackgroundSettings
  cardAppearance: CardAppearanceSettings
  nowPlayingBackground: NowPlayingBackground
  lyricAlign: LyricAlign
  lyricDimOpacity: number
  playbackResumeMode: PlaybackResumeMode
  playMode: PlayMode
  audioOutput: AudioOutputId
  audioDevice: string
  audioExclusiveMode: boolean
  audioOutputConfig: OutputConfig
  audioProcessing: AudioProcessingSettings
  headphoneCompensation: HeadphoneCompensationSettings
  audioEqPresets: AudioEqPreset[]
  desktopLyrics: DesktopLyricsSettings
  proxyMode: ProxyMode
  proxyHost: string
  proxyPort: number
  streamingActiveProvider: string
}

interface OpraCatalogStatus {
  loaded: boolean
  loading: boolean
  source: 'empty' | 'cache' | 'network'
  cachePath: string
  vendorCount: number
  productCount: number
  profileCount: number
  lastUpdatedAt: string | null
  lastError: string
}

interface OpraProfile {
  eqId: string
  productId: string
  productName: string
  vendorName: string
  author: string
  details: string
  link: string
  attributionUrl: string
  preampDb: number
  bands: EqualizerBand[]
  applicable: boolean
  unsupportedBandTypes: string[]
}

interface ConvolverInfo {
  loaded: boolean
  active: boolean
  bypassed: boolean
  irResampled: boolean
  path: string
  sampleRate: number
  channels: number
  lengthFrames: number
  lengthMs: number
  partitionSize: number
  latencyFrames: number
  overrunCount: number
  lastProcessMs: number
  maxProcessMs: number
  channelMappingMode: string
  warning: string
  lastError: string
}

interface NativeAudioMetadata {
  source: string
  title: string
  artist: string
  album: string
  albumArtist: string
  composer: string
  year: string
  genre: string
  trackNumber: string
  discNumber: string
  comment: string
  codec: string
  container: string
  channelLayout: string
  sampleRate: number
  channelCount: number
  bitDepth: number
  bitrate: number
  duration: number
  playable?: boolean
  reasonCode?: string
  isDsd: boolean
  dsdMode: string
  dsdRate: number
  outputModes?: string[]
  coverMime: string
  coverDataBase64: string
  replayGainTrackGain: number | null
  replayGainAlbumGain: number | null
  r128TrackGain: number | null
  r128AlbumGain: number | null
  error: string
  isoTracks?: NativeAudioMetadata[]
}

interface PlaybackSession {
  version: 1
  savedAt: string
  mode: PlaybackResumeMode
  playMode?: PlayMode
  track: TrackData
  position: number
}

interface SettingsSnapshot extends AppSettings {
  settings: AppSettings
  defaults: {
    cachePath: string
  }
  paths: {
    settingsFile: string
    userDataPath: string
    activeCachePath: string
  }
  appVersion: string
  platform: string
  restartRequired: boolean
  restartReasons: string[]
}

interface AudioOutputOption {
  id: AudioOutputId
  label: string
  description: string
  platform: NodeJS.Platform
  supportsExclusive: boolean
}

interface AudioDeviceOption {
  id: string
  label: string
  isDefault: boolean
  backend?: string
  name?: string
  channels?: number
  sampleRates?: number[]
  driverName?: string
  driverVersion?: number
  bitDepths?: number[]
  latencyFrames?: number
  minBufferSize?: number
  maxBufferSize?: number
  granularity?: number
  preferredBufferSize?: number
  capabilityVersion?: number
  supportsExclusive?: boolean
  supportsHogMode?: boolean
  supportsDirectHw?: boolean
  supportsDop?: boolean
  supportsNativeDsd?: boolean
  dopSupportState?: AudioCapabilitySupportState
  nativeDsdSupportState?: AudioCapabilitySupportState
  supportedDsdRates?: number[]
  nativeDsdSampleRates?: number[]
  nativeDsdSampleFormats?: string[]
  dopCarrierSampleRates?: number[]
  dopCarrierFormats?: string[]
  pathKind?: string
  capabilityReason?: string
}

type AudioCapabilitySupportState =
  | 'verified'
  | 'runtime-probed'
  | 'unsupported'
  | 'unknown'

interface TwilightPluginDescriptor {
  id: string
  name: string
  version: string
  description: string
  author: string
  license: string
  type: TwilightPluginType[]
  main?: string
  binary?: Record<string, string>
  dependencies?: Record<string, string>
  engines: {
    twilightEcho: string
  }
  apiVersion: number
  permissions: string[]
  status: TwilightPluginStatus
  enabled: boolean
  builtIn: boolean
  error: string | null
  isDsp: boolean
  source: 'directory' | 'tep' | 'bundled' | 'index' | 'scan'
  installedAt: string | null
  updatedAt: string | null
  paths: {
    root: string
    versionRoot: string
    manifestPath: string
    dataDir: string
    logPath: string
  }
}

interface TwilightPluginInstallResult {
  plugin: TwilightPluginDescriptor
  warning: string
}

interface TwilightPluginIndexEntry {
  id: string
  name: string
  version: string
  description: string
  author: string
  license: string
  type: TwilightPluginType[]
  main?: string
  binary?: Record<string, string>
  dependencies?: Record<string, string>
  engines: {
    twilightEcho: string
  }
  apiVersion: number
  permissions: string[]
  homepage?: string
  repository?: string
  icon?: string
  sourceUrl: string
  checksumSha256: string
  tags?: string[]
  verified?: boolean
  installState?: TwilightPluginIndexInstallState
  installedVersion?: string
}

interface TwilightPluginIndexStatus {
  sourceUrl: string
  sourceKind: TwilightPluginIndexSourceKind
  loadedFrom: TwilightPluginIndexLoadedFrom
  lastFetchedAt: string | null
  stale: boolean
  error: string | null
}

interface TwilightProviderStreamingSection {
  id: string
  title: string
  icon: string
  method: string
  args?: unknown[]
}

interface TwilightProviderUiMetadata {
  icon: string
  color?: string
  description?: string
  authType: 'qr' | 'oauth' | 'cookie'
  loginInstructions?: string
  qrStatusCodes?: {
    waiting: number
    scanned: number | null
    expired: number
    denied?: number
    success: number
  }
  showBrowserButton?: boolean
  loginExtraActions?: Array<{
    label: string
    icon: string
    method: string
  }>
  streamingSections?: TwilightProviderStreamingSection[]
  streamingLibraryTab?: boolean
  streamingSearch?: boolean
  unifiedLibrary?: boolean
}

interface TwilightMediaProviderRegistration {
  id: string
  name: string
  capabilities: TwilightMediaProviderCapability[]
  ui?: TwilightProviderUiMetadata
  health?: TwilightMediaProviderHealth
}

interface TwilightMediaProviderHealth {
  providerId: string
  pluginId: string
  pluginStatus: TwilightPluginStatus
  available: boolean
  totalCalls: number
  successfulCalls: number
  failedCalls: number
  successRate: number
  methodStats?: Partial<Record<TwilightMediaProviderMethod, TwilightMediaProviderMethodHealth>>
  lastError: string | null
  lastCheckedAt: string | null
}

interface TwilightMediaProviderMethodHealth {
  totalCalls: number
  successfulCalls: number
  failedCalls: number
  successRate: number
  lastError: string | null
  lastCheckedAt: string | null
}

type TwilightUiContributionKind =
  | 'sidebarPage'
  | 'playerBarButton'
  | 'settingsPanel'
  | 'localSidebarItem'
  | 'streamingHome'

interface TwilightUiContribution {
  id: string
  kind: TwilightUiContributionKind
  title: string
  description?: string
  icon?: string
  command?: string
  /** Legacy field normalized by the host to command-only rendering. */
  renderMode?: 'command'
  autoLoad?: boolean
}

interface TwilightThemeContribution {
  id: string
  name: string
  description?: string
  variables?: Record<string, string>
  stylesheet?: string
}

interface TwilightPluginExtensionContribution {
  pluginId: string
  ui: TwilightUiContribution[]
  themes: TwilightThemeContribution[]
}

interface OutputConfig {
  preferredBufferSize: number
  routingMode: ChannelRoutingMode
  wasapiExclusivePushMode?: boolean
}

interface LatencyInfo {
  bufferLatencyMs: number
  outputLatencyMs: number
  totalLatencyMs: number
}

interface OutputDiagnostics {
  sessionUnderrunCount: number
  sessionBufferDropCount: number
  sessionRecoveryCount: number
  lifetimeUnderrunCount: number
  lifetimeBufferDropCount: number
  lifetimeRecoveryCount: number
  driverRestartCount: number
  deviceLostCount: number
  lastError: string
}

interface AudioOutputState {
  output: AudioOutputId
  device: string
  exclusiveMode: boolean
  exclusiveAvailable: boolean
  outputOptions: AudioOutputOption[]
  deviceOptions: AudioDeviceOption[]
}

interface OutputInfo {
  exclusive: boolean
  supportsOutputPerfect: boolean
  sourceExact: boolean
  outputPerfect: boolean
  pcmPassthrough: boolean
  resampled: boolean
  perfectReason: string
  outputSampleRate: number
  outputBitDepth: number
  backend: string
  actualBackend: string
  deviceName: string
  actualDeviceName: string
  driverName: string
  actualDriverName: string
  driverVersion: number
  actualDriverVersion: number
  actualOutputFormat: string
  actualSampleRate: number
  actualBitDepth: number
  actualChannels: number
  accessMode: string
  devicePathKind: string
  perfectReasonCode: string
  capabilityReason: string
  driverDopCapable: boolean
  driverNativeDsdCapable: boolean
  driverDopCarrierSampleRates: number[]
  driverDopCarrierFormats: string[]
  driverNativeDsdSampleRates: number[]
  nativeDsdRuntimeState: string
  nativeDsdRequestedRate: number
  nativeDsdActualRate: number
  nativeDsdChannels: number
  nativeDsdExplicitlyCapable: boolean
  nativeDsdAdvertisedSampleRates: number[]
  nativeDsdRuntimeReason: string
  bufferSizeFrames: number
  latencyFrames: number
  latencyMs: number
  latencyInfo: LatencyInfo
  channelRoutingMode: string
  diagnostics: OutputDiagnostics
  deviceRecovered: boolean
  recoveryCount: number
  nativeDsp?: { plugins: unknown[] }
  isDsd: boolean
  dsdMode: string
  dsdRate: number
}

type PlaybackOutputInfoMirror = Pick<
  OutputInfo,
  | 'actualBackend'
  | 'actualOutputFormat'
  | 'actualSampleRate'
  | 'actualBitDepth'
  | 'actualChannels'
  | 'bufferSizeFrames'
  | 'latencyFrames'
  | 'latencyMs'
  | 'latencyInfo'
  | 'channelRoutingMode'
  | 'supportsOutputPerfect'
  | 'sourceExact'
  | 'diagnostics'
  | 'deviceRecovered'
  | 'recoveryCount'
  | 'outputSampleRate'
  | 'outputBitDepth'
  | 'outputPerfect'
  | 'pcmPassthrough'
  | 'perfectReason'
  | 'perfectReasonCode'
  | 'isDsd'
  | 'dsdMode'
  | 'dsdRate'
> &
  Partial<Pick<OutputInfo, 'accessMode' | 'devicePathKind' | 'capabilityReason'>>

interface PlaybackInfo extends PlaybackOutputInfoMirror {
  state: 'stopped' | 'playing' | 'paused'
  position: number
  duration: number
  volume: number
  queueIndex: number
  playMode: PlayMode
  source: string
  codec: string
  nativePlaybackActive: boolean
  bitrate: number
  sourceSampleRate: number
  sourceBitDepth: number
  decodedSampleRate: number
  decodedBitDepth: number
  decodedChannels: number
  decodedSampleFormat: string
  outputBackend: string
  outputDevice: string
  outputInfo: OutputInfo
  actualBackend: string
  driverName: string
  driverVersion: number
  actualOutputFormat: string
  actualSampleRate: number
  actualBitDepth: number
  actualChannels: number
  bufferSizeFrames: number
  latencyFrames: number
  latencyMs: number
  latencyInfo: LatencyInfo
  channelRoutingMode: string
  supportsOutputPerfect: boolean
  sourceExact: boolean
  diagnostics: OutputDiagnostics
  deviceRecovered: boolean
  recoveryCount: number
  outputSampleRate: number
  outputBitDepth: number
  channelCount: number
  outputPerfect: boolean
  pcmPassthrough: boolean
  dspActive: boolean
  replayGainActive: boolean
  eqActive: boolean
  convolverActive: boolean
  crossfeedActive: boolean
  crossfadeActive: boolean
  fftActive: boolean
  irResampled: boolean
  replayGainDb: number
  crossfeedStrength: number
  crossfadeSeconds: number
  convolverLatencyFrames: number
  partitionSize: number
  channelMappingMode: string
  perfectReason: string
  perfectReasonCode: string
  isDsd: boolean
  dsdMode: string
  dsdRate: number
  gaplessActive: boolean
  preloadReady: boolean
  upcomingTrack: AudioEngineQueueItem | null
}

interface AudioEnginePlayResult {
  nativeStarted: boolean
  fallbackReason: string
}

interface AudioEngineAPI {
  loadQueue: (items: AudioEngineQueueItem[], startIndex?: number) => Promise<void>
  play: (filePath: string, startTime?: number) => Promise<AudioEnginePlayResult>
  togglePause: () => Promise<void>
  seek: (time: number) => Promise<void>
  setVolume: (volume: number) => Promise<void>
  stop: () => Promise<void>
  next: () => Promise<void>
  previous: () => Promise<void>
  setPlayMode: (mode: PlayMode) => Promise<void>
  getUpcomingTrack: () => Promise<AudioEngineQueueItem | null>
  setExclusiveMode: (enabled: boolean) => Promise<AudioOutputState>
  getExclusiveMode: () => Promise<boolean>
  setAudioOutput: (output: AudioOutputId, device?: string) => Promise<AudioOutputState>
  setAudioDevice: (device: string) => Promise<AudioOutputState>
  setOutputConfig: (config: OutputConfig) => Promise<OutputConfig>
  getAudioOutput: () => Promise<AudioOutputId>
  getAudioOutputOptions: () => Promise<AudioOutputOption[]>
  getAudioOutputState: () => Promise<AudioOutputState>
  setAudioProcessing: (
    settings: Partial<AudioProcessingSettings>
  ) => Promise<AudioProcessingSettings>
  getAudioProcessing: () => Promise<AudioProcessingSettings>
  selectImpulseResponse: () => Promise<string | null>
  loadImpulseResponse: (path: string) => Promise<ConvolverInfo>
  unloadImpulseResponse: () => Promise<ConvolverInfo>
  getConvolverInfo: () => Promise<ConvolverInfo>
  setEqBands: (settings: Partial<AudioProcessingSettings>) => Promise<AudioProcessingSettings>
  setEqPreset: (preset: AudioEqPreset) => Promise<AudioProcessingSettings>
  setCrossfeedStrength: (strength: number) => Promise<AudioProcessingSettings>
  setReplayGainMode: (
    mode: VolumeNormalizationMode,
    preamp?: number,
    fallback?: number,
    clip?: boolean
  ) => Promise<AudioProcessingSettings>
  getMetadata: (source: string) => Promise<NativeAudioMetadata | null>
  getPlaybackInfo: () => Promise<PlaybackInfo>
  getSpectrumData: (points?: number) => Promise<number[]>
  getVisualizationData: (options?: VisualizationOptions) => Promise<VisualizationData>

  onPropertyChange: (cb: (event: AudioEngineEvent) => void) => () => void
  onEndFile: (cb: (reason: string) => void) => () => void
  onStartFile: (cb: () => void) => () => void
  onReady: (cb: () => void) => () => void
  onError: (cb: (message: string) => void) => () => void
  onDisconnected: (cb: () => void) => () => void
  onPlaybackInfo: (cb: (info: PlaybackInfo) => void) => () => void
  onDeviceOptionsChanged: (cb: (event: { reason: string }) => void) => () => void
  onServiceCrash: (cb: (event: { reason: string }) => void) => () => void
  onServiceReady: (
    cb: (event: {
      manualResumeRequired: boolean
      outputRouteSynced: boolean
      restoreErrors: string[]
    }) => void
  ) => () => void
}

interface OpraAPI {
  search: (query: string) => Promise<OpraProfile[]>
  getProfile: (eqId: string) => Promise<OpraProfile | null>
  refresh: () => Promise<OpraCatalogStatus>
  getStatus: () => Promise<OpraCatalogStatus>
}

interface WindowAPI {
  window: {
    minimize: () => void
    toggleMaximize: () => void
    close: () => void
  }
  dialog: {
    openFolder: () => Promise<string | null>
  }
  shell: {
    showItemInFolder: (filePath: string) => Promise<void>
    openPath: (path: string) => Promise<string>
    openExternal: (url: string) => Promise<void>
  }
  discord: {
    updateActivity: (data: {
      title: string
      artist: string
      album?: string
      playing: boolean
      startTime?: number
    }) => Promise<void>
    clearActivity: () => Promise<void>
  }
  library: {
    onChanged: (cb: (change: LibraryChange | undefined) => void) => () => void
    onCoversMissing: (cb: (info: { dirtyCount: number }) => void) => () => void
  }
  fs: {
    scanMusicFiles: (folderPath: string) => Promise<TrackData[]>
    readAudioFile: (filePath: string) => Promise<{ buffer: ArrayBuffer; mimeType: string }>
    getAudioFileUrl: (filePath: string) => Promise<string>
    onScanProgress: (cb: (progress: { current: number; total: number }) => void) => () => void
  }
  audioEngine: AudioEngineAPI
  bpmAnalysis: {
    request: (request: BpmAnalysisRequest) => Promise<BpmAnalysisRequestResult>
    getCacheSize: () => Promise<number>
    clearCache: () => Promise<number>
    onCompleted: (cb: (event: BpmAnalysisCompletedEvent) => void) => () => void
  }
  opra: OpraAPI
  app: {
    relaunch: () => Promise<void>
    checkForUpdates: () => Promise<{
      hasUpdate: boolean
      currentVersion: string
      latestVersion?: string
      releaseUrl?: string
      releaseNotes?: string
      error?: string
    }>
    onSavePlaybackSession: (cb: () => Promise<void> | void) => () => void
  }
  ncm: {
    getPort: () => Promise<number>
    request: (path: string, cookie?: string) => Promise<unknown>
    getCachedSong: (songId: number) => Promise<string | null>
    cacheSong: (songId: number, url: string, fileName?: string) => Promise<string | null>
  }
  data: {
    saveMusicLibrary: (data: { tracks: unknown[]; folders: string[] }) => Promise<void>
    loadMusicLibrary: () => Promise<{ tracks: unknown[]; folders: string[] } | unknown[]>
    getCover: (handle: string) => Promise<string | null>
    getLyrics: (dir: string, fileName: string, filePath?: string) => Promise<string | null>
    savePlaybackSession: (session: PlaybackSession | null) => Promise<void>
    loadPlaybackSession: () => Promise<PlaybackSession | null>
    clearPlaybackSession: () => Promise<void>
    savePlaylists: (playlists: unknown) => Promise<void>
    loadPlaylists: () => Promise<unknown>
    saveCookie: (cookie: string) => Promise<void>
    loadCookie: () => Promise<string>
  }
  settings: {
    get: () => Promise<SettingsSnapshot>
    update: (patch: Partial<AppSettings>) => Promise<SettingsSnapshot>
    chooseCacheFolder: () => Promise<string | null>
    chooseBackgroundImage: () => Promise<string | null>
    importBackgroundImage: (fileName: string, data: ArrayBuffer) => Promise<string | null>
    exportBackup: () => Promise<string>
    importBackup: (json: string) => Promise<SettingsSnapshot>
    getCacheSize: () => Promise<number>
    clearCache: () => Promise<number>
    getShortcutStatuses: () => Promise<PlayerShortcutStatus[]>
    onChanged: (cb: (snapshot: SettingsSnapshot) => void) => () => void
    onPlayerShortcut: (cb: (action: PlayerShortcutAction) => void) => () => void
  }
  plugins: {
    list: () => Promise<TwilightPluginDescriptor[]>
    installFromPath: (path: string) => Promise<TwilightPluginInstallResult>
    chooseAndInstall: () => Promise<TwilightPluginInstallResult | null>
    enable: (id: string) => Promise<TwilightPluginDescriptor>
    disable: (id: string) => Promise<TwilightPluginDescriptor>
    uninstall: (id: string, options?: { removeData?: boolean }) => Promise<void>
    openLog: (id: string) => Promise<void>
    getLog: (id: string) => Promise<string>
    listIndex: () => Promise<TwilightPluginIndexEntry[]>
    refreshIndex: () => Promise<TwilightPluginIndexEntry[]>
    getIndexStatus: () => Promise<TwilightPluginIndexStatus>
    installFromIndex: (id: string) => Promise<TwilightPluginInstallResult>
    setNativeDspParameters: (id: string, parameters: Record<string, number>) => Promise<TwilightPluginDescriptor>
    onChanged: (cb: () => void) => () => void
  }
  providers: {
    list: () => Promise<TwilightMediaProviderRegistration[]>
    call: (providerId: string, method: TwilightMediaProviderMethod, args: unknown[]) => Promise<unknown>
  }
  extensions: {
    list: () => Promise<TwilightPluginExtensionContribution[]>
    executeCommand: (command: string, args?: unknown[]) => Promise<unknown>
    readThemeStylesheet: (stylesheetPath: string) => Promise<string>
  }
  desktopLyrics: {
    toggle: () => Promise<boolean>
    show: () => Promise<void>
    hide: () => Promise<void>
    updateTrack: (data: {
      lyrics: string | null
      translatedLyrics?: string | null
      lyricsSource?: 'embedded' | 'local' | 'provider' | null
      translatedLyricsSource?: 'embedded' | 'local' | 'provider' | null
      title?: string
      artist?: string
    }) => void
    updateTime: (time: number) => void
    updateSettings: (settings: DesktopLyricsSettings) => void
    onToggle: (cb: (enabled: boolean) => void) => () => void
    onInitSettings: (cb: (settings: DesktopLyricsSettings) => void) => () => void
    onTrackUpdate: (cb: (data: {
      lyrics: string | null
      translatedLyrics?: string | null
      lyricsSource?: 'embedded' | 'local' | 'provider' | null
      translatedLyricsSource?: 'embedded' | 'local' | 'provider' | null
      title?: string
      artist?: string
    }) => void) => () => void
    onTimeUpdate: (cb: (time: number) => void) => () => void
    onSettingsUpdate: (cb: (settings: DesktopLyricsSettings) => void) => () => void
    getPosition: () => void
    move: (x: number, y: number) => void
    requestClose: () => void
  }
}

declare global {
  interface Window {
    api: WindowAPI
  }
}
