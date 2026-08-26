import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type {
  AppSettings,
  CloseWindowBehavior,
  MiniPlayerSettings,
  MusicCachePolicySettings,
  NcmPlaybackQuality,
  PlaybackResumeMode,
  PlayerBarSettings
} from '@renderer/types/settings'
import {
  DEFAULT_MINI_PLAYER_SETTINGS,
  cloneMiniPlayerSettings
} from '../../../../shared/miniPlayer.ts'
import {
  DEFAULT_PLAYER_BAR_SETTINGS,
  clonePlayerBarSettings
} from '../../../../shared/playerBar.ts'

export type OnboardingUsage = 'local' | 'streaming' | 'both'
export type OnboardingStepId =
  | 'welcome'
  | 'usage'
  | 'local'
  | 'streaming'
  | 'player'
  | 'audio'
  | 'system'
  | 'finish'
export type OnboardingDirection = 'forward' | 'back'
export type OnboardingFinishAction = 'local' | 'streaming' | 'streaming-login'

const DEFAULT_ONBOARDING_CACHE_POLICY: MusicCachePolicySettings = {
  cover: true,
  lyrics: true,
  metadata: true,
  streamingAudio: 'provider'
}

export interface OnboardingChoices {
  usage: OnboardingUsage | null
  audioExclusiveMode: boolean
  closeWindowBehavior: CloseWindowBehavior
  launchAtLogin: boolean
  playerBar: PlayerBarSettings
  miniPlayer: MiniPlayerSettings
  openMiniPlayerOnFinish: boolean
  taskbarThumbarButtonsEnabled: boolean
  watchLibrary: boolean
  autoAnalyzeBpm: boolean
  onlineLyricsFallback: boolean
  cachePolicy: MusicCachePolicySettings
  globalShortcuts: boolean
  smtcEnabled: boolean
  discordRpcEnabled: boolean
  ncmPlaybackQuality: NcmPlaybackQuality
  playbackResumeMode: PlaybackResumeMode
  /** StepStreaming CTA: open the NCM login page right after the wizard closes. */
  wantsStreamingLogin: boolean
  /** StepStreaming CTA: browse the plugin market for more providers after finishing. */
  wantsPluginMarket: boolean
}

export function createDefaultOnboardingChoices(
  seed?: Pick<
    AppSettings,
    | 'closeWindowBehavior'
    | 'launchAtLogin'
    | 'taskbarThumbarButtonsEnabled'
    | 'playerBar'
    | 'miniPlayer'
    | 'onlineLyricsFallback'
    | 'cachePolicy'
  >
): OnboardingChoices {
  return {
    usage: null,
    audioExclusiveMode: false,
    closeWindowBehavior: seed?.closeWindowBehavior ?? 'quit',
    launchAtLogin: seed?.launchAtLogin ?? false,
    playerBar: clonePlayerBarSettings(seed?.playerBar ?? DEFAULT_PLAYER_BAR_SETTINGS),
    miniPlayer: cloneMiniPlayerSettings(seed?.miniPlayer ?? DEFAULT_MINI_PLAYER_SETTINGS),
    openMiniPlayerOnFinish: false,
    taskbarThumbarButtonsEnabled: seed?.taskbarThumbarButtonsEnabled !== false,
    watchLibrary: true,
    autoAnalyzeBpm: true,
    onlineLyricsFallback: seed?.onlineLyricsFallback === true,
    cachePolicy: { ...(seed?.cachePolicy ?? DEFAULT_ONBOARDING_CACHE_POLICY) },
    globalShortcuts: false,
    smtcEnabled: true,
    discordRpcEnabled: false,
    ncmPlaybackQuality: 'auto',
    playbackResumeMode: 'off',
    wantsStreamingLogin: false,
    wantsPluginMarket: false
  }
}

export function resolveVisibleSteps(usage: OnboardingUsage | null): OnboardingStepId[] {
  const steps: OnboardingStepId[] = ['welcome', 'usage']
  if (usage === 'local' || usage === 'both') steps.push('local')
  if (usage === 'streaming' || usage === 'both') steps.push('streaming')
  steps.push('player', 'audio', 'system', 'finish')
  return steps
}

