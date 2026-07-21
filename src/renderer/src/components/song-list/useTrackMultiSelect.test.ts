import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, ref } from 'vue'

const { useTrackMultiSelect } = (await import(
  new URL('./useTrackMultiSelect.ts', import.meta.url).href
)) as typeof import('./useTrackMultiSelect')

function makeTracks(count: number): Array<{
  id: string
  title: string
  artist: string
  album: string
  filePath: string
  fileName: string
  duration: number
  size: number
  cover: null
  lyrics: null
  source: 'local'
}> {
  return Array.from({ length: count }, (_, i) => ({
    id: `t${i}`,
    title: `Track ${i}`,
    artist: 'Artist',
    album: 'Album',
    filePath: `/music/t${i}.flac`,
    fileName: `t${i}.flac`,
    duration: 100 + i,
    size: 1000,
    cover: null,
    lyrics: null,
    source: 'local' as const
  }))
}

function withScope<T>(run: () => T): T {
  const scope = effectScope()
  const result = scope.run(run)
  if (result === undefined) throw new Error('scope.run returned undefined')
  return result
}

test('plain click plays without selecting and clears any prior selection', () => {
  const tracks = ref(makeTracks(5))
  const multi = withScope(() => useTrackMultiSelect({ tracks }))
  multi.toggle(tracks.value[0].id, 0)
  assert.equal(multi.selectedCount.value, 1)

  const result = multi.onRowClick(tracks.value[2], 2, {
    shiftKey: false,
    ctrlKey: false,
    metaKey: false
  } as MouseEvent)
  assert.equal(result, 'play')
  assert.equal(multi.selectedCount.value, 0)
  assert.equal(multi.isSelected('t2'), false)
  assert.deepEqual(multi.getSelectedTrackIds(), [])
})

test('ctrl click toggles selection without play', () => {
  const tracks = ref(makeTracks(5))
  const multi = withScope(() => useTrackMultiSelect({ tracks }))
  multi.onRowClick(tracks.value[0], 0, {
    shiftKey: false,
    ctrlKey: true,
    metaKey: false
  } as MouseEvent)
  multi.onRowClick(tracks.value[2], 2, {
    shiftKey: false,
    ctrlKey: true,
    metaKey: false
  } as MouseEvent)
  assert.equal(multi.selectedCount.value, 2)
  assert.equal(multi.isSelected('t0'), true)
  assert.equal(multi.isSelected('t2'), true)

  multi.onRowClick(tracks.value[0], 0, {
    shiftKey: false,
    ctrlKey: true,
    metaKey: false
  } as MouseEvent)
  assert.equal(multi.isSelected('t0'), false)
  assert.equal(multi.selectedCount.value, 1)
})

test('meta click behaves like ctrl click', () => {
  const tracks = ref(makeTracks(3))
  const multi = withScope(() => useTrackMultiSelect({ tracks }))
  const result = multi.onRowClick(tracks.value[1], 1, {
    shiftKey: false,
    ctrlKey: false,
    metaKey: true
  } as MouseEvent)
  assert.equal(result, 'select')
  assert.equal(multi.isSelected('t1'), true)
})

test('shift click selects inclusive range from anchor', () => {
  const tracks = ref(makeTracks(6))
  const multi = withScope(() => useTrackMultiSelect({ tracks }))
  // Enter selection with ctrl first (plain click no longer selects).
  multi.onRowClick(tracks.value[1], 1, {
    shiftKey: false,
    ctrlKey: true,
    metaKey: false
  } as MouseEvent)
  const result = multi.onRowClick(tracks.value[4], 4, {
    shiftKey: true,
    ctrlKey: false,
    metaKey: false
  } as MouseEvent)
  assert.equal(result, 'select')
  assert.deepEqual(multi.getSelectedTrackIds().sort(), ['t1', 't2', 't3', 't4'])
})

test('shift click without prior selection selects only the target row', () => {
  const tracks = ref(makeTracks(4))
  const multi = withScope(() => useTrackMultiSelect({ tracks }))
  const result = multi.onRowClick(tracks.value[2], 2, {
    shiftKey: true,
    ctrlKey: false,
    metaKey: false
  } as MouseEvent)
  assert.equal(result, 'select')
  assert.deepEqual(multi.getSelectedTrackIds(), ['t2'])
})

test('selectAll and clearSelection', () => {
  const tracks = ref(makeTracks(3))
  const multi = withScope(() => useTrackMultiSelect({ tracks }))
  multi.selectAll()
  assert.equal(multi.selectedCount.value, 3)
  multi.clearSelection()
  assert.equal(multi.selectedCount.value, 0)
  assert.equal(multi.hasSelection.value, false)
})

test('ensureContextSelection keeps multi-selection when target already selected', () => {
  const tracks = ref(makeTracks(4))
  const multi = withScope(() => useTrackMultiSelect({ tracks }))
  multi.onRowClick(tracks.value[0], 0, {
    shiftKey: false,
    ctrlKey: true,
    metaKey: false
  } as MouseEvent)
  multi.onRowClick(tracks.value[2], 2, {
    shiftKey: false,
    ctrlKey: true,
    metaKey: false
  } as MouseEvent)
  multi.ensureContextSelection(tracks.value[0], 0)
  assert.equal(multi.selectedCount.value, 2)
  multi.ensureContextSelection(tracks.value[3], 3)
  assert.equal(multi.selectedCount.value, 1)
  assert.equal(multi.isSelected('t3'), true)
})

test('getSelectedTracks preserves list order', () => {
  const tracks = ref(makeTracks(5))
  const multi = withScope(() => useTrackMultiSelect({ tracks }))
  multi.onRowClick(tracks.value[3], 3, {
    shiftKey: false,
    ctrlKey: true,
    metaKey: false
  } as MouseEvent)
  multi.onRowClick(tracks.value[1], 1, {
    shiftKey: false,
    ctrlKey: true,
    metaKey: false
  } as MouseEvent)
  assert.deepEqual(
    multi.getSelectedTracks().map((t) => t.id),
    ['t1', 't3']
  )
})

test('checkbox-style toggle enters multi-select without playing', () => {
  const tracks = ref(makeTracks(3))
  const multi = withScope(() => useTrackMultiSelect({ tracks }))
  multi.toggle(tracks.value[1].id, 1)
  assert.equal(multi.hasSelection.value, true)
  assert.equal(multi.isSelected('t1'), true)
  multi.toggle(tracks.value[1].id, 1)
  assert.equal(multi.hasSelection.value, false)
})
