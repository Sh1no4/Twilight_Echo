# @twilight-echo/plugin-api

TypeScript typings for Twilight Echo plugin API v1.

```ts
import type { TwilightPluginContext } from '@twilight-echo/plugin-api'

export async function activate(context: TwilightPluginContext): Promise<void> {
  context.logger.info(`Hello from API v${context.apiVersion}`)
}
```

This package is types-first. Runtime capabilities are injected by Twilight Echo
through `activate(context)`.

The v1 UI typings include the controlled extension points currently exposed by
the host: `playerBarButton`, `settingsPanel`, `sidebarPage`,
`localSidebarItem`, and `streamingHome`. UI contributions may also declare
`renderMode` and `autoLoad`.
