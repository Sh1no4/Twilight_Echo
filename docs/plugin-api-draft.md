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
  settings: PluginPrivateSettings
  logger: PluginLogger
  twilight: TwilightApi
}
```

`storagePath` points to `plugin-data/<id>/`. Plugins should keep private data
there and should not mutate app files elsewhere.

```ts
interface PluginPrivateSettings {
  get(key?: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}
```

`settings` reads and writes `plugin-data/<id>/settings.json`. It is plugin
private storage only; host application settings are not exposed in Phase 1.

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

## Dependencies

Plugins may declare optional package dependencies in `plugin.json`:

```json
{
  "dependencies": {
    "com.example.base": ">=1.0.0"
  }
}
```

Dependencies are checked at enable/startup time. Missing, disabled,
incompatible, or cyclic dependencies mark the dependent plugin as failed and
write the reason to its log. The host does not auto-install or auto-enable
dependencies.

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

Phase 3 supported event names:

- `app:ready`
- `app:before-quit`
- `player:track-change`
- `player:play`
- `player:pause`
- `player:stop`
- `player:progress`
- `player:queue-change`
- `player:playback-info`

The existing `audioEngine:*` events remain available as compatibility events for
low-level diagnostics. Tool plugins should prefer the normalized `player:*` and
`app:*` names.

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
  checkLogin?(): Promise<{ loggedIn: boolean; profile: ProviderProfile | null }>
  getProfile?(): Promise<ProviderProfile | null>
  logout?(): Promise<void>
  getQrLogin?(): Promise<{ key: string; qrContent?: string; imageDataUrl?: string; expiresInSeconds?: number } | null>
  getQrKey?(): Promise<string | null>
  getQrImage?(key: string): Promise<string | null>
  checkQrLogin?(key: string): Promise<{ code: number }>
  fetchUserLibrary?(force?: boolean): Promise<{ likedPlaylist: PlaylistSummary | null; playlists: PlaylistSummary[] }>
  fetchLikedTracks?(force?: boolean): Promise<Track[]>
  fetchRecommendSongs?(): Promise<Track[]>
  fetchRecommendPlaylists?(): Promise<PlaylistSummary[]>
  fetchPersonalFm?(): Promise<Track[]>
  fetchPrivateContent?(): Promise<Track[]>
  fetchArtistTopSongs?(artistId: string | number): Promise<Track[]>
  fetchArtistPlaylists?(artistId: string | number): Promise<PlaylistSummary[]>
  fetchUserPlaylistsByUid?(uid: string | number): Promise<PlaylistSummary[]>
  fetchUserFollows?(uid: string | number, limit?: number, offset?: number): Promise<UserSummary[]>
  fetchUserFolloweds?(uid: string | number, limit?: number, offset?: number): Promise<UserSummary[]>
  likeTrack?(trackId: string | number, like: boolean): Promise<void>
  isTrackLiked?(trackId: string | number | undefined): Promise<boolean> | boolean
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

The NetEase Cloud Music integration is dogfooded as Twilight Echo's bundled
base provider plugin. Its plugin id is `com.twilightecho.provider.ncm`, its
provider id is `ncm`, it ships with the app, is enabled by default, can be
disabled, and cannot be uninstalled like a third-party plugin. Existing renderer
UI can keep its compatibility store, but that store must call `providers.call`
instead of `window.api.ncm` or host cookie IPC.

The bundled NetEase plugin receives a private internal gateway for the local NCM
API and song cache. This gateway is not part of the public third-party plugin
API and is rejected for all other plugin ids.

Provider login UIs should prefer `getQrLogin()` when present. It lets a plugin
return a provider-native QR payload such as a URL, while the renderer owns QR
image generation. Older providers can keep `getQrKey()` plus `getQrImage()`.

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
  return { ok: true }
})
```

Initial controlled UI contribution kinds:

- `playerBarButton`: rendered in the PlayerBar more drawer and must declare `command`.
- `settingsPanel`: rendered as a plugin settings entry and may declare `command`.
- `sidebarPage`: rendered in the local sidebar as a controlled host page and
  must declare `command`.
- `localSidebarItem`: rendered in the local music sidebar and must declare `command`.
- `streamingHome`: rendered as a controlled streaming entry point.

UI commands are request/response calls. The host waits for completion with a
short timeout and returns the plugin handler result to the renderer. Command
failures mark only the owning plugin as failed and are written to that plugin's
log.

UI contributions may set `renderMode` to `command` or `html`. `command` is the
default and only runs the command. `html` expects the command to return an HTML
string for controlled iframe rendering. `autoLoad` controls whether the command
runs when the page opens; `html` contributions default to auto-loading.

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
load remote runtime code. The renderer applies only the plugin theme selected by
the user in Settings -> Appearance; disabling or uninstalling that plugin clears
the selected plugin theme.

## Native DSP Plugins

Phase 4 adds the native DSP track. A native DSP plugin declares `type:["dsp"]`,
`permissions:["dsp:native"]`, and a platform `binary` entry. Pure DSP plugins do
not run in the JS plugin host; enabling them updates the audio engine native DSP
chain.

The C ABI entrypoint is:

```c
const tae_dsp_plugin_info* tae_plugin_get_info(void);
```

ABI v1 is `TAE_DSP_PLUGIN_ABI_VERSION = 1` and supports float32 interleaved PCM.
The info table provides `create`, `destroy`, `prepare`, `process`, `set_param`,
`reset`, and parameter metadata. ABI structs may only append fields at the tail.

The host engine exposes:

```ts
TAE_SetDspPluginChain(chainJson)
TAE_GetDspPluginStatus()
PlaybackInfo.outputInfo.nativeDsp
```

Native DSP plugins are bypassed on prepare/process errors, unsupported formats,
and repeated realtime-budget overruns. DSD / passthrough paths bypass native DSP
v1 processors.

`PlaybackInfo.outputInfo.nativeDsp.plugins[]` reports `id`, `name`, `version`,
`enabled`, `loaded`, `active`, `bypassed`, `bypassReason`, `lastError`,
`processCalls`, `overrunCount`, `lastProcessMs`, `maxProcessMs`, and
`parameters[]`. Parameter entries include `id`, `name`, `type`, `defaultValue`,
`minValue`, `maxValue`, `step`, `unit`, `enumValues`, and `currentValue`; the
management UI uses them to render bool, int, float, and enum controls.

In production the native audio engine is hosted by a restartable Audio Engine
Service by default. A DSP plugin hard crash restarts that service, clears the
native DSP chain, and marks enabled DSP plugins failed instead of exiting the
Electron main process. `TWILIGHT_AUDIO_SERVICE=0` is reserved as a development
fallback for direct native binding.

## Phase 5 Typings, CLI, And Index API

Developer typings are exported from `@twilight-echo/plugin-api`:

```ts
import type { TwilightPluginContext, TwilightPluginManifest } from '@twilight-echo/plugin-api'
```

The official CLI is `create-twilight-plugin`:

```bash
create-twilight-plugin init my-provider --type provider --id com.example.provider
create-twilight-plugin pack ./my-provider
```

Renderer/preload exposes the plugin index through the existing `plugins`
namespace:

```ts
interface TwilightPluginIndexEntry extends TwilightPluginManifest {
  sourceUrl: string
  checksumSha256: string
  tags?: string[]
  verified?: boolean
  installState?: 'not-installed' | 'installed' | 'update-available' | 'incompatible' | 'built-in-blocked'
  installedVersion?: string
}

interface TwilightPluginIndexStatus {
  sourceUrl: string
  sourceKind: 'github' | 'custom' | 'bundled'
  loadedFrom: 'remote' | 'cache' | 'bundled'
  lastFetchedAt: string | null
  stale: boolean
  error: string | null
}

window.api.plugins.listIndex(): Promise<TwilightPluginIndexEntry[]>
window.api.plugins.refreshIndex(): Promise<TwilightPluginIndexEntry[]>
window.api.plugins.getIndexStatus(): Promise<TwilightPluginIndexStatus>
window.api.plugins.installFromIndex(id: string): Promise<TwilightPluginInstallResult>
```

The index schema is static JSON with `schemaVersion: 1`. Installation validates
the package checksum and then uses the same trust-based manifest validation path
as local `.tep` installation.

## Host Capability Audit

- `usePlayerStore`: maps to player observe/control API through main-process
  `audioEngineManager`.
- `useMusicStore`: kept internal in Phase 1; library API waits for provider and
  library contract work.
- `useNcmStore`: Phase 2 wraps this compatibility store as the internal `ncm`
  `MediaProvider`; playback URL and lyrics resolution now use the provider
  facade before direct store access.
- `useSettingsStore`: plugin-private settings are supported through
  `context.settings` backed by `plugin-data/<id>/settings.json`; host settings
  mutation is not exposed in Phase 1.
- Main-process IPC: plugins do not call existing `audioEngine:*`, `data:*`, or
  `settings:*` channels directly.
- `audioEngineManager`: event and playback operations are bridged by the plugin
  API gateway.
- UI/theme extension points: Phase 3 exposes controlled DTO registration for
  PlayerBar buttons, settings entries, sidebar pages, and declarative themes.
- Native DSP: Phase 4 exposes a C ABI plugin chain through the audio engine
  service; JS plugins and native DSP plugins remain separate compatibility
  tracks.

## Examples

A Discord status sync plugin can subscribe to `player:playback-info` and publish
status externally after declaring `network` and `player:observe`.

A Bilibili provider plugin can be described by the manifest and
`MediaProvider` shape without changing this host contract. Twilight Echo treats
`com.twilightecho.provider.bilibili` as an external third-party `provider + ui`
plugin that can be distributed from a separate plugin repository or a private
server index. It uses Bilibili Web QR login, stores cookies in
`plugin-data/com.twilightecho.provider.bilibili/settings.json`, lists the
signed-in user's video favorite folders, and returns `127.0.0.1` loopback audio
proxy URLs for `bili:<bvid>:<cid>` tracks.
