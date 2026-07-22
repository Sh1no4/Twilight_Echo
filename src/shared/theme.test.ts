import assert from 'node:assert/strict'
import test from 'node:test'
import {
  THEME_TOKEN_DEFINITIONS,
  TWILIGHT_DEFAULT_THEME,
  TWILIGHT_DEFAULT_THEME_ID,
  createDefaultThemeLibraryDocument,
  normalizeStructuredPluginTheme,
  normalizeThemeLibraryDocument,
  normalizeThemeProfile,
  normalizeThemeSelection,
  normalizeThemeTokenOverrides,
  resolveThemeProfileTokens,
  themeTokensToCssVariables
} from './theme.ts'

test('the immutable built-in theme preserves the current light and dark root values', () => {
  assert.equal(TWILIGHT_DEFAULT_THEME.id, TWILIGHT_DEFAULT_THEME_ID)
  assert.equal(TWILIGHT_DEFAULT_THEME.variants.pureWhite.tokens['color.primary.500'], '#2563eb')
  assert.equal(TWILIGHT_DEFAULT_THEME.variants.dark.tokens['color.primary.500'], '#f59e0b')
  assert.equal(TWILIGHT_DEFAULT_THEME.variants.pureWhite.tokens['surface.card'], '#ffffff')
  assert.equal(TWILIGHT_DEFAULT_THEME.variants.dark.tokens['surface.card'], '#181818')
  assert.equal(
    Object.keys(TWILIGHT_DEFAULT_THEME.variants.dark.tokens).length,
    THEME_TOKEN_DEFINITIONS.length
  )
})

test('theme profiles keep sparse known-token overrides and reject unsafe values', () => {
  const profile = normalizeThemeProfile({
    schemaVersion: 1,
    id: 'user:studio',
    name: 'Studio',
    description: 'Custom',
    baseThemeId: TWILIGHT_DEFAULT_THEME_ID,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    overrides: {
      pureWhite: {
        'color.primary.500': '#123456',
        unknown: '#ffffff'
      },
      dark: {
        'surface.card': 'url(https://example.com/card.png)',
        'shape.cardRadius': '12px'
      }
    }
  })

  assert.ok(profile)
  assert.equal(resolveThemeProfileTokens(profile, 'pureWhite')['color.primary.500'], '#123456')
  assert.equal(resolveThemeProfileTokens(profile, 'pureWhite')['surface.card'], '#ffffff')
  assert.equal(resolveThemeProfileTokens(profile, 'dark')['shape.cardRadius'], '12px')
  assert.equal(resolveThemeProfileTokens(profile, 'dark')['surface.app'], '#17181a')
  assert.equal(
    Object.keys(resolveThemeProfileTokens(profile, 'dark')).length,
    THEME_TOKEN_DEFINITIONS.length
  )
  assert.deepEqual(themeTokensToCssVariables(profile.overrides.pureWhite), {
    '--te-primary-500': '#123456'
  })
})

test('theme profiles keep only local typed assets and valid visual bindings', () => {
  const profile = normalizeThemeProfile({
    schemaVersion: 1,
    id: 'user:assets',
    name: 'Assets',
    baseThemeId: TWILIGHT_DEFAULT_THEME_ID,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    overrides: { pureWhite: {}, dark: {} },
    assets: [
      { id: 'backdrop', path: 'backdrop.webp', type: 'image' },
      { id: 'sans', path: 'fonts/sans.woff2', type: 'font' },
      { id: 'escape', path: '../secret.png', type: 'image' },
      { id: 'remote', path: 'https://example.com/a.png', type: 'image' }
    ],
    assetBindings: {
      appBackground: 'backdrop',
      sansFont: 'sans',
      playerBackground: 'sans',
      displayFont: 'missing'
    }
  })

  assert.ok(profile)
  assert.deepEqual(profile.assets, [
    { id: 'backdrop', path: 'backdrop.webp', type: 'image' },
    { id: 'sans', path: 'fonts/sans.woff2', type: 'font' }
  ])
  assert.deepEqual(profile.assetBindings, { appBackground: 'backdrop', sansFont: 'sans' })
})

test('theme library normalization falls back from missing user themes without deleting profiles', () => {
  const defaults = createDefaultThemeLibraryDocument()
  const normalized = normalizeThemeLibraryDocument({
    ...defaults,
    activeTheme: { kind: 'user', id: 'user:missing' },
    profiles: []
  })

  assert.deepEqual(normalized.activeTheme, { kind: 'builtin', id: TWILIGHT_DEFAULT_THEME_ID })
  assert.deepEqual(normalized.profiles, [])
})

test('numeric and length token constraints are enforced', () => {
  assert.deepEqual(
    normalizeThemeTokenOverrides({
      'layout.uiScale': '1.05',
      'shape.cardRadius': '24px',
      'shape.cardBorderWidth': '4px',
      'typography.titleWeight': '950'
    }),
    {
      'layout.uiScale': '1.05',
      'shape.cardRadius': '24px'
    }
  )
})

test('legacy plugin selection migrates to the structured active theme contract', () => {
  assert.deepEqual(normalizeThemeSelection(undefined, 'com.example.theme:midnight'), {
    kind: 'plugin',
    pluginId: 'com.example.theme',
    themeId: 'midnight'
  })
  assert.deepEqual(normalizeThemeSelection(undefined, '../invalid'), {
    kind: 'builtin',
    id: TWILIGHT_DEFAULT_THEME_ID
  })
})

test('structured plugin themes keep only registered safe tokens and bounded window defaults', () => {
  assert.deepEqual(
    normalizeStructuredPluginTheme({
      schemaVersion: 1,
      variants: {
        pureWhite: {
          tokens: {
            'color.primary.500': '#123456',
            unknown: '#ffffff'
          }
        },
        dark: {
          tokens: {
            'surface.card': 'url(https://example.com/remote.png)'
          }
        }
      },
      windowDefaults: {
        miniPlayer: { cornerRadius: 999, borderColor: '#112233' },
        desktopLyrics: { fontSize: 4, shadow: false }
      }
    }),
    {
      schemaVersion: 1,
      variants: { pureWhite: { tokens: { 'color.primary.500': '#123456' } } },
      windowDefaults: {
        miniPlayer: {
          accentColor: undefined,
          primaryTextColor: undefined,
          mutedTextColor: undefined,
          surfaceOpacity: undefined,
          glassBlur: undefined,
          cornerRadius: 36,
          borderWidth: undefined,
          borderColor: '#112233',
          shadowStrength: undefined
        },
        desktopLyrics: {
          fontFamily: undefined,
          fontSize: 12,
          fontWeight: undefined,
          color: undefined,
          highlightColor: undefined,
          backgroundColor: undefined,
          backgroundOpacity: undefined,
          shadow: false,
          shadowBlur: undefined,
          shadowColor: undefined
        }
      }
    }
  )
})
