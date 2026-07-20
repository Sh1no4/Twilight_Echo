# Twilight Audio Real-Device Smoke Evidence

Generated: 2026-07-05T15:25:00.504Z
Platform: win32
Coverage: 0/5 required surfaces passed
Complete: no

Required opt-in surfaces:
- WASAPI Exclusive
- ASIO
- DoP DAC
- Native DSD
- SACD ISO

| Surface | Status | Command | Artifact | Notes |
|---|---|---|---|---|
| WASAPI Exclusive | not-run |  |  | No opt-in real-device smoke evidence recorded yet. |
| ASIO | not-run |  |  | No opt-in real-device smoke evidence recorded yet. |
| DoP DAC | not-run |  |  | No opt-in real-device smoke evidence recorded yet. |
| Native DSD | not-run |  |  | No opt-in real-device smoke evidence recorded yet. |
| SACD ISO | not-run |  |  | No opt-in real-device smoke evidence recorded yet. |

A required surface only counts as passed when at least one `pass` row includes an existing local artifact path or a remote artifact URL.

## Collection Action Plan

| Surface | Current status | Suggested command | Artifact | Required evidence |
|---|---|---|---|---|
| WASAPI Exclusive | not-run | pnpm run smoke:wasapi -- --device "<wasapi-endpoint>" --buffer 256 --format-matrix --json > output/audio-smoke-evidence/wasapi-exclusive.json | output/audio-smoke-evidence/wasapi-exclusive.json | actualBackend=wasapi-exclusive, exclusive=true, actual output format facts, and outputPerfect/perfectReason for every probed PCM format |
| ASIO | not-run | pnpm run smoke:audio-format-matrix -- --fixture-dir "<pcm-fixtures>" --playback --backend asio --device "<asio-driver>" --json > output/audio-smoke-evidence/asio-pcm.json | output/audio-smoke-evidence/asio-pcm.json | actualBackend=asio, selected driver/device, actual output format facts, and explicit pass/fail reason |
| DoP DAC | not-run | pnpm run smoke:audio-format-matrix -- --fixture-dir "<dsd-fixtures>" --playback --backend wasapi-exclusive --device "<dop-capable-dac>" --json > output/audio-smoke-evidence/dop-dac.json | output/audio-smoke-evidence/dop-dac.json | dsdMode=dop, carrier sample rate, actual output format facts, and fallback reason when the DAC rejects DoP |
| Native DSD | not-run | pnpm run smoke:asio-native-dsd -- --device "<native-dsd-asio-driver>" --fixture-dir "<dsd-fixtures>" --json > output/audio-smoke-evidence/native-dsd.json | output/audio-smoke-evidence/native-dsd.json | nativeDsdRuntimeState=proven for at least one DSD rate, plus explicit driver/device and fallback reason for unsupported rates |
| SACD ISO | not-run | pnpm run smoke:audio-format-matrix -- --manifest "<sacd-iso-matrix.json>" --playback --backend wasapi-exclusive --device "<dac>" --json > output/audio-smoke-evidence/sacd-iso.json | output/audio-smoke-evidence/sacd-iso.json | SACD ISO source metadata, selected track/area, dsdMode/native-or-dop-or-pcm result, and explicit DST/provider reason when applicable |
