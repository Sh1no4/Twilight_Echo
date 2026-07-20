# Search And Library Identity

## Search Requests

Renderer search state is committed only by the latest monotonically increasing request id.
Each Streaming search snapshots `query`, `type`, `source`, and `offset` before calling a
provider. Unified search snapshots its query and pagination inputs. A later response from an
older snapshot must not change results, loading state, or error state.

`pagehide` and component disposal invalidate outstanding request ids. They do not make a
network request successful or turn an old response into current UI state.

## Album Identity

The album display name is not an identity. Local-library album groups use `albumId` when
available. Otherwise they use the normalized `albumArtist + album` tuple, with `artist` as the
legacy fallback for files that do not carry an album-artist tag. Album navigation and Vue keys
use this group id, so two artists with the same album title remain separate.

## Folder Identity

Folder cards represent configured scan roots. A root owns tracks whose normalized file paths are
equal to the root or start with the root followed by a path separator. This includes nested
directories while excluding similarly prefixed siblings such as `C:\\music-other` for the root
`C:\\music`.
