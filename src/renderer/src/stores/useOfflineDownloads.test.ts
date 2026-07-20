import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./useOfflineDownloads.ts', import.meta.url), 'utf8')

function extractFunctionBody(name: string): string {
  const signature = new RegExp(
    `(?:async\\s+)?function ${name}\\([^)]*\\)(?:\\s*:\\s*[^{]+)?\\s*\\{`
  )
  const match = signature.exec(source)
  assert.ok(match?.index != null, `missing function ${name}`)
  const bodyStart = match.index + match[0].length - 1

  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return source.slice(bodyStart + 1, index)
  }
  assert.fail(`function ${name} body should close`)
}

test('pinTrack routes podcast pins through podcast:pinEpisode and rejects radio', () => {
  const body = extractFunctionBody('pinTrack')
  assert.match(body, /source === 'podcast'[\s\S]*pinEpisode/)
  assert.match(body, /providerId === 'radio'[\s\S]*cannot be pinned offline/)
  assert.match(body, /offline\.queue\(/)
  assert.doesNotMatch(body, /queueMany/)
})

test('pinTracks reuses pinTrack so bulk path cannot bypass podcast grants or pin radio', () => {
  const body = extractFunctionBody('pinTracks')
  assert.match(body, /for \(const track of tracks\)/)
  assert.match(body, /await pinTrack\(track\)/)
  assert.doesNotMatch(body, /queueMany/)
  assert.doesNotMatch(body, /resolvePlaybackUrl/)
  assert.doesNotMatch(body, /offline\.queue\(/)
})
