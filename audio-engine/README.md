# Twilight Audio Engine

C++20 native audio engine for Twilight Echo.

## Targets

- `twilight_audio_engine`: shared C ABI library. On Windows the output name is `twilight-audio-engine.dll`.
- `twilight_audio_node`: optional Node-API bridge. Enable with `-DTAE_BUILD_NAPI=ON` and provide `-DTAE_NODE_INCLUDE_DIR=<path-to-node-or-electron-headers>`.
- `twilight_audio_tests`: smoke tests for the C ABI.

## Current Implementation State

The repository contains the production boundary: C ABI, CMake options, vcpkg manifest, Node-API bridge source, queue/state/DSP metadata plumbing, and platform backend slots.

The Windows MVP path is wired as real native audio code:

- `decoder/FFmpegDecoder.*` opens local paths and HTTP URLs through FFmpeg, probes stream metadata, seeks, and outputs float32 interleaved PCM through libswresample.
- `core/AudioPipeline.*` owns the decode thread, PCM ring buffer, render callback, playback position, bit-perfect/DSP flags, and spectrum tap.
- `output/wasapi/WasapiSharedBackend.*` opens a Windows WASAPI shared-mode render stream and pulls PCM from the pipeline.
- `devices/DeviceManager.cpp` enumerates active WASAPI render devices when built on Windows.
- WASAPI Exclusive, ASIO, CoreAudio, and ALSA still have backend slots for the next milestones.
- DSD Native/DoP capability routing is represented in playback state as `dsdMode`.

Electron keeps the renderer `HTMLAudioElement` playback path as a temporary fallback while the native DLL is not built or a native backend reports unavailable. Once `twilight-audio-engine.dll` and `twilight_audio_node.node` are built and verified on the target machine, the fallback can be removed.
