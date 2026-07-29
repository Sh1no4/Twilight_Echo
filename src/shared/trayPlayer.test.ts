import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeTrayNavigationTarget } from './trayPlayer.ts'

test('tray navigation accepts only built-in app surfaces', () => {
  assert.equal(normalizeTrayNavigationTarget('local'), 'local')
  assert.equal(normalizeTrayNavigationTarget('streaming'), 'streaming')
  assert.equal(normalizeTrayNavigationTarget('settings'), 'settings')
  assert.equal(normalizeTrayNavigationTarget('plugins'), null)
  assert.equal(normalizeTrayNavigationTarget({ target: 'local' }), null)
})
