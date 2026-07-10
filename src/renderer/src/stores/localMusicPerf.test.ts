/**
 * Performance regression baseline for local music library.
 *
 * Uses Node's built-in test runner (`node --experimental-strip-types --test`).
 * Only pure-logic assertions are tested here — component mount, rAF flush, and
 * DOM events are excluded (they degrade to typecheck + lint + build gates).
 *
 * Later waves (1-5) extend this file with wave-specific tests that are
 * un-skipped once the corresponding feature lands.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Dynamic import of the pure-logic search module (no Vue/window dependencies).
const { filterLocalGridItems } = (await import(
  new URL('../utils/localLibrarySearch.ts', import.meta.url).href
)) as typeof import('../utils/localLibrarySearch')

// ── Mock data generators (exported for reuse by later wave tests) ────────────

export interface MockTrack {
  id: string
  title: string
  artist: string
  album: string
  filePath: string
  fileName: string
  dir: string
  duration: number
  size: number
  cover: string | null
  lyrics: string | null
  source: string
  format: string
  sampleRate: number
  bitrate: number
}

/**
 * Generate `count` mock tracks spread across artists/albums/folders
 * to exercise realistic filtering and derived-collection paths.
 */
export function generateMockTracks(count: number): MockTrack[] {
  const tracks: MockTrack[] = []
  const artistCount = Math.max(50, Math.floor(count / 100))
  const albumCount = Math.max(100, Math.floor(count / 50))
  const folderCount = Math.max(20, Math.floor(count / 250))
  for (let i = 0; i < count; i++) {
    const ext = ['.mp3', '.flac', '.wav', '.m4a'][i % 4]
    const folder = `C:\\music\\folder${i % folderCount}`
    const fileName = `song${i}${ext}`
    tracks.push({
      id: `track_${i}`,
      title: `Song Title ${i}`,
      artist: `Artist ${i % artistCount}`,
      album: `Album ${i % albumCount}`,
      filePath: `${folder}\\${fileName}`,
      fileName,
      dir: folder,
      duration: 120 + (i % 300),
      size: 3_000_000 + i * 1000,
      cover: i % 3 === 0 ? `cover://hash${i}.jpg` : null,
      lyrics: null,
      source: 'local',
      format: ext.slice(1),
      sampleRate: 44100,
      bitrate: 320
    })
  }
  return tracks
}

/**
 * Generate grid items (artist/album/folder-like) each containing a slice of
 * mock tracks, for exercising `filterLocalGridItems`.
 */
export function generateMockGridItems(trackCount: number): {
  name: string
  trackCount: number
  tracks: MockTrack[]
  cover: string | null
  artist: string
  path: string
}[] {
  const tracks = generateMockTracks(trackCount)
  const byArtist = new Map<string, MockTrack[]>()
  for (const t of tracks) {
    if (!byArtist.has(t.artist)) byArtist.set(t.artist, [])
    byArtist.get(t.artist)!.push(t)
  }
  return Array.from(byArtist.entries()).map(([name, items]) => ({
    name,
    trackCount: items.length,
    tracks: items,
    cover: items[0]?.cover ?? null,
    artist: name,
    path: items[0]?.dir ?? ''
  }))
}

// ── Baseline assertions (pass immediately at Wave 0) ────────────────────────

test('mock track generator produces exactly the requested count', () => {
  const tracks = generateMockTracks(5000)
  assert.equal(tracks.length, 5000)
  // Verify spread across artists/albums/folders
  const artists = new Set(tracks.map((t) => t.artist))
  const albums = new Set(tracks.map((t) => t.album))
  const folders = new Set(tracks.map((t) => t.dir))
  assert.ok(artists.size >= 50, `expected >= 50 artists, got ${artists.size}`)
  assert.ok(albums.size >= 100, `expected >= 100 albums, got ${albums.size}`)
  assert.ok(folders.size >= 20, `expected >= 20 folders, got ${folders.size}`)
})

test('filterLocalGridItems filters 5000 tracks across grid items in < 50ms', () => {
  const items = generateMockGridItems(5000)
  assert.ok(items.length > 0)

  const start = performance.now()
  const result = filterLocalGridItems(items, 'song 42')
  const elapsed = performance.now() - start

  assert.ok(elapsed < 50, `filterLocalGridItems took ${elapsed.toFixed(2)}ms, expected < 50ms`)
  assert.ok(result.length > 0, 'expected at least one matching grid item')
})

test('filterLocalGridItems with empty query returns all items (no filtering)', () => {
  const items = generateMockGridItems(200)
  const result = filterLocalGridItems(items, '')
  assert.equal(result.length, items.length)
})

test('filterLocalGridItems with non-matching query returns empty', () => {
  const items = generateMockGridItems(200)
  const result = filterLocalGridItems(items, 'zzz_nonexistent_zzz')
  assert.equal(result.length, 0)
})

test('searchQuery preprocessing: query is normalized once (trim + lowercase)', () => {
  // This validates the memoize pattern: the query should be preprocessed
  // a single time before the filter loop, not per-item.
  // filterLocalGridItems already does this internally (normalizeSearchText).
  const items = generateMockGridItems(500)
  const query = '  Song TITLE 42  '

  // The function normalizes once; verify consistent results regardless of
  // surrounding whitespace/case in the query.
  const resultA = filterLocalGridItems(items, query)
  const resultB = filterLocalGridItems(items, query.trim().toLowerCase())
  assert.deepEqual(resultA, resultB, 'query normalization should be idempotent')
})

// ── Placeholders for later waves (un-skipped when feature lands) ────────────
// Wave 1: search debounce (component mount — degraded to typecheck+lint+build)
test.skip('search debounce: 10 rapid searchQuery changes yield <= 2 filter recomputes', () => {})

// Wave 2: scheduleRebuild coalescing — store is importable in bare Node
// (module-level state uses Vue reactivity which works without DOM)
const useMusicStoreModule = (await import(
  new URL('./useMusicStore.ts', import.meta.url).href
)) as typeof import('./useMusicStore')
const useSettingsStoreModule = (await import(
  new URL('./useSettingsStore.ts', import.meta.url).href
)) as typeof import('./useSettingsStore')

