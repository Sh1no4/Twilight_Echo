# Mini Player Customization Design

**Date:** 2026-07-10
**Status:** Approved for implementation planning

## Goal

Turn the standalone mini player into a resizable, deeply customizable surface without weakening its restricted preload boundary or duplicating settings logic between the mini player and the main window.

The finished experience must let users resize the window from every edge and corner, customize each built-in theme independently, select safe local backgrounds, control visual treatment and content visibility, and edit the same settings from both the mini player and the main Settings page.

## Existing Context

The current mini player is a dedicated frameless `BrowserWindow` rendered by `MiniPlayerApp.vue`. It already persists window position and size fields, supports always-on-top and position locking, exposes a restricted `miniPlayer` preload API, and ships the `aurora-glass` and `porcelain` styles.

Important constraints:

- The window is currently created with `resizable: false`.
- Style switching currently replaces the saved background color and preferred window size.
- Windows 11 uses DWM-owned rounded corners while other paths use a transparent web surface.
- The main process is the authority for application settings and broadcasts setting changes to both renderers.
- Local application backgrounds are already copied into the application data directory and exposed through the controlled `background://` protocol.
- The mini-player document intentionally receives only the restricted `miniPlayer` preload API.

## Scope

### Included

- Native edge and corner resizing with persisted bounds.
- Automatic compact, standard, and wide layouts.
- A reusable customization editor shown in both the mini player and the main Settings page.
- Independent customization profiles for every mini-player theme.
- Solid, two-color gradient, current-cover, and imported local-image backgrounds.
- Background blur, brightness, saturation, overlay, opacity, and fit controls.
- Accent, text, glass, surface opacity, radius, border, and shadow controls.
- Per-element visibility controls.
- Live optimistic preview, debounced automatic persistence, undo-session, and reset-theme actions.
- Migration of the existing flat mini-player settings.
- Safe fallback behavior for missing images, unknown themes, and invalid settings.

### Excluded

- Network image URLs.
- Arbitrary drag-and-drop control positioning.
- Theme file import or export.
- Third-party plugin theme APIs.
- Cloud synchronization.

These exclusions keep the first version bounded without blocking later expansion of the profile model.

## User Experience

### Entry Points

The palette button in the mini-player toolbar opens a customization panel instead of cycling directly to the next style. The panel overlays the right side of standard and wide layouts. In the compact layout it becomes a full-surface, scrollable sheet so controls remain usable at the minimum window size.

The main window adds a Mini Player section under Settings > Personalization. It hosts the same editor component and remains synchronized with the mini-player window.

Both entry points expose four tabs:

1. **Theme** selects a built-in theme and shows its independent saved profile.
2. **Background** selects the source and adjusts its treatment.
3. **Appearance** adjusts color, glass, radius, border, and shadow.
4. **Layout** selects automatic or preferred layout behavior and controls element visibility.

The editor uses color swatches and color inputs for colors, segmented controls for modes, sliders for continuous numeric values, and checkboxes or switches for binary visibility settings.

### Save And Recovery Behavior

Opening the editor captures the current theme profile as the session snapshot. Changes preview immediately in the active renderer and are persisted automatically after a short debounce. The last pending change is flushed when the pointer is released, the panel closes, or the renderer unloads.

`Undo session` restores the snapshot captured when the panel opened. `Reset theme` replaces only the active theme profile with its registered defaults. Neither action changes window position, size, always-on-top, or position-lock state.

Closing an editor does not discard saved changes. Pressing Escape closes the editor first; only a subsequent Escape returns from the mini player to the main window.

### Theme Switching

Each theme stores its own profile. Switching themes changes `activeStyleId`, loads that theme's saved profile, and leaves the current window bounds unchanged. Returning to a theme restores its previous customization.

## Settings Model

Window behavior remains global while appearance is stored per theme.

```ts
interface MiniPlayerSettings {
  windowX: number
  windowY: number
  windowWidth: number
  windowHeight: number
  alwaysOnTop: boolean
  positionLocked: boolean
  activeStyleId: string
  profiles: Record<string, MiniPlayerThemeProfile>
}

interface MiniPlayerThemeProfile {
  background: MiniPlayerBackgroundSettings
  appearance: MiniPlayerAppearanceSettings
  layout: MiniPlayerLayoutSettings
  visibility: MiniPlayerVisibilitySettings
}
```

### Background Settings

`background.kind` accepts `solid`, `gradient`, `cover`, or `image`.

- Solid color and fallback color: six-digit hex colors.
- Gradient start and end: six-digit hex colors.
- Gradient angle: `0-360` degrees.
- Imported image: controlled `background://` URL only.
- Fit: `cover` or `contain`.
- Blur: `0-40px`.
- Brightness: `50-150%`.
- Saturation: `0-200%`.
- Background opacity: `0-100%`.
- Overlay color: six-digit hex color.
- Overlay opacity: `0-90%`.

The theme fallback color is used when a cover or imported image is unavailable.

### Appearance Settings

