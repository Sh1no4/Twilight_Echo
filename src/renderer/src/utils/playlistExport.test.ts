import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PLAYLIST_EXPORT_FORMATS,
  playlistExportFilename,
  playlistExportMimeType
} from './playlistExport.ts'

test('playlist exports expose each supported user-selectable format with a matching download type', () => {
  assert.deepEqual(
    PLAYLIST_EXPORT_FORMATS.map((option) => option.value),
    ['m3u', 'm3u8', 'pls']
  )
  assert.equal(playlistExportMimeType('m3u'), 'audio/x-mpegurl;charset=utf-8')
  assert.equal(playlistExportMimeType('m3u8'), 'audio/x-mpegurl;charset=utf-8')
  assert.equal(playlistExportMimeType('pls'), 'audio/x-scpls;charset=utf-8')
  assert.equal(playlistExportFilename('Road: Trip', 'pls'), 'Road_ Trip.pls')
})
