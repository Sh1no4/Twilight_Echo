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

Runtime permission checks:

- `player:*` and compatibility `audioEngine:*` subscriptions require
  `player:observe`.
- `app:ready` and `app:before-quit` are public lifecycle events.
- Future `library:*` events require `library:read`; unknown event names are
  rejected instead of being silently registered.

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
Provider registration requires `network`; declaring the `library` capability
also requires `library:read`. Provider IDs are single-owner at runtime, and
host-owned prefixes such as `ncm` and `local` are reserved.

```ts
type MediaProviderCapability =
  | 'search'
  | 'playbackUrl'
  | 'lyrics'
  | 'cover'
  | 'playlist'
  | 'library'
  | 'login'

interface Track {
  id: string
  title: string
  artist: string
  album: string
  filePath: string
  fileName: string
  duration: number
  size: number
  cover: string | null
  lyrics: string | null
  translatedLyrics?: string | null
  source?: string
  streamUrl?: string | null
  bpm?: number
}

interface TwilightProviderRequestContext {
  signal: AbortSignal
  idempotencyKey?: string
}

interface TwilightUiCommandContext {
  signal: AbortSignal
}

interface MediaProviderRegistration {
  id: string
  name: string
  capabilities: MediaProviderCapability[]
  health?: TwilightMediaProviderHealth
  getPlaybackUrl?(track: Track, options?: { force?: boolean }): Promise<string | null>
  /**
   * Optional lyrics payload. `wordLyrics` is preferred for timed/word-level
   * display when present (e.g. NetEase YRC). Host may also fan out title+artist
   * search across lyric-capable providers for local library tracks.
   */
  getLyrics?(track: Track): Promise<{
    lyrics: string | null
    translatedLyrics: string | null
    wordLyrics?: string | null
  }>
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
  followArtist?(artistId: string | number, follow: boolean, context?: TwilightProviderRequestContext): Promise<void>
  followUser?(userId: string | number, follow: boolean, context?: TwilightProviderRequestContext): Promise<void>
  likeTrack?(trackId: string | number, like: boolean, context?: TwilightProviderRequestContext): Promise<void>
  isTrackLiked?(trackId: string | number | undefined, context?: TwilightProviderRequestContext): Promise<boolean> | boolean
}
```

Every callable provider method accepts an optional `TwilightProviderRequestContext` as its final
argument; only the write signatures are expanded above to keep the sketch compact. The host appends
that context without breaking v1 handlers that ignore extra arguments. Timeout, disable, uninstall,
utility-process error/exit, and shutdown send protocol-level cancel and abort `signal`. Late results
are quarantined. The default per-plugin limit is 4 active + 32 queued RPCs; 3 consecutive failures
open an exponential-backoff circuit (1s to 30s, single half-open probe).

Writes (`likeTrack`, `followArtist`, `followUser`) receive an idempotency key that remains stable for
an unknown-outcome retry of the same logical payload and changes after success or a payload change.
Providers must forward it to an upstream idempotency facility or persistently deduplicate it.

```ts
interface TwilightMediaProviderHealth {
  providerId: string
  pluginId: string
  pluginStatus: TwilightPluginStatus
  available: boolean
  totalCalls: number
  successfulCalls: number
  failedCalls: number
  successRate: number
  methodStats: Partial<Record<TwilightMediaProviderMethod, TwilightMediaProviderMethodHealth>>
  lastError: string | null
  lastCheckedAt: string | null
}

interface TwilightMediaProviderMethodHealth {
  totalCalls: number
  successfulCalls: number
  failedCalls: number
  successRate: number
  lastError: string | null
  lastCheckedAt: string | null
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

`Track.bpm` is optional, measured in beats per minute, and should be a finite
positive number in the normal music tempo range. Providers should omit it when
the upstream source has no trustworthy BPM metadata.

The NetEase Cloud Music integration is dogfooded as Twilight Echo's bundled
base provider plugin. Its plugin id is `com.twilightecho.provider.ncm`, its
provider id is `ncm`, it ships with the app, is enabled by default, can be
disabled, and cannot be uninstalled like a third-party plugin. Existing renderer
UI can keep its compatibility store, but that store must call `providers.call`
instead of `window.api.ncm` or host cookie IPC.

The bundled NetEase plugin receives a private internal gateway for the local NCM
API and song cache. This gateway is not part of the public third-party plugin
API and is rejected for all other plugin ids. Its write path forwards cancellation
and the host-managed idempotency key to the local NCM gateway when supported;
successful deduplication records are bounded and persist for five minutes.

Provider login UIs should prefer `getQrLogin()` when present. It lets a plugin
return a provider-native QR payload such as a URL, while the renderer owns QR
image generation. Older providers can keep `getQrKey()` plus `getQrImage()`.

Provider health is part of the public API contract. Plugins may provide an
initial `health` snapshot when registering, and the host records aggregate and
per-method call health while routing provider calls. Streaming UI should prefer
`methodStats.getPlaybackUrl` when explaining playback URL failures, because a
provider can be logged in and searchable while still failing to produce playable
URLs. Health status must remain provider-generic; platform-specific risk-control
or login messages belong in provider errors and logs, not host-side platform
branches.

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

context.twilight.ui.onCommand('myPlugin.scrobble', async (track, request) => {
  request.signal.throwIfAborted()
  context.logger.info(`Scrobble requested for ${track?.title ?? 'unknown track'}`)
  return { ok: true }
})
```

