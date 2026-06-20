import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

function extractFunctionBody(source: string, functionName: string): string {
  const signatureIndex = source.indexOf(`export function ${functionName}`)
  assert.notEqual(signatureIndex, -1, `${functionName} export should exist`)

  const implementationStart = source.slice(signatureIndex).match(/\r?\n} \{/)
  assert.ok(implementationStart?.index != null, `${functionName} implementation should start`)

  const bodyStart = signatureIndex + implementationStart.index + implementationStart[0].length - 1

  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return source.slice(bodyStart + 1, index)
  }

  assert.fail(`${functionName} body should close`)
}

test('usePlayerStore does not register reactive side effects per caller', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
  const body = extractFunctionBody(source, 'usePlayerStore')

  assert.match(body, /setupPlayerIntegrationSideEffects\(\)/)
  assert.equal(
    body.includes('watch('),
    false,
    'watchers in usePlayerStore run once per component that calls the store'
  )
})

test('playback info keeps loaded lyrics when reusing the current queue track', () => {
  const source = readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')

  assert.match(source, /function mergeTrackTransientData/)
  assert.match(source, /const mergedTrack = mergeTrackTransientData\(track, currentTrack\.value\)/)
  assert.match(source, /patchTrackInQueues\(updatedTrack\)/)
})

test('local dashboard playback keeps a multi-track queue for next and previous controls', () => {
  const source = readFileSync(new URL('../components/LocalDashboard.vue', import.meta.url), 'utf8')
  const playDashboardTrack = source.match(/function playDashboardTrack[\s\S]*?\n}/)?.[0] ?? ''

  assert.match(playDashboardTrack, /DASHBOARD_QUEUE_WINDOW/)
  assert.match(playDashboardTrack, /tracks\.value\.slice\(queueStart, end\)/)
  assert.match(
    playDashboardTrack,
    /if \(sourceIndex < 0\) \{\s*playTrack\(track, \[track\]\)\s*return\s*\}/,
    'dashboard playback should only fall back to a single-track queue when the track is not in the local library'
  )
})
