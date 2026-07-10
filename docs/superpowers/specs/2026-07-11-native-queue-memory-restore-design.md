# Native Queue Memory Restore Recovery Design

**Date:** 2026-07-11
**Status:** Approved for implementation planning

## Goal

Make remembered playback start reliably through the native audio engine when a restored queue contains stale, unresolved, or unauthorized entries. A bad companion entry must not prevent a valid current track from playing.

The fix must preserve the main-process filesystem authorization boundary. It must not automatically trust paths recovered from renderer-owned library or playback-session data.

## Root Cause

The failure begins with a remembered local track whose file still exists but whose parent directory is no longer in the main process's authorized library roots. This can happen with library data created before library-folder authorization was persisted in application settings.

The current flow is:

1. The renderer restores the saved track and queue.
2. Playing the local track fails `isAudioFileAuthorized`.
3. Playback fallback searches providers and resolves a valid HTTP(S) stream for the same song.
4. The fallback track replaces the failed current item, but the restored queue still contains other local entries.
5. `canUseNativeQueuePlayback` considers those local path shapes native-capable without checking their authorization.
6. The renderer sends the complete queue to `audioEngine:loadQueue`.
7. The main process correctly rejects an unauthorized local entry, and `Promise.all` rejects the complete queue.
8. The valid current provider stream never reaches native playback.

Observed application data confirms this state: the local library contains tracks whose files exist, while both saved library folders and authorized settings folders are empty. The provider URL policy itself correctly accepts HTTP and HTTPS sources.

## Scope

### Included

- Preflight native queue candidates before calling `audioEngine:loadQueue`.
- Require the current target and every companion candidate to be native-capable and currently authorized or already resolved.
- Fall back to a single-item native queue containing the valid current target when full delegation is unsafe.
- Apply the same preparation rule to initial playback and later native queue synchronization.
- Keep renderer-controlled next and previous behavior when only the current item is delegated.
- Add regression tests for remembered playback, provider rematching, unauthorized local companions, and fully valid queues.

### Excluded

- Automatically authorizing directories inferred from `music-library.json` or `playback-session.json`.
- Silently dropping individual entries inside the main-process IPC handler.
- Changing the native engine, decoder, or output backend.
- Adding a legacy-folder reauthorization user interface.
- Changing provider URL resolution or NetEase Cloud Music plugin behavior.

Users still need to reselect an old local library directory before its files can be played directly. This fix ensures that provider fallback and other valid current targets are not blocked by unrelated restored entries.

## Design

### Queue Preparation Boundary

The renderer player store will prepare a native load request before each queue load. Preparation receives:

- The renderer queue.
- The current track.
- The already resolved and validated current playback target.
- The current renderer queue index.
- A filesystem authorization callback backed by `window.api.fs.isAudioFileAuthorized`.

It returns:

- The queue items to send to the native engine.
- The native start index.
- Whether the complete renderer queue was delegated.

The preparation logic will live in a focused renderer utility so it can be tested with Node's built-in test runner without mounting Vue or mocking the complete player store.

### Candidate Rules

The current track always uses the `playTarget` returned by `resolvePlayTarget`. Queue preparation then validates that concrete target:

- HTTP and HTTPS targets must parse as credential-free remote URLs.
- Filesystem targets, including provider-managed cache paths, must pass `isAudioFileAuthorized`.
- Renderer-only or unsupported schemes cannot enter a native queue.

If the current target fails preparation, no native queue request is produced and `loadAndPlay` continues through its existing playback fallback path.

Every other queue item must pass all applicable checks:

1. It has a non-empty concrete audio target rather than a provider identifier such as `ncm:123`.
2. `shouldUseNativePlaybackTarget` accepts the target.
3. HTTP and HTTPS targets parse as credential-free remote URLs and may be delegated.
4. Filesystem targets pass `isAudioFileAuthorized` at preparation time.

If every item passes, preparation returns the complete queue and preserves the renderer queue index. If any item fails, preparation returns only the current item at native index `0` and marks delegation false.

Preparation is all-or-current. It never removes an arbitrary middle item because doing so would desynchronize renderer and native queue indexes.

### Playback Flow

`loadAndPlay` will keep its existing sequence through current-target resolution. Immediately before `audioEngine.loadQueue`, it will call the queue preparation utility.

