import assert from 'node:assert/strict'
import test from 'node:test'
import {
  APP_LOCALES,
  DEFAULT_LOCALE,
  matchSystemLocale,
  normalizeLanguagePreference,
  resolveLocale
} from './locale.ts'
import { MESSAGES } from './messages/index.ts'
import { catalogFor, createTranslator, formatMessage, hasMessage, translate } from './translate.ts'

test('substitutes placeholders and keeps unfilled ones visible', () => {
  assert.equal(formatMessage('{a} then {b}', { a: 'one', b: 'two' }), 'one then two')
  assert.equal(formatMessage('count {n}', { n: 3 }), 'count 3')
  // A missing param must not print "undefined" — a visible {b} reads as a bug,
  // "undefined" reads as a crash.
  assert.equal(formatMessage('{a} then {b}', { a: 'one' }), 'one then {b}')
  assert.equal(formatMessage('{a}', { a: null }), '{a}')
  assert.equal(formatMessage('no placeholders'), 'no placeholders')
})

test('falls back through locale then key, never to blank', () => {
  assert.equal(translate('en-US', 'settings.language.title'), 'Language')
  assert.equal(translate('zh-CN', 'settings.language.title'), '语言')
  // An unknown key returns itself so a missing entry is diagnosable from a
  // screenshot instead of rendering empty chrome.
  assert.equal(translate('en-US', 'nope.not.here'), 'nope.not.here')
  assert.equal(translate('zh-CN', 'nope.not.here'), 'nope.not.here')
})

test('every shipped locale carries exactly the same key set', () => {
  const baseline = Object.keys(MESSAGES[DEFAULT_LOCALE]).sort()
  assert.ok(baseline.length > 100, 'baseline catalog should be substantial')
  for (const locale of APP_LOCALES) {
    const keys = Object.keys(MESSAGES[locale]).sort()
    assert.deepEqual(
      keys.filter((key) => !baseline.includes(key)),
      [],
      `${locale} has keys missing from ${DEFAULT_LOCALE}`
    )
    assert.deepEqual(
      baseline.filter((key) => !keys.includes(key)),
      [],
      `${locale} is missing keys present in ${DEFAULT_LOCALE}`
    )
  }
})

test('no catalog entry is blank, and placeholders agree across locales', () => {
  const placeholders = (template: string): string[] =>
    [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
  for (const key of Object.keys(MESSAGES[DEFAULT_LOCALE])) {
    const expected = placeholders(MESSAGES[DEFAULT_LOCALE][key])
    for (const locale of APP_LOCALES) {
      const template = MESSAGES[locale][key]
      assert.equal(typeof template, 'string', `${locale}:${key} must be a string`)
      // `fix: ''` is a deliberate "user cannot act on this" marker, so empty is
      // allowed — but it must be empty in every locale, not just one.
      if (MESSAGES[DEFAULT_LOCALE][key] === '') {
        assert.equal(template, '', `${locale}:${key} must be empty in every locale`)
        continue
      }
      assert.notEqual(template.trim(), '', `${locale}:${key} must not be blank`)
      assert.deepEqual(placeholders(template), expected, `${locale}:${key} placeholder mismatch`)
    }
  }
})

test('maps system locales by primary subtag', () => {
  assert.equal(matchSystemLocale('zh-CN'), 'zh-CN')
  assert.equal(matchSystemLocale('zh-Hans-CN'), 'zh-CN')
  assert.equal(matchSystemLocale('zh-TW'), 'zh-CN')
  assert.equal(matchSystemLocale('en-GB'), 'en-US')
  assert.equal(matchSystemLocale('en_US'), 'en-US')
  assert.equal(matchSystemLocale('ja-JP'), null)
  assert.equal(matchSystemLocale(''), null)
  assert.equal(matchSystemLocale(undefined), null)
})

test('resolves preference against the system locale', () => {
  assert.equal(resolveLocale('en-US', 'zh-CN'), 'en-US', 'explicit choice wins over system')
  assert.equal(resolveLocale('system', 'en-GB'), 'en-US')
  assert.equal(resolveLocale('system', 'ja-JP'), 'zh-CN', 'unshipped system locale falls back')
  assert.equal(resolveLocale(undefined, 'en-US'), 'en-US', 'absent preference means system')
  assert.equal(resolveLocale('garbage', 'en-US'), 'en-US')
})

test('normalizes persisted preferences, tolerating region-qualified tags', () => {
  assert.equal(normalizeLanguagePreference('system'), 'system')
  assert.equal(normalizeLanguagePreference('en-US'), 'en-US')
  assert.equal(normalizeLanguagePreference('zh-Hans-CN'), 'zh-CN')
  assert.equal(normalizeLanguagePreference(null), 'system')
  assert.equal(normalizeLanguagePreference(42), 'system')
})

test('catalogFor and bound translators agree with translate', () => {
  assert.equal(catalogFor('en-US')['settings.language.title'], 'Language')
  const t = createTranslator('en-US')
  assert.equal(t('settings.language.title'), translate('en-US', 'settings.language.title'))
  assert.ok(hasMessage('settings.language.title'))
  assert.equal(hasMessage('nope.not.here'), false)
})
