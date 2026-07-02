import assert from 'node:assert/strict'
import test from 'node:test'
import { nextTick, ref } from 'vue'

const { createPlaybackSessionPersistence } = (await import(
  new URL('./usePlaybackSessionPersistence.ts', import.meta.url).href
)) as typeof import('./usePlaybackSessionPersistence')

const track = {
  id: 'local:track',
  title: 'Track',
  artist: 'Artist',
  album: 'Album',
  filePath: 'D:/Music/track.flac',
  fileName: 'track.flac',
  duration: 180,
  size: 1024,
  cover: null,
  lyrics: null,
  source: 'local' as const
}

test('restore clears persisted session when resume mode is off', async () => {
  const calls: string[] = []
  const persistence = createPlaybackSessionPersistence({
    settings: ref({ playbackResumeMode: 'off' }),
    currentTrack: ref(null),
    currentTime: ref(0),
    isPlaying: ref(false),
    restorePlaybackSession: () => calls.push('restore'),
    createPlaybackSession: () => null,
    syncPluginProviders: async () => calls.push('sync'),
    dataApi: {
      clearPlaybackSession: async () => calls.push('clear'),
      loadPlaybackSession: async () => ({ version: 1, savedAt: '', mode: 'track', track, position: 30 }),
      savePlaybackSession: async () => calls.push('save')
    }
  })

  await persistence.restoreSavedPlaybackSession('off')

  assert.deepEqual(calls, ['clear'])
})

test('restore waits for plugin providers before restoring a saved session', async () => {
  const calls: string[] = []
  const persistence = createPlaybackSessionPersistence({
    settings: ref({ playbackResumeMode: 'trackAndPosition' }),
    currentTrack: ref(null),
    currentTime: ref(0),
    isPlaying: ref(false),
    restorePlaybackSession: (session) => calls.push(`restore:${session.position}`),
    createPlaybackSession: () => null,
    syncPluginProviders: async () => calls.push('sync'),
    dataApi: {
      clearPlaybackSession: async () => calls.push('clear'),
      loadPlaybackSession: async () => ({ version: 1, savedAt: '', mode: 'track', track, position: 30 }),
      savePlaybackSession: async () => calls.push('save')
    }
  })

  await persistence.restoreSavedPlaybackSession('track')

  assert.deepEqual(calls, ['sync', 'restore:0'])
})

test('autosave clears, saves track-only, and saves track position according to resume mode', async () => {
  const mode = ref<'off' | 'track' | 'trackAndPosition'>('off')
  const currentTrack = ref<typeof track | null>(null)
  const currentTime = ref(0)
  const isPlaying = ref(false)
  const saved: Array<unknown> = []
  const persistence = createPlaybackSessionPersistence({
    settings: ref({ playbackResumeMode: mode }),
    currentTrack,
    currentTime,
    isPlaying,
    restorePlaybackSession: () => undefined,
    createPlaybackSession: (resumeMode) =>
      currentTrack.value
        ? { version: 1, savedAt: '', mode: resumeMode, track: currentTrack.value, position: currentTime.value }
        : null,
    syncPluginProviders: async () => undefined,
    autosaveDelayMs: 0,
    positionAutosaveMs: 0,
    dataApi: {
      clearPlaybackSession: async () => saved.push('clear'),
      loadPlaybackSession: async () => null,
      savePlaybackSession: async (session) => saved.push(session)
    }
  })

  persistence.startAutosaveWatchers()

  mode.value = 'track'
  currentTrack.value = track
  await nextTick()
  await waitForTimers()

  mode.value = 'trackAndPosition'
  currentTime.value = 42
  isPlaying.value = true
  await nextTick()
  await waitForTimers()
  persistence.stop()

  assert.equal((saved[0] as { mode: string; position: number }).mode, 'track')
  assert.equal((saved[0] as { position: number }).position, 0)
  assert.equal((saved[1] as { mode: string; position: number }).mode, 'trackAndPosition')
  assert.equal((saved[1] as { position: number }).position, 42)
})

async function waitForTimers(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5))
}
