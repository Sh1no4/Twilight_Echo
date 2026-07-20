# TE-3.4 Playback Queue Virtualization

The PlayerBar queue drawer renders a fixed-height virtual window instead of one DOM row per queued track. It uses a 54 px row, 6 rows of overscan on both sides, and centers the active queue item whenever the drawer opens or playback changes.

Playback queue state stores compact snapshots: identity, display fields, routing target, duration, format, and audio normalization metadata. Lyrics, translations, and metadata-match payloads remain on the library/current-track paths and are not duplicated for every queue entry. The queue and its original ordering use shallow reactive arrays, so Vue does not proxy nested fields for thousands of entries.

Native queue synchronization captures a monotonic revision with the queue snapshot. A request that becomes stale while authorization or IPC is pending does not update native delegated state or issue a later stale configuration step.

## Drawer interactions

The drawer operates on a per-entry `queueEntryId`, not the provider media ID or a virtual row's DOM position. This keeps duplicate tracks distinct and makes a drag/drop safe if the visible window moves or queue state changes while the pointer is down. Row actions for play-next, add-tail, and removal all resolve that identity immediately before calling the store command. Those commands use the existing snapshot commit and native revision-fenced synchronization path. The header can clear the queue or save its current snapshot as a named playlist.

The queue-virtualization test entry also runs `usePlaybackQueueDrawerActions.test.ts`. It exercises a drag beginning in a 20,000-item visible window while a queue update shifts indexes, and confirms that the stable source/target IDs resolve to the new current indexes.

## Authoritative Artifacts

- Runner: `scripts/playback-queue-virtualization-benchmark.ts`
- Runner test: `scripts/playback-queue-virtualization-benchmark.test.ts`
- Queue/composable/revision behavior tests: `src/renderer/src/utils/playbackQueueVirtualization.test.ts` and `src/renderer/src/utils/nativeQueueRevision.test.ts`
- Package-protected test entry point: `pnpm run test:queue-virtualization`
- Package benchmark entry point: `pnpm run benchmark:queue-virtualization`
- Formal machine-readable evidence: `docs/audit-evidence/te-3.4-queue-virtualization-2026-07-17.json`

There is no `scripts/playback-queue-virtualization-benchmark.cjs` runner or CJS test. The TypeScript paths above are the only supported paths.

From a clean candidate after frozen installation, run the package-protected test and benchmark commands. Set temporary state to E before either command:

```powershell
$env:TEMP = 'E:\twilight-audit-20260716\tmp-te34'
$env:TMP = $env:TEMP
pnpm run test:queue-virtualization
pnpm run benchmark:queue-virtualization
```

The benchmark command writes the formal evidence path above. The runner does not create an untracked build directory; its only output is the requested JSON evidence file.

The benchmark imports the production `toPlaybackQueueSnapshots`, `getPlaybackQueueWindow`, and `createPlaybackQueueDisplayItems` implementation. It generates 5,000 and 20,000 real `Track`-shaped entries with independent large lyrics, translations, metadata matches, and BPM tempo maps. It proves that the retained snapshot heavy-payload bytes are zero, verifies first/middle/last current-item visibility, and enforces p95 snapshot/window time, window heap, and mounted-row thresholds. Browser DOM allocation remains bounded by the same 18-row cap because the production template iterates only over `visibleQueueItems`.
