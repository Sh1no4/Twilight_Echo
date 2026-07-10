# Mini Player Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a resizable mini player with synchronized, per-theme customization for background, appearance, responsive layout, and element visibility in both the mini window and main Settings page.

**Architecture:** Keep window behavior and per-theme profiles in the shared normalized settings contract, with the main process as the persistence authority. Reuse one controlled Vue customizer and one draft composable in both renderer surfaces, while keeping responsive presentation calculations in pure tested helpers and preserving the mini document's restricted preload boundary.

**Tech Stack:** Electron 39, Vue 3 Composition API, TypeScript 5.9, CSS custom properties, Node `node:test`, existing `background://` protocol and background cache.

---

## File Structure

### Create

- `src/main/integrations/miniPlayerWindow.ts`: pure window-bound constants and clamping helpers.
- `src/main/integrations/miniPlayerWindow.test.ts`: window-bound and persistence-patch tests.
- `src/renderer/src/mini-player/presentation.ts`: pure responsive-layout, visibility, color, and CSS-variable helpers.
- `src/renderer/src/mini-player/presentation.test.ts`: presentation boundary and fallback tests.
- `src/renderer/src/mini-player/useMiniPlayerCustomizationDraft.ts`: reusable optimistic draft and persistence state machine.
- `src/renderer/src/mini-player/useMiniPlayerCustomizationDraft.test.ts`: draft, flush, rollback, undo, and reset tests.
- `src/renderer/src/mini-player/MiniPlayerCustomizer.vue`: controlled four-tab customization editor.
- `src/renderer/src/mini-player/MiniPlayerCustomizer.css`: compact overlay and inline editor styling.
- `src/renderer/src/mini-player/MiniPlayerCustomizer.test.ts`: static contract tests for control coverage and API isolation.
- `src/renderer/src/components/settings-page/MiniPlayerSettingsSection.vue`: main Settings host and adapter.

### Modify

- `src/shared/miniPlayer.ts`: persisted profile types, defaults, cloning, migration, and normalization.
- `src/shared/miniPlayer.test.ts`: migration and nested normalization tests.
- `src/renderer/src/mini-player/styles.ts`: connect style definitions to shared default profiles.
- `src/renderer/src/mini-player/styles.test.ts`: registry profile and surface contract tests.
- `src/main/integrations/miniPlayer.ts`: resizable window behavior, bounds persistence, safe image selection, and broadcasts.
- `src/main/audio/state.ts`: delegate live mini-player application to the integration module.
- `src/main/security/ipcValidation.test.ts`: restricted image-picker and sender-validation assertions.
- `src/preload/index.ts`: expose image selection only through the restricted mini-player API.
- `src/preload/index.d.ts`: update the hand-maintained mini-player API and settings types.
- `src/preload/types.ts`: consume the expanded shared settings contract.
- `src/main/core/types.ts`: continue re-exporting the expanded shared settings contract.
- `src/main/core/settings.ts`: normalize the expanded contract through the shared normalizer.
- `src/renderer/src/types/settings.ts`: continue re-exporting the expanded shared settings contract.
- `src/renderer/src/stores/useSettingsStore.ts`: update fallback settings and optimistic mini-player updates.
- `src/renderer/src/mini-player/MiniPlayerApp.vue`: host the draft/customizer and render responsive profile state.
- `src/renderer/src/mini-player/MiniPlayer.css`: background layers, layout modes, visibility, panel integration, and variable radius.
- `src/renderer/src/assets/main.css`: stop forcing the mini-player radius to a fixed native-corner value.
- `src/renderer/src/main.ts`: remove the obsolete native-corner query class.
- `src/renderer/src/components/SettingsPage.vue`: mount the focused Mini Player settings section under Appearance.
- `package.json`: append the new focused tests to the existing playback-routing test script without dropping current entries.

## Task 1: Shared Profile Model And Legacy Migration

**Files:**

- Modify: `src/shared/miniPlayer.ts`
- Modify: `src/shared/miniPlayer.test.ts`
- Modify: `src/renderer/src/stores/useSettingsStore.ts`
- Modify: `src/renderer/src/mini-player/MiniPlayerApp.vue`
- Modify: `src/main/integrations/miniPlayer.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: Write failing migration and normalization tests**

Add these focused cases to `src/shared/miniPlayer.test.ts`:

```ts
test('legacy mini player settings migrate into an independent active theme profile', () => {
  const settings = normalizeMiniPlayerSettings({
    windowX: 120,
    windowY: 80,
    windowWidth: 612,
    windowHeight: 244,
    alwaysOnTop: true,
    positionLocked: true,
    styleId: 'porcelain',
    backgroundColor: '#123456'
  })

  assert.equal(settings.activeStyleId, 'porcelain')
  assert.equal(settings.profiles.porcelain.background.solidColor, '#123456')
  assert.equal(settings.profiles.porcelain.background.fallbackColor, '#123456')
  assert.equal(settings.windowWidth, 612)
  assert.equal(settings.windowHeight, 244)
  assert.equal(settings.alwaysOnTop, true)
  assert.equal(settings.positionLocked, true)
})

test('mini player profiles clamp nested values and reject unsafe background urls', () => {
  const settings = normalizeMiniPlayerSettings({
    activeStyleId: 'aurora-glass',
    profiles: {
      'aurora-glass': {
        background: {
          kind: 'image',
          imageUrl: 'file:///D:/private/image.png',
          gradientAngle: 999,
          blur: -20,
          brightness: 400,
          saturation: -1,
          opacity: 150,
          overlayOpacity: -10
        },
        appearance: {
          accentMode: 'custom',
          accentColor: '#abcdef',
          textMode: 'custom',
          primaryTextColor: '#123456',
          mutedTextColor: '#654321',
          surfaceOpacity: 2,
          glassBlur: 99,
          cornerRadius: 80,
          borderWidth: 9,
          borderColor: '#111111',
          shadowStrength: -5
        },
        layout: { preference: 'wide' },
        visibility: { artwork: false, volume: false }
      }
    }
  })

  const profile = settings.profiles['aurora-glass']
  assert.equal(profile.background.imageUrl, '')
  assert.equal(profile.background.kind, 'solid')
  assert.equal(profile.background.gradientAngle, 360)
  assert.equal(profile.background.blur, 0)
  assert.equal(profile.background.brightness, 150)
  assert.equal(profile.background.saturation, 0)
  assert.equal(profile.background.opacity, 100)
  assert.equal(profile.background.overlayOpacity, 0)
  assert.equal(profile.appearance.surfaceOpacity, 40)
  assert.equal(profile.appearance.glassBlur, 40)
  assert.equal(profile.appearance.cornerRadius, 36)
  assert.equal(profile.appearance.borderWidth, 3)
  assert.equal(profile.appearance.shadowStrength, 0)
  assert.equal(profile.visibility.artwork, false)
  assert.equal(profile.visibility.album, true)
})

