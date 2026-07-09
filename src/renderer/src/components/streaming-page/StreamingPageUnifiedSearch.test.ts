import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../StreamingPage.vue', import.meta.url), 'utf8')

test('streaming page exposes unified song search beyond the NetEase-only surface', () => {
  assert.match(source, /useMediaProviders\(\)/)
  assert.match(source, /mediaProviders\.searchAllSongs\(\{/)
  assert.match(source, /localTracks: musicStore\.tracks\.value/)
  assert.match(source, /searchUnifiedSongs/)
  assert.match(source, /const showUnifiedSearch = computed/)
  assert.doesNotMatch(source, /const showNcmSearch = computed/)
})

test('streaming page keeps third-party providers on the generic provider library surface', () => {
  assert.doesNotMatch(source, /import BilibiliPage/)
  assert.doesNotMatch(source, /<BilibiliPage/)
  assert.doesNotMatch(source, /showBilibiliView/)
  assert.doesNotMatch(source, /shouldShowBilibiliViewForSidebarProvider/)
  assert.doesNotMatch(source, /activeProvider\.value === 'bili'/)
  assert.doesNotMatch(source, /bilibili\.setPinnedFavoriteFolder/)
})

test('recent playback detail uses local unified listening history before provider recent APIs', () => {
  assert.match(source, /getRecentTracks\(\)/)
  assert.match(source, /resolveUnifiedRecentTracks\(\{/)
  assert.match(source, /recentStats/)
  assert.match(source, /localTracks: musicStore\.tracks\.value/)
  assert.doesNotMatch(source, /const tracks = await fetchRecentSongs\(\)/)
})

test('ranking detail uses cross-source listening stats before provider play records', () => {
  assert.match(source, /getTopTracks\(\)/)
  assert.match(source, /topStats/)
  assert.match(source, /resolveUnifiedRecentTracks\(\{/)
  assert.doesNotMatch(source, /const tracks = await fetchPlayRecords\(1\)/)
})

test('liked detail uses unified default favorites before provider liked APIs', () => {
  assert.match(source, /summarizeUnifiedFavorites\(\{/)
  assert.match(source, /resolveUnifiedFavoriteTracks\(\{/)
  assert.match(
    source,
    /const unifiedFavoriteTracks = computed\(\(\) => musicStore\.getPlaylistTracks\('我收藏的音乐'\)\)/
  )
  assert.match(source, /if \(unifiedTracks\.length > 0\)/)
})

test('local dashboard top tracks resolve logical stats to playable local variants', () => {
  const dashboardSource = readFileSync(new URL('../LocalDashboard.vue', import.meta.url), 'utf8')

  assert.match(
    dashboardSource,
    /import \{ createUnifiedRecentTrackResolver \} from '\.\.\/utils\/unifiedRecentTracks'/
  )
  assert.match(dashboardSource, /getMostListenedTracks\(TOP_TRACK_COUNT\)/)
  assert.match(dashboardSource, /createUnifiedRecentTrackResolver\(tracks\.value\)/)
  assert.doesNotMatch(dashboardSource, /recentStats: \[stat\]/)
  assert.doesNotMatch(dashboardSource, /Object\.entries\(listeningStats\.value\.tracks\)/)
  assert.doesNotMatch(dashboardSource, /track: byId\.get\(id\) \?\? stat\.track/)
})
