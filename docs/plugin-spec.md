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

## Plugin Repository Boundary

The Twilight Echo app repository must not store third-party plugin source code,
plugin tests, or third-party plugin-specific `.tep` release packages. It may
store host/runtime code, plugin API typings, plugin tooling, built-in app
plugins, and the app-side plugin index client.

Third-party plugin source and packages belong in the external plugin repository:

- GitHub: `https://github.com/asenyarzc-cpu/Twilight-Echo-plugins/`
- Local path: `D:\Twilight-Echo-plugins`

Future third-party plugins should be added under
`D:\Twilight-Echo-plugins\plugins\<plugin-name>\`, packaged into
`D:\Twilight-Echo-plugins\packages\`, and indexed by
`D:\Twilight-Echo-plugins\plugins.json`. The app consumes that repository
through `TWILIGHT_PLUGIN_INDEX_URL`, pointed at the GitHub raw `plugins.json` URL
or a future self-hosted HTTPS `plugins.json`.

Built-in application plugins are the exception. NetEase Cloud Music remains
owned by the app repository because it is a bundled base provider, synced by the
host, enabled by default, and not uninstallable like third-party plugins.

## Manifest

Required `plugin.json` fields:

- `id`: reverse-domain globally unique id, such as `com.example.discord-status`
- `name`
- `version`: semver
- `description`
- `author`
- `license`: SPDX identifier
- `type`: array of `provider`, `tool`, `ui`, `theme`, `dsp`
- `main`: JS entry path, required for JS plugins unless `binary` is present; pure theme plugins can omit it
- `binary`: platform dynamic-library map for native DSP plugins
- `engines.twilightEcho`: compatible host version range
- `apiVersion`: plugin API major version
- `permissions`: explicit permission declarations

JS plugins declare `main`, DSP plugins declare `binary`, and pure theme plugins
can use `contributes.themes` to declare CSS variables/stylesheets without an
executable entry. If `type` contains `dsp`, `binary` is required. Optional fields are `contributes`,
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

Third-party providers use the same public provider API.
`com.twilightecho.provider.bilibili` is maintained as an external `provider +
ui` plugin rather than an app-bundled provider. It can be served from a separate
GitHub plugin repository or a private plugin server index. When installed and
enabled, it exposes provider id `bili`, uses Web QR login through
`getQrLogin()` / `checkQrLogin()`, stores Bilibili cookies only in its private
settings file, and maps favorite videos to audio-only tracks with stable ids
`bili:<bvid>:<cid>`. Playback URLs may be local `127.0.0.1` loopback proxy URLs
owned by the plugin so the renderer audio element can play DASH audio without
downloading or showing video.

The API gateway enforces provider registration permissions. Provider plugins
must declare `network`; providers that expose the `library` capability must also
declare `library:read`. Provider IDs are single-owner at runtime. `ncm` and
`local` remain reserved for the built-in NetEase provider and the local library
track prefix.

## Phase 3 Event And UI Baseline

Tool plugins can subscribe through `context.twilight.events.on`. The normalized
Phase 3 events are `app:ready`, `app:before-quit`, `player:track-change`,
`player:play`, `player:pause`, `player:stop`, `player:progress`,
`player:queue-change`, and `player:playback-info`. Existing `audioEngine:*`
events remain available for low-level diagnostics.

The host validates event subscriptions at the API gateway. `player:*` and
compatibility `audioEngine:*` events require `player:observe`; public `app:*`
lifecycle events carry no sensitive payload. Future `library:*` events require
`library:read`, and unknown event names are rejected.

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

## Phase 5 Ecosystem Baseline

Twilight Echo ships local-publishable ecosystem tooling:

- `@twilight-echo/plugin-api` exports the authoritative API v1 typings for
  manifests, lifecycle context, providers, events, UI/theme contributions, and
  native DSP diagnostics.
- `create-twilight-plugin` scaffolds `tool`, `provider`, `ui-tool`, and `theme`
  plugins, then packages any valid plugin root as a `.tep` archive.
- `plugins.json` is a schemaVersion 1 index. Entries repeat the plugin
  manifest fields and add `sourceUrl`, `checksumSha256`, `tags`, and
  `verified`.

The app reads the GitHub raw index at
`https://raw.githubusercontent.com/asenyarzc-cpu/Twilight-Echo-plugins/main/plugins.json`
by default. `TWILIGHT_PLUGIN_INDEX_URL` may override it with any HTTPS
`plugins.json` endpoint or a localhost HTTP test index. Successful remote
loads are cached in user data; remote failures fall back to the cached index,
then to the bundled offline index. Index installation validates protocol,
package size, sha256 checksum, and the packaged manifest before delegating to
the normal trust-based installer. The index cannot install or overwrite bundled
plugins such as `com.twilightecho.provider.ncm`.
