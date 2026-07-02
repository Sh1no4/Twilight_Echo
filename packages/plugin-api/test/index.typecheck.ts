import type {
  TwilightMediaProviderHealth,
  TwilightMediaProviderMethodHealth,
  TwilightMediaProviderRegistration,
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

const playbackUrlHealth: TwilightMediaProviderMethodHealth = {
  totalCalls: 10,
  successfulCalls: 8,
  failedCalls: 2,
  successRate: 0.8,
  lastError: 'HTTP 403',
  lastCheckedAt: '2026-07-02T00:00:00.000Z'
}

const providerHealth: TwilightMediaProviderHealth = {
  providerId: 'example',
  pluginId: 'com.example.provider',
  pluginStatus: 'enabled',
  available: true,
  totalCalls: 14,
  successfulCalls: 11,
  failedCalls: 3,
  successRate: 11 / 14,
  methodStats: {
    getPlaybackUrl: playbackUrlHealth
  },
  lastError: null,
  lastCheckedAt: '2026-07-02T00:00:00.000Z'
}

const providerRegistration: TwilightMediaProviderRegistration = {
  id: 'example',
  name: 'Example Provider',
  capabilities: ['search', 'playbackUrl'],
  health: providerHealth
}

void extensionContribution
void providerRegistration
