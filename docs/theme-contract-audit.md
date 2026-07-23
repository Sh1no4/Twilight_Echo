# Twilight Echo Theme Contract Audit

Status: Phase 0 baseline, with Phase 1 and Phase 2 behavior frozen.

## Contract Rules

- Tokens use semantic IDs (`library.selection.surface`), never visual names (`purple2`).
- User profiles are sparse overrides. Missing values always resolve from the built-in theme.
- `ThemeProfileV1` remains an accepted import format. Runtime and persistence normalize it to V2
  with an empty `modes` object.
- Unknown profile or archive versions are not rewritten. The active selection falls back to the
  built-in theme and the original file remains available for recovery.
- Modes are host-owned enum IDs. Profiles never contain CSS, selectors, HTML, or scripts.
- Plugin theme v1 keeps its existing `variables + stylesheet + structured` semantics. Plugin modes
  are explicitly deferred to Phase 6.
- Removed tokens remain readable for one compatibility cycle, are omitted from new UI, and emit a
  migration note before deletion in a later schema version.
- User profile count remains capped at `MAX_USER_THEME_PROFILES = 32`.
- Phase 2 adds an optional bounded `toneSchedule` to V2. Curated palettes and built-in font styles
  are UI shortcuts only; profiles persist the resulting token values, never palette/font-style IDs.

## Mode Registry

| Domain     | Mode                 | Values                                                       | Current behavior                                    |
| ---------- | -------------------- | ------------------------------------------------------------ | --------------------------------------------------- |
| Appearance | accent source        | `fixed`, `cover`                                             | Cached cover accent or fixed profile tokens         |
| Appearance | background treatment | `solid`, `gradient`, `cover-blur`, `image`                   | Bounded tokens with solid failure fallback          |
| Appearance | tone scheduling      | `manual`, `system`, `timed`                                  | Native system events or bounded local time schedule |
| Appearance | contrast guard       | `off`, `warn`, `enforce`                                     | WCAG warning or host-derived text fallback           |
| Navigation | style                | `expanded`, `compact`, `rail`                                | Attribute output only                               |
| Navigation | icon scale           | `sm`, `md`, `lg`                                             | Attribute output only                               |
| Library    | density              | `comfortable`, `compact`                                     | Attribute output only                               |
| Library    | selection            | `fill`, `stroke`                                             | Attribute output only                               |
| Player     | layout               | `standard`, `full-cover`, `lyrics-focus`, `split`, `minimal` | Attribute output only                               |
| Player     | controls             | `standard`, `pro`                                            | Attribute output only                               |
| Artwork    | transition           | `fade`, `slide`, `none`                                      | Attribute output only                               |
| Icons      | family               | `outline`, `rounded`, `filled`                               | Attribute output only                               |
| Typography | title case           | `preserve`, `uppercase`                                      | Presentation only; metadata remains unchanged       |
| Typography | lyric accent         | `off`, `accent`                                              | Active lyric line may inherit the accent family     |
| Typography | title color          | `off`, `track`, `artist-album`                               | Accent applies to the selected metadata hierarchy   |
| Visibility | registered slot IDs  | boolean                                                      | Sparse attributes only; UI is deferred              |

Only registry entries may become `data-te-*` attributes. Unknown keys and values are discarded by
normalization.

## Component Audit

| Order | Owner                | Visual semantics                                       | Current state                                 | Phase 1 contract                           | Classification  |
| ----: | -------------------- | ------------------------------------------------------ | --------------------------------------------- | ------------------------------------------ | --------------- |
|     1 | App shell / TitleBar | page surface, shell text, control hover                | app tokens plus literal hover colors          | shell surface/text/control tokens          | token           |
|     2 | SettingsPage         | page text, navigation state, controls, borders         | mixed tokens and many legacy literals         | settings text/nav/control tokens           | token           |
|     3 | SideMenu             | surface, border, shadow, text, hover, active indicator | glass tokens plus literal slate values        | navigation semantic tokens                 | token           |
|     4 | SongList             | page/table surface, row text, hover, selection         | custom gradients and literal selection colors | library surface/row/selection tokens       | token           |
|     5 | PlayerBar            | surface and controls                                   | partially tokenized                           | existing playback tokens; no layout change | token           |
|     6 | PlayingMusic         | backdrop, artwork, lyrics, controls                    | registered playback token coverage            | unchanged in P1                            | token           |
|     7 | EqualizerPage        | panel and control appearance                           | mixed global tokens and literals              | deferred visual preset                     | token, deferred |
|     8 | Mini Player          | inherited appearance                                   | structured settings and window defaults       | unchanged in P1                            | token, deferred |
|     9 | Desktop lyrics       | inherited text/background                              | structured settings and window defaults       | unchanged in P1                            | token, deferred |

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

## Color Baseline

`themeColorAudit.test.ts` records a per-file budget for existing hard-coded CSS colors. New style
files with literals fail, and an existing file may not exceed its recorded budget. Phase migrations
should lower the relevant budget; the baseline is not permission to batch-replace unrelated pages.
