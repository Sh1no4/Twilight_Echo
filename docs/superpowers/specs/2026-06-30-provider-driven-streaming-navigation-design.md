# Provider-Driven Streaming Navigation Design

## Goal

When a streaming provider plugin is disabled, Twilight Echo should hide streaming navigation entries that no enabled provider can support. If another enabled provider can support the same shared entry, the entry remains visible.

## Scope

This change is host-side renderer behavior only. It does not add third-party plugin source to the app repository and does not introduce provider-specific checks for YTMusic or any other external provider.

## Behavior

- The streaming sidebar builds shared entries from enabled provider registrations.
- The "主页" entry is visible when the built-in NetEase provider is available.
- The "音乐库" entry is visible when NetEase is available or at least one enabled provider declares `capabilities: ["library"]` with `ui.unifiedLibrary: true`.
- Providers with `library` capability that do not opt into `ui.unifiedLibrary` keep their independent sidebar entry unless `ui.streamingLibraryTab === false`.
- If the active tab or preferred provider becomes unavailable after a plugin is disabled, the page selects the first visible supported entry.
- If no streaming provider can support any online entry, the page shows an empty state instead of a dead NetEase page.

## Compatibility

The change uses existing Provider API metadata: `capabilities`, `ui.unifiedLibrary`, and `ui.streamingLibraryTab`. It preserves the plugin-system boundary and keeps NetEase as the built-in provider while allowing future providers to keep shared controls alive through the documented UI metadata.

## Tests

Focused tests should cover sidebar item generation and fallback selection using plain utility functions, so the behavior can be verified without mounting the large Vue page.