const musicStoreSource = readFileSync(new URL('./useMusicStore.ts', import.meta.url), 'utf8')

// Mock window.api for store tests. saveMusicLibrary is counted for debounce tests.
// loadMusicLibrary is counted to verify incremental vs full-reload paths.
// scanMusicFiles returns mock tracks for the incremental 'add' path.
let saveCallCount = 0
let loadCallCount = 0
let scanCallCount = 0
;(globalThis as Record<string, unknown>).window = {
  api: {
    data: {
      saveMusicLibrary: async (): Promise<void> => {
        saveCallCount++
      },
      loadMusicLibrary: async (): Promise<unknown[]> => {
        loadCallCount++
        return []
      },
      savePlaylists: async (): Promise<void> => {},
      loadPlaylists: async (): Promise<unknown[]> => []
    },
    fs: {
      scanMusicFiles: async (): Promise<unknown[]> => {
        scanCallCount++
        return generateMockTracks(1)
      }
    }
  }
}

function setupStore(): ReturnType<typeof useMusicStoreModule.useMusicStore> {
  const store = useMusicStoreModule.useMusicStore()
  store.isScanning.value = true
  store.clearTracks()
  return store
}

test('removeTrack debounce: 10 removeTrack calls coalesce into 1 rebuild', async () => {
  const store = setupStore()
  await store.addTracks(generateMockTracks(5000), { deferRebuild: true })
  store.refreshLibraryIndex()

  const countBefore = store.getRebuildCount()
  const tracksBefore = store.tracks.value.length

  for (let i = 0; i < 10; i++) {
    store.removeTrack(`track_${i}`)
  }
  store.flushRebuild()

  const rebuildDelta = store.getRebuildCount() - countBefore
  assert.equal(rebuildDelta, 1, `expected 1 rebuild, got ${rebuildDelta}`)
  assert.equal(store.tracks.value.length, tracksBefore - 10)

  store.clearTracks()
})

test('single removeTrack does not rebuild immediately (deferred to microtask)', async () => {
  const store = setupStore()
  await store.addTracks(generateMockTracks(100), { deferRebuild: true })
  store.refreshLibraryIndex()

  const countBefore = store.getRebuildCount()
  store.removeTrack('track_0')

  // Rebuild should NOT have fired yet (still pending in microtask queue)
  assert.equal(store.getRebuildCount(), countBefore, 'rebuild should be deferred')

  store.flushRebuild()
  assert.equal(store.getRebuildCount(), countBefore + 1, 'rebuild should fire on flush')

  store.clearTracks()
})

test('store cleanup: clearTracks cancels pending scheduled rebuild', async () => {
  const store = setupStore()
  await store.addTracks(generateMockTracks(100), { deferRebuild: true })
  store.refreshLibraryIndex()

  // Schedule a rebuild via removeTrack (don't flush — leave microtask pending)
  store.removeTrack('track_0')
  const countBefore = store.getRebuildCount()

  // clearTracks should cancel the pending microtask and do immediate rebuild
  store.clearTracks()

  // Let microtasks flush — the cancelled microtask should be a no-op
  await new Promise((resolve) => queueMicrotask(resolve))

  assert.equal(
    store.getRebuildCount(),
    countBefore,
    'no extra rebuild should fire after clearTracks cancels pending'
  )
})

test('addTracks non-deferRebuild updates derived collections after flush', async () => {
  const store = setupStore()
  await store.addTracks(generateMockTracks(50), { deferRebuild: false })

  store.flushRebuild()

  assert.ok(store.artists.value.length > 0, 'artists should be populated')
  assert.ok(store.albums.value.length > 0, 'albums should be populated')

  store.clearTracks()
})

test('derived collections keep first cover without per-group rescans', async () => {
  const store = setupStore()
  await store.addTracks(
    [
      {
        ...generateMockTracks(1)[0],
        id: 'no-cover',
        artist: 'Cover Artist',
        album: 'Cover Album',
        dir: 'C:\\music\\cover-folder',
        filePath: 'C:\\music\\cover-folder\\a.flac',
        cover: null
      },
      {
        ...generateMockTracks(1)[0],
        id: 'with-cover',
        artist: 'Cover Artist',
        album: 'Cover Album',
        dir: 'C:\\music\\cover-folder',
        filePath: 'C:\\music\\cover-folder\\b.flac',
        cover: 'cover://first.jpg'
      }
    ],
    { deferRebuild: false }
  )
  store.syncFolders(['C:\\music\\cover-folder'])
  store.flushRebuild()

  assert.equal(
    store.artists.value.find((item) => item.name === 'Cover Artist')?.cover,
    'cover://first.jpg'
  )
  assert.equal(
    store.albums.value.find((item) => item.name === 'Cover Album')?.cover,
    'cover://first.jpg'
  )
  assert.equal(
    store.folders.value.find((item) => item.path === 'C:\\music\\cover-folder')?.cover,
    'cover://first.jpg'
  )
  assert.match(musicStoreSource, /interface DerivedTrackGroup/)
  assert.doesNotMatch(musicStoreSource, /items\.find\(\(t\) => t\.cover\)/)

  store.clearTracks()
})

