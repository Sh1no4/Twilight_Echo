import { computed, ref } from 'vue'
import {
  cloneMiniPlayerSettings,
  cloneMiniPlayerThemeProfile,
  createDefaultMiniPlayerThemeProfile,
  type MiniPlayerSettings,
  type MiniPlayerThemeProfile
} from '../../../shared/miniPlayer.ts'

export interface MiniPlayerCustomizationDraftOptions {
  initial: MiniPlayerSettings
  persist: (settings: MiniPlayerSettings) => Promise<MiniPlayerSettings>
  debounceMs?: number
}

export function useMiniPlayerCustomizationDraft(options: MiniPlayerCustomizationDraftOptions) {
  const settings = ref<MiniPlayerSettings>(cloneMiniPlayerSettings(options.initial))
  const confirmed = ref<MiniPlayerSettings>(cloneMiniPlayerSettings(options.initial))
  const sessionSnapshot = ref<MiniPlayerSettings | null>(null)
  const saving = ref(false)
  const error = ref('')
  const activeProfile = computed(
    () =>
      settings.value.profiles[settings.value.activeStyleId] ??
      createDefaultMiniPlayerThemeProfile(settings.value.activeStyleId)
  )

  const debounceMs = options.debounceMs ?? 120
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let persistenceQueue = Promise.resolve()
  let revision = 0
  let confirmedRevision = 0
  let dirty = false
  let activeSaveCount = 0

  function beginSession(): void {
    sessionSnapshot.value = cloneMiniPlayerSettings(settings.value)
    error.value = ''
  }

  function acceptConfirmed(next: MiniPlayerSettings): void {
    confirmed.value = cloneMiniPlayerSettings(next)
    if (!dirty && activeSaveCount === 0) {
      settings.value = cloneMiniPlayerSettings(next)
    }
  }

  function replaceSettings(next: MiniPlayerSettings): void {
    settings.value = cloneMiniPlayerSettings(next)
    revision += 1
    dirty = true
    error.value = ''
    scheduleSave()
  }

  function updateActiveProfile(
    update: (profile: MiniPlayerThemeProfile) => MiniPlayerThemeProfile
  ): void {
    const styleId = settings.value.activeStyleId
    const current = cloneMiniPlayerThemeProfile(activeProfile.value)
    const nextProfile = cloneMiniPlayerThemeProfile(update(current))
    replaceSettings({
      ...settings.value,
      profiles: { ...settings.value.profiles, [styleId]: nextProfile }
    })
  }

  function selectTheme(styleId: string): void {
    const profiles = settings.value.profiles[styleId]
      ? settings.value.profiles
      : {
          ...settings.value.profiles,
          [styleId]: createDefaultMiniPlayerThemeProfile(styleId)
        }
    replaceSettings({ ...settings.value, activeStyleId: styleId, profiles })
  }

  function resetActiveTheme(): void {
    const styleId = settings.value.activeStyleId
    replaceSettings({
      ...settings.value,
      profiles: {
        ...settings.value.profiles,
        [styleId]: createDefaultMiniPlayerThemeProfile(styleId)
      }
    })
  }

  async function undoSession(): Promise<MiniPlayerSettings> {
    if (!sessionSnapshot.value) return cloneMiniPlayerSettings(settings.value)
    replaceSettings(sessionSnapshot.value)
    return await flush()
  }

  async function flush(): Promise<MiniPlayerSettings> {
    clearSaveTimer()
    if (!dirty) return cloneMiniPlayerSettings(confirmed.value)

    const candidate = cloneMiniPlayerSettings(settings.value)
    const candidateRevision = revision
    dirty = false
    activeSaveCount += 1
    saving.value = true

    const saveOperation = persistenceQueue.then(() => options.persist(candidate))
    persistenceQueue = saveOperation.then(
      () => undefined,
      () => undefined
    )

    try {
      const persisted = cloneMiniPlayerSettings(await saveOperation)
      if (candidateRevision >= confirmedRevision) {
        confirmedRevision = candidateRevision
        confirmed.value = persisted
      }
      if (revision === candidateRevision) {
        settings.value = cloneMiniPlayerSettings(persisted)
      }
      error.value = ''
      return cloneMiniPlayerSettings(persisted)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '迷你播放器设置保存失败'
      error.value = message
      if (revision === candidateRevision) {
        settings.value = cloneMiniPlayerSettings(confirmed.value)
      }
      throw cause
    } finally {
      activeSaveCount -= 1
      saving.value = activeSaveCount > 0
    }
  }

  function dispose(): void {
    clearSaveTimer()
  }

  function scheduleSave(): void {
    clearSaveTimer()
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flush().catch(() => undefined)
    }, debounceMs)
  }

  function clearSaveTimer(): void {
    if (!saveTimer) return
    clearTimeout(saveTimer)
    saveTimer = null
  }

  return {
    settings,
    activeProfile,
    saving,
    error,
    beginSession,
    acceptConfirmed,
    replaceSettings,
    updateActiveProfile,
    selectTheme,
    resetActiveTheme,
    undoSession,
    flush,
    dispose
  }
}
