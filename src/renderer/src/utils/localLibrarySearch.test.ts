import assert from 'node:assert/strict'
import test from 'node:test'

const { filterLocalGridItems } = (await import(
  new URL('./localLibrarySearch.ts', import.meta.url).href
)) as typeof import('./localLibrarySearch')

test('filters local grid items by card metadata and nested tracks', () => {
  const items = [
    {
      name: 'HoneyWorks',
      trackCount: 2,
      cover: null,
      tracks: [
        {
          id: '1',
          title: 'Kawaikute Gomen',
          artist: 'HoneyWorks',
          album: '告白実行委員会',
          filePath: 'D:\\Music\\HoneyWorks\\01.flac',
          fileName: '01.flac',
          duration: 1,
          size: 1,
          cover: null,
          lyrics: null
        }
      ]
    },
    {
      name: 'Vocaloid',
      trackCount: 1,
      cover: null,
      tracks: [
        {
          id: '2',
          title: 'Tell Your World',
          artist: 'livetune',
          album: 'Re:Dial',
          filePath: 'D:\\Music\\Vocaloid\\02.flac',
          fileName: '02.flac',
          duration: 1,
          size: 1,
          cover: null,
          lyrics: null
        }
      ]
    }
  ]

  assert.deepEqual(filterLocalGridItems(items, 'honey').map((item) => item.name), ['HoneyWorks'])
  assert.deepEqual(filterLocalGridItems(items, 'redial').map((item) => item.name), ['Vocaloid'])
})
