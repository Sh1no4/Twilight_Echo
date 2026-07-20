# Lyrics Timing And Manual Management

Lyrics timing is a renderer presentation concern. Twilight Echo never rewrites
an LRC file merely to correct its timing. A user may explicitly save their
edited original lyrics as a separate LRC file from the Lyrics manager.

- A global offset and a per-track offset are stored in milliseconds. Both are
  bounded to `-120000..120000` and are added to the playback clock when the
  active line is selected. Clicking a line applies the inverse offset before
  seeking.
- Per-track choices are persisted in `lyrics-management.json`, independently
  from the scanned library, playlist data, audio metadata, and playback
  session. A library rescan cannot discard a manual lyric edit.
- `Auto`, `Local LRC`, and `Provider` retain the existing lyric
  resolver and its fallback order. `Manual` has explicit precedence only for
  the selected track and never overwrites the resolver result held by the
  playback queue.
- Import accepts a user-selected `.lrc` or `.txt` file through the main-process
  dialog, strips a UTF-8 BOM, and rejects content above 1 MiB. The UI supports
  editing original, translation, and romanization text before saving.
- `Save LRC` opens a main-process Save dialog. The renderer cannot provide a
  destination path. Only non-empty, valid LRC text (at most 1 MiB) is written;
  an existing destination is copied to `<name>.lrc.bak`, data is fsynced to a
  same-directory temporary file, and the temporary file is atomically
  replaced. A failed replacement restores the backup before reporting the
  error. `Save lyrics` separately commits the per-track management settings.
- Original, translation, and romanization are independent global display
  toggles. Hidden tracks are retained in the stored document, so re-enabling a
  toggle does not require a new lookup.

The persistence file uses the shared versioned-data envelope and compare-and-
swap revisions. A stale renderer write is rejected instead of replacing a
newer document.