test('mini player profile normalization is idempotent and clones defaults', () => {
  const first = normalizeMiniPlayerSettings({ activeStyleId: 'aurora-glass' })
  const second = normalizeMiniPlayerSettings(first)
  assert.deepEqual(second, first)

  const left = createDefaultMiniPlayerThemeProfile('aurora-glass')
  const right = createDefaultMiniPlayerThemeProfile('aurora-glass')
  left.background.solidColor = '#000000'
  assert.notEqual(right.background.solidColor, '#000000')
})
```

Replace the existing flat `assert.deepEqual(settings, ...)` expectation with assertions against the new top-level geometry/behavior fields and the normalized active profile. Keep the existing command and playback-state tests unchanged.

- [ ] **Step 2: Run the shared test and verify failure**

Run:

```powershell
node --experimental-strip-types --test src/shared/miniPlayer.test.ts
```

Expected: FAIL because `activeStyleId`, `profiles`, and `createDefaultMiniPlayerThemeProfile` do not exist.

- [ ] **Step 3: Define the persisted profile contract and defaults**

In `src/shared/miniPlayer.ts`, replace the flat style fields with these exported contracts and keep geometry/behavior global:

```ts
export type MiniPlayerBackgroundKind = 'solid' | 'gradient' | 'cover' | 'image'
export type MiniPlayerImageFit = 'cover' | 'contain'
export type MiniPlayerLayoutPreference = 'auto' | 'compact' | 'standard' | 'wide'

export interface MiniPlayerBackgroundSettings {
  kind: MiniPlayerBackgroundKind
  solidColor: string
  fallbackColor: string
  gradientStart: string
  gradientEnd: string
  gradientAngle: number
  imageUrl: string
  imageFit: MiniPlayerImageFit
  blur: number
  brightness: number
  saturation: number
  opacity: number
  overlayColor: string
  overlayOpacity: number
}

export interface MiniPlayerAppearanceSettings {
  accentMode: 'track' | 'custom'
  accentColor: string
  textMode: 'auto' | 'custom'
  primaryTextColor: string
  mutedTextColor: string
  surfaceOpacity: number
  glassBlur: number
  cornerRadius: number
  borderWidth: number
  borderColor: string
  shadowStrength: number
}

export interface MiniPlayerLayoutSettings {
  preference: MiniPlayerLayoutPreference
}

export interface MiniPlayerVisibilitySettings {
  artwork: boolean
  album: boolean
  playbackState: boolean
  equalizer: boolean
  time: boolean
  volume: boolean
  playMode: boolean
  queuePosition: boolean
}

export interface MiniPlayerThemeProfile {
  background: MiniPlayerBackgroundSettings
  appearance: MiniPlayerAppearanceSettings
  layout: MiniPlayerLayoutSettings
  visibility: MiniPlayerVisibilitySettings
}

export interface MiniPlayerSettings {
  windowX: number
  windowY: number
  windowWidth: number
  windowHeight: number
  alwaysOnTop: boolean
  positionLocked: boolean
  activeStyleId: string
  profiles: Record<string, MiniPlayerThemeProfile>
}
```

Declare the built-in defaults with these exact values:

```ts
const DEFAULT_MINI_PLAYER_VISIBILITY: MiniPlayerVisibilitySettings = {
  artwork: true,
  album: true,
  playbackState: true,
  equalizer: true,
  time: true,
  volume: true,
  playMode: true,
  queuePosition: false
}

export const DEFAULT_MINI_PLAYER_THEME_PROFILES: Readonly<
  Record<string, MiniPlayerThemeProfile>
> = Object.freeze({
  'aurora-glass': {
    background: {
      kind: 'cover',
      solidColor: '#11121d',
      fallbackColor: '#11121d',
      gradientStart: '#20182f',
      gradientEnd: '#0a0c18',
      gradientAngle: 138,
      imageUrl: '',
      imageFit: 'cover',
      blur: 32,
      brightness: 100,
      saturation: 145,
      opacity: 36,
      overlayColor: '#070812',
      overlayOpacity: 42
    },
    appearance: {
      accentMode: 'track',
      accentColor: '#7c4dff',
      textMode: 'auto',
      primaryTextColor: '#ffffff',
      mutedTextColor: '#b8b7c2',
      surfaceOpacity: 94,
      glassBlur: 18,
      cornerRadius: 25,
      borderWidth: 1,
      borderColor: '#353542',
      shadowStrength: 80
    },
    layout: { preference: 'auto' },
    visibility: { ...DEFAULT_MINI_PLAYER_VISIBILITY }
  },
  porcelain: {
    background: {
      kind: 'cover',
      solidColor: '#f4f5fb',
      fallbackColor: '#f4f5fb',
      gradientStart: '#ffffff',
      gradientEnd: '#f1f3fc',
      gradientAngle: 145,
      imageUrl: '',
      imageFit: 'cover',
      blur: 32,
      brightness: 108,
      saturation: 110,
      opacity: 18,
      overlayColor: '#f5f7ff',
      overlayOpacity: 58
    },
    appearance: {
      accentMode: 'custom',
      accentColor: '#5966d9',
      textMode: 'auto',
      primaryTextColor: '#1b2034',
      mutedTextColor: '#656a7b',
      surfaceOpacity: 97,
      glassBlur: 14,
      cornerRadius: 25,
      borderWidth: 1,
      borderColor: '#d7d9e5',
      shadowStrength: 35
    },
    layout: { preference: 'auto' },
    visibility: { ...DEFAULT_MINI_PLAYER_VISIBILITY }
  }
})
```

Export exact clone/default helpers:

```ts
export function cloneMiniPlayerThemeProfile(
  profile: MiniPlayerThemeProfile
): MiniPlayerThemeProfile {
  return {
    background: { ...profile.background },
    appearance: { ...profile.appearance },
    layout: { ...profile.layout },
    visibility: { ...profile.visibility }
  }
}

export function createDefaultMiniPlayerThemeProfile(styleId: string): MiniPlayerThemeProfile {
  return cloneMiniPlayerThemeProfile(
    DEFAULT_MINI_PLAYER_THEME_PROFILES[styleId] ??
      DEFAULT_MINI_PLAYER_THEME_PROFILES[DEFAULT_MINI_PLAYER_STYLE_ID]
  )
}

