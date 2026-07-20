# Playlist Lifecycle

Local playlists support rename, cover selection, copying, manual ordering, and moving a selected group
to another playlist. A playlist update is queued as one versioned persistence transaction; a bulk action
does not create one JSON write per track.

## Import And Export

The playlist detail toolbar imports and exports `M3U`, `M3U8`, and `PLS` files. The renderer
matches imported entries to known local-library paths. Entries that are not currently in the library are
reported as unmatched and are never fabricated as playable tracks.

The parser is deliberately bounded:

- input is limited to 8 MiB and 20,000 entries;
- comments, malformed PLS fields, empty paths, and NUL-containing paths are skipped or rejected;
- PLS entries are ordered by numeric `FileN` index, not input line order.

## Missing Files

Use the locate action in a playlist detail to choose a directory and scan it for replacement candidates.
Automatic repair only changes a playlist when there is one unambiguous match, preferring an exact filename
and then `title + artist + duration` (within two seconds). Multiple candidates remain untouched and are
reported for manual resolution. A repair replaces the stored playlist snapshot and track id together, so
the persisted order remains stable after restart.

## Covers

Playlist covers accept user-selected PNG, JPEG, and WebP files only. The UI rejects files larger than
6 MiB and images above 16 million pixels before writing a data URL. Covers are persisted with the same
versioned playlist transaction as the metadata edit.
