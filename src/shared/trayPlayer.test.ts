import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeTrayNavigationTarget } from './trayPlayer.ts'

test('tray navigation accepts only the built-in home surfaces', () => {
  assert.equal(normalizeTrayNavigationTarget('local'), 'local')
  assert.equal(normalizeTrayNavigationTarget('streaming'), 'streaming')
  assert.equal(normalizeTrayNavigationTarget('settings'), null)
  assert.equal(normalizeTrayNavigationTarget({ target: 'local' }), null)
})
