# TE-3.3d Persistence Benchmark and SQLite Evaluation

This evaluation does not add SQLite to the application or authorize a production migration.

`scripts/persistence-benchmark.cjs` benchmarks 5,000, 20,000, and 50,000 local tracks, 100 playlists of 500 IDs, a 20,000-entry session queue, and 1,000 listening-stat entries. JSON uses a production-shaped v2 envelope with sibling temporary file, preceding backup, and rename replacement, matching the important shape of `jsonFile` and `VersionedDataStore`. SQLite fully reconstructs all four documents on load; it is not a lazy-query comparison.

Each single and bulk sample starts from the same fixture. After the timed write, the runner reconstructs every document and uses complete deep equality against the expected data; counts alone are not accepted. The bulk logical mutation is identical: update 500 track genres, insert the same derived track at playlist position zero and remove the former last track, update every statistic, and advance session revision/current index. SQLite uses one database transaction; JSON writes the same four envelopes one at a time and has no cross-document transaction.

This is not a durable-commit equivalence claim. JSON mirrors the production atomic-replace/backup path but does not issue `fsync`; SQLite uses `journal_mode=DELETE` and `synchronous=FULL`. Timings say "write", not "durable write". The runner uses seven samples, nearest-rank p50/p95, `--expose-gc`, and process-wide peak RSS.

```powershell
node --test scripts/persistence-benchmark.test.cjs
node --expose-gc scripts/persistence-benchmark.cjs --work-dir E:\twilight-audit-20260716\tmp-te33-benchmark-fix\full-run --output docs/audit-evidence/te-3.3-persistence-benchmark-2026-07-17.json
```

The machine-readable result is [`te-3.3-persistence-benchmark-2026-07-17.json`](audit-evidence/te-3.3-persistence-benchmark-2026-07-17.json). Its `provenance` records the exact command and runner SHA-256. The 50,000-track result, in milliseconds, is:

| Operation                           |    JSON p50 / p95 |   SQLite p50 / p95 |
| ----------------------------------- | ----------------: | -----------------: |
| Full parse and equivalent load      | 432.025 / 493.827 | 962.735 / 1394.412 |
| One listening-stat update and write |     3.835 / 7.268 |     6.646 / 34.062 |
| One bulk logical mutation and write | 198.437 / 382.559 |  552.035 / 623.649 |
| Corrupt-primary backup recovery     | 124.102 / 191.035 |  683.685 / 827.243 |

Primary storage is 20.17 MiB for JSON and 20.39 MiB for SQLite. Peak process RSS was 405.43 MiB for JSON and 382.35 MiB for SQLite. JSON-envelope serialization p50 was 141.518 ms; SQLite structured seed was 1165.142 ms.

SQLite is slower in every recorded corrected 50,000-track operation, including renderer-shaped hydration (962.735 ms versus 432.025 ms). There is no case for a production migration now. A release-ready migration would still need Electron compatibility, typed main-process IPC, migration/rollback and recovery, locking and low-disk coverage, plus a Windows release gate with final packaging and signing.
