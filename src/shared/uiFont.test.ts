import assert from 'node:assert/strict'
import test from 'node:test'
import {
  UI_FONT_FAMILY_STACKS,
  isUiFontFamily,
  normalizeUiFontFamily,
  resolveUiFontStack
} from './uiFont.ts'

test('the default UI font resolves to the real OS system stack', () => {
  assert.equal(resolveUiFontStack('system'), UI_FONT_FAMILY_STACKS.system)
  assert.match(resolveUiFontStack('system'), /^system-ui, -apple-system, BlinkMacSystemFont/)
  assert.match(resolveUiFontStack('system'), /'Segoe UI'/)
  assert.match(resolveUiFontStack('system'), /'Microsoft YaHei'/)
  // The default must never route through the packaged Inter face.
  assert.doesNotMatch(resolveUiFontStack('system'), /Inter/)
})

test('known builtin fonts resolve to their packaged stack with CJK fallback', () => {
  assert.match(resolveUiFontStack('inter'), /^'Inter', 'Plus Jakarta Sans', 'MiSans'/)
  assert.match(resolveUiFontStack('lxgw'), /^'LXGW WenKai', 'MiSans'/)
  assert.match(resolveUiFontStack('sarasa'), /^'Sarasa Gothic SC', 'MiSans'/)
  assert.match(resolveUiFontStack('comic'), /^'Comic Sans MS', 'MiSans'/)
  for (const family of ['inter', 'lxgw', 'sarasa', 'comic'] as const) {
    assert.equal(resolveUiFontStack(family), UI_FONT_FAMILY_STACKS[family])
  }
})

test('unknown or invalid font values fall back to the system stack', () => {
  assert.equal(resolveUiFontStack(''), UI_FONT_FAMILY_STACKS.system)
  assert.equal(resolveUiFontStack('totally-not-a-font'), UI_FONT_FAMILY_STACKS.system)
  assert.equal(resolveUiFontStack('  '), UI_FONT_FAMILY_STACKS.system)
})

test('font value validation only admits known families', () => {
  for (const family of ['system', 'inter', 'lxgw', 'sarasa', 'comic']) {
    assert.ok(isUiFontFamily(family), `${family} should be accepted`)
  }
  assert.ok(!isUiFontFamily('Comic Sans MS'))
  assert.ok(!isUiFontFamily(''))
  assert.ok(!isUiFontFamily(42))
  assert.ok(!isUiFontFamily(null))
  assert.ok(!isUiFontFamily(undefined))
})

test('normalization clamps unknown values to a fallback family', () => {
  assert.equal(normalizeUiFontFamily('system'), 'system')
  assert.equal(normalizeUiFontFamily('inter'), 'inter')
  assert.equal(normalizeUiFontFamily('user injected font'), 'system')
  assert.equal(normalizeUiFontFamily(undefined), 'system')
  assert.equal(normalizeUiFontFamily('evil', 'comic'), 'comic')
})
