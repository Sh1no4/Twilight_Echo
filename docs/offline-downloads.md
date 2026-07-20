# Offline Pins And Downloads

Online tracks can be fixed for offline use from a track's download button or from an online playlist's
`Offline available` action. A playlist action resolves each provider stream through the normal provider
API, then submits one bounded batch to the main process. Third-party providers need no app-side plugin
implementation: a provider that already exposes `playbackUrl` participates through the same host path.

## Safety And Recovery

- The renderer never supplies a destination path or writes media bytes. The main process accepts only
  HTTP(S) URLs without credentials or local/private literal hosts, streams at most 2 GiB into a private
  temporary file, hashes the complete stream, and atomically publishes the completed file.
- State is a versioned, compare-and-swap document in `offline-pinned/offline-downloads.json`; the normal
  atomic JSON backup/recovery path applies. Downloads interrupted by restart become visible retryable
  failures rather than appearing complete, and immediate hidden `.part` files are removed without
  following or recursively deleting directories.
- A declared `Content-Length` must equal the streamed byte count exactly. A truncated refresh is rejected
  before publication and the previous complete, verified pin remains available.
- Refresh publication uses one fsynced transaction journal and one fixed rollback sibling derived from
  the download's 64-character ID. On restart, the main process accepts only immediate, non-symlink files
  whose journal name, journal ID, persisted provider/track identity, and bounded media filename agree. It
  hashes both the published and rollback files: a complete new hash is committed before the rollback copy
  is removed; otherwise the prior verified pin is restored. Journal JSON can never choose an absolute or
  relative filesystem destination.
- A completed file is SHA-256 checked before it is returned to playback. A mismatch is surfaced as a
  failed download and the online resolver remains the normal fallback.
- Cancel leaves no playable partial file. Unpin is the only operation that removes fixed media.
- Fixed files are deliberately stored under `offline-pinned`, outside disposable cache directories.
  **Clear cache never removes user-pinned media.** The Offline manager shows pinned size, free space,
  progress, selected quality, expiry metadata, failure detail, retry, cancellation, and unpin actions.

## Playback Order

Before native queue delegation, the renderer submits the provider identities for the whole queue through
one preload call. The main process independently checks expiry, confinement, and SHA-256 for every pin and
returns only verified paths. A missing, expired, or tampered pin uses the normal online target; renderer-
cached `offlinePath` values are never authority. This keeps queue and session track identities unchanged
and lets a fully pinned provider playlist advance while the network is unavailable.

## Validation

`pnpm run test:offline-downloads` exercises streamed publication, strict response length, old-pin rollback,
cache preservation, restart cleanup, cancellation, whole-queue pin resolution, tamper/expiry fallback,
real UI progress/error behavior, and a 1000-track batch-state process-exit check. Publish fault injection
covers restart before the old move, after the old move, after the new publish but before cleanup, and with
a corrupt new final; a forged journal-path case proves that recovery cannot escape the pinned directory.
