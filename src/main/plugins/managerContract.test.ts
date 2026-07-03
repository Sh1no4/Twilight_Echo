import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const managerSource = readFileSync(new URL('./manager.ts', import.meta.url), 'utf8')
const pluginHostSource = readFileSync(new URL('../pluginHost.ts', import.meta.url), 'utf8')

test('plugin manager keeps UI command failures isolated to the owning plugin', () => {
  assert.match(managerSource, /const PLUGIN_UI_COMMAND_TIMEOUT_MS = 5000/)
  assert.match(managerSource, /UI command 调用超时/)
  assert.match(managerSource, /this\.markFailed\(\s*running\.descriptor\.id/)
  assert.match(managerSource, /void this\.stopPlugin\(running\.descriptor\.id\)/)
})

test('plugin manager enforces controlled UI and theme extension contracts', () => {
  assert.match(managerSource, /permissions\.includes\('ui:inject'\)/)
  assert.match(managerSource, /'localSidebarItem'/)
  assert.match(managerSource, /'streamingHome'/)
  assert.match(managerSource, /record\.renderMode === 'html' \? 'html' : 'command'/)
  assert.match(managerSource, /this\.resolveThemeStylesheet/)
  assert.match(managerSource, /isInsidePath\(stylesheetPath, descriptor\.paths\.versionRoot\)/)
  assert.match(managerSource, /\^--te-\[a-z0-9-_\]\+\$/)
})

test('plugin manager enforces plugin API namespace permissions at the gateway', () => {
  assert.match(managerSource, /private requirePermission\(/)
  assert.match(managerSource, /'player:observe'/)
  assert.match(managerSource, /'player:control'/)
  assert.match(managerSource, /this\.requirePermission\(id,\s*'player:observe'/)
  assert.match(managerSource, /this\.requirePermission\(id,\s*'player:control'/)
  assert.match(managerSource, /message\.kind === 'api-event-subscribe'[\s\S]*this\.requirePermission\(id,\s*'player:observe'/)
})

test('plugin host enforces declared settings permission before private settings access', () => {
  assert.match(pluginHostSource, /message\.manifest\.permissions/)
  assert.match(pluginHostSource, /createSettingsApi\(/)
  assert.match(pluginHostSource, /requireLocalPermission\([^)]*'settings'/)
})

test('plugin manager exposes declarative manifest themes without executing theme scripts', () => {
  assert.match(managerSource, /normalizeDeclarativeThemeContributions/)
  assert.match(managerSource, /descriptor\.contributes/)
  assert.match(managerSource, /manifest theme/)
})

test('plugin manager blocks bundled plugin uninstall while allowing disable', () => {
  assert.match(managerSource, /async disable\(id: string\)/)
  assert.match(managerSource, /async uninstall\(id: string/)
  assert.match(managerSource, /this\.isBundledPluginId\(id\)/)
  assert.match(managerSource, /自带插件不能卸载/)
})

test('plugin manager isolates startup failures and keeps other enabled plugins loading', () => {
  assert.match(managerSource, /private async scanAndStartEnabled\(\)/)
  assert.match(managerSource, /for \(const descriptor of startupPlan\.ordered\)/)
  assert.match(
    managerSource,
    /await this\.startPlugin\(descriptor\)\.catch\(\(error\) => \{\s*this\.markFailed\(descriptor\.id/
  )
})

test('plugin manager exposes per-plugin logs for troubleshooting', () => {
  assert.match(managerSource, /async openLog\(id: string\)/)
  assert.match(managerSource, /async getLog\(id: string\)/)
  assert.match(managerSource, /raw\.slice\(-20000\)/)
  assert.match(managerSource, /private appendLog\(descriptor: TwilightPluginDescriptor/)
  assert.match(managerSource, /logs', 'plugins'/)
})

test('plugin manager tracks provider health for calls and plugin failures', () => {
  assert.match(managerSource, /interface ProviderHealthRecord/)
  assert.match(managerSource, /private readonly providerHealth = new Map/)
  assert.match(managerSource, /private getProviderHealth\(/)
  assert.match(managerSource, /private normalizeProviderHealth\(/)
  assert.match(managerSource, /private recordProviderCallSuccess\(/)
  assert.match(managerSource, /private recordProviderCallFailure\(/)
  assert.match(managerSource, /interface ProviderMethodHealthRecord/)
  assert.match(managerSource, /methodStats:/)
  assert.match(managerSource, /successRate:/)
  assert.match(managerSource, /totalCalls:/)
  assert.match(managerSource, /failedCalls:/)
  assert.match(managerSource, /lastError:/)
  assert.match(managerSource, /pluginStatus:/)
  assert.match(managerSource, /const health = this\.normalizeProviderHealth\(record\.health,\s*providerId,\s*pluginId/)
  assert.match(managerSource, /if \(health\) this\.providerHealth\.set\(providerId,\s*health\)/)
  assert.match(managerSource, /this\.recordProviderCallSuccess\(pending\.providerId,\s*pending\.pluginId,\s*pending\.method/)
  assert.match(managerSource, /this\.recordProviderCallFailure\(\s*pending\.providerId,\s*pending\.pluginId,\s*pending\.method/)
  assert.match(managerSource, /health: this\.getProviderHealth/)
})

test('plugin host forwards provider health registration metadata', () => {
  assert.match(pluginHostSource, /health\?: Record<string, unknown>/)
  assert.match(pluginHostSource, /health: provider\.health/)
})
