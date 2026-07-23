# Twilight Echo Theme Contract Audit

Status: Phase 0 baseline, with Phase 1 through Phase 6 behavior frozen.

## Contract Rules

- Tokens use semantic IDs (`library.selection.surface`), never visual names (`purple2`).
- User profiles are sparse overrides. Missing values always resolve from the built-in theme.
- `ThemeProfileV1` remains an accepted import format. Runtime and persistence normalize it to V2
  with an empty `modes` object.
- Unknown profile or archive versions are not rewritten. The active selection falls back to the
  built-in theme and the original file remains available for recovery.
- Modes are host-owned enum IDs. Profiles never contain CSS, selectors, HTML, or scripts.
- Plugin theme v1 keeps its existing `variables + stylesheet + structured` semantics. Plugin API v2
  adds structured schemaVersion 2 modes without changing v1 input or runtime behavior.
- Plugin modes are normalized through the host registry. Unknown IDs or values are ignored, logged
  once for the owning plugin, and returned to Theme Studio as compatibility notes.
- Removed tokens remain readable for one compatibility cycle, are omitted from new UI, and emit a
  migration note before deletion in a later schema version.
- User profile count remains capped at `MAX_USER_THEME_PROFILES = 32`.
- Phase 2 adds an optional bounded `toneSchedule` to V2. Curated palettes and built-in font styles
  are UI shortcuts only; profiles persist the resulting token values, never palette/font-style IDs.
- Seven host-owned built-in presets are valid persisted selections and remain read-only. A derived
  profile records its preset source, uses that preset as its base, and persists only sparse overrides.
- Profile history is library-owned rather than recursive profile data. It is capped at 8 entries and
  256 KiB per profile while the existing 2 MiB theme-library limit remains authoritative.
- Settings backup schema V2 carries the normalized theme library and history. Legacy settings backups
  remain readable, missing assets fall back safely, and plugin-theme reconciliation is unchanged.

## Mode Registry

| Domain     | Mode                 | Values                                                       | Current behavior                                    |
| ---------- | -------------------- | ------------------------------------------------------------ | --------------------------------------------------- |
| Appearance | accent source        | `fixed`, `cover`                                             | Cached cover accent or fixed profile tokens         |
| Appearance | background treatment | `solid`, `gradient`, `cover-blur`, `image`                   | Bounded tokens with solid failure fallback          |
| Appearance | tone scheduling      | `manual`, `system`, `timed`                                  | Native system events or bounded local time schedule |
| Appearance | contrast guard       | `off`, `warn`, `enforce`                                     | WCAG warning or host-derived text fallback          |
| Navigation | style                | `expanded`, `compact`, `rail`                                | Static host sidebar variants                        |
| Navigation | icon scale           | `sm`, `md`, `lg`                                             | Fixed hit areas with scaled glyphs                  |
| Navigation | logo                 | `show`, `hide`                                               | Host brand visibility only                          |
| Library    | density              | `comfortable`, `compact`                                     | Static list/card presentation                       |
| Library    | selection            | `fill`, `stroke`                                             | Static selected-row presentation                    |
| Library    | title overlay        | `off`, `on`                                                  | Bounded token-driven heading overlay                |
| Player     | layout               | `standard`, `full-cover`, `lyrics-focus`, `split`, `minimal` | Static layouts with responsive split fallback       |
| Player     | controls             | `standard`, `pro`                                            | Static host control presentation                    |
| Player     | title alignment      | `left`, `center`                                             | Presentation only; independent from layout          |
| Player     | progress             | `line`, `ring`, `solid`, `spectrum`                          | Static progress presentation                        |
| Artwork    | transition           | `fade`, `slide`, `none`                                      | Bounded host animation                              |
| Artwork    | shadow               | `on`, `off`                                                  | Static shadow presentation                          |
| Equalizer  | panel                | `neutral`, `tinted`, `glass`                                 | Visual-only panel treatment                         |
| Equalizer  | slider               | `ring`, `solid`                                              | Visual-only slider thumb treatment                  |
| Equalizer  | knob                 | `line`, `dot`                                                | Visual-only knob indicator                          |
| Equalizer  | spectrum             | `bars`, `line`, `area`                                       | Visual-only spectrum treatment                      |
| Equalizer  | button               | `soft`, `outline`, `solid`                                   | Visual-only button treatment                        |
| Icons      | family               | `outline`, `rounded`, `filled`                               | Host-owned semantic slot mapping                    |
| Typography | title case           | `preserve`, `uppercase`                                      | Presentation only; metadata remains unchanged       |
| Typography | lyric accent         | `off`, `accent`                                              | Active lyric line may inherit the accent family     |
| Typography | title color          | `off`, `track`, `artist-album`                               | Accent applies to the selected metadata hierarchy   |
| Visibility | 13 registered slots  | boolean                                                      | Static attributes with Theme Studio controls        |

