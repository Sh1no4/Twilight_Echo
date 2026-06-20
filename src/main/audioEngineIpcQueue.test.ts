import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

test('audioEngine loadQueue IPC accepts renderer queue items with source field', () => {
  const start = source.indexOf('function toQueueItem')
  const end = source.indexOf("ipcMain.handle('audioEngine:loadQueue'", start)
  assert.notEqual(start, -1, 'toQueueItem should exist')
  assert.notEqual(end, -1, 'audioEngine:loadQueue handler should exist')
  const toQueueItem = source.slice(start, end)

  assert.match(toQueueItem, /typeof item\.source === 'string'/)
  assert.match(toQueueItem, /source,\s*\n\s*title:/)
  assert.equal(
    /typeof item\.filePath === 'string'[\s\S]*typeof item\.source === 'string'/.test(toQueueItem),
    false,
    'source must be checked before filePath because renderer queue items no longer include filePath'
  )
})