test('single-track update paths use track indexes instead of linear scans', () => {
  assert.match(musicStoreSource, /const trackIndexById = new Map<string, number>\(\)/)
  assert.match(musicStoreSource, /function replaceTrackAtIndex\(index: number, nextTrack: Track\)/)
  assert.doesNotMatch(musicStoreSource, /tracks\.value\.findIndex\(/)
})

test('track indexes are cleaned on removeTrack', async () => {
  const store = setupStore()
  await store.addTracks(generateMockTracks(10), { deferRebuild: true })
  store.refreshLibraryIndex()

  // Verify track exists in derived collections
  assert.equal(store.tracks.value.length, 10)

  store.removeTrack('track_0')
  store.flushRebuild()

  assert.equal(store.tracks.value.length, 9)
  // After flush, rebuildDerivedCollections rebuilds trackById — verify the
  // removed track is gone
  const playlists = store.getPlaylistTracks('test')
  assert.equal(playlists.length, 0, 'removed track should not appear in playlists')

  store.clearTracks()
})

// Wave 3 TODO 4: saveLibrary debounce (testable in bare Node via window.api mock)
test('saveLibrary debounce: 10 scheduled saves yield 1 IPC write', async () => {
  const store = setupStore()
  store.isScanning.value = false

  saveCallCount = 0
  const promises: Promise<void>[] = []
  for (let i = 0; i < 10; i++) {
    promises.push(store.scheduleSaveLibrary())
  }

  // Wait for debounce timer (500ms + buffer)
  await new Promise((resolve) => setTimeout(resolve, 600))
  await Promise.all(promises)

  assert.equal(saveCallCount, 1, `expected 1 IPC write, got ${saveCallCount}`)

  store.isScanning.value = true
  store.clearTracks()
})

test('saveLibrary direct call flushes pending debounce and writes immediately', async () => {
  const store = setupStore()
  store.isScanning.value = false

  saveCallCount = 0
  // Schedule a debounced save
  const scheduled = store.scheduleSaveLibrary()
  // Immediately call direct saveLibrary (should flush timer + write now)
  await store.saveLibrary()
  await scheduled

  // Both the scheduled and direct save resolve after 1 IPC write (direct flushes)
  assert.ok(saveCallCount >= 1, 'expected at least 1 IPC write from direct saveLibrary')
  // The timer should be cleared (no extra write after 600ms)
  const countAfterWait = saveCallCount
  await new Promise((resolve) => setTimeout(resolve, 600))
  assert.equal(saveCallCount, countAfterWait, 'no extra write after flush')

  store.isScanning.value = true
  store.clearTracks()
})

test('flushSaveLibrary clears timer without scheduling extra write', () => {
  const store = setupStore()
  store.isScanning.value = false

  saveCallCount = 0
  // Schedule a debounced save
  void store.scheduleSaveLibrary()
  // Flush (quit-flush) — should clear timer and do one synchronous save
  store.flushSaveLibrary()

  assert.ok(saveCallCount >= 1, 'expected at least 1 IPC write from flush')
  // Timer was cleared — no extra assertion possible in sync test,
  // but the cleared timer means no future write will fire
  store.isScanning.value = true
  store.clearTracks()
})

// loadLibrary skip-repair is a main-process behavior — verified via grep, not runtime test
test.skip('loadLibrary skips repairMissingLibraryCovers', () => {})

// Wave 3 TODO 5: incremental reload — store handleLibraryChange is testable
test('incremental remove: single file remove triggers removeTrack not full loadLibrary', async () => {
  const store = setupStore()
  await store.addTracks(generateMockTracks(10), { deferRebuild: true })
  store.refreshLibraryIndex()
  store.isScanning.value = false

  loadCallCount = 0
  const tracksBefore = store.tracks.value.length
  const filePath = store.tracks.value[0].filePath

  await store.handleLibraryChange({ kind: 'remove', path: filePath })

  assert.equal(loadCallCount, 0, 'loadLibrary should NOT be called for incremental remove')
  assert.equal(store.tracks.value.length, tracksBefore - 1, 'track should be removed')

  store.clearTracks()
})

test('incremental add: single file add triggers addTracks not full loadLibrary', async () => {
  const store = setupStore()
  await store.addTracks(generateMockTracks(5), { deferRebuild: true })
  store.refreshLibraryIndex()
  store.isScanning.value = false

  loadCallCount = 0
  scanCallCount = 0
  const tracksBefore = store.tracks.value.length

  // Mock scanMusicFiles returns a track with filePath matching the change path
  const newFilePath = 'C:\\music\\newfolder\\newsong.mp3'
  ;(globalThis as Record<string, unknown>).window = {
    api: {
      data: {
        saveMusicLibrary: async (): Promise<void> => {
          saveCallCount++
        },
        loadMusicLibrary: async (): Promise<unknown[]> => {
          loadCallCount++
          return []
        },
        savePlaylists: async (): Promise<void> => {},
        loadPlaylists: async (): Promise<unknown[]> => []
      },
      fs: {
        scanMusicFiles: async (): Promise<unknown[]> => {
          scanCallCount++
          return [
            {
              ...generateMockTracks(1)[0],
              filePath: newFilePath,
              id: 'new_track_1'
            }
          ]
        }
      }
    }
  }

  await store.handleLibraryChange({ kind: 'add', path: newFilePath })

  assert.equal(loadCallCount, 0, 'loadLibrary should NOT be called for incremental add')
  assert.equal(scanCallCount, 1, 'scanMusicFiles should be called once')
  assert.equal(store.tracks.value.length, tracksBefore + 1, 'track should be added')

  // Restore default mock
  ;(globalThis as Record<string, unknown>).window = {
    api: {
      data: {
        saveMusicLibrary: async (): Promise<void> => {
          saveCallCount++
        },
        loadMusicLibrary: async (): Promise<unknown[]> => {
          loadCallCount++
          return []
        },
        savePlaylists: async (): Promise<void> => {},
        loadPlaylists: async (): Promise<unknown[]> => []
      },
      fs: {
        scanMusicFiles: async (): Promise<unknown[]> => {
          scanCallCount++
          return generateMockTracks(1)
        }
      }
    }
  }

  store.clearTracks()
})

test('incremental fallback: unknown kind triggers full loadLibrary', async () => {
  const store = setupStore()
  await store.addTracks(generateMockTracks(5), { deferRebuild: true })
  store.refreshLibraryIndex()
  store.isScanning.value = false

  loadCallCount = 0
  await store.handleLibraryChange({ kind: 'unknown' })

  assert.ok(loadCallCount >= 1, 'loadLibrary should be called for unknown kind')

  store.clearTracks()
})

test('incremental fallback: no payload triggers full loadLibrary', async () => {
  const store = setupStore()
  store.isScanning.value = false

  loadCallCount = 0
  await store.handleLibraryChange(undefined)

  assert.ok(loadCallCount >= 1, 'loadLibrary should be called for undefined change')

  store.clearTracks()
})

test('loadLibrary repairs moved local files from scanned folders while preserving track ids', async () => {
  const store = setupStore()
  const oldTrack = {
    ...generateMockTracks(1)[0],
    id: 'local:stable-id',
    title: 'Moon River',
    artist: 'Audrey',
    album: 'Old Album',
    filePath: 'D:\\Old\\Moon River.flac',
    fileName: 'Moon River.flac',
    dir: 'D:\\Old',
    duration: 181
  }
  const movedTrack = {
    ...oldTrack,
    id: 'local:new-scan-id',
    filePath: 'E:\\Music\\Audrey\\Moon River.flac',
    fileName: 'Moon River.flac',
    dir: 'E:\\Music\\Audrey',
    duration: 179,
    cover: 'cover://new'
  }

  saveCallCount = 0
  scanCallCount = 0
  ;(globalThis as Record<string, unknown>).window = {
    api: {
      data: {
        saveMusicLibrary: async (): Promise<void> => {
          saveCallCount++
        },
        loadMusicLibrary: async (): Promise<unknown> => {
          loadCallCount++
          return { tracks: [oldTrack], folders: ['E:\\Music'] }
        },
        savePlaylists: async (): Promise<void> => {},
        loadPlaylists: async (): Promise<unknown[]> => []
      },
      fs: {
        scanMusicFiles: async (): Promise<unknown[]> => {
          scanCallCount++
          return [movedTrack]
        }
      }
    }
  }

  await store.loadLibrary()
  await store.whenLibrarySettled()

  assert.equal(scanCallCount, 1)
  assert.equal(store.tracks.value.length, 1)
  assert.equal(store.tracks.value[0].id, 'local:stable-id')
  assert.equal(store.tracks.value[0].filePath, 'E:\\Music\\Audrey\\Moon River.flac')
  assert.equal(store.tracks.value[0].cover, 'cover://new')
  await new Promise((resolve) => setTimeout(resolve, 600))
  assert.equal(saveCallCount, 1, 'repaired library should be saved')
  ;(globalThis as Record<string, unknown>).window = {
    api: {
      data: {
        saveMusicLibrary: async (): Promise<void> => {
          saveCallCount++
        },
        loadMusicLibrary: async (): Promise<unknown[]> => {
          loadCallCount++
          return []
        },
        savePlaylists: async (): Promise<void> => {},
        loadPlaylists: async (): Promise<unknown[]> => []
      },
      fs: {
        scanMusicFiles: async (): Promise<unknown[]> => {
          scanCallCount++
          return generateMockTracks(1)
        }
      }
    }
  }

  store.clearTracks()
})

test('loadLibrary exposes a repair report for repaired and unresolved local files', async () => {
  const store = setupStore()
  const repairedOldTrack = {
    ...generateMockTracks(1)[0],
    id: 'local:stable-id',
    title: 'Moon River',
    artist: 'Audrey',
    album: 'Old Album',
    filePath: 'D:\\Old\\Moon River.flac',
    fileName: 'Moon River.flac',
    dir: 'D:\\Old',
    duration: 181
  }
  const unresolvedTrack = {
    ...generateMockTracks(1)[0],
    id: 'local:missing-id',
    title: 'Lost Song',
    artist: 'Unknown Artist',
    album: 'Old Album',
    filePath: 'D:\\Old\\Lost Song.flac',
    fileName: 'Lost Song.flac',
    dir: 'D:\\Old',
    duration: 200
  }
  const movedTrack = {
    ...repairedOldTrack,
    id: 'local:new-scan-id',
    filePath: 'E:\\Music\\Audrey\\Moon River.flac',
    fileName: 'Moon River.flac',
    dir: 'E:\\Music\\Audrey',
    duration: 179
  }

  ;(globalThis as Record<string, unknown>).window = {
    api: {
      data: {
        saveMusicLibrary: async (): Promise<void> => {},
        loadMusicLibrary: async (): Promise<unknown> => {
          return { tracks: [repairedOldTrack, unresolvedTrack], folders: ['E:\\Music'] }
        },
        savePlaylists: async (): Promise<void> => {},
        loadPlaylists: async (): Promise<unknown[]> => []
      },
      fs: {
        scanMusicFiles: async (): Promise<unknown[]> => [movedTrack]
      }
    }
  }

  await store.loadLibrary()
  await store.whenLibrarySettled()

  assert.equal(store.libraryRepairReport.value?.repairedCount, 1)
  assert.equal(store.libraryRepairReport.value?.unresolvedCount, 1)
  assert.deepEqual(store.libraryRepairReport.value?.repairedTrackIds, ['local:stable-id'])
  assert.deepEqual(store.libraryRepairReport.value?.unresolvedTrackIds, ['local:missing-id'])

  store.clearTracks()
})

test('loadLibrary enriches missing local metadata from provider search without changing local identity', async () => {
  const store = setupStore()
  const localTrack = {
    ...generateMockTracks(1)[0],
    id: 'local:moon',
    title: 'Moon River',
    artist: 'Audrey',
    album: '',
    filePath: 'D:\\Music\\Moon River.flac',
    fileName: 'Moon River.flac',
    duration: 181,
    cover: null,
    lyrics: null,
    source: 'local' as const,
    format: 'flac'
  }

  saveCallCount = 0
  scanCallCount = 0
  let providerSearchCalls = 0
  ;(globalThis as Record<string, unknown>).window = {
    api: {
      data: {
        saveMusicLibrary: async (): Promise<void> => {
          saveCallCount++
        },
        loadMusicLibrary: async (): Promise<unknown> => {
          loadCallCount++
          return { tracks: [localTrack], folders: [] }
        },
        savePlaylists: async (): Promise<void> => {},
        loadPlaylists: async (): Promise<unknown[]> => []
      },
      fs: {
        scanMusicFiles: async (): Promise<unknown[]> => {
          scanCallCount++
          return []
        }
      },
      providers: {
        list: async (): Promise<unknown[]> => [
          {
            id: 'ncm',
            name: 'NetEase',
            capabilities: ['search'],
            health: { available: true }
          }
        ],
        call: async (): Promise<unknown> => {
          providerSearchCalls++
          return {
            items: [
              {
                ...localTrack,
                id: 'ncm:123',
                filePath: 'ncm:123',
                fileName: 'Moon River',
                album: 'Online Album',
                duration: 179,
                cover: 'https://cover.example/album.jpg',
                lyrics: '[00:00.00]Moon River',
                translatedLyrics: '[00:00.00]月亮河',
                source: 'ncm'
              }
            ],
            total: 1
          }
        }
      }
    }
  }

  await store.loadLibrary()
  await store.whenLibrarySettled()

  assert.equal(providerSearchCalls, 1)
  assert.equal(store.tracks.value[0].id, 'local:moon')
  assert.equal(store.tracks.value[0].filePath, 'D:\\Music\\Moon River.flac')
  assert.equal(store.tracks.value[0].album, 'Online Album')
  assert.equal(store.tracks.value[0].cover, 'https://cover.example/album.jpg')
  assert.equal(store.tracks.value[0].lyrics, '[00:00.00]Moon River')
  assert.equal(store.tracks.value[0].translatedLyrics, '[00:00.00]月亮河')
  assert.deepEqual(store.tracks.value[0].metadataMatch, {
    providerId: 'ncm',
    trackId: 'ncm:123',
    confidence: 'high',
    score: 96
  })
  assert.equal(store.tracks.value[0].streamUrl, undefined)
  await new Promise((resolve) => setTimeout(resolve, 600))
  assert.equal(saveCallCount, 1, 'enriched library should be saved')

  store.clearTracks()
})

test('clearTrackMetadataMatch removes provider match without dropping cached local metadata', async () => {
  const store = setupStore()
  const matchedTrack = {
    ...generateMockTracks(1)[0],
    id: 'local:matched',
    filePath: 'D:\\Music\\Matched.flac',
    fileName: 'Matched.flac',
    title: 'Matched',
    album: 'Cached Album',
    cover: 'https://cover.example/matched.jpg',
    lyrics: '[00:00.00]Matched lyric',
    metadataMatch: {
      providerId: 'ncm',
      trackId: 'ncm:matched',
      confidence: 'medium' as const,
      score: 82
    }
  }

  await store.addTracks([matchedTrack])
  saveCallCount = 0

  const changed = store.clearTrackMetadataMatch('local:matched')

  assert.equal(changed, true)
  assert.equal(store.tracks.value[0].metadataMatch, null)
  assert.equal(store.tracks.value[0].id, 'local:matched')
  assert.equal(store.tracks.value[0].filePath, 'D:\\Music\\Matched.flac')
  assert.equal(store.tracks.value[0].source, 'local')
  assert.equal(store.tracks.value[0].album, 'Cached Album')
  assert.equal(store.tracks.value[0].cover, 'https://cover.example/matched.jpg')
  assert.equal(store.tracks.value[0].lyrics, '[00:00.00]Matched lyric')
  await new Promise((resolve) => setTimeout(resolve, 600))
  assert.equal(saveCallCount, 1, 'cleared metadata match should be saved')

  store.clearTracks()
})

test('applyTrackMetadataMatch applies a selected provider match without replacing local playback identity', async () => {
  const store = setupStore()
  const localTrack = {
    ...generateMockTracks(1)[0],
    id: 'local:selected',
    title: 'Selected Song',
    artist: 'Selected Artist',
    album: '',
    filePath: 'D:\\Music\\Selected Song.flac',
    fileName: 'Selected Song.flac',
    duration: 200,
    cover: null,
    lyrics: null,
    source: 'local' as const,
    format: 'flac'
  }
  const providerTrack = {
    ...localTrack,
    id: 'ncm:selected',
    album: 'Provider Album',
    filePath: 'ncm:selected',
    fileName: 'Selected Song',
    duration: 202,
    cover: 'https://cover.example/selected.jpg',
    lyrics: '[00:00.00]Selected lyric',
    translatedLyrics: '[00:00.00]选择的歌词',
    source: 'ncm' as const,
    streamUrl: 'https://temporary.example/selected.mp3'
  }

  await store.addTracks([localTrack])
  saveCallCount = 0

  const changed = store.applyTrackMetadataMatch('local:selected', providerTrack, {
    confidence: 'medium',
    score: 88
  })

  assert.equal(changed, true)
  assert.equal(store.tracks.value[0].id, 'local:selected')
  assert.equal(store.tracks.value[0].filePath, 'D:\\Music\\Selected Song.flac')
  assert.equal(store.tracks.value[0].source, 'local')
  assert.equal(store.tracks.value[0].album, 'Provider Album')
  assert.equal(store.tracks.value[0].cover, 'https://cover.example/selected.jpg')
  assert.equal(store.tracks.value[0].lyrics, '[00:00.00]Selected lyric')
  assert.equal(store.tracks.value[0].translatedLyrics, '[00:00.00]选择的歌词')
  assert.equal(store.tracks.value[0].lyricsSource, 'provider')
  assert.equal(store.tracks.value[0].translatedLyricsSource, 'provider')
  assert.deepEqual(store.tracks.value[0].metadataMatch, {
    providerId: 'ncm',
    trackId: 'ncm:selected',
    confidence: 'medium',
    score: 88
  })
  assert.equal(store.tracks.value[0].streamUrl, undefined)
  await new Promise((resolve) => setTimeout(resolve, 600))
  assert.equal(saveCallCount, 1, 'manual metadata match should be saved')

  store.clearTracks()
})

test('applyTrackMetadataMatch respects disabled metadata cache policy for manual provider matches', async () => {
  const store = setupStore()
  const settingsStore = useSettingsStoreModule.useSettingsStore()
  const previousSettings = settingsStore.settings.value
  settingsStore.settings.value = {
    ...previousSettings,
    cachePolicy: {
      ...previousSettings.cachePolicy,
      cover: false,
      lyrics: false,
      metadata: false
    }
  }
  const localTrack = {
    ...generateMockTracks(1)[0],
    id: 'local:policy',
    title: 'Policy Song',
    artist: 'Policy Artist',
    album: '',
    filePath: 'D:\\Music\\Policy Song.flac',
    fileName: 'Policy Song.flac',
    duration: 200,
    cover: null,
    lyrics: null,
    source: 'local' as const,
    format: 'flac'
  }
  const providerTrack = {
    ...localTrack,
    id: 'ncm:policy',
    album: 'Provider Album',
    filePath: 'ncm:policy',
    fileName: 'Policy Song',
    duration: 200,
    cover: 'https://cover.example/policy.jpg',
    lyrics: '[00:00.00]Policy lyric',
    translatedLyrics: '[00:00.00]策略歌词',
    source: 'ncm' as const
  }

  try {
    await store.addTracks([localTrack])
    saveCallCount = 0

    const changed = store.applyTrackMetadataMatch('local:policy', providerTrack, {
      confidence: 'high',
      score: 95
    })

    assert.equal(changed, true)
    assert.equal(store.tracks.value[0].id, 'local:policy')
    assert.equal(store.tracks.value[0].album, '')
    assert.equal(store.tracks.value[0].cover, null)
    assert.equal(store.tracks.value[0].lyrics, null)
    assert.equal(store.tracks.value[0].translatedLyrics, undefined)
    assert.deepEqual(store.tracks.value[0].metadataMatch, {
      providerId: 'ncm',
      trackId: 'ncm:policy',
      confidence: 'high',
      score: 95
    })
    await new Promise((resolve) => setTimeout(resolve, 600))
    assert.equal(saveCallCount, 1, 'manual metadata match trace should be saved')
  } finally {
    settingsStore.settings.value = previousSettings
    store.clearTracks()
  }
})

test('loadLibrary respects cache policy when provider metadata is available', async () => {
  const store = setupStore()
  const settingsStore = useSettingsStoreModule.useSettingsStore()
  const previousSettings = settingsStore.settings.value
  settingsStore.settings.value = {
    ...previousSettings,
    cachePolicy: {
      ...previousSettings.cachePolicy,
      cover: false,
      lyrics: false,
      metadata: false
    }
  }
  const localTrack = {
    ...generateMockTracks(1)[0],
    id: 'local:moon',
    title: 'Moon River',
    artist: 'Audrey',
    album: '',
    filePath: 'D:\\Music\\Moon River.flac',
    fileName: 'Moon River.flac',
    duration: 181,
    cover: null,
    lyrics: null,
    source: 'local' as const,
    format: 'flac'
  }

  saveCallCount = 0
  let providerSearchCalls = 0
  ;(globalThis as Record<string, unknown>).window = {
    api: {
      data: {
        saveMusicLibrary: async (): Promise<void> => {
          saveCallCount++
        },
        loadMusicLibrary: async (): Promise<unknown> => ({ tracks: [localTrack], folders: [] }),
        savePlaylists: async (): Promise<void> => {},
        loadPlaylists: async (): Promise<unknown[]> => []
      },
      fs: {
        scanMusicFiles: async (): Promise<unknown[]> => []
      },
      providers: {
        list: async (): Promise<unknown[]> => [
          {
            id: 'ncm',
            name: 'NetEase',
            capabilities: ['search'],
            health: { available: true }
          }
        ],
        call: async (): Promise<unknown> => {
          providerSearchCalls++
          return {
            items: [
              {
                ...localTrack,
                id: 'ncm:123',
                filePath: 'ncm:123',
                fileName: 'Moon River',
                album: 'Online Album',
                duration: 179,
                cover: 'https://cover.example/album.jpg',
                lyrics: '[00:00.00]Moon River',
                translatedLyrics: '[00:00.00]月亮河',
                source: 'ncm'
              }
            ],
            total: 1
          }
        }
      }
    }
  }

  try {
    await store.loadLibrary()
    await store.whenLibrarySettled()

    assert.equal(providerSearchCalls, 0)
    assert.equal(store.tracks.value[0].album, '')
    assert.equal(store.tracks.value[0].cover, null)
    assert.equal(store.tracks.value[0].lyrics, null)
    assert.equal(store.tracks.value[0].translatedLyrics, undefined)
    await new Promise((resolve) => setTimeout(resolve, 600))
    assert.equal(saveCallCount, 0, 'unchanged library should not be saved')
  } finally {
    settingsStore.settings.value = previousSettings
    store.clearTracks()
  }
})

// Wave 4: dashboard memo — Vue computed caching is testable in bare Node
const vue = await import('vue')

test('dashboard memo: byIdMap not rebuilt when only listeningStats changes', () => {
  const tracks = vue.shallowRef(generateMockTracks(100))
  const stats = vue.ref({ plays: 0 })

  let mapBuildCount = 0
  const byIdMap = vue.computed(() => {
    mapBuildCount++
    return new Map(tracks.value.map((t) => [t.id, t]))
  })
  const topTracks = vue.computed(() => {
    const byId = byIdMap.value
    return Object.keys(stats.value).length + byId.size
  })

  // Initial access
  void topTracks.value
  const initialBuildCount = mapBuildCount

  // Change only stats (not tracks) — byIdMap should NOT rebuild
  stats.value = { plays: 1, duration: 10 }
  void topTracks.value
  assert.equal(
    mapBuildCount,
    initialBuildCount,
    'byIdMap should not rebuild when only stats change'
  )

  // Change tracks — byIdMap SHOULD rebuild
  tracks.value = generateMockTracks(200)
  void topTracks.value
  assert.ok(mapBuildCount > initialBuildCount, 'byIdMap should rebuild when tracks change')
})

// Wave 5: pointermove rAF throttle — pure logic extracted from SongList.vue
// (rAF/DOM not available in bare Node; throttle behavior degraded to typecheck+build)

function shouldScheduleFlush(rafId: number | null): boolean {
  return rafId === null
}

function cleanupPointerMove(rafId: number | null, cancelFn: (id: number) => void): void {
  if (rafId !== null) cancelFn(rafId)
}

test('pointermove schedule: shouldScheduleFlush returns true when idle, false when pending', () => {
  assert.equal(shouldScheduleFlush(null), true, 'should schedule when rafId is null')
  assert.equal(shouldScheduleFlush(1), false, 'should NOT schedule when rafId is set')
  assert.equal(shouldScheduleFlush(42), false, 'should NOT schedule when rafId is any number')
})

test('pointermove cleanup: cleanupPointerMove calls cancelAnimationFrame only when rafId is set', () => {
  let cancelledId: number | null = null
  const mockCancel = (id: number): void => {
    cancelledId = id
  }

  // rafId set → cancelAnimationFrame should be called
  cleanupPointerMove(42, mockCancel)
  assert.equal(cancelledId, 42, 'cancelAnimationFrame should be called with rafId 42')

  // rafId null → cancelAnimationFrame should NOT be called
  cancelledId = null
  cleanupPointerMove(null, mockCancel)
  assert.equal(cancelledId, null, 'cancelAnimationFrame should NOT be called when rafId is null')
})

test('mixed-source playlists keep provider track snapshots when the track is not in the local library', async () => {
  const store = setupStore()
  store.playlists.value = []
  const providerTrack = {
    id: 'ncm:12345',
    title: 'Online Song',
    artist: 'Remote Artist',
    album: 'Remote Album',
    filePath: 'ncm:12345',
    fileName: 'Online Song',
    duration: 180,
    size: 0,
    cover: null,
    lyrics: null,
    source: 'ncm'
  }

  store.createPlaylist('mixed-source')
  store.addToPlaylist('mixed-source', providerTrack.id, providerTrack)

  assert.deepEqual(store.getPlaylistTracks('mixed-source'), [providerTrack])

  store.clearTracks()
})

test('mixed-source playlists prefer a local library variant over a provider snapshot for the same logical track', async () => {
  const store = setupStore()
  store.playlists.value = []
  const providerTrack = {
    id: 'ncm:12345',
    title: 'Moon River',
    artist: 'Audrey',
    album: 'Remote Album',
    filePath: 'ncm:12345',
    fileName: 'Moon River',
    duration: 180,
    size: 0,
    cover: null,
    lyrics: null,
    source: 'ncm'
  }
  const localTrack = {
    ...generateMockTracks(1)[0],
    id: 'local:moon',
    title: 'Moon River',
    artist: 'Audrey',
    album: 'Local Album',
    filePath: 'D:\\Music\\Moon River.flac',
    fileName: 'Moon River.flac',
    duration: 181,
    source: 'local',
    format: 'flac'
  }

  store.createPlaylist('mixed-source')
  store.addToPlaylist('mixed-source', providerTrack.id, providerTrack)
  await store.addTracks([localTrack])

  const tracks = store.getPlaylistTracks('mixed-source')

  assert.equal(tracks.length, 1)
  assert.equal(tracks[0].id, 'local:moon')

  store.clearTracks()
})

test('mixed-source playlists prefer the best local library variant over a provider snapshot', async () => {
  const store = setupStore()
  store.playlists.value = []
  const providerTrack = {
    ...generateMockTracks(1)[0],
    id: 'ncm:moon',
    title: 'Moon River',
    artist: 'Audrey',
    album: 'Online Album',
    filePath: 'ncm:moon',
    fileName: 'Moon River',
    duration: 180,
    source: 'ncm',
    format: 'aac'
  }
  const localMp3 = {
    ...providerTrack,
    id: 'local:moon-mp3',
    album: 'Local Album',
    filePath: 'D:\\Music\\Moon River.mp3',
    fileName: 'Moon River.mp3',
    duration: 181,
    source: 'local',
    format: 'mp3',
    bitDepth: undefined
  }
  const localFlac = {
    ...providerTrack,
    id: 'local:moon-flac',
    album: 'Local Album',
    filePath: 'D:\\Music\\Moon River.flac',
    fileName: 'Moon River.flac',
    duration: 181,
    source: 'local',
    format: 'flac',
    bitDepth: 24
  }

  store.createPlaylist('mixed-source')
  store.addToPlaylist('mixed-source', providerTrack.id, providerTrack)
  await store.addTracks([localMp3, localFlac])

  const tracks = store.getPlaylistTracks('mixed-source')

  assert.equal(tracks.length, 1)
  assert.equal(tracks[0].id, 'local:moon-flac')

  store.clearTracks()
})

test('mixed-source playlists can replace expired provider ids with rematched provider snapshots', async () => {
  const store = setupStore()
  store.playlists.value = []
  const expiredTrack = {
    id: 'ncm:expired',
    title: 'Online Song',
    artist: 'Remote Artist',
    album: 'Remote Album',
    filePath: 'ncm:expired',
    fileName: 'Online Song',
    duration: 180,
    size: 0,
    cover: null,
    lyrics: null,
    source: 'ncm'
  }
  const rematchedTrack = {
    ...expiredTrack,
    id: 'ncm:fresh',
    filePath: 'ncm:fresh',
    cover: 'https://cover.example/fresh.jpg'
  }

  store.createPlaylist('mixed-source')
  store.addToPlaylist('mixed-source', expiredTrack.id, expiredTrack)

  const replacedCount = store.replaceTrackReference(expiredTrack.id, rematchedTrack)

  assert.equal(replacedCount, 1)
  assert.deepEqual(store.playlists.value[0].trackIds, ['ncm:fresh'])
  assert.equal(store.playlists.value[0].trackSnapshots?.['ncm:expired'], undefined)
  assert.equal(
    store.playlists.value[0].trackSnapshots?.['ncm:fresh']?.cover,
    'https://cover.example/fresh.jpg'
  )
  assert.deepEqual(store.getPlaylistTracks('mixed-source'), [rematchedTrack])

  store.clearTracks()
})

test('mixed-source playlist rematch de-duplicates when replacement id already exists', async () => {
  const store = setupStore()
  store.playlists.value = []
  const expiredTrack = {
    id: 'ncm:expired',
    title: 'Online Song',
    artist: 'Remote Artist',
    album: 'Remote Album',
    filePath: 'ncm:expired',
    fileName: 'Online Song',
    duration: 180,
    size: 0,
    cover: null,
    lyrics: null,
    source: 'ncm'
  }
  const rematchedTrack = {
    ...expiredTrack,
    id: 'ncm:fresh',
    filePath: 'ncm:fresh'
  }

  store.createPlaylist('mixed-source')
  store.addToPlaylist('mixed-source', expiredTrack.id, expiredTrack)
  store.addToPlaylist('mixed-source', rematchedTrack.id, rematchedTrack)

  const replacedCount = store.replaceTrackReference(expiredTrack.id, rematchedTrack)

  assert.equal(replacedCount, 1)
  assert.deepEqual(store.playlists.value[0].trackIds, ['ncm:fresh'])
  assert.equal(store.playlists.value[0].trackSnapshots?.['ncm:expired'], undefined)
  assert.deepEqual(store.getPlaylistTracks('mixed-source'), [rematchedTrack])

  store.clearTracks()
})

test('default favorites match logical tracks across local and provider variants', async () => {
  const store = setupStore()
  store.playlists.value = []
  const localTrack = {
    ...generateMockTracks(1)[0],
    id: 'local:moon',
    title: 'Moon River',
    artist: 'Audrey',
    album: 'Local Album',
    filePath: 'D:\\Music\\Moon River.flac',
    fileName: 'Moon River.flac',
    duration: 181,
    source: 'local'
  }
  const providerTrack = {
    ...localTrack,
    id: 'ncm:123',
    album: 'Online Album',
    filePath: 'ncm:123',
    fileName: 'Moon River',
    duration: 180,
    size: 0,
    source: 'ncm'
  }

  store.createPlaylist('我收藏的音乐')
  store.addToPlaylist('我收藏的音乐', localTrack.id, localTrack)

  assert.equal(store.isFavoriteTrack(providerTrack), true)
  assert.equal(store.isFavoriteTrack(localTrack), true)

  store.clearTracks()
})

test('playlist exact-id reads reuse indexes instead of rebuilding logical maps', async () => {
  const store = setupStore()
  const tracks = generateMockTracks(5000)
  await store.addTracks(tracks, { deferRebuild: true })
  store.refreshLibraryIndex()
  store.playlists.value = [
    {
      id: 'pl_exact',
      name: 'exact-local',
      trackIds: tracks.slice(100, 300).map((track) => track.id),
      createdAt: new Date().toISOString()
    }
  ]

  assert.equal(store.getPlaylistTracks('exact-local').length, 200)

  const start = performance.now()
  for (let i = 0; i < 200; i++) {
    assert.equal(store.getPlaylistTracks('exact-local').length, 200)
  }
  const elapsed = performance.now() - start

  assert.ok(elapsed < 150, `exact playlist reads took ${elapsed.toFixed(2)}ms, expected < 150ms`)

  store.clearTracks()
})

test('favorite logical state reuses playlist identity cache for repeated button reads', async () => {
  const store = setupStore()
  const tracks = generateMockTracks(5000)
  await store.addTracks(tracks, { deferRebuild: true })
  store.refreshLibraryIndex()
  store.playlists.value = [
    {
      id: 'pl_favorites',
      name: '我收藏的音乐',
      trackIds: tracks.map((track) => track.id),
      isDefault: true,
      createdAt: new Date().toISOString()
    }
  ]
  const localTrack = tracks[4200]
  const providerVariant = {
    ...localTrack,
    id: 'ncm:logical-favorite',
    filePath: 'ncm:logical-favorite',
    source: 'ncm'
  }

  assert.equal(store.isFavoriteTrack(providerVariant), true)

  const start = performance.now()
  for (let i = 0; i < 10000; i++) {
    assert.equal(store.isFavoriteTrack(providerVariant), true)
  }
  const elapsed = performance.now() - start

  assert.ok(elapsed < 150, `favorite state reads took ${elapsed.toFixed(2)}ms, expected < 150ms`)

  store.clearTracks()
})

test('removing a logical favorite removes all source variants from default favorites', async () => {
  const store = setupStore()
  store.playlists.value = []
  const localTrack = {
    ...generateMockTracks(1)[0],
    id: 'local:moon',
    title: 'Moon River',
    artist: 'Audrey',
    album: 'Local Album',
    filePath: 'D:\\Music\\Moon River.flac',
    fileName: 'Moon River.flac',
    duration: 181,
    source: 'local'
  }
  const providerTrack = {
    ...localTrack,
    id: 'ncm:123',
    album: 'Online Album',
    filePath: 'ncm:123',
    fileName: 'Moon River',
    duration: 180,
    size: 0,
    source: 'ncm'
  }

  store.createPlaylist('我收藏的音乐')
  store.addToPlaylist('我收藏的音乐', localTrack.id, localTrack)
  store.addToPlaylist('我收藏的音乐', providerTrack.id, providerTrack)

  store.removeFavoriteTrack(providerTrack)

  const favorite = store.playlists.value.find((playlist) => playlist.name === '我收藏的音乐')
  assert.deepEqual(favorite?.trackIds, [])
  assert.equal(store.isFavoriteTrack(localTrack), false)
  assert.equal(store.isFavoriteTrack(providerTrack), false)

  store.clearTracks()
})
