import type {
  TwilightPluginExtensionContribution,
  TwilightUiContribution,
  TwilightUiContributionKind
} from '../src/index'

const localSidebarKind: TwilightUiContributionKind = 'localSidebarItem'
const streamingHomeKind: TwilightUiContributionKind = 'streamingHome'

const localSidebarContribution: TwilightUiContribution = {
  id: 'example.local',
  kind: localSidebarKind,
  title: 'Local Tool',
  command: 'example.local.open',
  renderMode: 'html',
  autoLoad: true
}

const streamingHomeContribution: TwilightUiContribution = {
  id: 'example.streaming',
  kind: streamingHomeKind,
  title: 'Streaming Tool',
  command: 'example.streaming.open'
}

const extensionContribution: TwilightPluginExtensionContribution = {
  pluginId: 'com.example.ui',
  ui: [localSidebarContribution, streamingHomeContribution],
  themes: []
}

void extensionContribution
