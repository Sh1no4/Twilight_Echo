# TE-4.1A Playback Mode Contract

The supported runtime playback modes are `sequential`, `listLoop`, `repeat`, `shuffle`, and `heart`.

- `sequential`: playback stops at the last queue entry.
- `listLoop`: playback wraps from the last queue entry to the first.
- `repeat`: EOF reloads the current track.
- `shuffle`: the renderer shuffles the original queue into a cycle and wraps after its last entry.
- `heart`: the renderer fetches a smart recommendation list for the NetEase "我喜欢的音乐"
  (liked songs) playlist via `/playmode/intelligence/list` and keeps refilling it at track
  boundaries. It is renderer-only, never persisted, and can only be entered while playing a
  NetEase stream from the liked playlist; other playlists and non-streaming sources cannot
  enable it. The native engine is kept on `sequential` and loads only the current track so the
  renderer owns every boundary.

The native audio ABI supports only `sequential` and `repeat`. The main and renderer map
`listLoop`, `shuffle`, and `heart` to native `sequential`; the renderer owns their
queue-boundary fallback behavior. This preserves native compatibility while keeping settings,
playback-session restoration, preload, and mini-player state on the same mode contract.
`heart` is intentionally excluded from persisted settings and saved playback sessions.