- Accent mode: `track` or `custom`.
- Custom accent: six-digit hex color.
- Text mode: `auto` or `custom`.
- Custom primary and muted text: six-digit hex colors.
- Surface opacity: `40-100%`.
- Glass blur: `0-40px`.
- Corner radius: `0-36px`.
- Border width: `0-3px`.
- Border color: six-digit hex color.
- Shadow strength: `0-100%`.

Automatic text mode derives a high-contrast text family from the effective surface color. Controls continue to use the effective accent color.

### Layout And Visibility Settings

The layout preference accepts `auto`, `compact`, `standard`, or `wide`. `auto` is the default. A manually preferred layout is honored only when the current bounds satisfy its minimum constraints; otherwise the renderer safely degrades to the next layout that fits.

Visibility flags cover:

- Artwork.
- Album name.
- Playback state badge.
- Equalizer animation.
- Elapsed and duration text.
- Volume control.
- Play-mode control.
- Queue position.

User-disabled elements remain hidden in every responsive mode. Responsive layout rules may additionally hide secondary elements when the window cannot fit them safely.

### Normalization And Migration

The shared mini-player module owns the persisted types, defaults, cloning helpers, normalization, and migration. Every string, enum, color, number, profile key, and nested object is validated before becoming application state.

The current settings shape migrates as follows:

- `styleId` becomes `activeStyleId`.
- The old `backgroundColor` seeds the solid and fallback colors for the active theme.
- Existing window position, dimensions, always-on-top, and position-lock values are preserved.
- Built-in profiles not present in the old settings are created from registered defaults.
- Unknown but syntactically safe theme IDs may retain normalized profiles, using the base profile for missing fields.
- Invalid active themes fall back to `aurora-glass` without deleting other valid profiles.

Normalization remains idempotent so settings backup import and repeated application do not produce further changes.

## Theme Registry

The registry continues to own human-readable theme metadata, CSS class names, fixed or track-derived accent defaults, and CSS tokens. Each registered theme also declares a complete default customization profile.

Serializable profile defaults are available to shared normalization without importing renderer code into the main process. Renderer-only presentation metadata remains in the renderer registry. Registering a theme with an incomplete or invalid default profile fails early.

Built-in defaults preserve the current visual identities of Aurora Glass and Porcelain. Custom overrides are applied after theme tokens, so resetting a profile always returns to the registered theme appearance.

## Component Boundaries

### `MiniPlayerCustomizer`

A controlled Vue component receives the active theme, profiles, session state, and capability callbacks through props. It emits intent events such as theme selection, profile replacement, undo, reset, image selection, and close. It never calls `window.api` directly.

This keeps the component reusable and testable in both renderer surfaces.

### `useMiniPlayerCustomizationDraft`

A composable owns the optimistic draft, the editor-open snapshot, the persistence debounce, rollback to the last confirmed state, and flush-on-close behavior. It accepts a persistence adapter so the two hosts use the same state machine.

The local draft updates CSS immediately. A `120ms` trailing debounce sends the normalized settings candidate to the main process. A confirmed response replaces the local draft. A rejected response restores the last confirmed state and exposes an inline error state.

### Mini-Player Host

`MiniPlayerApp.vue` owns playback state, actual window dimensions, responsive layout selection, and the mini-player persistence adapter. It renders the customizer as an overlay and maps the active profile to CSS variables and background layers.

### Main-Window Host

A focused Mini Player settings section is composed into `SettingsPage.vue` rather than adding the complete editor implementation to that already-large file. It adapts the settings store and existing background-image import capability to the shared editor.

### Pure Presentation Helpers

Pure helpers calculate the effective profile, active responsive layout, automatic text colors, and CSS variable values. Keeping these calculations outside Vue components allows Node's built-in test runner to cover the important behavior without introducing a second test framework.

## Synchronization And IPC

The main process remains the single authority for persisted settings.

1. A renderer updates its optimistic local draft.
2. Its adapter sends the full active profile or the relevant window-level patch.
3. The main process verifies the sender, allows only mini-player setting keys, merges the candidate, and normalizes the complete settings object.
4. The main process persists the result atomically.
5. It sends `miniPlayer:settings` to the mini-player window and `settings:changed` to the main window.
6. Both renderers replace their confirmed state with the normalized snapshot.

The dedicated mini-player API gains a sender-restricted local-background selection method. The main Settings host may continue to use the existing settings background import method. Both paths call the existing background cache helpers, enforce JPG/PNG/WebP and the 20MB limit, and return only `background://` URLs.

No generic settings, filesystem, shell, or Node capability is exposed to the mini-player document.

## Resizable Window Behavior

The mini-player `BrowserWindow` becomes resizable with these content bounds:

- Minimum: `360x140`.
- Default: `500x190`.
- Maximum: `900x520`.

Windows uses a frameless thick frame so all four edges and corners retain system resize hit regions. Position locking disables movement but does not disable resizing. Window `resize` events are debounced before updating `windowWidth` and `windowHeight`; final bounds are flushed when resizing ends or the window closes.

Programmatic bounds updates suppress duplicate resize persistence. Restored bounds are clamped to the nearest display work area, including when a saved monitor is no longer connected.

