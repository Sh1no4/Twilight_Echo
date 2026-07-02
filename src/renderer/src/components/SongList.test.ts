import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

test('song list exposes local metadata match confidence from provider enrichment', () => {
  const source = readFileSync(new URL('./SongList.vue', import.meta.url), 'utf8')

  assert.match(source, /function metadataMatchLabel\(track: Track\): string/)
  assert.match(source, /function metadataMatchTitle\(track: Track\): string/)
  assert.match(source, /track\.metadataMatch/)
  assert.match(source, /class="metadata-match-chip"/)
  assert.match(source, /v-if="track\.metadataMatch"/)
  assert.match(source, /:title="metadataMatchTitle\(track\)"/)
})

test('song list wires clear metadata match action into the context menu', () => {
  const source = readFileSync(new URL('./SongList.vue', import.meta.url), 'utf8')

  assert.match(source, /clearTrackMetadataMatch/)
  assert.match(source, /clearMetadataMatch:/)
  assert.match(source, /canClearMetadataMatchSelectedTrack/)
  assert.match(source, /handleClearMetadataMatch/)
  assert.match(source, /取消流媒体匹配/)
})

test('song list manual matching uses ranked metadata match candidates', () => {
  const source = readFileSync(new URL('./SongList.vue', import.meta.url), 'utf8')

  assert.match(source, /buildMetadataMatchCandidates/)
  assert.match(source, /const candidates = buildMetadataMatchCandidates\(/)
  assert.match(source, /const rematched = candidates\[0\]\?\.track/)
})

test('song list wires local metadata rematch into the context menu', () => {
  const source = readFileSync(new URL('./SongList.vue', import.meta.url), 'utf8')

  assert.match(source, /async function handleMetadataRematch\(track: Track\): Promise<void>/)
  assert.match(source, /applyTrackMetadataMatch/)
  assert.match(source, /rematchMetadata: handleMetadataRematch/)
  assert.match(source, /canRematchMetadataSelectedTrack/)
  assert.match(source, /handleRematchMetadata/)
  assert.match(source, /重新匹配流媒体元数据/)
})

test('song list all songs search uses unified local and provider results', () => {
  const source = readFileSync(new URL('./SongList.vue', import.meta.url), 'utf8')

  assert.match(source, /useUnifiedMusicSearch/)
  assert.match(source, /unifiedSearch\.search\(q/)
  assert.match(source, /unifiedSearch\.items\.value\.map\(\(item\) => item\.track\)/)
  assert.match(source, /props\.category === 'allSongs'/)
})

test('song list exposes unified search loading errors and provider health in the local search UI', () => {
  const source = readFileSync(new URL('./SongList.vue', import.meta.url), 'utf8')

  assert.match(source, /unifiedSearchStatusText/)
  assert.match(source, /unifiedSearchHealthItems/)
  assert.match(source, /unified-search-status/)
  assert.match(source, /unified-search-health-chip/)
  assert.match(source, /unifiedSearch\.loading\.value/)
  assert.match(source, /unifiedSearch\.error\.value/)
  assert.match(source, /providerHealth\.value/)
  assert.match(source, /health\.lastError/)
})

test('song list unified search health chips include plugin and playback URL diagnostics', () => {
  const source = readFileSync(new URL('./SongList.vue', import.meta.url), 'utf8')

  assert.match(source, /unifiedSearchHealthDetail\(health\)/)
  assert.match(source, /health\.pluginStatus/)
  assert.match(source, /health\.successRate/)
  assert.match(source, /health\.playbackUrlSuccessRate/)
  assert.match(source, /health\.playbackUrlLastError/)
  assert.match(source, /播放 URL/)
  assert.match(source, /插件/)
})

test('song list shows generic source badges for mixed local and provider search results', () => {
  const source = readFileSync(new URL('./SongList.vue', import.meta.url), 'utf8')

  assert.match(source, /unifiedSearchSourceNames/)
  assert.match(source, /trackSourceLabel\(track\)/)
  assert.match(source, /trackSourceClass\(track\)/)
  assert.match(source, /isLosslessTrack\(track\)/)
  assert.match(source, /class="track-source-chip"/)
  assert.match(source, /本地无损/)
  assert.match(source, /item\.sourceName/)
})

test('song list playlist cards expose mixed-source composition', () => {
  const source = readFileSync(new URL('./SongList.vue', import.meta.url), 'utf8')
  const styles = readFileSync(new URL('./song-list/SongList.css', import.meta.url), 'utf8')

  assert.match(source, /summarizePlaylistSources/)
  assert.match(source, /formatPlaylistSourceSummary/)
  assert.match(source, /function playlistSourceSummaryLabel\(playlist: GridItem\): string/)
  assert.match(source, /class="playlist-source-summary"/)
  assert.match(source, /playlistSourceSummaryLabel\(playlist\)/)
  assert.match(styles, /\.playlist-source-summary/)
})

test('song list surfaces library repair status for moved or unresolved local files', () => {
  const source = readFileSync(new URL('./SongList.vue', import.meta.url), 'utf8')
  const styles = readFileSync(new URL('./song-list/SongList.css', import.meta.url), 'utf8')

  assert.match(source, /libraryRepairReport/)
  assert.match(source, /libraryRepairStatusText/)
  assert.match(source, /已自动重定位/)
  assert.match(source, /本地文件未找到/)
  assert.match(source, /重新匹配音源/)
  assert.match(source, /class="library-repair-status"/)
  assert.match(styles, /\.library-repair-status/)
})
