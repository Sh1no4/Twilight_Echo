import assert from 'node:assert/strict'
import test from 'node:test'
import { themeModesToDataAttributes } from '../../../shared/theme.ts'
import { resolvePluginThemeRuntimeContract } from './pluginThemeRuntime.ts'

test('plugin theme runtime preserves API v1 variables and structured token precedence', () => {
  const contract = resolvePluginThemeRuntimeContract(
    {
      variables: { '--te-primary-500': '#111111' },
      structured: {
        schemaVersion: 1,
        variants: { dark: { tokens: { 'color.primary.500': '#60a5fa' } } }
      }
    },
    'dark'
  )

  assert.equal(contract.variables['--te-primary-500'], '#60a5fa')
  assert.equal(contract.modes.player?.layout, 'standard')
  assert.equal(contract.usesStructuredModes, false)
})

test('plugin theme runtime maps normalized API v2 modes to host attributes', () => {
  const contract = resolvePluginThemeRuntimeContract(
    {
      structured: {
        schemaVersion: 2,
        variants: {},
        modes: {
          navigation: { style: 'rail' },
          player: { layout: 'split', controls: 'pro' },
          visibility: { playerDuration: false }
        }
      }
    },
    'dark'
  )
  const attributes = themeModesToDataAttributes(contract.modes)

  assert.equal(attributes['data-te-navigation-style'], 'rail')
  assert.equal(attributes['data-te-player-layout'], 'split')
  assert.equal(attributes['data-te-player-controls'], 'pro')
  assert.equal(attributes['data-te-visible-player-duration'], 'false')
  assert.equal(contract.usesStructuredModes, true)
})

test('plugin theme runtime exposes API v3 shell layouts without granting script access', () => {
  const contract = resolvePluginThemeRuntimeContract(
    {
      structured: {
        schemaVersion: 3,
        variants: {},
        layout: {
          desktop: {
            columns: ['standard', 'fill'],
            rows: ['auto', 'fill', 'auto'],
            areas: [
              ['titleBar', 'titleBar'],
              ['navigation', 'content'],
              ['navigation', 'playerBar']
            ]
          },
          navigation: 'persistent'
        }
      }
    },
    'dark'
  )

  assert.equal(contract.layout?.navigation, 'persistent')
  assert.deepEqual(contract.layout?.desktop.columns, ['standard', 'fill'])
  assert.equal(contract.usesStructuredModes, true)
})
