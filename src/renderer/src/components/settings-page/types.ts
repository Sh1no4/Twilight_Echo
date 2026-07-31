import {
  DSD_OUTPUT_MODE_OPTIONS,
  VOLUME_NORMALIZATION_OPTIONS
} from '../../../../shared/audioProcessingOptions.ts'
import type {
  AppTheme,
  AppBackgroundPage,
  ChannelRoutingMode,
  DesktopLyricsSettings,
  LyricAlign,
  MotionPreference,
  NcmPlaybackQuality,
  PlaybackResumeMode,
  SacdProgramMode,
  StartupHomePage,
  StreamingAudioCachePolicy,
  UiDensity
} from '../../types/settings'

export type SectionKey =
  | 'general'
  | 'playback'
  | 'dsp'
  | 'cache'
  | 'performance'
  | 'appearance'
  | 'desktopLyrics'
  | 'shortcuts'
  | 'about'

export type BooleanSettingKey =
  | 'autoCheckLogin'
  | 'launchAtLogin'
  | 'hardwareAcceleration'
  | 'proxyAllowDirectFallback'
  | 'windowTransparency'
  | 'useCoverTheme'
  | 'globalShortcuts'
  | 'watchLibrary'
  | 'onlineLyricsFallback'
  | 'smtcEnabled'
  | 'discordRpcEnabled'
  | 'remoteControlEnabled'

export const sections: { key: SectionKey; label: string; icon: string }[] = [
  { key: 'general', label: '常规', icon: 'pi pi-sliders-h' },
  { key: 'playback', label: '播放', icon: 'pi pi-volume-up' },
  { key: 'dsp', label: 'DSP', icon: 'pi pi-sliders-v' },
  { key: 'cache', label: '缓存', icon: 'pi pi-database' },
  { key: 'performance', label: '性能', icon: 'pi pi-bolt' },
  { key: 'appearance', label: '外观', icon: 'pi pi-palette' },
  { key: 'desktopLyrics', label: '桌面歌词', icon: 'pi pi-window-maximize' },
  { key: 'shortcuts', label: '快捷键', icon: 'pi pi-key' },
  { key: 'about', label: '关于', icon: 'pi pi-info-circle' }
]

export const colorModeOptions: { value: AppTheme; label: string; icon: string }[] = [
  { value: 'system', label: '系统', icon: 'pi pi-desktop' },
  { value: 'pureWhite', label: '浅色', icon: 'pi pi-sun' },
  { value: 'dark', label: '深色', icon: 'pi pi-moon' }
]

export const motionPreferenceOptions: { value: MotionPreference; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'full', label: '完整动效' },
  { value: 'reduced', label: '减少动效' },
  { value: 'off', label: '关闭动效' }
]

export const playbackResumeOptions: { value: PlaybackResumeMode; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'track', label: '记住曲目' },
  { value: 'trackAndPosition', label: '曲目和位置' }
]

export const ncmPlaybackQualityOptions: { value: NcmPlaybackQuality; label: string }[] = [
  { value: 'auto', label: '自动（最高可用）' },
  { value: 'standard', label: '标准' },
  { value: 'exhigh', label: '极高' },
  { value: 'lossless', label: '无损' },
  { value: 'hires', label: 'Hi-Res' }
]

export const startupHomePageOptions: { value: StartupHomePage; label: string; icon: string }[] = [
  { value: 'local', label: '本地音乐主页', icon: 'pi pi-home' },
  { value: 'streaming', label: '流媒体主页', icon: 'pi pi-compass' }
]

export const bufferSizeOptions = [
  { value: 0, label: 'Auto' },
  { value: 64, label: '64' },
  { value: 128, label: '128' },
  { value: 256, label: '256' },
  { value: 512, label: '512' },
  { value: 1024, label: '1024' },
  { value: 2048, label: '2048' }
] as const

export const routingModeOptions: { value: ChannelRoutingMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'stereo', label: 'Stereo' },
  { value: 'stereo-to-5.1', label: 'Stereo → 5.1' },
  { value: 'stereo-to-7.1', label: 'Stereo → 7.1' },
  { value: 'mono-to-stereo', label: 'Mono → Stereo' },
  { value: 'mono-to-multichannel', label: 'Mono → Multichannel' }
]

export const pcmToDsdModeOptions: {
  value: import('../../types/settings').PcmToDsdMode
  label: string
}[] = [
  { value: 'off', label: '关闭' },
  { value: 'dsd64', label: 'DSD64' },
  { value: 'dsd128', label: 'DSD128' },
  { value: 'dsd256', label: 'DSD256' }
]

export const replayGainOptions = VOLUME_NORMALIZATION_OPTIONS
export const dsdOutputModeOptions = DSD_OUTPUT_MODE_OPTIONS

export const sacdProgramModeOptions: { value: SacdProgramMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'stereo', label: 'Stereo' },
  { value: 'multichannel', label: 'Multichannel' }
]