For a safe full queue:

1. Load the complete native queue.
2. Set `nativeQueueDelegated` to true.
3. Apply the play mode.
4. Play the resolved current target.

For an unsafe queue:

1. Load a one-item native queue containing the current target.
2. Set `nativeQueueDelegated` to false.
3. Apply sequential or repeat behavior only for the current native item as supported by the existing flow.
4. Play the resolved current target.
5. Route next and previous through renderer `loadAndPlay`, which resolves and validates the next track before replacing the native singleton.

This means an unauthorized remembered local track may still rematch to a provider, but its valid stream will start natively instead of being blocked by the remainder of the old local queue.

### Queue Synchronization

`syncNativeQueueState` must use the same preparation rules before replacing an active native queue. It must not send a structurally native-looking local path without authorization.

If synchronization can no longer delegate the complete queue, it must not manufacture a partial reordered queue. It will prepare and load a current-only queue when the current track has a concrete target that passes the same validation. If there is no current track, its target is still unresolved, or its target fails validation, synchronization will call the existing `stopNativeAudio` path and let the next explicit playback action resolve the current target.

The synchronous `nativeQueueDelegated` flag remains the authority for whether native next and previous controls are safe. Authorization checks are performed only at queue preparation boundaries, not on every UI state read.

## Security

The main process remains the final authority for every local audio source. `resolveAuthorizedAudioSource` and `resolveAuthorizedAudioFile` remain unchanged.

Renderer preflight is an optimization and routing decision, not a security grant. A path can still be rejected in the main process if it changes between preflight and use. That rejection follows the existing playback error path.

The design deliberately rejects two tempting alternatives:

- Trusting roots inferred from legacy renderer data would turn persisted renderer content into a filesystem authority source.
- Filtering unauthorized entries in the IPC handler would silently change queue indexes and could make native playback events select the wrong renderer track.

## Error Handling

- A failed companion authorization check selects the current-only queue; it is not surfaced as a playback error.
- A failed current-target validation or authorization produces no native load request and continues through the existing playback fallback and provider rematch flow.
- A failed current-only `audioEngine:loadQueue` remains a genuine native playback failure and uses the existing renderer fallback behavior.
- Provider placeholders, malformed targets, and renderer-only `blob:` or `data:` targets prevent full native delegation.
- A race where a file becomes unauthorized after preflight is still rejected by the main process.

## Testing Strategy

### Queue Preparation Unit Tests

- A restored queue with a resolved provider current target and an unauthorized local companion returns a current-only queue.
- A provider identifier placeholder in any companion entry returns a current-only queue.
- An authorized all-local queue preserves every item and its start index.
- A fully resolved HTTP(S) queue preserves every item and its start index.
- A mixed queue whose filesystem targets are all authorized may be fully delegated.
- Current-only fallback always uses the supplied resolved `playTarget`, even when the saved current track still contains a stale path.
- An unauthorized provider-returned local cache target is rejected as the current target.
- A malformed or credential-bearing HTTP(S) target is rejected.
- Authorization rejection and authorization callback failure both fail closed to the current-only queue.

### Player Store Contract Tests

- `loadAndPlay` uses prepared queue items, start index, and delegation state.
- Provider rematch does not send the old restored queue directly to `audioEngine.loadQueue`.
- Native next and previous remain gated by `nativeQueueDelegated`.
- Queue synchronization uses the same preparation boundary.

### Regression Gate

Run:

- The focused new queue preparation test.
- `npm run test:audio-manager`.
- `npm run test:playback-routing`.
- `npm run typecheck`.
- `npm run build`.

The native C++ engine does not change, so the MinGW engine build and real-device smoke tests are not required for this renderer routing fix.

## Acceptance Criteria

1. Remembered playback can rematch an unauthorized local current track to a provider and start the resolved stream through the native engine.
2. An unauthorized or unresolved companion entry never rejects an otherwise valid current native load.
3. Fully valid queues continue to use native next, previous, shuffle, and repeat delegation.
4. Renderer and native queue indexes never diverge because entries were silently filtered.
5. The main-process local path authorization boundary is unchanged.
6. Focused tests, audio-manager tests, playback-routing tests, typechecking, and the production build pass.
