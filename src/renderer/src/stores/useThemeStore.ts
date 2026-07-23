import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  DEFAULT_THEME_TONE_SCHEDULE,
  THEME_MANAGED_DATA_ATTRIBUTES,
  THEME_TOKEN_DEFINITIONS,
  TWILIGHT_DEFAULT_THEME,
  TWILIGHT_DEFAULT_THEME_ID,
  createThemeAccentTokenOverrides,
  ensureThemeTextContrast,
  normalizeThemeTokenOverrides,
  resolveScheduledThemeTone,
  resolveThemeProfileModes,
  resolveThemeProfileTokens,
  themeModesToDataAttributes,
  themeTokensToCssVariables,
  type ThemeAssetReference,
  type ThemeAssetType,
  type ThemeBootstrap,
  type ThemeLibrarySnapshot,
  type ThemeProfileV2,
  type ThemeSelection,
  type ThemeTone,
  type ThemeModes,
  type ThemeWindowInheritance
} from '../../../shared/theme.ts'
import { useExtensionRegistry, type ThemeContribution } from '../extensions/registry'
import { getPluginThemeKey } from '../extensions/themeSelection'

const STYLE_ID = 'twilight-theme-runtime'
const EPOCH_ISO = new Date(0).toISOString()

const snapshot = ref<ThemeLibrarySnapshot | null>(null)
const previewProfile = ref<ThemeProfileV2 | null>(null)
const previewSelection = ref<ThemeSelection | null>(null)
const loaded = ref(false)
const saving = ref(false)
const error = ref('')
let bootstrapPromise: Promise<void> | null = null
let listenersSetup = false
let applySequence = 0
const assetValidationCache = new Map<string, Promise<boolean>>()
const systemTone = ref<ThemeTone>('pureWhite')
const adaptiveAccentColor = ref('#1a73e8')
const adaptiveCoverUrl = ref('')
const previewTone = ref<ThemeTone | null>(null)
let adaptiveMediaIdentity = ''
let adaptiveCoverSource = ''
let adaptiveCoverObjectUrl = ''
let adaptiveMediaSequence = 0
let toneRefreshTimer: number | null = null
let lastAppliedTone: ThemeTone | null = null

function resolveTone(): ThemeTone {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'pureWhite'
}

function resolveThemeMode(theme: string): ThemeTone {
  if (theme === 'dark') return 'dark'
  if (theme === 'pureWhite') return 'pureWhite'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'pureWhite'
}

function applyBootstrapThemeMode(
  bootstrap: Awaited<ReturnType<typeof window.api.settings.get>>
): void {
  const tone = resolveThemeMode(bootstrap.settings.theme)
  document.documentElement.dataset.theme = tone
  document.documentElement.dataset.themePreference = bootstrap.settings.theme
  document.documentElement.style.colorScheme = tone === 'dark' ? 'dark' : 'light'
}

export async function bootstrapThemeRuntime(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise
  bootstrapPromise = (async () => {
    if (!window.api?.themes || !window.api?.settings) return
    const [settingsBootstrap, themeBootstrap, nativeTone] = await Promise.all([
      window.api.settings.get(),
      window.api.themes.getBootstrap(),
      window.api.themes.getSystemTone()
    ])
    systemTone.value = nativeTone
    applyBootstrapThemeMode(settingsBootstrap)
    acceptBootstrap(themeBootstrap)
    setupThemeListeners()
    await applyActiveTheme(false)
  })()
  try {
    await bootstrapPromise
  } finally {
    bootstrapPromise = null
  }
}

function acceptBootstrap(bootstrap: ThemeBootstrap): void {
  snapshot.value = bootstrap.library
  loaded.value = true
}

