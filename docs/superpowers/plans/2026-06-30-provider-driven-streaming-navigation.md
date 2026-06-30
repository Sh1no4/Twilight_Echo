# Provider-Driven Streaming Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide shared streaming navigation entries when their backing provider plugins are disabled, while keeping them visible when another enabled provider supports the same shared surface.

**Architecture:** Extract streaming navigation eligibility into `src/renderer/src/utils/streamingNavigation.ts` and keep `StreamingPage.vue` as the UI coordinator. The Vue component consumes generated sidebar items, chooses a visible fallback tab, and renders an empty state when no online provider entry exists.

**Tech Stack:** Vue 3 Composition API, TypeScript, Node test runner.

---

### Task 1: Add Provider-Driven Navigation Helpers

**Files:**
- Modify: `src/renderer/src/utils/streamingNavigation.ts`
- Test: `src/renderer/src/utils/streamingNavigation.test.ts`

- [ ] **Step 1: Add failing tests for shared entry visibility**

Add tests that assert:

```ts
const providers = [
  {
    id: 'ytmusic',
    name: 'YouTube Music',
    capabilities: ['library'],
    ui: { icon: 'pi pi-youtube', authType: 'oauth', unifiedLibrary: true }
  }
]
```

produces only the shared `library` entry when NetEase is unavailable, and that an empty provider list with NetEase unavailable produces no shared `home` or `library` entries.

- [ ] **Step 2: Implement helper functions**

Add `buildStreamingSidebarItems`, `getFirstVisibleStreamingTab`, and `hasStreamingSidebarEntries`. Use only provider capabilities and UI metadata; do not special-case YTMusic.

- [ ] **Step 3: Run navigation tests**

Run: `npm run test -- src/renderer/src/utils/streamingNavigation.test.ts`

Expected: tests pass.

### Task 2: Wire Helpers Into StreamingPage

**Files:**
- Modify: `src/renderer/src/components/StreamingPage.vue`

- [ ] **Step 1: Replace hardcoded shared tabs**

Compute sidebar items from `buildStreamingSidebarItems({ ncmAvailable: providerAvailable.value, providers: providerStore.providers.value })`.

- [ ] **Step 2: Preserve active provider behavior**

Make `libraryProviders` include NetEase only when available, include unified providers when enabled, and make `activeProvider` fall back to the first unified library provider before falling back to NetEase.

- [ ] **Step 3: Add tab fallback watcher**

When visible shared tabs change, reset detail/search state and select the first visible tab. If no entries remain, leave the page on an empty state.

- [ ] **Step 4: Render empty state**

If `sidebarItems.length === 0`, render a placeholder saying no online provider is enabled and point the user to the plugin settings page.

### Task 3: Verify

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck:web`

Expected: typecheck succeeds.

- [ ] **Step 2: Run focused tests**

Run: `npm run test -- src/renderer/src/utils/streamingNavigation.test.ts`

Expected: focused navigation tests pass.
