# Mini Player Shape and Status Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the mini player real rounded corners, keep its artwork square in every responsive layout, and remove playback-status customization.

**Architecture:** The shared profile contract no longer models a playback-status visibility bit. The renderer no longer renders the chip and constrains the artwork wrapper to a square; on Windows, the Electron window receives a rounded region derived from the active theme radius so its visible and clickable frame matches the transparent renderer surface.

**Tech Stack:** Electron, Vue 3, TypeScript, CSS Grid, Node test runner.

---

### Task 1: Correct the mini player presentation contract

**Files:**
- Modify: `src/shared/miniPlayer.ts`
- Modify: `src/shared/miniPlayer.test.ts`
- Modify: `src/renderer/src/mini-player/presentation.ts`
- Modify: `src/renderer/src/mini-player/presentation.test.ts`
- Modify: `src/renderer/src/mini-player/MiniPlayerCustomizer.vue`
- Modify: `src/renderer/src/mini-player/MiniPlayerCustomizer.test.ts`
- Modify: `src/renderer/src/mini-player/MiniPlayerApp.vue`
- Modify: `src/renderer/src/mini-player/MiniPlayer.css`
- Modify: `src/renderer/src/mini-player/styles.test.ts`
- Modify: `src/main/integrations/miniPlayer.ts`
- Modify: `src/main/integrations/miniPlayerWindow.ts`
- Modify: `src/main/integrations/miniPlayerWindow.test.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/preload/types.ts`
- Modify: `src/renderer/src/components/settings-page/MiniPlayerSettingsSection.vue`
- Modify: `src/renderer/src/types/settings.ts`

- [x] **Step 1: Write the failing regression tests**

Add assertions that legacy `visibility.playbackState` is absent after normalization, the responsive visibility result has no `playbackState` property, the customizer source has no playback-status key, and the renderer source/CSS contains neither `mini-play-state` nor `mini-state-dot`. In `miniPlayerWindow.test.ts`, add a test for a rounded region that removes top-corner pixels while preserving the center and bottom edge. In `styles.test.ts`, assert the base artwork rule contains `aspect-ratio: 1` and does not set `height: 100%`.

- [x] **Step 2: Run the focused tests and verify the expected failures**

Run:

```powershell
node --experimental-strip-types --test src/shared/miniPlayer.test.ts src/renderer/src/mini-player/presentation.test.ts src/renderer/src/mini-player/styles.test.ts src/renderer/src/mini-player/MiniPlayerCustomizer.test.ts
```

Expected: FAIL because the current model, template, CSS, and Electron configuration still contain playback-status behavior, stretched artwork, and no rounded native window region.

- [x] **Step 3: Implement the smallest matching change**

Remove `playbackState` from `MiniPlayerVisibilitySettings`, default visibility, profile normalization, responsive masks, and customizer choices. Delete `playbackStateText` and the `mini-play-state` template/CSS rules. Change `.mini-artwork-wrap` to use `width: min(100%, 100cqh)`, `height: auto`, `max-height: 100%`, and `aspect-ratio: 1`; retain `object-fit: cover` on the image. Add a tested rounded-region helper in `miniPlayerWindow.ts` and apply it with `BrowserWindow.setShape` whenever the mini player opens, resizes, or receives a theme update.

- [x] **Step 4: Run the focused tests and verify they pass**

Run:

```powershell
node --experimental-strip-types --test src/shared/miniPlayer.test.ts src/renderer/src/mini-player/presentation.test.ts src/renderer/src/mini-player/styles.test.ts src/renderer/src/mini-player/MiniPlayerCustomizer.test.ts
```

Expected: all focused tests pass.

- [x] **Step 5: Verify types, production bundle, and working tree**

Run:

```powershell
npm run typecheck
git diff --check
git status --short
```

Expected: type checking passes, diff check has no output, and only the intended mini-player files plus the design and plan documents are modified.

- [ ] **Step 6: Commit and push**

Run:

```powershell
git add src/shared/miniPlayer.ts src/shared/miniPlayer.test.ts src/renderer/src/mini-player/presentation.ts src/renderer/src/mini-player/presentation.test.ts src/renderer/src/mini-player/MiniPlayerCustomizer.vue src/renderer/src/mini-player/MiniPlayerCustomizer.test.ts src/renderer/src/mini-player/MiniPlayerApp.vue src/renderer/src/mini-player/MiniPlayer.css src/renderer/src/mini-player/styles.test.ts src/renderer/src/components/settings-page/MiniPlayerSettingsSection.vue src/renderer/src/types/settings.ts src/main/integrations/miniPlayer.ts src/main/integrations/miniPlayerWindow.ts src/main/integrations/miniPlayerWindow.test.ts src/preload/index.d.ts src/preload/types.ts docs/superpowers/specs/2026-07-11-mini-player-shape-and-status-removal-design.md docs/superpowers/plans/2026-07-11-mini-player-shape-and-status-removal.md
git commit -m "fix: refine mini player frame and artwork"
git push
```

Expected: a new implementation commit is created on the user's current branch and pushed through the configured Git account.