function setupThemeListeners(): void {
  if (listenersSetup || !window.api?.themes) return
  listenersSetup = true
  window.api.themes.onChanged((next) => {
    snapshot.value = next
    queueMicrotask(() => void applyActiveTheme(true))
  })
  window.api.themes.onSystemToneChanged((tone) => {
    systemTone.value = tone
    queueMicrotask(() => void applyActiveTheme(false))
  })
  window.api.settings.onChanged(() => {
    queueMicrotask(() => void applyActiveTheme(true))
  })
  window.api.plugins.onChanged(() => {
    queueMicrotask(() => void applyActiveTheme(true))
  })
  const observer = new MutationObserver((mutations) => {
    if (
      mutations.some((mutation) => mutation.attributeName === 'data-theme') &&
      resolveTone() !== lastAppliedTone
    ) {
      queueMicrotask(() => void applyActiveTheme(false))
    }
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
}

function getSelectedProfile(selection: ThemeSelection | undefined): ThemeProfileV2 | null {
  if (previewProfile.value) return previewProfile.value
  if (!selection || selection.kind !== 'user') return null
  const library = snapshot.value?.data
  if (!library) return null
  const profileId = selection.id
  return library.profiles.find((profile) => profile.id === profileId) ?? null
}

function resolvePluginTheme(
  contributions: ThemeContribution[],
  selection: Extract<ThemeSelection, { kind: 'plugin' }>
): ThemeContribution | null {
  const key = `${selection.pluginId}:${selection.themeId}`
  return contributions.find((theme) => getPluginThemeKey(theme) === key) ?? null
}

interface ThemeRuntimeState {
  css: string
  dataAttributes: Record<`data-te-${string}`, string>
  activeTheme: string
  tone: ThemeTone
}

async function buildThemeRuntimeState(syncPluginExtensions: boolean): Promise<ThemeRuntimeState> {
  const variables: Record<string, string> = {}
  let stylesheet = ''
  let assetStylesheet = ''
  const selection = previewSelection.value ?? snapshot.value?.data.activeTheme
  const selectedProfile = getSelectedProfile(selection)
  const modes = resolveThemeProfileModes(selectedProfile)
  const tone = resolveRuntimeTone(selectedProfile, modes)
  if (selectedProfile) {
    await assertProfileAssetsAvailable(selectedProfile)
    const resolvedTokens = resolveThemeProfileTokens(selectedProfile, tone)
    Object.assign(variables, themeTokensToCssVariables(resolvedTokens))
    Object.assign(variables, {
      '--te-app-bg-image': 'none',
      '--te-local-bg-image': 'none',
      '--te-settings-bg-image': 'none',
      '--te-streaming-bg-image': 'none',
      '--te-player-bg-image': 'none'
    })
    assetStylesheet = applyProfileAssetBindings(selectedProfile, variables)
    applyProfileModeVariables(modes, tone, resolvedTokens, variables)
  } else {
    if (selection?.kind === 'plugin') {
      const registry = useExtensionRegistry()
      if (syncPluginExtensions) await registry.syncExtensions()
      const contribution = resolvePluginTheme(registry.themeContributions.value, selection)
      if (!contribution) {
        if (previewSelection.value) throw new Error('当前插件主题不可用')
        return {
          css: '',
          dataAttributes: themeModesToDataAttributes(resolveThemeProfileModes(null)),
          activeTheme: TWILIGHT_DEFAULT_THEME_ID,
          tone
        }
      }
      if (contribution.structured) {
        Object.assign(
          variables,
          themeTokensToCssVariables(TWILIGHT_DEFAULT_THEME.variants[tone].tokens)
        )
      }
      Object.assign(variables, contribution.variables ?? {})
      const structuredTokens = contribution.structured?.variants[tone]?.tokens
      if (structuredTokens) {
        Object.assign(
          variables,
          themeTokensToCssVariables(normalizeThemeTokenOverrides(structuredTokens))
        )
      }
      if (contribution.stylesheet) {
        stylesheet = await window.api.extensions.readThemeStylesheet(contribution.stylesheet)
      }
    } else if (previewTone.value) {
      const resolvedTokens = TWILIGHT_DEFAULT_THEME.variants[tone].tokens
      Object.assign(variables, themeTokensToCssVariables(resolvedTokens))
      Object.assign(variables, {
        '--te-app-bg-image': 'none',
        '--te-local-bg-image': 'none',
        '--te-settings-bg-image': 'none',
        '--te-streaming-bg-image': 'none',
        '--te-player-bg-image': 'none'
      })
      applyProfileModeVariables(modes, tone, resolvedTokens, variables)
    }
  }
  const root = Object.entries(variables)
    .map(([name, value]) => `  ${name}: ${value} !important;`)
    .join('\n')
  return {
    css: [assetStylesheet, root ? `:root {\n${root}\n}` : '', stylesheet]
      .filter(Boolean)
      .join('\n\n'),
    dataAttributes: themeModesToDataAttributes(modes),
    activeTheme: activeThemeKey(selection),
    tone
  }
}

function resolveRuntimeTone(profile: ThemeProfileV2 | null, modes: ThemeModes): ThemeTone {
  if (previewTone.value) {
    clearTimedToneRefresh()
    return previewTone.value
  }
  const scheduling = modes.appearance?.toneScheduling ?? 'manual'
  if (scheduling === 'system') return systemTone.value
  if (scheduling === 'timed') {
    scheduleTimedToneRefresh(profile)
    return resolveScheduledThemeTone(
      new Date(),
      profile?.toneSchedule ?? DEFAULT_THEME_TONE_SCHEDULE
    )
  }
  clearTimedToneRefresh()
  return resolveTone()
}

function scheduleTimedToneRefresh(profile: ThemeProfileV2 | null): void {
  clearTimedToneRefresh()
  const schedule = profile?.toneSchedule ?? DEFAULT_THEME_TONE_SCHEDULE
  const now = new Date()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const boundaries = [schedule.lightStartMinutes, schedule.darkStartMinutes]
    .map((minutes) => {
      const delta = minutes - currentMinutes
      return delta > 0 ? delta : delta + 24 * 60
    })
    .sort((a, b) => a - b)
  const delay = Math.max(
    1_000,
    boundaries[0] * 60_000 - now.getSeconds() * 1_000 - now.getMilliseconds()
  )
  toneRefreshTimer = window.setTimeout(() => void applyActiveTheme(false), delay)
}

function clearTimedToneRefresh(): void {
  if (toneRefreshTimer === null) return
  window.clearTimeout(toneRefreshTimer)
  toneRefreshTimer = null
}

function applyProfileModeVariables(
  modes: ThemeModes,
  tone: ThemeTone,
  tokens: Record<string, string>,
  variables: Record<string, string>
): void {
  const background =
    tokens['surface.app'] ?? TWILIGHT_DEFAULT_THEME.variants[tone].tokens['surface.app']
  if (modes.appearance?.accentSource === 'cover' && adaptiveAccentColor.value) {
    Object.assign(
      variables,
      themeTokensToCssVariables(
        createThemeAccentTokenOverrides(adaptiveAccentColor.value, tone, background, true)
      )
    )
  }
  if (modes.appearance?.contrastGuard === 'enforce') {
    variables['--te-neutral-900'] = ensureThemeTextContrast(tokens['color.neutral.900'], background)
    variables['--te-settings-text'] = ensureThemeTextContrast(
      tokens['settings.text.primary'],
      tokens['surface.settings'] ?? background
    )
    variables['--te-navigation-text'] = ensureThemeTextContrast(
      tokens['navigation.text'],
      tokens['navigation.surface'] ?? background
    )
    variables['--te-chrome-text'] = ensureThemeTextContrast(
      tokens['typography.chromeText'],
      background
    )
  }
  const treatment = modes.appearance?.backgroundTreatment ?? 'solid'
  variables['--te-theme-background-image'] = 'none'
  if (treatment === 'gradient') {
    variables['--te-theme-background-image'] =
      `linear-gradient(${tokens['background.gradientAngle']}, ${tokens['background.gradientStart']}, ${tokens['background.gradientEnd']})`
  } else if (treatment === 'cover-blur' && adaptiveCoverUrl.value) {
    variables['--te-theme-background-image'] = `url("${escapeCssUrl(adaptiveCoverUrl.value)}")`
  } else if (treatment === 'image') {
    variables['--te-theme-background-image'] = variables['--te-app-bg-image'] ?? 'none'
  }
  if (treatment !== 'image') {
    for (const variable of [
      '--te-app-bg-image',
      '--te-local-bg-image',
      '--te-settings-bg-image',
      '--te-streaming-bg-image'
    ]) {
      variables[variable] = variables['--te-theme-background-image']
    }
  }
}

function escapeCssUrl(value: string): string {
  return value.replace(/["\\\n\r\f]/g, (character) => `\\${character}`)
}

export async function setThemeAdaptiveMedia(input: {
  identity: string
  accentColor: string
  coverUrl: string
}): Promise<void> {
  const identity = input.identity.trim().slice(0, 512)
  const accentColor = input.accentColor.trim()
  const coverUrl = input.coverUrl.trim()
  if (
    identity === adaptiveMediaIdentity &&
    accentColor === adaptiveAccentColor.value &&
    coverUrl === adaptiveCoverSource
  ) {
    return
  }
  const sequence = ++adaptiveMediaSequence
  let nextCoverUrl = ''
  let nextObjectUrl = ''
  try {
    if (/^data:image\//i.test(coverUrl)) {
      const blob = await (await fetch(coverUrl)).blob()
      nextObjectUrl = URL.createObjectURL(blob)
      nextCoverUrl = nextObjectUrl
    } else if (/^(?:blob:|twilight-media:|cover:|background:)/i.test(coverUrl)) {
      nextCoverUrl = coverUrl
    }
  } catch {
    nextCoverUrl = ''
  }
  if (sequence !== adaptiveMediaSequence) {
    if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl)
    return
  }
  if (adaptiveCoverObjectUrl) URL.revokeObjectURL(adaptiveCoverObjectUrl)
  adaptiveCoverObjectUrl = nextObjectUrl
  adaptiveCoverUrl.value = nextCoverUrl
  adaptiveCoverSource = coverUrl
  adaptiveAccentColor.value = accentColor || '#1a73e8'
  adaptiveMediaIdentity = identity
  if (loaded.value) await applyActiveTheme(false)
}

async function setThemePreviewTone(tone: ThemeTone | null): Promise<void> {
  previewTone.value = tone
  if (loaded.value) await applyActiveTheme(false)
}

function applyProfileAssetBindings(
  profile: ThemeProfileV2,
  variables: Record<string, string>
): string {
  const bindings = profile.assetBindings
  if (!bindings) return ''
  const assets = new Map((profile.assets ?? []).map((asset) => [asset.id, asset]))
  const backgroundBindings = [
    ['appBackground', '--te-app-bg-image'],
    ['localBackground', '--te-local-bg-image'],
    ['settingsBackground', '--te-settings-bg-image'],
    ['streamingBackground', '--te-streaming-bg-image'],
    ['playerBackground', '--te-player-bg-image']
  ] as const
  for (const [binding, variable] of backgroundBindings) {
    const asset = assets.get(bindings[binding] ?? '')
    if (asset?.type === 'image') variables[variable] = `url("${themeAssetUrl(profile.id, asset)}")`
  }
  const appBackground = variables['--te-app-bg-image']
  if (appBackground && appBackground !== 'none') {
    for (const [binding, variable] of backgroundBindings.slice(1)) {
      if (!bindings[binding]) variables[variable] = appBackground
    }
  }

  const fontBindings = [
    ['sansFont', '--te-font-sans'],
    ['displayFont', '--te-font-display'],
    ['roundedFont', '--te-font-rounded']
  ] as const
  const fontFaces: string[] = []
  for (const [binding, variable] of fontBindings) {
    const asset = assets.get(bindings[binding] ?? '')
    if (asset?.type !== 'font') continue
    const family = `TwilightTheme-${profile.id.replace(/[^a-zA-Z0-9_-]/g, '-')}-${asset.id}`
    variables[variable] = `'${family}', system-ui, sans-serif`
    fontFaces.push(
      `@font-face { font-family: '${family}'; src: url("${themeAssetUrl(profile.id, asset)}") format('woff2'); font-display: swap; }`
    )
  }
  return fontFaces.join('\n')
}

async function assertProfileAssetsAvailable(profile: ThemeProfileV2): Promise<void> {
  if (!profile.assetBindings) return
  const boundIds = new Set(
    Object.values(profile.assetBindings).filter((id): id is string => typeof id === 'string')
  )
  const assets = (profile.assets ?? []).filter((asset) => boundIds.has(asset.id))
  if (assets.length !== boundIds.size) throw new Error('主题绑定的本地资源不存在')
  const key = `${profile.id}:${assets
    .map((asset) => `${asset.id}:${asset.path}:${asset.type}`)
    .sort()
    .join('|')}`
  let validation = assetValidationCache.get(key)
  if (!validation) {
    validation = window.api.themes.validateAssets(profile.id, assets)
    assetValidationCache.set(key, validation)
    if (assetValidationCache.size > 64) {
      const oldest = assetValidationCache.keys().next().value
      if (oldest) assetValidationCache.delete(oldest)
    }
  }
  let valid = false
  try {
    valid = await validation
  } catch (cause) {
    assetValidationCache.delete(key)
    throw cause
  }
  if (!valid) {
    assetValidationCache.delete(key)
    throw new Error('主题绑定的本地资源不可用')
  }
}

function themeAssetUrl(profileId: string, asset: ThemeAssetReference): string {
  const path = asset.path.split('/').map(encodeURIComponent).join('/')
  return `theme-asset://asset/${encodeURIComponent(profileId)}/${path}`
}

export async function applyActiveTheme(syncPluginExtensions = true): Promise<void> {
  const sequence = ++applySequence
  try {
    const state = await buildThemeRuntimeState(syncPluginExtensions)
    if (sequence !== applySequence) return
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = STYLE_ID
      document.head.appendChild(style)
    }
    style.textContent = state.css
    for (const attribute of THEME_MANAGED_DATA_ATTRIBUTES) {
      document.documentElement.removeAttribute(attribute)
    }
    for (const [attribute, value] of Object.entries(state.dataAttributes)) {
      document.documentElement.setAttribute(attribute, value)
    }
    const toneChanged = resolveTone() !== state.tone
    if (toneChanged && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      document.documentElement.classList.add('te-theme-tone-transition')
      window.setTimeout(
        () => document.documentElement.classList.remove('te-theme-tone-transition'),
        220
      )
    }
    lastAppliedTone = state.tone
    document.documentElement.dataset.theme = state.tone
    document.documentElement.style.colorScheme = state.tone === 'dark' ? 'dark' : 'light'
    document.documentElement.dataset.activeTheme = state.activeTheme
    error.value = ''
  } catch (cause) {
    if (sequence !== applySequence) return
    error.value = cause instanceof Error ? cause.message : '主题应用失败'
  }
}

function activeThemeKey(selection: ThemeSelection | undefined): string {
  if (!selection) return TWILIGHT_DEFAULT_THEME_ID
  if (selection.kind === 'plugin') return `${selection.pluginId}:${selection.themeId}`
  return selection.id
}

export function useThemeStore(): {
  snapshot: Ref<ThemeLibrarySnapshot | null>
  profiles: ComputedRef<ThemeProfileV2[]>
  activeTheme: ComputedRef<ThemeSelection>
  activeProfile: ComputedRef<ThemeProfileV2 | null>
  previewProfile: Ref<ThemeProfileV2 | null>
  previewSelection: Ref<ThemeSelection | null>
  loaded: Ref<boolean>
  saving: Ref<boolean>
  error: Ref<string>
  load: () => Promise<void>
  preview: (profile: ThemeProfileV2 | null) => Promise<void>
  previewTheme: (selection: ThemeSelection | null) => Promise<void>
  createProfile: (name?: string, source?: ThemeProfileV2 | null) => ThemeProfileV2
  saveProfile: (profile: ThemeProfileV2) => Promise<ThemeLibrarySnapshot>
  deleteProfile: (profileId: string) => Promise<ThemeLibrarySnapshot>
  setActive: (selection: ThemeSelection) => Promise<ThemeLibrarySnapshot>
  setWindowInheritance: (inheritance: ThemeWindowInheritance) => Promise<ThemeLibrarySnapshot>
  importTheme: () => Promise<ThemeLibrarySnapshot | null>
  exportTheme: (profileId: string) => Promise<string | null>
  importAsset: (profileId: string, type: ThemeAssetType) => Promise<ThemeAssetReference | null>
  copyAssets: (sourceProfileId: string, targetProfileId: string) => Promise<void>
  setAdaptiveMedia: typeof setThemeAdaptiveMedia
  setPreviewTone: typeof setThemePreviewTone
} {
  const profiles = computed(() => snapshot.value?.data.profiles ?? [])
  const activeTheme = computed(
    () =>
      snapshot.value?.data.activeTheme ??
      ({ kind: 'builtin', id: TWILIGHT_DEFAULT_THEME_ID } as const)
  )
  const activeProfile = computed(() => {
    const selection = activeTheme.value
    return selection.kind === 'user'
      ? (profiles.value.find((profile) => profile.id === selection.id) ?? null)
      : null
  })

  async function load(): Promise<void> {
    await bootstrapThemeRuntime()
  }

  async function preview(profile: ThemeProfileV2 | null): Promise<void> {
    previewProfile.value = profile
    previewSelection.value = profile ? { kind: 'user', id: profile.id } : null
    await applyActiveTheme(false)
  }

  async function previewTheme(selection: ThemeSelection | null): Promise<void> {
    previewProfile.value = null
    previewSelection.value = selection
    await applyActiveTheme(selection?.kind === 'plugin')
  }

  function createProfile(
    name = '自定义主题',
    source: ThemeProfileV2 | null = null
  ): ThemeProfileV2 {
    const now = new Date().toISOString()
    return {
      schemaVersion: 2,
      id: `user:${crypto.randomUUID()}`,
      name,
      description: source?.description ?? '',
      baseThemeId: source?.baseThemeId ?? TWILIGHT_DEFAULT_THEME_ID,
      createdAt: now,
      updatedAt: now,
      overrides: {
        pureWhite: { ...(source?.overrides.pureWhite ?? {}) },
        dark: { ...(source?.overrides.dark ?? {}) }
      },
      modes: source?.modes ? JSON.parse(JSON.stringify(source.modes)) : {},
      toneSchedule: source?.toneSchedule ? { ...source.toneSchedule } : undefined,
      windowDefaults: source?.windowDefaults
        ? JSON.parse(JSON.stringify(source.windowDefaults))
        : undefined,
      assets: source?.assets?.map((asset) => ({ ...asset })),
      assetBindings: source?.assetBindings ? { ...source.assetBindings } : undefined
    }
  }

  async function runSave(
    operation: (revision: number) => Promise<ThemeLibrarySnapshot>
  ): Promise<ThemeLibrarySnapshot> {
    saving.value = true
    error.value = ''
    try {
      const next = await operation(snapshot.value?.revision ?? 0)
      snapshot.value = next
      await applyActiveTheme(true)
      return next
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '主题保存失败'
      previewProfile.value = null
      previewSelection.value = null
      await applyActiveTheme(false)
      error.value = message
      throw cause
    } finally {
      saving.value = false
    }
  }

  async function saveProfile(profile: ThemeProfileV2): Promise<ThemeLibrarySnapshot> {
    return await runSave((revision) => window.api.themes.save(profile, revision))
  }

  async function deleteProfile(profileId: string): Promise<ThemeLibrarySnapshot> {
    return await runSave((revision) => window.api.themes.delete(profileId, revision))
  }

  async function setActive(selection: ThemeSelection): Promise<ThemeLibrarySnapshot> {
    previewProfile.value = null
    previewSelection.value = null
    return await runSave((revision) => window.api.themes.setActive(selection, revision))
  }

  async function setWindowInheritance(
    inheritance: ThemeWindowInheritance
  ): Promise<ThemeLibrarySnapshot> {
    return await runSave((revision) =>
      window.api.themes.setWindowInheritance(inheritance, revision)
    )
  }

  async function importTheme(): Promise<ThemeLibrarySnapshot | null> {
    try {
      const next = await window.api.themes.importTheme(snapshot.value?.revision ?? 0)
      if (next) snapshot.value = next
      return next
    } catch (cause) {
      await restorePersistedTheme()
      throw cause
    }
  }

  async function exportTheme(profileId: string): Promise<string | null> {
    try {
      return await window.api.themes.exportTheme(profileId)
    } catch (cause) {
      await restorePersistedTheme()
      throw cause
    }
  }

  async function importAsset(
    profileId: string,
    type: ThemeAssetType
  ): Promise<ThemeAssetReference | null> {
    try {
      return await window.api.themes.importAsset(profileId, type)
    } catch (cause) {
      await restorePersistedTheme()
      throw cause
    }
  }

  async function copyAssets(sourceProfileId: string, targetProfileId: string): Promise<void> {
    try {
      await window.api.themes.copyAssets(sourceProfileId, targetProfileId)
    } catch (cause) {
      await restorePersistedTheme()
      throw cause
    }
  }

  async function restorePersistedTheme(): Promise<void> {
    previewProfile.value = null
    previewSelection.value = null
    await applyActiveTheme(false)
  }

  return {
    snapshot,
    profiles,
    activeTheme,
    activeProfile,
    previewProfile,
    previewSelection,
    loaded,
    saving,
    error,
    load,
    preview,
    previewTheme,
    createProfile,
    saveProfile,
    deleteProfile,
    setActive,
    setWindowInheritance,
    importTheme,
    exportTheme,
    importAsset,
    copyAssets,
    setAdaptiveMedia: setThemeAdaptiveMedia,
    setPreviewTone: setThemePreviewTone
  }
}

export const themeTokenDefinitions = THEME_TOKEN_DEFINITIONS
export const defaultThemeDocument = TWILIGHT_DEFAULT_THEME
export const themeEpochIso = EPOCH_ISO
