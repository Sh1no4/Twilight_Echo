# Theme layout sheets

Each built-in preset owns one stylesheet here that restructures the five core surfaces
(app shell, local dashboard, streaming home, playing page, player bar) so the preset reads
as a distinct application rather than a recolor of the default.

## Contract

- Every rule **must** be scoped under `html[data-te-preset-layout='<key>']`. The attribute is
  written by `applyActiveTheme` in `src/renderer/src/stores/useThemeStore.ts` and resolves
  through `profile.source.presetId`, so user profiles derived from a preset keep its layout.
- `<key>` is the preset id with the `builtin:` prefix stripped
  (`builtin:neon-gradient` → `neon-gradient`).
- **No hard-coded color literals.** `themeColorAudit.test.ts` walks every `.css` under
  `src/renderer/src` and these files are budgeted at 0. Use `--te-*` tokens, or `color-mix()`
  / `oklch()` over tokens, so the sheets follow tone switching and accent-from-cover.
- These are global sheets, not scoped SFC styles, so `:global(...)` must not appear and the
  `scopedGlobalSelectors` restriction does not apply.
- Do not fight the runtime `!important` on `:root` token values — override structure
  (grid, flow, order, size, position), not token values.
