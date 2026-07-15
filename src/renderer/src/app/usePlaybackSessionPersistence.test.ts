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
      loadPlaybackSession: async () => ({
        version: 1,
        savedAt: '',
        mode: 'track',
        track,
        position: 30
      }),
      savePlaybackSession: async () => calls.push('save')
    }
  })

  await persistence.restoreSavedPlaybackSession('off')

  assert.deepEqual(calls, ['clear'])
})

test('local playback resume restores without waiting for plugin providers', async () => {
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
      loadPlaybackSession: async () => ({
        version: 1,
        savedAt: '',
        mode: 'track',
        track,
        position: 30
      }),
      savePlaybackSession: async () => calls.push('save')
    }
  })

  await persistence.restoreSavedPlaybackSession('track')

  assert.deepEqual(calls, ['restore:0'])
})

test('plugin playback resume waits for plugin providers before restoring a saved session', async () => {
  const calls: string[] = []
  const pluginTrack = { ...track, id: 'plugin:track', source: 'plugin' as const }
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
      loadPlaybackSession: async () => ({
        version: 1,
        savedAt: '',
        mode: 'track',
        track: pluginTrack,
        position: 30
      }),
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
        ? {
            version: 1,
            savedAt: '',
            mode: resumeMode,
            track: currentTrack.value,
            position: currentTime.value
          }
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

  await persistence.restoreSavedPlaybackSession('off')
  saved.length = 0
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

test('a track change persists immediately instead of retaining the previous debounced track', async () => {
  const currentTrack = ref<typeof track | null>(track)
  const savedTrackIds: string[] = []
  const nextTrack = { ...track, id: 'local:next-track', title: 'Next Track' }
  const persistence = createPlaybackSessionPersistence({
    settings: ref({ playbackResumeMode: 'track' as const }),
    currentTrack,
    currentTime: ref(0),
    isPlaying: ref(true),
    restorePlaybackSession: () => undefined,
    createPlaybackSession: (mode) => ({
      version: 1,
      savedAt: '',
      mode,
      track: currentTrack.value!,
      position: 0
    }),
    syncPluginProviders: async () => undefined,
    autosaveDelayMs: 1000,
    dataApi: {
      clearPlaybackSession: async () => undefined,
      loadPlaybackSession: async () => null,
      savePlaybackSession: async (session) => savedTrackIds.push(session!.track.id)
    }
  })

  await persistence.restoreSavedPlaybackSession('track')
  persistence.startAutosaveWatchers()
  currentTrack.value = nextTrack
  await nextTick()
  await waitForTimers()
  persistence.stop()

  assert.deepEqual(savedTrackIds, [track.id, nextTrack.id])
})

test('captures a track that was selected before autosave watchers were installed', async () => {
  const currentTrack = ref<typeof track | null>(track)
  const savedTrackIds: string[] = []
  const persistence = createPlaybackSessionPersistence({
    settings: ref({ playbackResumeMode: 'track' as const }),
    currentTrack,
    currentTime: ref(0),
    isPlaying: ref(true),
    restorePlaybackSession: () => undefined,
    createPlaybackSession: (mode) => ({
      version: 1,
      savedAt: '',
      mode,
      track: currentTrack.value!,
      position: 0
    }),
    syncPluginProviders: async () => undefined,
    dataApi: {
      clearPlaybackSession: async () => undefined,
      loadPlaybackSession: async () => null,
      savePlaybackSession: async (session) => savedTrackIds.push(session!.track.id)
    }
  })

  await persistence.restoreSavedPlaybackSession('track')
  persistence.startAutosaveWatchers()
  await waitForTimers()
  persistence.stop()

  assert.deepEqual(savedTrackIds, [track.id])
})

test('overlapping playback-session saves commit snapshots in creation order', async () => {
  const currentTrack = ref<typeof track | null>(track)
  const nextTrack = { ...track, id: 'local:next-track', title: 'Next Track' }
  const savedTrackIds: string[] = []
  let releaseFirstWrite: () => void = () => undefined
  let notifyFirstWriteStarted: () => void = () => undefined
  const firstWriteReleased = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve
  })
  const firstWriteStarted = new Promise<void>((resolve) => {
    notifyFirstWriteStarted = resolve
  })
  const persistence = createPlaybackSessionPersistence({
    settings: ref({ playbackResumeMode: 'track' as const }),
    currentTrack,
    currentTime: ref(0),
    isPlaying: ref(true),
    restorePlaybackSession: () => undefined,
    createPlaybackSession: (mode) => ({
      version: 1,
      savedAt: '',
      mode,
      track: currentTrack.value!,
      position: 0
    }),
    syncPluginProviders: async () => undefined,
    dataApi: {
      clearPlaybackSession: async () => undefined,
      loadPlaybackSession: async () => null,
      savePlaybackSession: async (session) => {
        const trackId = session!.track.id
        if (trackId === track.id) {
          notifyFirstWriteStarted()
          await firstWriteReleased
        }
        savedTrackIds.push(trackId)
      }
    }
  })

  await persistence.restoreSavedPlaybackSession('track')
  const firstSave = persistence.savePlaybackSessionSnapshot()
  await firstWriteStarted
  currentTrack.value = nextTrack
  const secondSave = persistence.savePlaybackSessionSnapshot()
  await Promise.resolve()
  assert.deepEqual(savedTrackIds, [])

  releaseFirstWrite()
  await Promise.all([firstSave, secondSave])

  assert.deepEqual(savedTrackIds, [track.id, nextTrack.id])
})

test('failed restore leaves autosave available to replace the unusable old session', async () => {
  const mode = ref<'off' | 'track' | 'trackAndPosition'>('track')
  const currentTrack = ref<typeof track | null>(null)
  const writes: string[] = []
  const persistence = createPlaybackSessionPersistence({
    settings: ref({ playbackResumeMode: mode }),
    currentTrack,
    currentTime: ref(0),
    isPlaying: ref(false),
    restorePlaybackSession: () => undefined,
    createPlaybackSession: (resumeMode) =>
      currentTrack.value
        ? {
            version: 1,
            savedAt: '',
            mode: resumeMode,
            track: currentTrack.value,
            position: 0
          }
        : null,
    syncPluginProviders: async () => undefined,
    autosaveDelayMs: 0,
    dataApi: {
      clearPlaybackSession: async () => writes.push('clear'),
      loadPlaybackSession: async () => {
        throw new Error('primary and backup are corrupt')
      },
      savePlaybackSession: async () => writes.push('save')
    }
  })

  await assert.rejects(() => persistence.restoreSavedPlaybackSession('track'), /corrupt/)

  persistence.startAutosaveWatchers()
  currentTrack.value = track
  await nextTick()
  persistence.schedulePlaybackSessionAutosave(0)
  await waitForTimers()
  await persistence.savePlaybackSessionSnapshot()
  await persistence.savePlaybackSessionForQuit()
  persistence.stop()

  assert.deepEqual(writes, ['save', 'save', 'save', 'save'])
})

async function waitForTimers(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5))
}