UI command handlers likewise receive `TwilightUiCommandContext` as the final argument. The signal is
aborted on timeout or plugin lifecycle shutdown, and any result produced after cancellation is ignored.

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

UI commands may return a string or JSON-serializable object. The host renders
that result as text/structured data in a controlled surface. Arbitrary
plugin-provided HTML, `srcdoc` frames, and DOM injection are not supported.
Legacy `renderMode: 'html'` input is normalized to command-only rendering.

UI contributions require `type` containing `ui` or `tool` and permission
`ui:inject`.

## Themes

Pure theme plugins declare CSS variables and/or one packaged stylesheet in
`plugin.json` and do not execute plugin scripts. Theme stylesheets are resolved
inside the installed plugin directory and cannot point outside the package.

```json
{
  "type": ["theme"],
  "permissions": [],
  "contributes": {
    "themes": [
      {
        "id": "nocturne",
        "name": "Nocturne",
        "variables": {
          "--te-primary-500": "#38bdf8"
        },
        "stylesheet": "theme.css"
      }
    ]
  }
}
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

ABI v2 is `TAE_DSP_PLUGIN_ABI_VERSION_V2 = 2`. It appends the supported channel
layouts, sample-rate range, declared latency and tail, and an optional `flush`
callback. Hosts read those fields only when `struct_size` covers the v2 tail.
ABI v1 plugins stay fixed after built-in graph nodes and before terminal output
protection. ABI v2 plugins can be compiled as ordered graph nodes after the
host validates their format, layout, latency, and tail declarations.

The host engine exposes:

```ts
TAE_SetDspPluginChain(chainJson)
TAE_GetDspPluginStatus()
TAE_SetDspGraph(graphJson)
TAE_GetDspGraphStatus()
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

### VST3 External Effects

Windows x64 VST3 modules are a managed external-effects integration, not
Twilight `.tep` plugins and not plugin-index or marketplace entries. The app
scans only standard or explicitly user-authorized directories, stores module
metadata and state in the managed DSP asset library, and never copies a
third-party VST3 binary into this repository or a `.tedsp` configuration pack.
Only single main input/output buses with exact Mono, Stereo, 5.1, or 7.1 layout
matches are eligible. Vendor GUIs, VST2, AU, LV2, sidechains, and multi-bus
modules are outside the host contract.

Each VST3 module is probed in an isolated scanner process and executed through
the restartable audio service. A timeout, crash, architecture/signature failure,
or invalid metadata quarantines only that catalog entry. After an audio-service
restart, affected VST3 graph nodes remain bypassed until the user explicitly
reenables them. Like all sample-processing effects, VST3 nodes are bypassed on
DSD Direct and DoP paths until the user confirms PCM fallback.

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
  publisherSignature?: { schemaVersion: 1; algorithm: 'ed25519'; keyId: string; value: string }
  /** Index publisher claim only; never an official-trust decision by itself. */
  verified?: boolean
  verification: {
    level: 'official' | 'publisher-signed' | 'index-declared' | 'unverified'
    official: boolean
    officialSource: boolean
    indexClaimed: boolean
    signatureStatus: string
    keyId: string | null
    publisher: string | null
    keyFingerprintSha256: string | null
    reason: string
  }
  installState?: 'not-installed' | 'installed' | 'update-available' | 'incompatible' | 'built-in-blocked'
  installedVersion?: string
}

interface TwilightPluginIndexStatus {
  sourceUrl: string
  configuredSourceUrl: string
  sourceKind: 'github' | 'custom' | 'bundled'
  loadedFrom: 'remote' | 'cache' | 'bundled'
  lastFetchedAt: string | null
  expiresAt: string | null
  loadedAt: string
  stale: boolean
  expired: boolean
  originVerified: boolean
  officialSource: boolean
  cacheFormat: 'envelope-v1' | 'legacy' | null
  trustStoreError: string | null
  error: string | null
}

window.api.plugins.listIndex(): Promise<TwilightPluginIndexEntry[]>
window.api.plugins.refreshIndex(): Promise<TwilightPluginIndexEntry[]>
window.api.plugins.getIndexStatus(): Promise<TwilightPluginIndexStatus>
window.api.plugins.installFromIndex(id: string): Promise<TwilightPluginInstallResult>
```

The index schema is static JSON with `schemaVersion: 1`. `verified` remains for
API v1 compatibility but means only an index claim. Official trust is the
derived result of an exact fixed origin, fresh direct load, non-expired cache
evidence, and a valid active trusted-publisher Ed25519 signature. Installation
validates the package checksum and then uses the same trust-based manifest
validation path as local `.tep` installation.

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
