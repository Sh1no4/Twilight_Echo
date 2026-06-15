# Twilight Echo Plugin Specification

This document freezes the Phase 0 contract for the Phase 1 plugin host and adds
the Phase 2 bundled provider requirements now implemented in the app. It is
derived from `docs/twilight-echo-plugin-spec.md` and keeps that document as the
product-level source of truth.

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

## Phase 1 Boundaries

Phase 1 implements generic plugin discovery, local install, activation,
deactivation, uninstall, dependency-order loading, private plugin settings,
logs, and management UI.

Phase 1 does not implement renderer UI injection, theme loading, or native DSP C
ABI loading. Native DSP plugins are shown with a warning but not activated
through the engine.

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