export const fftResolutionOptions = [64, 128, 256, 512, 1024, 2048, 4096, 8192] as const

export const accentColorOptions: { value: string; label: string; class: string }[] = [
  { value: 'violet', label: '紫罗兰', class: 'violet' },
  { value: 'blue', label: '蓝', class: 'blue' },
  { value: 'emerald', label: '翠绿', class: 'emerald' },
  { value: 'rose', label: '玫瑰', class: 'rose' },
  { value: 'amber', label: '琥珀', class: 'amber' },
  { value: 'slate', label: '石板', class: 'slate' }
]

export const fontFamilyOptions: { value: string; label: string }[] = [
  { value: 'system', label: '系统默认 (System)' },
  { value: 'inter', label: 'Inter / Roboto' },
  { value: 'lxgw', label: '霞鹜文楷 (LXGW)' },
  { value: 'sarasa', label: 'Sarasa Gothic' },
  { value: 'comic', label: 'Comic Sans MS' }
]

export const uiDensityOptions: { value: UiDensity; label: string }[] = [
  { value: 'compact', label: '紧凑' },
  { value: 'standard', label: '标准' },
  { value: 'comfortable', label: '舒展' }
]

export const appBackgroundPageOptions: { value: AppBackgroundPage; label: string; desc: string }[] =
  [
    { value: 'local', label: '本地主页', desc: '本地音乐首页和资料概览背景。' },
    { value: 'settings', label: '设置与插件', desc: '设置页、插件中心等管理界面背景。' },
    { value: 'streaming', label: '流媒体页', desc: '在线音乐浏览、搜索和详情页背景。' },
    { value: 'player', label: '播放页', desc: '沉浸式播放页和全屏播放背景。' }
  ]

export const lyricAlignOptions: { value: LyricAlign; label: string }[] = [
  { value: 'center', label: '居中对齐' },
  { value: 'left', label: '靠左对齐' }
]

export const streamingAudioCachePolicyOptions: {
  value: StreamingAudioCachePolicy
  label: string
}[] = [
  { value: 'provider', label: '由 Provider 规则控制' },
  { value: 'off', label: '不缓存流媒体音频' }
]

export { GITHUB_URL, HOMEPAGE_URL, RELEASES_URL } from '../../../../shared/projectUrls.ts'

export const SETTINGS_SEARCH_INDEX: Array<{
  section: SectionKey
  title: string
  terms: string
}> = [
  {
    section: 'general',
    title: '媒体库与启动',
    terms:
      '常规 扫描 文件夹 监控 网易云 SMTC Discord 启动 托盘 代理 插件设置 备份 恢复 远程 遥控 PIN DLNA 投送 局域网'
  },
  {
    section: 'playback',
    title: '播放与输出',
    terms: '播放 输出 设备 独占 音量 削波 无缝 网易云 音质 无损 Hi-Res DSD SACD buffer routing'
  },
  {
    section: 'dsp',
    title: 'DSP 处理器',
    terms:
      'DSP EQ ReplayGain Crossfeed Convolver FFT High-Res DSD SACD VST3 插件 宿主 搜索目录 扫描'
  },
  { section: 'cache', title: '缓存策略', terms: '缓存 目录 封面 歌词 元数据 流媒体 BPM 分析 清理' },
  { section: 'performance', title: '性能', terms: '性能 硬件加速 GPU 重启' },
  {
    section: 'appearance',
    title: '外观与主题',
    terms:
      '外观 主题 插件主题 强调色 背景 字体 密度 动效 减少动画 歌词 卡片 迷你播放器 自定义 圆角 缩放 布局'
  },
  {
    section: 'desktopLyrics',
    title: '桌面歌词',
    terms: '桌面歌词 字体 颜色 阴影 对齐 窗口 置顶 鼠标穿透 翻译 行偏移 错落 双语 原文'
  },
  { section: 'shortcuts', title: '快捷键', terms: '快捷键 全局 播放 暂停 上一首 下一首 注册 冲突' },
  { section: 'about', title: '关于与更新', terms: '关于 版本 更新 GitHub Releases 开源 致谢' }
]

export const RESET_DESKTOP_LYRICS: DesktopLyricsSettings = {
  enabled: false,
  fontSize: 32,
  fontFamily: 'system',
  fontWeight: 700,
  color: '#ffffff',
  highlightColor: '#FFD700',
  bgColor: '#000000',
  bgOpacity: 30,
  align: 'center',
  showTranslation: true,
  layout: 'multi',
  lineSpacing: 1.6,
  shadow: true,
  shadowBlur: 8,
  shadowColor: '#000000',
  windowWidth: 900,
  windowHeight: 160,
  windowX: -1,
  windowY: -1,
  alwaysOnTop: true,
  clickThrough: false,
  maxLines: 2,
  lineOffset: 48
}