The web surface owns the configurable `0-36px` visual radius. On platforms that support transparent resizable windows, the window background remains transparent and the surface is clipped to the exact radius. On platforms where transparency and native resizing cannot coexist reliably, the operating system owns the outside outline while the inner surface still uses the configured radius. Windows 11 behavior is part of the required visual verification gate.

## Responsive Layout

The renderer derives layout from the actual content viewport, not only persisted settings.

- Compact: width below `460px` or height below `170px`.
- Wide: width at least `680px` and height at least `240px`.
- Standard: all other valid dimensions.

Compact mode uses a low-height horizontal composition and removes nonessential spacing. Standard mode evolves the current artwork-card composition. Wide mode increases artwork presence and separates transport, progress, and volume controls so the layout does not look stretched.

The customization panel is excluded from drag regions. All buttons, inputs, labels, and resize-adjacent interactive controls remain stable in size across hover, loading, and active states.

## Rendering Layers

Background rendering uses separate layers so visual effects never reduce control legibility:

1. Theme fallback or selected source.
2. Image transform, fit, blur, brightness, and saturation.
3. Color overlay.
4. Glass surface, border, radius, and shadow.
5. Artwork, metadata, and controls.

Cover mode follows the current track cover. A missing cover falls back to the theme color or configured solid fallback. Imported images are loaded only through the registered `background://` protocol.

Reduced-motion preference disables equalizer animation and shortens nonessential transitions. Text and control containers retain explicit responsive constraints so long titles, localized labels, or loading icons cannot resize the window layout.

## Failure Handling

- Invalid settings are normalized before persistence or broadcast.
- An unavailable cover or local image falls back to the theme background without making controls disappear.
- A failed settings update restores the last confirmed profile and displays an inline editor error.
- A destroyed counterpart window is ignored during broadcast.
- A failed image import leaves the existing background unchanged.
- Unknown active theme IDs fall back to Aurora Glass while valid stored profiles remain intact.
- Failed mini-player renderer loading keeps the existing behavior of restoring the main window.

## Performance

- Slider preview changes are local and do not require an IPC round trip for every animation frame.
- Persistence uses a `120ms` trailing debounce and explicit final flush.
- Window move and resize persistence uses an independent `350ms` trailing debounce.
- Background effects use compositor-friendly CSS layers.
- Hidden optional elements are not rendered where doing so avoids image or animation work.
- Existing image size limits prevent unbounded IPC payloads and storage use.

## Testing Strategy

### Shared Unit Tests

- Migrate the current flat settings shape without losing bounds or behavior flags.
- Normalize every nested enum, color, numeric range, visibility flag, and profile key.
- Prove normalization is idempotent.
- Preserve independent profiles across theme switches.
- Reset only the active theme and restore an editor snapshot for undo.
- Reject unsafe background URLs and accept controlled `background://` URLs.

### Presentation Unit Tests

- Resolve compact, standard, and wide modes at every boundary.
- Enforce graceful degradation of manually preferred layouts.
- Give user visibility choices precedence over responsive defaults.
- Produce stable CSS variables for every background and appearance mode.
- Select readable automatic text colors.
- Fall back correctly when cover or imported-image sources are absent.

### Main And Security Tests

- Accept setting updates only from the expected main or mini-player renderer.
- Allow only declared mini-player patch fields.
- Keep the restricted mini-player preload surface free of generic settings and filesystem APIs.
- Apply background import type and size limits.
- Persist debounced resize bounds and clamp them to valid dimensions and display work areas.
- Keep always-on-top and position-lock behavior unchanged.

### Visual And Interaction Verification

Run the Electron application on Windows and inspect the minimum, default, and wide dimensions. Verify:

- Every edge and corner resizes the window.
- Content never overlaps or escapes its parent.
- Long track, artist, and album text truncates cleanly.
- The customizer remains usable in compact mode.
- Solid, gradient, cover, and local-image backgrounds render correctly.
- Opacity and blur affect background layers without dimming controls.
- Radius `0`, the default radius, and radius `36` do not expose a square backing layer.
- Settings synchronize in both directions while both windows exist.
- Restart restores bounds, active theme, and every theme profile.
- 125% and 150% Windows display scaling preserve layout and resize hit regions.
- Reduced-motion preference removes nonessential animation.

The implementation gate is the focused mini-player tests, `npm run test:playback-routing`, `npm run typecheck`, and `npm run build`, followed by the Windows visual checks above.

## Acceptance Criteria

The feature is complete when:

1. The mini player resizes from all edges and corners and restores its saved size.
2. It adapts among compact, standard, and wide layouts without overlap.
3. The same customization editor works in the mini player and main Settings page.
4. Theme profiles retain independent appearance, background, layout, and visibility values.
5. All four approved background sources work with safe fallback behavior.
6. Live preview, automatic persistence, undo-session, and reset-theme behavior are reliable.
7. The configurable radius, border, glass, opacity, shadow, accent, and text controls render as specified.
8. User visibility choices remain effective across responsive layouts.
9. Old settings migrate without losing window bounds or existing behavior options.
10. The restricted preload and trusted-sender checks remain intact.
11. Automated tests, typechecking, build, and Windows visual verification pass.
