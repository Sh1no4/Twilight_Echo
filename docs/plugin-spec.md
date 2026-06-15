# Twilight Echo Plugin Specification

This document freezes the Phase 0 contract for the JS plugin host and adds the
Phase 2 bundled provider plus Phase 3 controlled UI/theme requirements now
implemented in the app. It is derived from `docs/twilight-echo-plugin-spec.md`
and keeps that document as the product-level source of truth.

## Package Contract

Each plugin package is either a directory or a `.tep` zip archive. The package
root must contain `plugin.json`.

Installed plugins live under the Electron user data directory:

- package files: `plugins/<id>/<version>/`
- plugin-private data: `plugin-data/<id>/`
- logs: `logs/plugins/<id>.log`
- host state: `plugin-state.json`

Plugins must not write application files outside their own package and private
data directories.

## Manifest

Required `plugin.json` fields:

- `id`: reverse-domain globally unique id, such as `com.example.discord-status`
- `name`
- `version`: semver
- `description`
- `author`
- `license`: SPDX identifier
- `type`: array of `provider`, `tool`, `ui`, `theme`, `dsp`
- `main`: JS entry path, required for JS plugins unless `binary` is present
- `binary`: platform dynamic-library map for native DSP plugins
- `engines.twilightEcho`: compatible host version range
- `apiVersion`: plugin API major version
- `permissions`: explicit permission declarations

`main` and `binary` are mutually compatible but at least one must exist. If
`type` contains `dsp`, `binary` is required. Optional fields are `contributes`,
`dependencies`, `homepage`, `repository`, `icon`, and reserved `signature`.
`dependencies` is a map of plugin id to supported semver range, for example
`{ "com.example.base": ">=1.0.0" }`. It controls enable-time validation and
dependency-order loading only; the host does not auto-install or auto-enable
dependencies.

Phase 1 permission enum:

`network`, `filesystem:read`, `filesystem:write`, `player:control`,
`player:observe`, `library:read`, `library:write`, `settings`, `clipboard`,
`ui:inject`, `dsp:native`.

## Runtime Model

JS plugins run in an Electron `utilityProcess`. The host process loads the
plugin entry, calls `activate(context)`, and later calls `deactivate()`.

The runtime isolates crashes and makes plugin behavior observable. It is not a
complete security sandbox; installation remains trust-based and must display
permissions, author, source, and the same-privilege warning.

Plugins access host capabilities only through `context.twilight`. Direct imports
of Twilight Echo internals are unsupported.

## Phase Boundaries

Phase 1 implements generic plugin discovery, local install, activation,
deactivation, uninstall, dependency-order loading, private plugin settings,
logs, and management UI.

Phase 3 implements event subscriptions and controlled UI/theme extension points.
UI plugins register host-approved DTOs only: `sidebarPage`, `playerBarButton`,
and `settingsPanel`. Those entries call plugin-host commands and do not receive
arbitrary renderer DOM access. Theme plugins register CSS variables and/or one
packaged stylesheet; users explicitly choose one plugin theme in appearance
settings before it is applied.

Phase 4 implements native DSP C ABI loading for Twilight Echo DSP plugins.
Native DSP plugins are loaded through the audio engine plugin registry, appear
in a separate risk-marked management section, and can be enabled or disabled
without starting a JS utilityProcess when the package has no `main`.

DSP ABI v1 supports float32 interleaved PCM processors. The host validates the
current platform `binary`, requires `dsp:native`, and passes the enabled DSP
chain to the audio engine. Process failures, prepare failures, unsupported
formats, and repeated realtime-budget overruns bypass the owning plugin and are
reported through playback diagnostics.

The production recovery boundary is the Audio Engine Service: by default the
Electron main process talks to a restartable service process that loads
`twilight_audio_node` and native DSP libraries. A hard-crashing DSP plugin
terminates that service, not the main application; the host clears the native
DSP chain and marks enabled DSP plugins failed until the user re-enables them.
`TWILIGHT_AUDIO_SERVICE=0` is a development fallback for direct native binding.

## Phase 2 Bundled Provider

NetEase Cloud Music is Twilight Echo's bundled base provider plugin:

- plugin id: `com.twilightecho.provider.ncm`
- provider id and track prefix: `ncm`
- package source: app-bundled `resources/plugins/ncm-provider`
- install target: user data `plugins/com.twilightecho.provider.ncm/<version>/`

The host syncs and repairs this plugin at startup. It is enabled by default and
visible in the plugin manager. Users may disable it, but it cannot be
uninstalled or overwritten by a local plugin package. When disabled, NetEase
streaming UI reports the disabled provider while local library, playback, and
settings continue to work.

The bundled provider still registers through `context.twilight.providers` and
does not import host internals. Its local NetEase API and song-cache access go
through a host-injected internal gateway that is rejected for all third-party
plugins.

## Phase 3 Event And UI Baseline

Tool plugins can subscribe through `context.twilight.events.on`. The normalized
Phase 3 events are `app:ready`, `app:before-quit`, `player:track-change`,
`player:play`, `player:pause`, `player:stop`, `player:progress`,
`player:queue-change`, and `player:playback-info`. Existing `audioEngine:*`
events remain available for low-level diagnostics.

UI commands are request/response calls with a short host timeout. Handler errors
fail only the owning plugin and are written to that plugin's log.

## Phase 4 Native DSP Baseline

Native DSP plugins export `tae_plugin_get_info()` from the dynamic library
declared in `plugin.json.binary`. The returned ABI table uses independent
`TAE_DSP_PLUGIN_ABI_VERSION = 1` and exposes create/destroy, prepare, process,
set_param, reset, and a self-described parameter table.

The public engine surface includes `TAE_SetDspPluginChain`,
`TAE_GetDspPluginStatus`, and `outputInfo.nativeDsp` in playback info. DSD,
DoP, Native DSD, and typed PCM passthrough paths do not run native DSP v1
processors; they are bypassed so passthrough semantics stay explicit.

`outputInfo.nativeDsp.plugins[]` includes loaded/active/bypassed state, bypass
reason, last error, process timing, overrun count, and parameter metadata with
current values. The management UI uses that metadata to render basic bool,
int, float, and enum controls.