Only registry entries may become `data-te-*` attributes. Unknown keys and values are discarded by
normalization.

## Component Audit

| Order | Owner                | Visual semantics                                       | Current state                                        | Frozen contract                                    | Classification |
| ----: | -------------------- | ------------------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------- | -------------- |
|     1 | App shell / TitleBar | page surface, shell text, control hover                | app tokens plus literal hover colors                 | shell surface/text/control tokens                  | token          |
|     2 | SettingsPage         | page text, navigation state, controls, borders         | mixed tokens and many legacy literals                | settings text/nav/control tokens                   | token          |
|     3 | SideMenu             | surface, border, shadow, text, hover, active indicator | host icon slots and static navigation modes          | navigation semantic tokens and modes               | token, mode    |
|     4 | SongList             | page/table surface, row text, hover, selection         | tokenized selection and separate list artwork radius | library tokens; virtualized data path unchanged    | token, mode    |
|     5 | PlayerBar            | surface, controls, progress, visibility                | tokenized Pro controls and four progress styles      | stable classes; playback behavior unchanged        | token, mode    |
|     6 | PlayingMusic         | backdrop, artwork, lyrics, controls                    | five static layouts and bounded visibility           | one store and one lyrics component instance        | token, mode    |
|     7 | EqualizerPage        | panel, slider, knob, spectrum, visibility              | tokenized host presentation modes                    | visual-only; EQ parameters and DSP chain unchanged | token, mode    |
|     8 | DspRackPage          | EQ panel and control presentation                      | visual-only EQ token overrides                       | DSP graph and parameter behavior unchanged         | token, mode    |
|     9 | Mini Player          | inherited surface, border, shadow, radius, typography  | explicit inheritance plus independent profile        | window-only overrides; playback state unchanged    | token, window  |
|    10 | Desktop lyrics       | inherited text, highlight, background, font, shadow    | explicit inheritance plus independent settings       | window-only overrides; lyric timing unchanged      | token, window  |

Rejected from the theme contract: playback behavior, DSP parameters, queue behavior, arbitrary DOM
visibility, remote URLs, free-form CSS, scripts, window security policy, focus removal, and reduced
motion overrides.

## Golden Samples

The Phase 1 visual review matrix uses the real application surface:

| Sample             | Tones          | Scale            | Required state                                           |
| ------------------ | -------------- | ---------------- | -------------------------------------------------------- |
| Default shell      | light and dark | 100%, 125%, 150% | dashboard, settings, open navigation                     |
| Long titles        | light and dark | 100%             | Latin, CJK, Japanese and Korean titles without overlap   |
| Artwork edge cases | light and dark | 100%             | no cover, very light cover, very dark cover              |
| Large library      | light and dark | 100%             | 10k rows, virtual scrolling retained during theme switch |
| Theme recovery     | light and dark | 100%             | cancel preview, missing asset, failed save/import/delete |

Screenshots are evidence, not schema fixtures. Pixel differences are reviewed manually until the
repository has a stable Electron screenshot harness.

### Phase 2 Evidence

- `audit-evidence/theme-p2-light.png` and `audit-evidence/theme-p2-dark.png` capture the real
  Theme Studio personalization surface with the 16 + 16 palettes, timed tone controls, and long
  Latin/CJK/Japanese/Korean preview titles.
- CDP geometry checks cover 1495×883, 1200×800, and 1080×720. The document has no horizontal
  overflow; all three workspace panes and the header/window controls remain disjoint.
- Reduced-motion emulation resolves both transition and animation duration to `0.01ms`; tone
  changes do not add the host transition class.
- Cover-blur with no artwork resolves the image layer to `none` while retaining `surface.app`.
  Lora, JetBrains Mono, and Space Grotesk all pass `document.fonts.check()` after load.
- `test:themes` (33/33), `test:cross-cutting-regressions` (13/13), ESLint, and both TypeScript
  typechecks pass for the Phase 2 state.

### Phase 3 Evidence

- `audit-evidence/theme-p3-light.png` and `audit-evidence/theme-p3-dark.png` capture the real Theme
  Studio navigation and library domains. The implementation exposes 25 host-owned semantic slots;
  theme profiles select a family but cannot provide icon resources or classes.
