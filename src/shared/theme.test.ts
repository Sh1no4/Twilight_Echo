import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BUILT_IN_THEME_FONTS,
  THEME_ACCENT_PALETTES,
  THEME_BACKGROUND_PALETTES,
  THEME_TOKEN_DEFINITIONS,
  TWILIGHT_DEFAULT_THEME,
  TWILIGHT_DEFAULT_THEME_ID,
  createThemeAccentTokenOverrides,
  createDefaultThemeLibraryDocument,
  normalizeThemeModes,
  normalizeStructuredPluginTheme,
  normalizeThemeLibraryDocument,
  normalizeThemeProfile,
  normalizeThemeToneSchedule,
  normalizeThemeSelection,
  normalizeThemeTokenOverrides,
  resolveThemeProfileModes,
  resolveThemeProfileTokens,
  resolveScheduledThemeTone,
  ensureThemeTextContrast,
  themeContrastRatio,
  themeModesToDataAttributes,
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
  assert.equal(profile.schemaVersion, 2)
  assert.deepEqual(profile.modes, {})
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
      'material.surfaceOpacity': '72%',
      'background.gradientAngle': '270deg',
      'background.coverBlur': '65px',
      'shape.cardRadius': '24px',
      'shape.dialogRadius': '12px',
      'shape.cardBorderWidth': '4px',
      'typography.titleWeight': '950',
      'color.primary.500': 'not-a-color'
    }),
    {
      'layout.uiScale': '1.05',
      'material.surfaceOpacity': '72%',
      'background.gradientAngle': '270deg',
      'shape.cardRadius': '24px',
      'shape.dialogRadius': '12px'
    }
  )
})

test('v2 theme modes are sparse, whitelisted, and map only to managed attributes', () => {
  const profile = normalizeThemeProfile({
    schemaVersion: 2,
    id: 'user:modes',
    name: 'Modes',
    description: '',
    baseThemeId: TWILIGHT_DEFAULT_THEME_ID,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    overrides: { pureWhite: {}, dark: {} },
    toneSchedule: { lightStartMinutes: 390, darkStartMinutes: 1230 },
    modes: {
      appearance: { backgroundTreatment: 'image', unknown: 'unsafe' },
      navigation: { style: 'rail', iconScale: 'huge' },
      typography: { titleCase: 'uppercase', lyricAccent: 'accent', titleColor: 'unsafe' },
      player: { layout: 'script:alert(1)' },
      visibility: { playerArtwork: false, arbitraryDomNode: false }
    }
  })

  assert.ok(profile)
  assert.deepEqual(profile.modes, {
    appearance: { backgroundTreatment: 'image' },
    navigation: { style: 'rail' },
    typography: { titleCase: 'uppercase', lyricAccent: 'accent' },
    visibility: { playerArtwork: false }
  })
  assert.deepEqual(profile.toneSchedule, { lightStartMinutes: 390, darkStartMinutes: 1230 })
  const attributes = themeModesToDataAttributes(resolveThemeProfileModes(profile))
  assert.equal(attributes['data-te-background-treatment'], 'image')
  assert.equal(attributes['data-te-navigation-style'], 'rail')
  assert.equal(attributes['data-te-title-case'], 'uppercase')
  assert.equal(attributes['data-te-lyric-accent'], 'accent')
  assert.equal(attributes['data-te-player-layout'], 'standard')
  assert.equal(attributes['data-te-visible-player-artwork'], 'false')
  assert.equal(
    Object.keys(attributes).some((name) => name.includes('unknown')),
    false
  )
  assert.equal(
    Object.keys(attributes).some((name) => name.includes('arbitrary')),
    false
  )
})

test('timed tone schedules are bounded and switch correctly across midnight', () => {
  assert.deepEqual(
    normalizeThemeToneSchedule({ lightStartMinutes: 420, darkStartMinutes: 1140 }),
    { lightStartMinutes: 420, darkStartMinutes: 1140 }
  )
  assert.equal(
    normalizeThemeToneSchedule({ lightStartMinutes: 1440, darkStartMinutes: 1140 }),
    undefined
  )
  assert.equal(
    normalizeThemeToneSchedule({ lightStartMinutes: 420, darkStartMinutes: 420 }),
    undefined
  )
  const schedule = { lightStartMinutes: 7 * 60, darkStartMinutes: 19 * 60 }
  assert.equal(resolveScheduledThemeTone(new Date(2026, 0, 1, 6, 59), schedule), 'dark')
  assert.equal(resolveScheduledThemeTone(new Date(2026, 0, 1, 7, 0), schedule), 'pureWhite')
  assert.equal(resolveScheduledThemeTone(new Date(2026, 0, 1, 18, 59), schedule), 'pureWhite')
  assert.equal(resolveScheduledThemeTone(new Date(2026, 0, 1, 19, 0), schedule), 'dark')
})

test('phase two palettes and built-in fonts are broad UI shortcuts, not schema values', () => {
  assert.ok(THEME_ACCENT_PALETTES.pureWhite.length >= 16)
  assert.ok(THEME_ACCENT_PALETTES.dark.length >= 16)
  assert.ok(THEME_BACKGROUND_PALETTES.pureWhite.length >= 16)
  assert.ok(THEME_BACKGROUND_PALETTES.dark.length >= 16)
  assert.ok(BUILT_IN_THEME_FONTS.some((font) => font.category === 'serif'))
  assert.ok(BUILT_IN_THEME_FONTS.some((font) => font.category === 'mono'))
  assert.ok(BUILT_IN_THEME_FONTS.some((font) => font.category === 'display'))
  const profile = normalizeThemeProfile({
    schemaVersion: 2,
    id: 'user:palette',
    name: 'Palette',
    baseThemeId: TWILIGHT_DEFAULT_THEME_ID,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    overrides: { pureWhite: {}, dark: {} },
    modes: {},
    paletteId: 'must-not-persist'
  })
  assert.ok(profile)
  assert.equal('paletteId' in profile, false)
})

test('adaptive accents and contrast enforcement produce bounded readable host colors', () => {
  const fixed = createThemeAccentTokenOverrides('#2563eb', 'pureWhite', '#f4f4f7')
  assert.equal(fixed['color.primary.500'], '#2563eb')
  assert.equal(fixed['color.primary.rgb'], '37, 99, 235')
  assert.equal(fixed['navigation.indicator'], '#2563eb')
  const adaptive = createThemeAccentTokenOverrides('#f6f7f8', 'pureWhite', '#ffffff', true)
  assert.equal(adaptive['color.primary.500'], '#2563eb')
  assert.ok((themeContrastRatio('#111827', '#ffffff') ?? 0) >= 4.5)
  assert.equal(ensureThemeTextContrast('#eeeeee', '#ffffff'), '#111827')
  assert.equal(ensureThemeTextContrast('#222222', '#111111'), '#f8fafc')
})

test('unknown profile versions fail closed while mode normalization accepts no arbitrary fields', () => {
  assert.equal(
    normalizeThemeProfile({ schemaVersion: 99, id: 'user:future', name: 'Future' }),
    null
  )
  assert.deepEqual(normalizeThemeModes({ prototype: { polluted: true } }), {})
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
