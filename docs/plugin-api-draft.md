# Twilight Echo Plugin API Draft

Phase 1 exposes the smallest API needed to validate the general plugin host.
The API major version is `1`.

## Lifecycle

```ts
export function activate(context: TwilightPluginContext): void | Promise<void>
export function deactivate(): void | Promise<void>
```

`activate` is called when the user enables a plugin or when an enabled plugin is
restored at app startup. `deactivate` is called before disabling, uninstalling,
or app shutdown.

## Context

```ts
interface TwilightPluginContext {
  apiVersion: number
  storagePath: string
  logger: PluginLogger
  twilight: TwilightApi
}
```

`storagePath` points to `plugin-data/<id>/`. Plugins should keep private data
there and should not mutate app files elsewhere.

## Logging

```ts
interface PluginLogger {
  debug(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}
```

Logs are appended to `logs/plugins/<id>.log` and are visible from the settings
plugin page.

## Events

```ts
interface TwilightEventsApi {
  on(eventName: string, callback: (payload: unknown) => void): () => void
}
```

Phase 1 event names:

- `audioEngine:start-file`
- `audioEngine:end-file`
- `audioEngine:ready`
- `player:playback-info`
- `audioEngine:<property-change-name>`

Phase 3 treats this API as the supported tool/automation event bus. Handlers run
inside the plugin host process; thrown errors fail only that plugin.

## Player

```ts
interface TwilightPlayerApi {
  getPlaybackInfo(): Promise<unknown>
  play(): Promise<void>
  pause(): Promise<void>
  togglePause(): Promise<void>
  stop(): Promise<void>
  next(): Promise<void>
  previous(): Promise<void>
}
```

`getPlaybackInfo` is available to plugins with `player:observe`. Control methods
are intended for plugins declaring `player:control`. Phase 1 records permissions
and displays them at install time; stronger runtime enforcement belongs in the
API gateway expansion.

## Media Providers

Phase 2 introduces the first provider extension point. A provider plugin declares
`type: ["provider"]`, uses provider-prefixed track ids such as `bili:BV...`, and
registers callable provider methods through the versioned API gateway.

```ts
type MediaProviderCapability =
  | 'search'
  | 'playbackUrl'
  | 'lyrics'
  | 'cover'
  | 'playlist'
  | 'library'
  | 'login'

interface MediaProviderRegistration {
  id: string
  name: string
  capabilities: MediaProviderCapability[]
  getPlaybackUrl?(track: Track, options?: { force?: boolean }): Promise<string | null>
  getLyrics?(track: Track): Promise<{ lyrics: string | null; translatedLyrics: string | null }>
  searchSongs?(keywords: string, limit?: number, offset?: number): Promise<{ items: Track[]; total: number }>
  searchPlaylists?(keywords: string, limit?: number, offset?: number): Promise<{ items: PlaylistSummary[]; total: number }>
  searchArtists?(keywords: string, limit?: number, offset?: number): Promise<{ items: ArtistSummary[]; total: number }>
  fetchPlaylistTracks?(playlistId: string | number, force?: boolean): Promise<Track[]>
}

await context.twilight.providers.register({
  id: 'bili',
  name: 'Bilibili Music',
  capabilities: ['search', 'playbackUrl', 'lyrics', 'cover', 'playlist'],
  async searchSongs(keywords) {
    return { items: [], total: 0 }
  },
  async getPlaybackUrl(track) {
    return null
  }
})
```

The built-in NetEase Cloud Music integration is dogfooded as the internal `ncm`
provider. Existing renderer UI can keep its compatibility store while playback
URL and lyrics resolution go through the `MediaProvider` facade.

Provider tracks must keep their source prefix throughout queue, library, and
session persistence:

```ts
const track: Track = {
  id: 'bili:BV1xx',
  filePath: 'bili:BV1xx',
  source: 'bili',
  title: 'Example',
  artist: 'Example Artist',
  album: 'Example Album',
  fileName: 'Example Artist - Example',
  duration: 180,
  size: 0,
  cover: null,
  lyrics: null
}
```

## UI Extension Points

Phase 3 UI plugins register declarative contributions. Renderer code renders
only host-approved DTOs; plugins do not receive arbitrary DOM access.

```ts
await context.twilight.ui.register({
  id: 'my-player-button',
  kind: 'playerBarButton',
  title: 'Scrobble',
  description: 'Publish the current track',
  icon: 'pi pi-send',
  command: 'myPlugin.scrobble'
})

context.twilight.ui.onCommand('myPlugin.scrobble', async (track) => {
  context.logger.info(`Scrobble requested for ${track?.title ?? 'unknown track'}`)
})
```

Initial controlled UI contribution kinds:

- `playerBarButton`: rendered in the PlayerBar more drawer and must declare `command`.
- `settingsPanel`: rendered as a plugin settings entry and may declare `command`.
- `sidebarPage`: reserved Phase 3 slot for custom pages and must declare `command`.

UI contributions require `type` containing `ui` or `tool` and permission
`ui:inject`.

## Themes

Theme plugins register CSS variables and/or one packaged stylesheet. Theme
stylesheets are resolved inside the installed plugin directory and cannot point
outside the package.

```ts
await context.twilight.themes.register({
  id: 'nocturne',
  name: 'Nocturne',
  variables: {
    '--te-primary-500': '#38bdf8'
  },
  stylesheet: 'theme.css'
})
```

Theme plugins are declarative only. They must not execute renderer scripts or
load remote runtime code.

## Host Capability Audit

- `usePlayerStore`: maps to player observe/control API through main-process
  `audioEngineManager`.
- `useMusicStore`: kept internal in Phase 1; library API waits for provider and
  library contract work.
- `useNcmStore`: Phase 2 wraps this compatibility store as the internal `ncm`
  `MediaProvider`; playback URL and lyrics resolution now use the provider
  facade before direct store access.
- `useSettingsStore`: plugin-private settings are supported through
  `storagePath`; host settings mutation is not exposed in Phase 1.
- Main-process IPC: plugins do not call existing `audioEngine:*`, `data:*`, or
  `settings:*` channels directly.
- `audioEngineManager`: event and playback operations are bridged by the plugin
  API gateway.
- UI/theme extension points: Phase 3 exposes controlled DTO registration for
  PlayerBar buttons, settings entries, sidebar pages, and declarative themes.

## Examples

A Discord status sync plugin can subscribe to `player:playback-info` and publish
status externally after declaring `network` and `player:observe`.

A Bilibili provider plugin can be described by the manifest and future
`MediaProvider` shape without changing this Phase 1 host contract; provider
runtime integration starts in Phase 2.
