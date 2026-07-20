# Local Library Metadata Enrichment

New or changed local tracks are committed to the renderer immediately. Cover art, lyrics, and
provider metadata are then requested by a background queue; enrichment must never delay the
first local-library render or change a local track into a provider track.

## Queue Contract

- The queue uses six workers by default and clamps configuration to four through eight workers.
- Requests are deduplicated by normalized title-and-artist query within a queued run. A failed
  query is retained with exponential retry backoff, so repeated scans do not repeatedly call an
  unavailable provider.
- Status is exposed separately from the file scan: the Settings library panel reports scanning,
  enriching, completed, failed, and cancelled states. Cancelling discards queued work and settles
  callers immediately.
- Each update carries both the enriched track and the exact local-track object it was derived
  from. The renderer accepts it only while that object is still the current record at the same
  local identity. A scan replacement, remove, reload, or later update therefore quarantines a
  late provider result before it reaches UI state or persistence.

## Cancellation Boundary

`LibraryMetadataEnrichmentQueue` supplies an `AbortSignal` to provider adapters and aborts every
active controller on cancellation. This is used when an adapter supports request aborting.

The current renderer-to-plugin provider IPC method has no `AbortSignal` or cancel-request field,
so plugin searches cannot yet be physically interrupted by the renderer. Those calls use logical
cancellation: queue generation fencing prevents result processing, and source-snapshot fencing
prevents stale updates from changing UI or scheduling `saveMusicLibrary`. The regression tests
cover both actual `AbortSignal` aborting and the no-abort late-result path. A future provider IPC
cancel protocol must retain both fences; transport abort alone is not sufficient for a result that
has already crossed a process boundary.
