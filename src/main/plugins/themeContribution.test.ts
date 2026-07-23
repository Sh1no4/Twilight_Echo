import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeThemeContribution } from './themeContribution.ts'

test('plugin API v1 keeps legacy variables, stylesheet, and structured themes', () => {
  const contribution = normalizeThemeContribution({
    pluginApiVersion: 1,
    pluginTypes: ['theme'],
    source: 'manifest theme',
    resolveStylesheet: (stylesheet) => `C:/plugin/${stylesheet}`,
    raw: {
      id: 'legacy',
      name: 'Legacy',
      variables: { '--te-primary-500': '#2563eb' },
      stylesheet: 'theme.css',
      structured: {
        schemaVersion: 1,
        variants: { dark: { tokens: { 'color.primary.500': '#60a5fa' } } }
      }
    }
  })

  assert.equal(contribution.stylesheet, 'C:/plugin/theme.css')
  assert.equal(contribution.structured?.schemaVersion, 1)
  assert.deepEqual(contribution.variables, { '--te-primary-500': '#2563eb' })
  assert.equal(contribution.compatibilityNotes, undefined)
})

test('structured theme v2 requires plugin API v2 and filters unknown host modes', () => {
  const raw = {
    id: 'mode-theme',
    name: 'Mode Theme',
    structured: {
      schemaVersion: 2,
      variants: {},
      modes: {
        navigation: { style: 'rail', futureStyle: 'floating' },
        player: { layout: 'cinema', controls: 'pro' },
        visibility: { playerDuration: false, futureControl: false },
        futureDomain: { value: 'future' }
      }
    }
  }

  assert.throws(
    () =>
      normalizeThemeContribution({
        pluginApiVersion: 1,
        pluginTypes: ['theme'],
        source: 'manifest theme',
        resolveStylesheet: (stylesheet) => stylesheet,
        raw
      }),
    /apiVersion 2/
  )

  const contribution = normalizeThemeContribution({
    pluginApiVersion: 2,
    pluginTypes: ['theme'],
    source: 'manifest theme',
    resolveStylesheet: (stylesheet) => stylesheet,
    raw
  })
  assert.deepEqual(contribution.structured, {
    schemaVersion: 2,
    variants: {},
    modes: {
      navigation: { style: 'rail' },
      player: { controls: 'pro' },
      visibility: { playerDuration: false }
    }
  })
  assert.deepEqual(contribution.compatibilityNotes, [
    '主题 mode navigation.futureStyle 不受当前宿主支持，已忽略',
    '主题 mode player.layout 不受当前宿主支持，已忽略',
    '主题 mode visibility.futureControl 不受当前宿主支持，已忽略',
    '主题 mode futureDomain 不受当前宿主支持，已忽略'
  ])
})

test('schema v1 modes are ignored with a compatibility note', () => {
  const contribution = normalizeThemeContribution({
    pluginApiVersion: 2,
    pluginTypes: ['theme'],
    source: 'manifest theme',
    resolveStylesheet: (stylesheet) => stylesheet,
    raw: {
      id: 'mixed-version',
      name: 'Mixed Version',
      variables: { '--te-primary-500': '#2563eb' },
      structured: { schemaVersion: 1, variants: {}, modes: { navigation: { style: 'rail' } } }
    }
  })

  assert.deepEqual(contribution.compatibilityNotes, [
    'structured schemaVersion 1 不支持 modes，已忽略该字段'
  ])
})
