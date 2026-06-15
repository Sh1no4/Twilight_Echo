import { computed, ref } from 'vue'

type UiContributionKind = 'sidebarPage' | 'playerBarButton' | 'settingsPanel'

interface UiContribution {
  id: string
  kind: UiContributionKind
  title: string
  description?: string
  icon?: string
  command?: string
}

interface ThemeContribution {
  id: string
  name: string
  description?: string
  variables?: Record<string, string>
  stylesheet?: string
}

interface PluginExtensionContribution {
  pluginId: string
  ui: UiContribution[]
  themes: ThemeContribution[]
}

const uiContributions = ref<UiContribution[]>([])
const themeContributions = ref<ThemeContribution[]>([])
const syncInFlight = ref<Promise<void> | null>(null)
let listenerSetup = false

export function useExtensionRegistry() {
  setupExtensionChangeListener()
  return {
    uiContributions: computed(() => uiContributions.value),
    themeContributions: computed(() => themeContributions.value),
    syncExtensions
  }
}

function setupExtensionChangeListener(): void {
  if (listenerSetup) return
  listenerSetup = true
  window.api.plugins.onChanged(() => {
    void syncExtensions()
  })
}

export async function syncExtensions(): Promise<void> {
  if (syncInFlight.value) return syncInFlight.value
  const api = window.api?.extensions
  if (!api) return

  syncInFlight.value = (async () => {
    const entries = await api.list()
    const nextUi: UiContribution[] = []
    const nextThemes: ThemeContribution[] = []
    for (const entry of entries as PluginExtensionContribution[]) {
      nextUi.push(...entry.ui)
      nextThemes.push(...entry.themes)
    }
    uiContributions.value = nextUi
    themeContributions.value = nextThemes
  })()

  try {
    await syncInFlight.value
  } finally {
    syncInFlight.value = null
  }
}