export function buildSettingsPatch(choices: OnboardingChoices): Partial<AppSettings> {
  const patch: Partial<AppSettings> = { onboardingCompleted: true }
  if (choices.usage === null) return patch
  patch.startupHomePage = choices.usage === 'streaming' ? 'streaming' : 'local'
  patch.audioExclusiveMode = choices.audioExclusiveMode
  patch.closeWindowBehavior = choices.closeWindowBehavior
  patch.closeToTray = choices.closeWindowBehavior === 'tray'
  patch.launchAtLogin = choices.launchAtLogin
  patch.playerBar = clonePlayerBarSettings(choices.playerBar)
  patch.miniPlayer = cloneMiniPlayerSettings(choices.miniPlayer)
  patch.taskbarThumbarButtonsEnabled = choices.taskbarThumbarButtonsEnabled
  patch.globalShortcuts = choices.globalShortcuts
  patch.smtcEnabled = choices.smtcEnabled
  patch.discordRpcEnabled = choices.discordRpcEnabled
  patch.playbackResumeMode = choices.playbackResumeMode
  if (choices.usage !== 'streaming') {
    patch.watchLibrary = choices.watchLibrary
    patch.autoAnalyzeBpm = choices.autoAnalyzeBpm
    patch.onlineLyricsFallback = choices.onlineLyricsFallback
  }
  if (choices.usage !== 'local') {
    patch.ncmPlaybackQuality = choices.ncmPlaybackQuality
    patch.cachePolicy = { ...choices.cachePolicy }
  }
  return patch
}

export function resolveFinishAction(choices: OnboardingChoices): OnboardingFinishAction {
  // Streaming CTAs on StepStreaming apply to pure streaming and dual-use paths.
  // Dual-use keeps startupHomePage local, but still honors "log in now".
  if (choices.usage === 'streaming' || choices.usage === 'both') {
    if (choices.wantsStreamingLogin) return 'streaming-login'
    if (choices.usage === 'streaming') return 'streaming'
  }
  return 'local'
}

export interface OnboardingFlow {
  choices: Ref<OnboardingChoices>
  visibleSteps: ComputedRef<OnboardingStepId[]>
  currentIndex: Ref<number>
  currentStep: ComputedRef<OnboardingStepId>
  direction: Ref<OnboardingDirection>
  isFirstStep: ComputedRef<boolean>
  isLastStep: ComputedRef<boolean>
  canAdvance: ComputedRef<boolean>
  next: () => void
  back: () => void
  goTo: (index: number) => void
}

export function useOnboardingFlow(
  seed?: Parameters<typeof createDefaultOnboardingChoices>[0]
): OnboardingFlow {
  const choices = ref<OnboardingChoices>(createDefaultOnboardingChoices(seed))
  const currentIndex = ref(0)
  const direction = ref<OnboardingDirection>('forward')

  const visibleSteps = computed(() => resolveVisibleSteps(choices.value.usage))
  const currentStep = computed(
    () => visibleSteps.value[Math.min(currentIndex.value, visibleSteps.value.length - 1)]
  )
  const isFirstStep = computed(() => currentIndex.value === 0)
  const isLastStep = computed(() => currentIndex.value >= visibleSteps.value.length - 1)
  // The usage step gates the rest of the flow; every other step has defaults.
  const canAdvance = computed(() => currentStep.value !== 'usage' || choices.value.usage !== null)

  function next(): void {
    if (isLastStep.value || !canAdvance.value) return
    direction.value = 'forward'
    currentIndex.value += 1
  }

  function back(): void {
    if (isFirstStep.value) return
    direction.value = 'back'
    currentIndex.value -= 1
  }

  function goTo(index: number): void {
    // Progress dots only allow revisiting steps already passed.
    if (index >= currentIndex.value || index < 0) return
    direction.value = 'back'
    currentIndex.value = index
  }

  return {
    choices,
    visibleSteps,
    currentIndex,
    currentStep,
    direction,
    isFirstStep,
    isLastStep,
    canAdvance,
    next,
    back,
    goTo
  }
}