- Raw CDP exercised all three icon families across all three navigation layouts. Every migrated
  icon resolves exactly one visible glyph with the expected Phosphor font, while the real sidebar
  remains 216/164/72px wide and every menu button remains 40px high.
- Library density, fill/stroke selection, title overlay, icon size, selection radius/inset, cover
  radius, overlay opacity, and action radius update root attributes, CSS variables, and the preview
  without changing `ROW_HEIGHT = 68` or the virtual-scroll data path.
- Geometry checks cover 1495×883, 1200×800, and 1080×720 with no document/preview horizontal
  overflow or pane/header collisions. Forced-colors retains one visible glyph per slot and a 2px
  focus outline.
- `test:themes` (35/35), `test:local-perf` (99 passed, 2 skipped),
  `test:cross-cutting-regressions` (13/13), ESLint, and both TypeScript typechecks pass.

### Phase 4 Evidence

- `audit-evidence/theme-p4-light.png` and `audit-evidence/theme-p4-dark.png` capture Theme Studio with
  its read-only live canvas. The canvas mounts the real dashboard, player, equalizer, title bar,
  navigation, and PlayerBar components; the former hand-built preview shell is no longer rendered.
- Raw CDP exercised all five layouts at 1495×883, 1200×800, and 1080×720. Artwork and PlayerBar
  remain inside the viewport with no document overflow or title/lyrics panel overlap.
- `split` falls back to one column at the narrow breakpoint and returns to two columns when width is
  restored. `minimal` applies host defaults without overwriting explicit visibility values, and
  hidden interactive controls leave the visible focus order.
- No-cover artwork, long scrolling lyrics, reduced motion, artwork shadow off, equalizer presentation
  modes, and full-cover partitioning at 1080×720 and 720×720 pass direct DOM/style checks.
- `test:themes` (37/37), the focused P4 component tests (16/16), `test:dsp-graph` (13/13), ESLint,
  and both TypeScript typechecks pass. Validation used raw CDP and did not use Computer Use.

### Phase 5 Evidence

- `audit-evidence/theme-p5-light.png` and `audit-evidence/theme-p5-dark.png` capture the real preset
  gallery and derived-profile workflow. All seven presets are host-owned selections rather than
  imported user profiles, and the gallery previews each preset before apply.
- Raw CDP exercised seven presets at 1495×883, 1200×800, and 1080×720: 21 checks completed with no
  document/editor overflow, pane collision, or duplicate preview canvas.
- A profile derived from `Paper Light` retained sparse overrides and returned to the source preset on
  full reset. Category reset, the bounded persistent history, and history restore use existing CAS
  theme-library writes.
- Library and player context actions opened the matching Theme Studio domains. The real mini-player
  inherited Obsidian surface/radius/border/shadow values, while the real desktop-lyrics window
  inherited its background, active text color, and 12px shadow blur.
- `test:themes` (43/43), `test:local-perf` (99 passed, 2 skipped), `test:lyrics-management` (64/64),
  the focused backup/window tests (13/13), ESLint, the production build, and both TypeScript
  typechecks pass. Validation used raw CDP and did not use Computer Use.

### Phase 6 Evidence

- `audit-evidence/theme-p6-light.png` and `audit-evidence/theme-p6-dark.png` capture an isolated real
  Electron instance with a pure plugin API v2 theme selected. The audit fixture and user-data
  directory were removed after validation; the user's existing dev instance was not stopped.
- The v2 contribution applied registered `rail`, `split`, `pro`, `filled`, and
  `playerDuration=false` modes. The dark primary and app surface resolved to `#5eead4` and `#07090a`.
- An unknown `futureDomain` was omitted from the normalized contribution, written once to the plugin
  log, and rendered by Theme Studio as a compatibility note.
- Raw CDP checked 1495×883, 1200×800, and 1080×720 with no document/workspace overflow or overlap
  between the domain, editor, and real preview panes.
- The committed `theme-contract.json` is generated from the token/mode/visibility registries and is
  checked for exact ordering and content by `test:themes`.
- `test:themes` (47/47), `test:plugin-tooling` (7/7), the focused manager contract (21/21), plugin API
  type build, ESLint, both TypeScript typechecks, the production build, and renderer budgets pass.
  Full `test:plugins` has one unchanged NCM cache-path assertion failure outside the theme contract.
  Validation used raw CDP and did not use Computer Use.

## Color Baseline

`themeColorAudit.test.ts` records a per-file budget for existing hard-coded CSS colors. New style
files with literals fail, and an existing file may not exceed its recorded budget. Phase migrations
should lower the relevant budget; the baseline is not permission to batch-replace unrelated pages.
