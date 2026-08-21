import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  NCM_CACHE_MAX_BYTES,
  NCM_CACHE_PART_MAX_AGE_MS,
  planNcmCachePrune
} from './ncmCachePrune.ts'

// ncmCache.ts imports electron and cannot run under plain node --test; its
// streaming/pipeline wiring is pinned with source assertions while the prune
// policy is unit-tested directly.

test('ncm cache prune evicts least-recently-used finished files past the byte budget', () => {
  const plan = planNcmCachePrune(
    [
      { name: '1.flac', size: 600, mtimeMs: 1_000 },
      { name: '2.flac', size: 600, mtimeMs: 2_000 },
      { name: '3.flac', size: 600, mtimeMs: 3_000 }
    ],
    1_000,
    10_000
  )
  // 1800 total against a 1000 byte budget: evict oldest until within budget.
  assert.deepEqual(plan.deleteNames, ['1.flac', '2.flac'])
  assert.equal(plan.remainingBytes, 600)
})

test('ncm cache prune keeps finished files within budget untouched', () => {
  const plan = planNcmCachePrune(
    [{ name: '1.mp3', size: 100, mtimeMs: 1_000 }],
    NCM_CACHE_MAX_BYTES,
    10_000
  )
  assert.deepEqual(plan.deleteNames, [])
  assert.equal(plan.remainingBytes, 100)
})

test('ncm cache prune cleans stale .part orphans but never counts them against the budget', () => {
  const now = 10_000_000
  const plan = planNcmCachePrune(
    [
      { name: '9.flac', size: 500, mtimeMs: now },
      { name: '9.flac.abc.part', size: 9_000, mtimeMs: now - NCM_CACHE_PART_MAX_AGE_MS - 1 },
      { name: '8.flac.def.part', size: 9_000, mtimeMs: now }
    ],
    600,
    now
  )
  assert.deepEqual(plan.orphanPartNames, ['9.flac.abc.part'])
  assert.deepEqual(plan.deleteNames, [], '.part size must not push finished files out')
  assert.equal(plan.remainingBytes, 500)
})

test('ncm cache write path streams to .part and only renames the finished file', () => {
  const source = readFileSync(new URL('./ncmCache.ts', import.meta.url), 'utf8')
  // Streaming: no whole-file arrayBuffer buffering remains.
  assert.doesNotMatch(source, /await res\.arrayBuffer\(\)/)
  assert.match(source, /Readable\.fromWeb\(res\.body/)
  assert.match(source, /createWriteStream\(partPath, \{ flags: 'wx' \}\)/)
  assert.match(source, /await rename\(partPath, target\)/)
  // Failures must not leave a stale .part behind from this invocation.
  assert.match(source, /await rm\(partPath, \{ force: true \}\)/)
  // Cache lookups must never hand out in-flight .part files (enforced by the
  // index builder in ncmCacheIndex.ts).
  assert.match(
    readFileSync(new URL('./ncmCacheIndex.ts', import.meta.url), 'utf8'),
    /name\.includes\('\.part'\)/
  )
  // Capacity governance hooks into the write path and hits refresh mtime (LRU).
  assert.match(source, /pruneNcmCacheDir\(dir\)/)
  assert.match(source, /utimesSync\(fullPath/)
})

test('ncm cache lookups run on an in-memory index instead of a per-play directory scan', () => {
  const source = readFileSync(new URL('./ncmCache.ts', import.meta.url), 'utf8')
  const lookup = extractFunction(source, 'getCachedNcmSong')
  // 8.3: 命中路径不再 readdirSync；索引由目录快照惰性构建，写入/淘汰同步维护。
  assert.match(lookup, /getNcmCacheEntryName\(songId\)/)
  assert.doesNotMatch(lookup, /readdirSync/)
  assert.match(
    source,
    /!ncmCacheIndex \|\| ncmCacheIndex\.dir !== dir[\s\S]*?buildNcmCacheIndexFromNames\(readdirSync\(dir\)\)/
  )
  assert.match(source, /rememberNcmCacheEntry\(songId, dir, `\$\{songId\}\$\{ext\}`\)/)
  assert.match(source, /forgetNcmCacheEntry\(dir, name\)/)
  // .part 临时文件仍绝不可入索引。
  assert.match(
    readFileSync(new URL('./ncmCacheIndex.ts', import.meta.url), 'utf8'),
    /name\.includes\('\.part\'\)/
  )
})

function extractFunction(source: string, functionName: string): string {
  const signature = new RegExp(
    `(?:async\\s+)?function ${functionName}\\([^)]*\\)[:\\w\\s<>\\[\\]'|]*\\s\\{`
  )
  const match = source.match(signature)
  assert.ok(match?.index != null, `${functionName} function should exist`)
  const bodyStart = match.index + match[0].length - 1
  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return source.slice(bodyStart + 1, index)
  }
  throw new Error(`${functionName} body should close`)
}
