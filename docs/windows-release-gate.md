# Windows-first Release Gate

This checklist is the minimum gate before publishing a Windows build of Twilight Echo.

## Required Commands

Run these from the repository root:

```powershell
npm run typecheck
npm run test:plugins
npm run test:audio-manager
npm run test:playback-routing
npm run build
```

## Native Audio Engine

Windows release builds must also verify the MinGW audio engine path:

```powershell
$env:VCPKG_ROOT = 'C:\path\to\vcpkg'
$env:W64DEVKIT_ROOT = 'C:\path\to\w64devkit'
$env:TWILIGHT_GNU_PATCH = 'C:\Program Files\Git\usr\bin\patch.exe'
```

`TWILIGHT_GNU_PATCH` must identify as GNU patch; Git for Windows provides a compatible executable.
When the repository path contains whitespace, set `TAE_MINGW_BUILD_DIR` to a writable path without
whitespace before configuring, for example:

```powershell
$env:TAE_MINGW_BUILD_DIR = 'D:\twilight-build\mingw-static'
```

```powershell
npm run configure:audio-engine:mingw
npm run build:audio-engine:mingw
npm run test:audio-engine:mingw
```

The staged release must include the matching `twilight-audio-engine.dll` and
`twilight_audio_node.node` under packaged `resources/audio-engine`.

## Plugin Boundary

The app repository may bundle host/runtime code, built-in plugins, plugin API tooling, and the
static plugin index client. Third-party plugin `.tep` packages must not be committed under
`resources/plugin-index`; Bilibili and future third-party plugins are installed from the remote
`TWILIGHT_PLUGIN_INDEX_URL` index.

## Manual Smoke

Before release, start the packaged app and verify:

- local library browsing and playback still work;
- local, playing, settings, plugin, equalizer, and streaming surfaces switch cleanly;
- disabling the built-in NCM provider does not affect local playback;
- installing a remote plugin shows the trust-based permissions warning;
- a failing plugin is marked failed and does not prevent app startup or playback.

Real-device smoke checks for WASAPI Exclusive, ASIO, native DSD, SACD ISO, CoreAudio, and ALSA
remain opt-in and are not part of the default gate.
