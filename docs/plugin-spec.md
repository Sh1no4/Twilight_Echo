# Twilight Echo Plugin Specification

This document freezes the Phase 0 contract for the Phase 1 plugin host. It is
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
`homepage`, `repository`, `icon`, and reserved `signature`.

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
deactivation, uninstall, logs, and management UI.

Phase 1 does not implement NetEase Cloud Music provider dogfooding, renderer UI
injection, theme loading, or native DSP C ABI loading. Native DSP plugins are
shown with a warning but not activated through the engine.
