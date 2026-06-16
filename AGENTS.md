# Twilight Echo Project Rules

These rules are mandatory when working in `D:\Twilight_Echo-main`.

## Plugin System Source Of Truth

- Follow `docs/twilight-echo-plugin-spec.md` and `docs/twilight-echo-plugin-plan.md` before designing or editing plugin-system code.
- The Twilight Echo plugin standards in this repository override generic Codex plugin conventions.
- Do not silently simplify, rename, or replace plugin-system requirements. If a requirement conflicts with the current codebase, explain the conflict before choosing an alternative.

## Plugin Repository Boundary

- Do not write third-party plugin source code into the Twilight Echo app repository.
- The app repository may contain only host/runtime code, built-in app plugins such as `com.twilightecho.provider.ncm`, plugin API typings, plugin tooling, built-in examples needed for host validation, and the bundled/static index client.
- Third-party plugin source, tests, packaged `.tep` artifacts, and plugin-specific README files belong in the external plugin repository:
  - GitHub: https://github.com/asenyarzc-cpu/Twilight-Echo-plugins/
  - Local path: `D:\Twilight-Echo-plugins`
- Future third-party plugins must be added under `D:\Twilight-Echo-plugins\plugins\<plugin-name>\`, packaged into `D:\Twilight-Echo-plugins\packages\`, and indexed by `D:\Twilight-Echo-plugins\plugins.json`.
- The app should consume third-party plugins through `TWILIGHT_PLUGIN_INDEX_URL`, pointed at the GitHub raw `plugins.json` URL or a future self-hosted HTTPS `plugins.json`.
- If a change requires app-side support for a plugin, implement only the generic host/API/UI capability in `D:\Twilight_Echo-main`; keep plugin-specific implementation in `D:\Twilight-Echo-plugins`.

## Built-In Provider Exception

- NetEase Cloud Music remains a built-in base provider plugin owned by the app repository.
- Built-in provider code may live in `resources/plugins/ncm-provider` because it ships with the application, is synced by the host, and cannot be uninstalled like third-party plugins.
- Do not use the NCM exception as precedent for third-party provider plugins.
