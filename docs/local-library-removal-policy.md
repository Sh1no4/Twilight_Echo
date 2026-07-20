# Local Library Removal Policy

## User-visible operations

- **从音乐库移除** removes matching local records from the library and adds their file paths to
  the managed exclusion list. Files on disk are not changed.
- **移到回收站** asks for confirmation, calls Electron `shell.trashItem` once per distinct file,
  and removes records only for successful calls. A failed file stays in the library and is
  reported to the user.
- Multiple SACD/sub-track records that share one physical path are treated as one file operation;
  all records for that path are removed together.

## Persistence schema and migration

`music-library.json` schema version 2 is:

```json
{
  "version": 2,
  "revision": 7,
  "tracks": [],
  "folders": [],
  "exclusions": [
    {
      "filePath": "D:\\Music\\Example.flac",
      "title": "Example",
      "artist": "Artist",
      "excludedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

Legacy array and unversioned object files migrate to version 2 with revision `0` and an empty
exclusion list. The migration establishes revision `0`; subsequent user-state commits advance it.
The existing atomic JSON writer keeps `.bak`, `.tmp`, and corruption-recovery behavior. Stale
renderer mutations fail instead of overwriting a newer document.

`tracks` and `exclusions` are disjoint by normalized file path. Creation, migration, save, and load
all enforce that invariant, so an excluded track cannot be revived by stale or legacy data.

To roll back this feature while preserving the library, copy `tracks` and `folders` into the old
unversioned object shape. Keep the version 2 file or its `.bak` first if exclusions may need to be
restored later.

## Scan and restore behavior

The main-process exclusion matcher is updated whenever the document loads or commits. Full scans,
incremental watcher additions, and background repair scans all pass through the same matcher, so an
excluded path cannot reappear after restart or rescan.

Directory scans check exclusions while collecting files, immediately before metadata parsing, and
again after parsing. The renderer repeats the check before and after asynchronous metadata
enrichment. A scan result that was collected before a concurrent removal therefore cannot merge the
excluded path back into memory or the persisted document.

The **已移除** manager lists exclusions. Restoring an entry removes it from the exclusion list and
rescans its parent directory. A missing file is still unexcluded, so it can be discovered if it is
placed back at that path later.

Restore requests share the same revisioned write queue as remove and save operations. The renderer
rebases concurrent track additions, metadata changes, folder changes, and pending saves onto the
revision returned by the restore transaction, including when the restored file is missing or the
follow-up scan is empty.

## Reference policy

- **Active track and playback queues:** remove every successful track ID and physical path from the
  active queue and original queue. If the active track was removed, playback stops, the active
  track is cleared, and the saved playback session is cleared. Removing a non-current queue item
  persists the pruned session before the next restart. All playback-session save and clear callers
  share one FIFO writer with monotonic sequence numbers, so an older delayed autosave cannot land
  after the newer pruned-queue session.
- **Favorites and custom playlists:** preserve track IDs and metadata snapshots as user intent.
  A missing local snapshot is not returned as a playable track. Restoring/rescanning a logically
  matching local track makes the preserved entry usable again.
- **Recently played and listening statistics:** preserve aggregate history and its metadata snapshot.
  A removed local-only snapshot is not exposed as playable; provider snapshots remain playable.
- **Streaming provider favorites:** resolve each non-local track through the provider registry and
  call `likeTrack(providerLocalId, false)`. NCM uses its compatibility fallback only when the generic
  provider operation is unavailable. Provider removals continue even if the local batch rejects,
  and the local favorite snapshot is removed only after the remote operation succeeds.

This split keeps historical and curated data without retaining an invalid active playback target.

## Batch and failure guarantees

- One remove request applies one ID/path delta to renderer state, causing one derived collection
  rebuild without replacing concurrent tracks or folders.
- A successful batch produces one atomic `music-library.json` commit, including a 5000-track batch.
- A mixed trash result commits successful paths once and leaves every failed record untouched.
- Trash operations write `music-library-removal-journal.json` before touching files, update it after
  each item, and clear it only after the library commit. Startup recovery finishes any successful
  removals left behind by a commit failure; trash itself is never reported as rolled back.
- The original trash IPC immediately runs journal recovery if its library commit fails. Successful
  recovery returns the authoritative revision and actual ID/path delta from that same request. If
  recovery persistence also fails, the journal remains intact and the error propagates for a later
  retry.
- A zero-success trash result does not write the library. If unrelated renderer changes already had
  a pending save, that pre-existing save is executed once after the failed trash result; it is not
  misreported as completed or discarded.
- Renderer changes made while a removal IPC is pending are rebased onto the returned revision. The
  removal response applies only ID/path deltas and never replaces current tracks or folders.
- On a revision conflict, the renderer reloads the authoritative document, reapplies only a rejected
  trash intent whose path is confirmed absent, and resaves the current renderer state. A transient
  authoritative-load failure retains that intent. Pending save promises remain unresolved until
  their generation commits, and scheduled saves retry with exponential delay capped at 30 seconds.