export function cloneMiniPlayerSettings(settings: MiniPlayerSettings): MiniPlayerSettings {
  return {
    ...settings,
    profiles: Object.fromEntries(
      Object.entries(settings.profiles).map(([id, profile]) => [
        id,
        cloneMiniPlayerThemeProfile(profile)
      ])
    )
  }
}
```

Update `MiniPlayerSettingsPatch` so it admits only `alwaysOnTop`, `positionLocked`, `activeStyleId`, `profiles`, `windowWidth`, and `windowHeight`.

- [ ] **Step 4: Implement nested normalization and legacy migration**

Make `normalizeMiniPlayerSettings` detect legacy `styleId`/`backgroundColor`, normalize every profile independently, preserve syntactically safe unknown profile IDs, and always ensure the two built-in profiles exist.

Export `normalizeMiniPlayerThemeProfile(raw, fallback)` so the renderer theme registry can validate registered default profiles without duplicating the rules.

Use these exact validation rules:

```ts
function normalizeBackgroundImageUrl(value: unknown): string {
  const url = normalizeText(value, 512)
  return /^background:\/\/[a-z0-9._-]+$/i.test(url) ? url : ''
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeLayoutPreference(
  value: unknown,
  fallback: MiniPlayerLayoutPreference
): MiniPlayerLayoutPreference {
  return value === 'compact' || value === 'standard' || value === 'wide' || value === 'auto'
    ? value
    : fallback
}
```

If normalized `kind` is `image` but `imageUrl` is empty, fall back to `solid`. Clamp all ranges exactly as specified in the design. For auto text mode, preserve validated custom colors even though they are inactive so toggling modes is reversible.

- [ ] **Step 5: Update renderer fallback settings and manual preload declarations**

Replace the flat mini-player fallback in `src/renderer/src/stores/useSettingsStore.ts` with a clone of the shared default shape. Update the hand-maintained declarations in `src/preload/index.d.ts` to mirror the new shared interfaces and patch keys.

Set the fallback field directly from the shared constant:

```ts
miniPlayer: cloneMiniPlayerSettings(DEFAULT_MINI_PLAYER_SETTINGS)
```

Import and call `cloneMiniPlayerSettings(DEFAULT_MINI_PLAYER_SETTINGS)` in the store so the nested defaults cannot be mutated.

Update immediate compile consumers in the same task:

```ts
// MiniPlayerApp.vue
const activeStyle = computed(() => resolveMiniPlayerStyle(settings.value.activeStyleId))

function switchStyle(): void {
  const nextStyle = getNextMiniPlayerStyle(activeStyle.value.id)
  void updateWindowSettings({ activeStyleId: nextStyle.id })
}
```

```ts
// src/main/integrations/miniPlayer.ts
function getMiniPlayerFallbackColor(settings: MiniPlayerSettings): string {
  return (
    settings.profiles[settings.activeStyleId]?.background.fallbackColor ??
    settings.profiles[DEFAULT_MINI_PLAYER_STYLE_ID]?.background.fallbackColor ??
    '#11121d'
  )
}
```

Use `getMiniPlayerFallbackColor(settings)` at the existing native background-color call sites. Replace `styleId`/`backgroundColor` in the allowed patch list with `activeStyleId`/`profiles`. Do not change resizing or renderer layout behavior yet.

- [ ] **Step 6: Run the shared tests and typecheck**

Run:

```powershell
node --experimental-strip-types --test src/shared/miniPlayer.test.ts
npm run typecheck:node
npm run typecheck:web
```

Expected: all commands PASS. Do not commit while either typecheck reports an old `styleId` or `backgroundColor` consumer.

- [ ] **Step 7: Commit the shared model**

```powershell
git add src/shared/miniPlayer.ts src/shared/miniPlayer.test.ts src/renderer/src/stores/useSettingsStore.ts src/renderer/src/mini-player/MiniPlayerApp.vue src/main/integrations/miniPlayer.ts src/preload/index.d.ts
git commit -m "feat: add mini player theme profiles"
```

## Task 2: Theme Registry And Pure Presentation Helpers

**Files:**

- Create: `src/renderer/src/mini-player/presentation.ts`
- Create: `src/renderer/src/mini-player/presentation.test.ts`
- Modify: `src/renderer/src/mini-player/styles.ts`
- Modify: `src/renderer/src/mini-player/styles.test.ts`

- [ ] **Step 1: Write failing responsive and color tests**

Create `src/renderer/src/mini-player/presentation.test.ts` with boundary cases:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { createDefaultMiniPlayerThemeProfile } from '../../../shared/miniPlayer.ts'
import {
  buildMiniPlayerCssVariables,
  resolveMiniPlayerLayout,
  resolveMiniPlayerVisibility,
  readableTextColors
} from './presentation.ts'

test('responsive layout resolves exact compact standard and wide boundaries', () => {
  assert.equal(resolveMiniPlayerLayout(459, 300, 'auto'), 'compact')
  assert.equal(resolveMiniPlayerLayout(500, 169, 'auto'), 'compact')
  assert.equal(resolveMiniPlayerLayout(460, 170, 'auto'), 'standard')
  assert.equal(resolveMiniPlayerLayout(679, 300, 'auto'), 'standard')
  assert.equal(resolveMiniPlayerLayout(680, 240, 'auto'), 'wide')
  assert.equal(resolveMiniPlayerLayout(500, 190, 'wide'), 'standard')
  assert.equal(resolveMiniPlayerLayout(700, 300, 'compact'), 'compact')
})

test('responsive visibility never re-enables a user-hidden element', () => {
  const visibility = createDefaultMiniPlayerThemeProfile('aurora-glass').visibility
  const compact = resolveMiniPlayerVisibility({ ...visibility, artwork: false }, 'compact')
  assert.equal(compact.artwork, false)
  assert.equal(compact.album, false)
  assert.equal(compact.volume, false)
  assert.equal(compact.playMode, true)
})

test('presentation variables keep controls opaque while background opacity changes', () => {
  const profile = createDefaultMiniPlayerThemeProfile('aurora-glass')
  profile.background.opacity = 25
  profile.appearance.cornerRadius = 36
  const variables = buildMiniPlayerCssVariables(profile, '#cc3366', 25, 60)
  assert.equal(variables['--mini-background-opacity'], '0.25')
  assert.equal(variables['--mini-window-radius'], '36px')
  assert.equal(variables['--mini-progress'], '25%')
  assert.equal(variables['--mini-volume'], '60%')
  assert.equal(Object.hasOwn(variables, 'opacity'), false)
})

test('automatic text colors choose readable light and dark families', () => {
  assert.equal(readableTextColors('#11121d').primary, '#ffffff')
  assert.equal(readableTextColors('#f4f5fb').primary, '#1b2034')
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
node --experimental-strip-types --test src/renderer/src/mini-player/presentation.test.ts
```

Expected: FAIL because `presentation.ts` does not exist.

- [ ] **Step 3: Implement pure layout and visibility resolution**

Create `presentation.ts` with explicit constants and degradation logic:

```ts
export type MiniPlayerResolvedLayout = 'compact' | 'standard' | 'wide'

export const MINI_PLAYER_STANDARD_MIN_WIDTH = 460
export const MINI_PLAYER_STANDARD_MIN_HEIGHT = 170
export const MINI_PLAYER_WIDE_MIN_WIDTH = 680
export const MINI_PLAYER_WIDE_MIN_HEIGHT = 240

export function resolveMiniPlayerLayout(
  width: number,
  height: number,
  preference: MiniPlayerLayoutPreference
): MiniPlayerResolvedLayout {
  const canUseStandard = width >= MINI_PLAYER_STANDARD_MIN_WIDTH && height >= MINI_PLAYER_STANDARD_MIN_HEIGHT
  const canUseWide = width >= MINI_PLAYER_WIDE_MIN_WIDTH && height >= MINI_PLAYER_WIDE_MIN_HEIGHT
  if (preference === 'compact') return 'compact'
  if (preference === 'standard') return canUseStandard ? 'standard' : 'compact'
  if (preference === 'wide') return canUseWide ? 'wide' : canUseStandard ? 'standard' : 'compact'
  return canUseWide ? 'wide' : canUseStandard ? 'standard' : 'compact'
}
```

Compact mode additionally hides album, playback state, equalizer, time, volume, and queue position. Standard mode additionally hides queue position. Apply those responsive masks with logical AND so no user-disabled item is re-enabled.

- [ ] **Step 4: Implement color and CSS-variable helpers**

Export `readableTextColors` using sRGB relative luminance and WCAG contrast ratios. Compare white and `#1b2034` against the surface color, choose the higher-ratio primary, and derive a muted color by mixing that primary toward the surface while retaining at least 4.5:1 contrast when possible. Export `buildMiniPlayerCssVariables(profile, dominantColor, progress, volume)` returning a typed `Record<\`--mini-${string}\`, string>`.

It must set:

```ts
{
  '--mini-track-accent': effectiveAccent,
  '--mini-text': effectivePrimaryText,
  '--mini-muted': effectiveMutedText,
  '--mini-window-radius': `${profile.appearance.cornerRadius}px`,
  '--mini-surface-opacity': `${profile.appearance.surfaceOpacity / 100}`,
  '--mini-glass-blur': `${profile.appearance.glassBlur}px`,
  '--mini-border-width': `${profile.appearance.borderWidth}px`,
  '--mini-border-color': profile.appearance.borderColor,
  '--mini-shadow-strength': `${profile.appearance.shadowStrength / 100}`,
  '--mini-background-opacity': `${profile.background.opacity / 100}`,
  '--mini-background-blur': `${profile.background.blur}px`,
  '--mini-background-brightness': `${profile.background.brightness}%`,
  '--mini-background-saturation': `${profile.background.saturation}%`,
  '--mini-background-overlay': hexToRgba(
    profile.background.overlayColor,
    profile.background.overlayOpacity / 100
  ),
  '--mini-gradient-angle': `${profile.background.gradientAngle}deg`,
  '--mini-gradient-start': profile.background.gradientStart,
  '--mini-gradient-end': profile.background.gradientEnd,
  '--mini-progress': `${clampPercent(progress)}%`,
  '--mini-volume': `${clampPercent(volume)}%`
}
```

Do not return a general `opacity` property.

- [ ] **Step 5: Connect theme registry definitions to shared defaults**

Add `defaultProfile: MiniPlayerThemeProfile` to `MiniPlayerStyleDefinition`. Set each built-in definition with `createDefaultMiniPlayerThemeProfile(id)`. Normalize by cloning the profile so callers cannot mutate registry state.

Extend `styles.test.ts`:

```ts
test('registered mini player styles expose isolated complete default profiles', () => {
  const aurora = resolveMiniPlayerStyle('aurora-glass')
  const porcelain = resolveMiniPlayerStyle('porcelain')
  assert.equal(aurora.defaultProfile.appearance.accentMode, 'track')
  assert.equal(porcelain.defaultProfile.appearance.accentMode, 'custom')
  assert.notStrictEqual(aurora.defaultProfile, porcelain.defaultProfile)
})
```

Update the future-style test fixture with `defaultProfile: createDefaultMiniPlayerThemeProfile('aurora-glass')`.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
node --experimental-strip-types --test src/renderer/src/mini-player/presentation.test.ts src/renderer/src/mini-player/styles.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit presentation helpers**

```powershell
git add src/renderer/src/mini-player/presentation.ts src/renderer/src/mini-player/presentation.test.ts src/renderer/src/mini-player/styles.ts src/renderer/src/mini-player/styles.test.ts
git commit -m "feat: resolve mini player presentation profiles"
```

## Task 3: Resizable Window And Bounds Persistence

**Files:**

- Create: `src/main/integrations/miniPlayerWindow.ts`
- Create: `src/main/integrations/miniPlayerWindow.test.ts`
- Modify: `src/main/integrations/miniPlayer.ts`
- Modify: `src/main/audio/state.ts`
- Modify: `src/main/security/ipcValidation.test.ts`

- [ ] **Step 1: Write failing pure window-bound tests**

Create `miniPlayerWindow.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MINI_PLAYER_MAX_HEIGHT,
  MINI_PLAYER_MAX_WIDTH,
  MINI_PLAYER_MIN_HEIGHT,
  MINI_PLAYER_MIN_WIDTH,
  clampMiniPlayerBoundsToWorkArea,
  miniPlayerBoundsPatch
} from './miniPlayerWindow.ts'

test('mini player bounds clamp size before position inside a display work area', () => {
  const bounds = clampMiniPlayerBoundsToWorkArea(
    { x: -500, y: -200, width: 1400, height: 50 },
    { x: 0, y: 0, width: 800, height: 600 }
  )
  assert.deepEqual(bounds, {
    x: 0,
    y: 0,
    width: Math.min(MINI_PLAYER_MAX_WIDTH, 800),
    height: MINI_PLAYER_MIN_HEIGHT
  })
})

test('mini player bounds patch persists position and size together', () => {
  assert.deepEqual(miniPlayerBoundsPatch({ x: 20, y: 30, width: 700, height: 260 }), {
    windowX: 20,
    windowY: 30,
    windowWidth: 700,
    windowHeight: 260
  })
  assert.equal(MINI_PLAYER_MIN_WIDTH, 360)
  assert.equal(MINI_PLAYER_MIN_HEIGHT, 140)
  assert.equal(MINI_PLAYER_MAX_WIDTH, 900)
  assert.equal(MINI_PLAYER_MAX_HEIGHT, 520)
})
```

- [ ] **Step 2: Run the pure test and verify failure**

Run:

```powershell
node --experimental-strip-types --test src/main/integrations/miniPlayerWindow.test.ts
```

Expected: FAIL because `miniPlayerWindow.ts` does not exist.

- [ ] **Step 3: Implement pure bounds helpers**

Create `miniPlayerWindow.ts` with the four exported constants, `clampMiniPlayerBoundsToWorkArea(bounds, workArea)`, and `miniPlayerBoundsPatch(bounds)`. Round all values to integers. Clamp width and height to both the mini-player maximum and the current work-area size before calculating the maximum x/y.

Use this return contract:

```ts
export function miniPlayerBoundsPatch(bounds: Electron.Rectangle): Pick<
  MiniPlayerSettings,
  'windowX' | 'windowY' | 'windowWidth' | 'windowHeight'
> {
  return {
    windowX: Math.round(bounds.x),
    windowY: Math.round(bounds.y),
    windowWidth: Math.round(bounds.width),
    windowHeight: Math.round(bounds.height)
  }
}
```

- [ ] **Step 4: Add resizable BrowserWindow behavior**

In `miniPlayer.ts`:

- Replace position-only persistence with `persistMiniPlayerBounds` using `miniPlayerBoundsPatch`.
- Rename the timer/scheduler to cover both `move` and `resize` events.
- Subscribe both events to the same `350ms` trailing debounce.
- Set `resizable: true`, `minWidth: 360`, `minHeight: 140`, `maxWidth: 900`, and `maxHeight: 520`.
- Keep `frame: false`, set `thickFrame: process.platform === 'win32'`, and use a transparent background so CSS can own the radius.
- Set `roundedCorners: false` to avoid double rounding.
- Keep `positionLocked` mapped only to `setMovable`.
- Suppress duplicate bounds writes while applying a programmatic settings update.

The creation options must include:

```ts
transparent: true,
backgroundColor: '#00000000',
resizable: true,
minWidth: MINI_PLAYER_MIN_WIDTH,
minHeight: MINI_PLAYER_MIN_HEIGHT,
maxWidth: MINI_PLAYER_MAX_WIDTH,
maxHeight: MINI_PLAYER_MAX_HEIGHT,
roundedCorners: false,
thickFrame: process.platform === 'win32'
```

Use `clampMiniPlayerBoundsToWorkArea` from both initial resolution and live settings application.

- [ ] **Step 5: Centralize live settings application**

Export a single integration function:

```ts
export function applyMiniPlayerSettingsFromApp(settings: MiniPlayerSettings): void {
  applyMiniPlayerWindowSettings(settings)
  sendMiniPlayerSettings(settings)
}
```

In `src/main/audio/state.ts`, import this function and replace the duplicated always-on-top, movable, size, and webContents block with:

```ts
if (Object.prototype.hasOwnProperty.call(patch, 'miniPlayer')) {
  applyMiniPlayerSettingsFromApp(runtime.appSettings.miniPlayer)
}
```

Keep the destroyed-window checks inside the integration function.

- [ ] **Step 6: Update security/source contract tests**

Replace old native-corner assertions in `ipcValidation.test.ts` with assertions for trusted sender validation, `resizable: true`, minimum/maximum dimensions, Windows thick frame, transparent background, and both move/resize persistence listeners.

Add exact source assertions:

```ts
assert.match(miniPlayerSource, /resizable: true/)
assert.match(miniPlayerSource, /minWidth: MINI_PLAYER_MIN_WIDTH/)
assert.match(miniPlayerSource, /maxHeight: MINI_PLAYER_MAX_HEIGHT/)
assert.match(miniPlayerSource, /win\.on\('resize'/)
assert.match(miniPlayerSource, /persistMiniPlayerBounds/)
```

- [ ] **Step 7: Run focused tests and typecheck**

Run:

```powershell
node --experimental-strip-types --test src/main/integrations/miniPlayerWindow.test.ts src/main/security/ipcValidation.test.ts
npm run typecheck:node
```

Expected: PASS.

- [ ] **Step 8: Commit window resizing**

```powershell
git add src/main/integrations/miniPlayerWindow.ts src/main/integrations/miniPlayerWindow.test.ts src/main/integrations/miniPlayer.ts src/main/audio/state.ts src/main/security/ipcValidation.test.ts
git commit -m "feat: make mini player window resizable"
```

## Task 4: Restricted Local Background Selection

**Files:**

- Modify: `src/main/integrations/miniPlayer.ts`
- Modify: `src/main/security/ipcValidation.test.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: Write failing sender and preload-surface assertions**

Extend `ipcValidation.test.ts` and `src/renderer/src/mini-player/styles.test.ts` with these expectations:

```ts
assert.match(miniPlayerSource, /miniPlayer:chooseBackgroundImage/)
assert.match(miniPlayerSource, /assertSenderWindow\(event, runtime\.miniPlayerWindow/)
assert.match(miniPlayerSource, /importBackgroundImage/)
assert.match(preloadSource, /chooseBackgroundImage: \(\): Promise<string \| null>/)
assert.match(
  preloadSource,
  /if \(isMiniPlayerDocument\(\)\) return \{ miniPlayer: miniPlayerWindowApi \}/
)
```

- [ ] **Step 2: Run the assertions and verify failure**

Run:

```powershell
node --experimental-strip-types --test src/main/security/ipcValidation.test.ts src/renderer/src/mini-player/styles.test.ts
```

Expected: FAIL because the mini-player image method is absent.

- [ ] **Step 3: Add a sender-restricted image picker**

Import `dialog` and `importBackgroundImage` into `miniPlayer.ts`, then register:

```ts
ipcMain.handle('miniPlayer:chooseBackgroundImage', async (event) => {
  assertSenderWindow(event, runtime.miniPlayerWindow, 'mini player background image IPC')
  const win = runtime.miniPlayerWindow
  const result = await dialog.showOpenDialog(win!, {
    properties: ['openFile'],
    filters: [{ name: '背景图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return importBackgroundImage(result.filePaths[0])
})
```

The existing cache helper enforces the 20MB limit, hashes the bytes, copies into `userData/backgrounds`, and returns `background://<hash>.<ext>`.

- [ ] **Step 4: Expose only the narrow preload method**

Add to `miniPlayerWindowApi` in `src/preload/index.ts`:

```ts
chooseBackgroundImage: (): Promise<string | null> =>
  ipcRenderer.invoke('miniPlayer:chooseBackgroundImage')
```

Mirror the method in the mini-player API declaration in `index.d.ts`. Do not expose `settings`, `dialog`, `shell`, `importBackgroundImage`, paths, or raw bytes to the mini document.

- [ ] **Step 5: Run security tests and typechecks**

Run:

```powershell
node --experimental-strip-types --test src/main/security/ipcValidation.test.ts src/main/plugins/managerContract.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit restricted background selection**

```powershell
git add src/main/integrations/miniPlayer.ts src/main/security/ipcValidation.test.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/mini-player/styles.test.ts
git commit -m "feat: add safe mini player background picker"
```

## Task 5: Reusable Customization Draft State

**Files:**

- Create: `src/renderer/src/mini-player/useMiniPlayerCustomizationDraft.ts`
- Create: `src/renderer/src/mini-player/useMiniPlayerCustomizationDraft.test.ts`

- [ ] **Step 1: Write failing draft-state tests**

Create the test file:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_MINI_PLAYER_SETTINGS,
  cloneMiniPlayerSettings
} from '../../../shared/miniPlayer.ts'
import { useMiniPlayerCustomizationDraft } from './useMiniPlayerCustomizationDraft.ts'

test('draft previews immediately and persists only when flushed', async () => {
  const saved: string[] = []
  const draft = useMiniPlayerCustomizationDraft({
    initial: cloneMiniPlayerSettings(DEFAULT_MINI_PLAYER_SETTINGS),
    persist: async (settings) => {
      saved.push(settings.profiles[settings.activeStyleId].background.solidColor)
      return cloneMiniPlayerSettings(settings)
    },
    debounceMs: 60_000
  })

  draft.beginSession()
  draft.updateActiveProfile((profile) => ({
    ...profile,
    background: { ...profile.background, solidColor: '#123456' }
  }))
  assert.equal(draft.activeProfile.value.background.solidColor, '#123456')
  assert.deepEqual(saved, [])
  await draft.flush()
  assert.deepEqual(saved, ['#123456'])
  draft.dispose()
})

test('undo restores the opening snapshot and persists it', async () => {
  const saved: string[] = []
  const draft = useMiniPlayerCustomizationDraft({
    initial: cloneMiniPlayerSettings(DEFAULT_MINI_PLAYER_SETTINGS),
    persist: async (settings) => {
      saved.push(settings.activeStyleId)
      return cloneMiniPlayerSettings(settings)
    },
    debounceMs: 60_000
  })
  draft.beginSession()
  draft.selectTheme('porcelain')
  await draft.undoSession()
  assert.equal(draft.settings.value.activeStyleId, 'aurora-glass')
  assert.equal(saved.at(-1), 'aurora-glass')
  draft.dispose()
})

test('failed persistence rolls back to the last confirmed settings', async () => {
  const draft = useMiniPlayerCustomizationDraft({
    initial: cloneMiniPlayerSettings(DEFAULT_MINI_PLAYER_SETTINGS),
    persist: async () => {
      throw new Error('disk unavailable')
    },
    debounceMs: 60_000
  })
  draft.updateActiveProfile((profile) => ({
    ...profile,
    appearance: { ...profile.appearance, cornerRadius: 36 }
  }))
  await assert.rejects(draft.flush(), /disk unavailable/)
  assert.equal(draft.activeProfile.value.appearance.cornerRadius, 25)
  assert.match(draft.error.value, /disk unavailable/)
  draft.dispose()
})
```

- [ ] **Step 2: Run the draft tests and verify failure**

Run:

```powershell
node --experimental-strip-types --test src/renderer/src/mini-player/useMiniPlayerCustomizationDraft.test.ts
```

Expected: FAIL because the composable does not exist.

- [ ] **Step 3: Implement the draft composable**

Export this public contract:

```ts
export interface MiniPlayerCustomizationDraftOptions {
  initial: MiniPlayerSettings
  persist: (settings: MiniPlayerSettings) => Promise<MiniPlayerSettings>
  debounceMs?: number
}

export function useMiniPlayerCustomizationDraft(options: MiniPlayerCustomizationDraftOptions) {
  const settings = ref(cloneMiniPlayerSettings(options.initial))
  const confirmed = ref(cloneMiniPlayerSettings(options.initial))
  const sessionSnapshot = ref<MiniPlayerSettings | null>(null)
  const saving = ref(false)
  const error = ref('')
  const activeProfile = computed(
    () => settings.value.profiles[settings.value.activeStyleId]
  )

  return {
    settings,
    activeProfile,
    saving,
    error,
    beginSession,
    acceptConfirmed,
    updateActiveProfile,
    selectTheme,
    resetActiveTheme,
    undoSession,
    flush,
    dispose
  }
}
```

Implementation requirements:

- Clone all incoming/confirmed settings.
- Update the local ref before scheduling persistence.
- Use a trailing `setTimeout` with default `120ms`.
- The timer callback calls `void flush().catch(() => undefined)` because rollback and the visible error state are already handled inside `flush`.
- Clear the timer before every explicit `flush`.
- Serialize persistence calls so older responses cannot replace newer drafts.
- On failure, restore `confirmed`, set a human-readable error string, and rethrow for explicit flush calls.
- `acceptConfirmed` updates both confirmed and draft only when no local flush is pending; otherwise update confirmed and let the pending candidate win.
- `resetActiveTheme` uses `createDefaultMiniPlayerThemeProfile(activeStyleId)`.
- `dispose` clears the timer without silently losing data; hosts must call `flush` before `dispose`.

- [ ] **Step 4: Run draft tests and web typecheck**

Run:

```powershell
node --experimental-strip-types --test src/renderer/src/mini-player/useMiniPlayerCustomizationDraft.test.ts
npm run typecheck:web
```

Expected: PASS.

- [ ] **Step 5: Commit the draft state machine**

```powershell
git add src/renderer/src/mini-player/useMiniPlayerCustomizationDraft.ts src/renderer/src/mini-player/useMiniPlayerCustomizationDraft.test.ts
git commit -m "feat: add mini player customization drafts"
```

## Task 6: Shared Customization Editor

**Files:**

- Create: `src/renderer/src/mini-player/MiniPlayerCustomizer.vue`
- Create: `src/renderer/src/mini-player/MiniPlayerCustomizer.css`
- Create: `src/renderer/src/mini-player/MiniPlayerCustomizer.test.ts`

- [ ] **Step 1: Write failing editor contract tests**

Create a source contract test that verifies the editor remains controlled and feature-complete without mounting Vue:

```ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./MiniPlayerCustomizer.vue', import.meta.url), 'utf8')

test('mini player customizer exposes four controlled tabs and no global api calls', () => {
  for (const tab of ['theme', 'background', 'appearance', 'layout']) {
    assert.match(source, new RegExp(`'${tab}'`))
  }
  assert.doesNotMatch(source, /window\.api/)
  assert.match(source, /pickBackgroundImage/)
  assert.match(source, /update:settings/)
})

test('mini player customizer includes every approved control family', () => {
  for (const field of [
    'kind',
    'solidColor',
    'gradientStart',
    'gradientEnd',
    'gradientAngle',
    'imageFit',
    'blur',
    'brightness',
    'saturation',
    'opacity',
    'overlayColor',
    'overlayOpacity',
    'accentMode',
    'accentColor',
    'textMode',
    'primaryTextColor',
    'mutedTextColor',
    'surfaceOpacity',
    'glassBlur',
    'cornerRadius',
    'borderWidth',
    'borderColor',
    'shadowStrength',
    'preference'
  ]) {
    assert.match(source, new RegExp(field))
  }
})
```

- [ ] **Step 2: Run the editor test and verify failure**

Run:

```powershell
node --experimental-strip-types --test src/renderer/src/mini-player/MiniPlayerCustomizer.test.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the controlled component contract**

Use these props and emits:

```ts
const props = withDefaults(
  defineProps<{
    settings: MiniPlayerSettings
    mode: 'overlay' | 'inline'
    saving?: boolean
    error?: string
    pickBackgroundImage: () => Promise<string | null>
  }>(),
  { saving: false, error: '' }
)

const emit = defineEmits<{
  'update:settings': [settings: MiniPlayerSettings]
  undo: []
  reset: []
  close: []
  flush: []
}>()
```

Keep `activeTab` local. Derive themes with `listMiniPlayerStyles()` and the active profile from `props.settings`. Every field handler must clone only the changed branch and emit a complete cloned settings object. Theme selection must change only `activeStyleId`.

The local-image action must clear its previous picker error, await `props.pickBackgroundImage()`, leave settings untouched when it returns `null`, and emit a profile with `background.kind = 'image'` plus the returned `imageUrl` when it succeeds. Catch picker errors locally and render the message in the existing inline error region.

- [ ] **Step 4: Build the four editor tabs**

Implement these exact control groups:

- Theme: theme swatches with name, active check icon, and no descriptive marketing text.
- Background: segmented source buttons for solid, gradient, cover, image; relevant color inputs; choose/remove image buttons; fit segmented control; sliders for blur, brightness, saturation, source opacity, overlay opacity; overlay color.
- Appearance: accent-mode and text-mode segmented controls; conditional color inputs; sliders for surface opacity, glass blur, radius, border width, and shadow; border color.
- Layout: automatic/compact/standard/wide segmented control; switches for all eight visibility flags.

Use Phosphor icons already bundled by the application. Use a close icon only in overlay mode. Keep labels concise. Add title tooltips to unfamiliar icon-only actions.

The footer contains icon-plus-text Undo and Reset actions. There is no Apply button because persistence is automatic.

- [ ] **Step 5: Implement editor styling**

In `MiniPlayerCustomizer.css`:

- Overlay mode is an absolute right-side panel with width `clamp(280px, 72%, 340px)`, full height, no drag region, and a restrained border/shadow.
- Inline mode is unframed and fills the Settings section width.
- Use four fixed-width tab buttons with icons and stable height.
- Use segmented controls, swatches, native color inputs, sliders, and switches rather than text-only pills.
- Use `border-radius: 8px` or less for editor panels and repeated options.
- Do not nest cards or add decorative gradients/orbs.
- Make the body scroll while header, tabs, and actions remain reachable.
- At `max-width: 459px` or `max-height: 169px`, overlay mode fills the complete mini surface.
- Add visible `:focus-visible` outlines and reduced-motion rules.

- [ ] **Step 6: Run editor tests and typecheck**

Run:

```powershell
node --experimental-strip-types --test src/renderer/src/mini-player/MiniPlayerCustomizer.test.ts
npm run typecheck:web
```

Expected: PASS.

- [ ] **Step 7: Commit the editor**

```powershell
git add src/renderer/src/mini-player/MiniPlayerCustomizer.vue src/renderer/src/mini-player/MiniPlayerCustomizer.css src/renderer/src/mini-player/MiniPlayerCustomizer.test.ts
git commit -m "feat: add mini player customization editor"
```

## Task 7: Responsive Mini-Player Renderer Integration

**Files:**

- Modify: `src/renderer/src/mini-player/MiniPlayerApp.vue`
- Modify: `src/renderer/src/mini-player/MiniPlayer.css`
- Modify: `src/renderer/src/mini-player/styles.test.ts`
- Modify: `src/renderer/src/assets/main.css`
- Modify: `src/renderer/src/main.ts`

- [ ] **Step 1: Extend failing surface contract tests**

Add assertions to `styles.test.ts`:

```ts
assert.match(component, /MiniPlayerCustomizer/)
assert.match(component, /resolveMiniPlayerLayout/)
assert.match(component, /data-layout/)
assert.match(component, /mini-background-source/)
assert.match(component, /settings\.profiles\[settings\.activeStyleId\]/)
assert.match(styles, /\[data-layout='compact'\]/)
assert.match(styles, /\[data-layout='wide'\]/)
assert.match(styles, /var\(--mini-window-radius\)/)
assert.doesNotMatch(rendererEntry, /mini-player-native-corners/)
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
node --experimental-strip-types --test src/renderer/src/mini-player/styles.test.ts src/renderer/src/mini-player/presentation.test.ts
```

Expected: FAIL on the new integration assertions.

- [ ] **Step 3: Host actual-size and draft state in `MiniPlayerApp.vue`**

Import the customizer, presentation helpers, and draft composable. Track actual viewport dimensions with `window.innerWidth/innerHeight` and a `resize` listener. Derive:

```ts
const activeProfile = computed(
  () => customization.settings.value.profiles[customization.settings.value.activeStyleId]
)
const resolvedLayout = computed(() =>
  resolveMiniPlayerLayout(
    viewportWidth.value,
    viewportHeight.value,
    activeProfile.value.layout.preference
  )
)
const resolvedVisibility = computed(() =>
  resolveMiniPlayerVisibility(activeProfile.value.visibility, resolvedLayout.value)
)
```

Create the persistence adapter with `window.api.miniPlayer.updateSettings(settings)` and the image adapter with `window.api.miniPlayer.chooseBackgroundImage()`.

Call `acceptConfirmed` for settings broadcasts. Flush before closing the customizer and in `onBeforeUnmount`, then dispose listeners/timers. Do not let an older settings broadcast overwrite a pending optimistic draft.

- [ ] **Step 4: Replace palette cycling with editor controls**

Remove `getNextMiniPlayerStyle` usage and `switchStyle`. Add `customizerOpen`, call `beginSession()` when opening, and render `MiniPlayerCustomizer` with the complete settings draft.

Map events exactly:

```vue
<MiniPlayerCustomizer
  v-if="customizerOpen"
  :settings="customization.settings.value"
  mode="overlay"
  :saving="customization.saving.value"
  :error="customization.error.value"
  :pick-background-image="pickBackgroundImage"
  @update:settings="customization.replaceSettings"
  @undo="customization.undoSession"
  @reset="customization.resetActiveTheme"
  @flush="customization.flush"
  @close="closeCustomizer"
/>
```

Expose `replaceSettings` from the draft composable. It must clone and schedule persistence exactly like the narrower update helpers because `MiniPlayerCustomizer` emits a complete settings candidate.

When Escape is pressed, close and flush the customizer first. Only return to the main window when the customizer is already closed.

Make `returnToMainWindow` asynchronous and await `customization.flush()` before calling `window.api.miniPlayer.returnToMain()`. Apply the same explicit flush before minimizing when a customization save is pending.

- [ ] **Step 5: Render approved background layers and visibility**

Set the root `data-layout` attribute and use `buildMiniPlayerCssVariables`. Render a dedicated `.mini-background-source` layer:

- `solid`: background color.
- `gradient`: linear gradient using the profile angle/start/end.
- `cover`: current cover URL when valid, otherwise fallback color.
- `image`: controlled image URL when present, otherwise fallback color.

Render a separate `.mini-background-overlay`. Apply blur/brightness/saturation/opacity only to `.mini-background-source`. Apply visibility flags with `v-if` on artwork, album, playback badge, equalizer, time row, volume, play-mode control, and queue position. Keep previous/next/play controls always present.

- [ ] **Step 6: Refactor CSS for profile variables and three layouts**

Update `MiniPlayer.css` so:

- Root/surface radius uses `--mini-window-radius`.
- Surface border uses `--mini-border-width` and `--mini-border-color`.
- Surface glass uses a color-mixed theme surface with `--mini-surface-opacity` and `backdrop-filter: blur(var(--mini-glass-blur))`.
- Shadow strength is derived without setting overall root opacity.
- Existing artwork backdrop CSS is replaced by the explicit source/overlay layers.
- Compact selectors produce a stable low-height horizontal layout at `360x140`.
- Standard selectors preserve the current `500x190` composition.
- Wide selectors use three clear regions and remain balanced at `900x520`.
- Text uses zero letter-spacing except existing uppercase metadata where positive spacing is retained.
- Buttons, counters, artwork, and sliders keep stable dimensions.
- No text or control overlaps at any valid size.

Remove the fixed `--mini-window-radius: 25px` and native-corner override from `assets/main.css`; leave only transparent document sizing/reset rules. Remove `nativeCorners` query handling from `main.ts` and the query parameter from the main integration.

- [ ] **Step 7: Run renderer tests, typecheck, and build**

Run:

```powershell
node --experimental-strip-types --test src/shared/miniPlayer.test.ts src/renderer/src/mini-player/presentation.test.ts src/renderer/src/mini-player/styles.test.ts src/renderer/src/mini-player/useMiniPlayerCustomizationDraft.test.ts src/renderer/src/mini-player/MiniPlayerCustomizer.test.ts
npm run typecheck:web
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit responsive renderer integration**

```powershell
git add src/renderer/src/mini-player/MiniPlayerApp.vue src/renderer/src/mini-player/MiniPlayer.css src/renderer/src/mini-player/styles.test.ts src/renderer/src/assets/main.css src/renderer/src/main.ts
git commit -m "feat: render responsive customized mini player"
```

## Task 8: Main Settings Integration

**Files:**

- Create: `src/renderer/src/components/settings-page/MiniPlayerSettingsSection.vue`
- Modify: `src/renderer/src/components/SettingsPage.vue`
- Modify: `src/renderer/src/mini-player/MiniPlayerCustomizer.test.ts`
- Modify: `src/renderer/src/stores/useSettingsStore.ts`

- [ ] **Step 1: Write failing reuse assertions**

Extend `MiniPlayerCustomizer.test.ts`:

```ts
const settingsSection = readFileSync(
  new URL('../components/settings-page/MiniPlayerSettingsSection.vue', import.meta.url),
  'utf8'
)
const settingsPage = readFileSync(new URL('../components/SettingsPage.vue', import.meta.url), 'utf8')

test('main settings reuses the controlled mini player customizer', () => {
  assert.match(settingsSection, /MiniPlayerCustomizer/)
  assert.match(settingsSection, /useMiniPlayerCustomizationDraft/)
  assert.match(settingsSection, /chooseBackgroundImage/)
  assert.match(settingsPage, /MiniPlayerSettingsSection/)
})
```

- [ ] **Step 2: Run the contract test and verify failure**

Run:

```powershell
node --experimental-strip-types --test src/renderer/src/mini-player/MiniPlayerCustomizer.test.ts
```

Expected: FAIL because `MiniPlayerSettingsSection.vue` does not exist.

- [ ] **Step 3: Implement the Settings host adapter**

Create `MiniPlayerSettingsSection.vue`. Use `useSettingsStore()` and create a draft with:

```ts
const persist = async (miniPlayer: MiniPlayerSettings): Promise<MiniPlayerSettings> => {
  const next = await updateSettings({ miniPlayer })
  return next.miniPlayer
}

const pickBackgroundImage = async (): Promise<string | null> => {
  return await chooseBackgroundImage()
}
```

Watch `settings.value.miniPlayer` deeply enough to call `acceptConfirmed` when main-process broadcasts arrive. Start a new editor session when the section accordion opens. Flush before it closes and before unmount.

Render `MiniPlayerCustomizer` in `inline` mode. Hide the overlay close button through the mode prop; retain Undo and Reset.

- [ ] **Step 4: Add the focused section to Appearance**

Import and render `MiniPlayerSettingsSection` inside the Appearance section after the global theme/background controls and before generic card appearance. Add `迷你播放器 自定义 背景 圆角 缩放 布局` to the Appearance search terms.

Do not copy editor fields into `SettingsPage.vue`. The only new markup there is the component mount.

- [ ] **Step 5: Add optimistic mini-player store handling**

In `useSettingsStore.updateSettings`, mirror the existing optimistic background behavior:

```ts
if (Object.prototype.hasOwnProperty.call(patch, 'miniPlayer') && patch.miniPlayer) {
  settings.value = {
    ...settings.value,
    miniPlayer: cloneMiniPlayerSettings(patch.miniPlayer)
  }
}
```

Do not apply mini-player CSS variables to the main document. The local draft is the preview shown by the editor, and the actual mini window receives broadcasts from the main process.

- [ ] **Step 6: Run reuse tests and typecheck**

Run:

```powershell
node --experimental-strip-types --test src/renderer/src/mini-player/MiniPlayerCustomizer.test.ts src/renderer/src/mini-player/useMiniPlayerCustomizationDraft.test.ts
npm run typecheck:web
```

Expected: PASS.

- [ ] **Step 7: Commit main Settings integration**

```powershell
git add src/renderer/src/components/settings-page/MiniPlayerSettingsSection.vue src/renderer/src/components/SettingsPage.vue src/renderer/src/mini-player/MiniPlayerCustomizer.test.ts src/renderer/src/stores/useSettingsStore.ts
git commit -m "feat: edit mini player themes from settings"
```

## Task 9: Regression Suite And Windows Visual Verification

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Append focused tests to the existing script**

Preserve every current entry in `test:playback-routing`, including the user's `src/renderer/src/components/scopedGlobalSelectors.test.ts` entry. Append:

```text
src/main/integrations/miniPlayerWindow.test.ts
src/renderer/src/mini-player/presentation.test.ts
src/renderer/src/mini-player/useMiniPlayerCustomizationDraft.test.ts
src/renderer/src/mini-player/MiniPlayerCustomizer.test.ts
```

- [ ] **Step 2: Run the full automated gate**

Run in this order:

```powershell
npm run test:playback-routing
npm run test:plugins
npm run typecheck
npm run build
```

Expected: all commands PASS with zero failed tests and zero TypeScript/build errors.

- [ ] **Step 3: Start the Electron development app**

Run:

```powershell
npm run dev
```

Expected: Electron starts successfully and the main music window is usable. Keep the process running for the visual steps.

- [ ] **Step 4: Verify window resizing and responsive layout**

Open the mini player from the PlayerBar and manually verify:

- Drag left, right, top, bottom, and all four corners.
- The window stops at `360x140` and `900x520`.
- Compact mode appears below `460px` width or `170px` height.
- Standard mode appears at `460x170`.
- Wide mode appears at `680x240`.
- Position lock prevents moving but does not prevent resizing.
- Closing and reopening restores the last position and size.

Capture screenshots at `360x140`, `500x190`, and `900x520`. Inspect the screenshots for blank pixels, square backing layers, overlap, clipped controls, and text overflow.

- [ ] **Step 5: Verify every customization family**

In the mini-player editor, verify:

- Both built-in themes switch without resizing the window.
- Each theme remembers independent changes.
- Solid, gradient, cover, and local image sources render.
- Local image selection copies into the app-managed background cache.
- Blur, brightness, saturation, source opacity, overlay, glass, border, shadow, and radius change live.
- Background opacity never fades text or controls.
- Track and custom accents work.
- Auto and custom text modes remain readable.
- Every visibility toggle works and stays hidden across layout changes.
- Undo restores the panel-open snapshot.
- Reset changes only the active theme.

- [ ] **Step 6: Verify bidirectional settings persistence**

Return to the main window and verify the Settings > Appearance mini-player section shows the same values. Change a theme there, reopen the mini player, and verify the result. Restart the app and confirm bounds, active theme, all profiles, and window behavior survive.

- [ ] **Step 7: Verify Windows scaling and reduced motion**

At Windows display scaling 125% and 150%, repeat edge/corner resize and inspect compact/default layouts. Enable reduced motion in the OS and verify the equalizer and nonessential transitions stop without changing layout.

- [ ] **Step 8: Stop the dev process and inspect the final diff**

Stop the Electron development process cleanly. Run:

```powershell
git status --short
git diff --check
git diff --stat origin/main...HEAD
```

Expected: no whitespace errors; only the planned mini-player, settings, preload, tests, documentation, and preserved user edits are present.

- [ ] **Step 9: Commit the test-script update and verification fixes**

```powershell
git add package.json
git commit -m "test: cover mini player customization"
```

When a visual check in Steps 4-7 fails, first add a focused automated assertion when the behavior is expressible without Electron UI automation, then fix the responsible file from Tasks 1-8 and rerun its focused test plus `npm run typecheck`. Stage only those proven fixes with `package.json`. Do not stage unrelated pre-existing worktree changes.

## Completion Checklist

- [ ] All nine task commits exist and contain only intended files.
- [ ] `npm run test:playback-routing` passes.
- [ ] `npm run test:plugins` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] Windows minimum/default/wide screenshots show no overlap or square backing layer.
- [ ] Every edge/corner resize path works at 100%, 125%, and 150% display scaling.
- [ ] Main Settings and mini-player customization values agree after restart.
- [ ] The mini-player preload still exposes only its restricted API.
