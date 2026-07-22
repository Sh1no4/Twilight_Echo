import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  THEME_TOKEN_DEFINITIONS,
  TWILIGHT_DEFAULT_THEME,
  TWILIGHT_DEFAULT_THEME_ID,
  normalizeThemeTokenOverrides,
  resolveThemeProfileTokens,
  themeTokensToCssVariables,
  type ThemeAssetReference,
  type ThemeAssetType,
  type ThemeBootstrap,
  type ThemeLibrarySnapshot,
  type ThemeProfileV1,
  type ThemeSelection,
  type ThemeTone,
  type ThemeWindowInheritance
} from '../../../shared/theme.ts'
import { useExtensionRegistry, type ThemeContribution } from '../extensions/registry'
import { getPluginThemeKey } from '../extensions/themeSelection'

const STYLE_ID = 'twilight-theme-runtime'
const EPOCH_ISO = new Date(0).toISOString()

const snapshot = ref<ThemeLibrarySnapshot | null>(null)
const previewProfile = ref<ThemeProfileV1 | null>(null)
const previewSelection = ref<ThemeSelection | null>(null)
const loaded = ref(false)
const saving = ref(false)
const error = ref('')
let bootstrapPromise: Promise<void> | null = null
let listenersSetup = false
let applySequence = 0

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
    const [settingsBootstrap, themeBootstrap] = await Promise.all([
      window.api.settings.get(),
      window.api.themes.getBootstrap()
    ])
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
  window.api.settings.onChanged(() => {
    queueMicrotask(() => void applyActiveTheme(true))
  })
  window.api.plugins.onChanged(() => {
    queueMicrotask(() => void applyActiveTheme(true))
  })
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.attributeName === 'data-theme')) {
      queueMicrotask(() => void applyActiveTheme(false))
    }
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
}

function getSelectedProfile(selection: ThemeSelection | undefined): ThemeProfileV1 | null {
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

async function buildThemeCss(syncPluginExtensions: boolean): Promise<string> {
  const tone = resolveTone()
  const variables: Record<string, string> = {}
  let stylesheet = ''
  let assetStylesheet = ''
  const selection = previewSelection.value ?? snapshot.value?.data.activeTheme
  const selectedProfile = getSelectedProfile(selection)
  if (selectedProfile) {
    Object.assign(
      variables,
      themeTokensToCssVariables(resolveThemeProfileTokens(selectedProfile, tone))
    )
    Object.assign(variables, {
      '--te-app-bg-image': 'none',
      '--te-local-bg-image': 'none',
      '--te-settings-bg-image': 'none',
      '--te-streaming-bg-image': 'none',
      '--te-player-bg-image': 'none'
    })
    assetStylesheet = applyProfileAssetBindings(selectedProfile, variables)
  } else {
    if (selection?.kind === 'plugin') {
      const registry = useExtensionRegistry()
      if (syncPluginExtensions) await registry.syncExtensions()
      const contribution = resolvePluginTheme(registry.themeContributions.value, selection)
      if (!contribution) {
        if (previewSelection.value) throw new Error('当前插件主题不可用')
        return ''
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
    }
  }
  const root = Object.entries(variables)
    .map(([name, value]) => `  ${name}: ${value} !important;`)
    .join('\n')
  return [assetStylesheet, root ? `:root {\n${root}\n}` : '', stylesheet]
    .filter(Boolean)
    .join('\n\n')
}

function applyProfileAssetBindings(
  profile: ThemeProfileV1,
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

function themeAssetUrl(profileId: string, asset: ThemeAssetReference): string {
  const path = asset.path.split('/').map(encodeURIComponent).join('/')
  return `theme-asset://asset/${encodeURIComponent(profileId)}/${path}`
}

export async function applyActiveTheme(syncPluginExtensions = true): Promise<void> {
  const sequence = ++applySequence
  try {
    const css = await buildThemeCss(syncPluginExtensions)
    if (sequence !== applySequence) return
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = STYLE_ID
      document.head.appendChild(style)
    }
    style.textContent = css
    document.documentElement.dataset.activeTheme = activeThemeKey(
      previewSelection.value ?? snapshot.value?.data.activeTheme
    )
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
  profiles: ComputedRef<ThemeProfileV1[]>
  activeTheme: ComputedRef<ThemeSelection>
  activeProfile: ComputedRef<ThemeProfileV1 | null>
  previewProfile: Ref<ThemeProfileV1 | null>
  previewSelection: Ref<ThemeSelection | null>
  loaded: Ref<boolean>
  saving: Ref<boolean>
  error: Ref<string>
  load: () => Promise<void>
  preview: (profile: ThemeProfileV1 | null) => Promise<void>
  previewTheme: (selection: ThemeSelection | null) => Promise<void>
  createProfile: (name?: string, source?: ThemeProfileV1 | null) => ThemeProfileV1
  saveProfile: (profile: ThemeProfileV1) => Promise<ThemeLibrarySnapshot>
  deleteProfile: (profileId: string) => Promise<ThemeLibrarySnapshot>
  setActive: (selection: ThemeSelection) => Promise<ThemeLibrarySnapshot>
  setWindowInheritance: (inheritance: ThemeWindowInheritance) => Promise<ThemeLibrarySnapshot>
  importTheme: () => Promise<ThemeLibrarySnapshot | null>
  exportTheme: (profileId: string) => Promise<string | null>
  importAsset: (profileId: string, type: ThemeAssetType) => Promise<ThemeAssetReference | null>
  copyAssets: (sourceProfileId: string, targetProfileId: string) => Promise<void>
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

  async function preview(profile: ThemeProfileV1 | null): Promise<void> {
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
    source: ThemeProfileV1 | null = null
  ): ThemeProfileV1 {
    const now = new Date().toISOString()
    return {
      schemaVersion: 1,
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
      error.value = cause instanceof Error ? cause.message : '主题保存失败'
      throw cause
    } finally {
      saving.value = false
    }
  }

  async function saveProfile(profile: ThemeProfileV1): Promise<ThemeLibrarySnapshot> {
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
    const next = await window.api.themes.importTheme(snapshot.value?.revision ?? 0)
    if (next) snapshot.value = next
    return next
  }

  async function exportTheme(profileId: string): Promise<string | null> {
    return await window.api.themes.exportTheme(profileId)
  }

  async function importAsset(
    profileId: string,
    type: ThemeAssetType
  ): Promise<ThemeAssetReference | null> {
    return await window.api.themes.importAsset(profileId, type)
  }

  async function copyAssets(sourceProfileId: string, targetProfileId: string): Promise<void> {
    await window.api.themes.copyAssets(sourceProfileId, targetProfileId)
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
    copyAssets
  }
}

export const themeTokenDefinitions = THEME_TOKEN_DEFINITIONS
export const defaultThemeDocument = TWILIGHT_DEFAULT_THEME
export const themeEpochIso = EPOCH_ISO
