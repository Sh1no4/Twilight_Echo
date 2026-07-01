import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const managerSource = readFileSync(new URL('./manager.ts', import.meta.url), 'utf8')

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

test('plugin manager blocks bundled plugin uninstall while allowing disable', () => {
  assert.match(managerSource, /async disable\(id: string\)/)
  assert.match(managerSource, /async uninstall\(id: string/)
  assert.match(managerSource, /this\.isBundledPluginId\(id\)/)
  assert.match(managerSource, /自带插件不能卸载/)
})
