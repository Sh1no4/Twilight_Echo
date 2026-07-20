# TE-4.1A Playback Mode Contract

The persisted and session-restored playback modes are `sequential`, `listLoop`, `repeat`, and `shuffle`.

- `sequential`: playback stops at the last queue entry.
- `listLoop`: playback wraps from the last queue entry to the first.
- `repeat`: EOF reloads the current track.
- `shuffle`: the renderer shuffles the original queue into a cycle and wraps after its last entry.

The native audio ABI supports only `sequential` and `repeat`. The main and renderer map `listLoop` and `shuffle` to native `sequential`; the renderer owns their queue-boundary fallback behavior. This preserves native compatibility while keeping settings, playback-session restoration, preload, and mini-player state on the same four-mode contract.
