import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const httpServerSource = readFileSync(new URL('./httpServer.ts', import.meta.url), 'utf8')
const remoteIpcSource = readFileSync(new URL('./remoteIpc.ts', import.meta.url), 'utf8')

test('remote HTTP server supports mediaOnly bind without full remote surface', () => {
  assert.match(httpServerSource, /mode\?: RemoteServerMode/)
  assert.match(httpServerSource, /mode === 'mediaOnly'/)
  assert.match(httpServerSource, /media_only/)
  // mediaOnly must not advertise PIN / remote URLs as "enabled".
  assert.match(httpServerSource, /enabled: this\.enabled && !mediaOnly/)
  assert.match(httpServerSource, /pin: this\.enabled && !mediaOnly \? this\.auth\.getPin\(\) : null/)
  // mediaOnly request path only serves /media/ tokens.
  assert.match(
    httpServerSource,
    /if \(this\.mode === 'mediaOnly'\) \{[\s\S]*\/media\/[\s\S]*media_only/
  )
  // Full remote pair/UI routes must not run under mediaOnly (early return).
  assert.match(httpServerSource, /desiredMode === 'full'/)
})

test('cast binds media-only when remote control is off and tears it down on stopCast', () => {
  assert.match(remoteIpcSource, /ensureCastMediaServer/)
  assert.match(
    remoteIpcSource,
    /remoteEnabled[\s\S]*mode: 'full'[\s\S]*mode: 'mediaOnly'/
  )
  assert.match(remoteIpcSource, /await ensureCastMediaServer\(\)/)
  assert.match(
    remoteIpcSource,
    /remote:stopCast[\s\S]*isMediaOnly\(\)[\s\S]*remoteControlEnabled !== true[\s\S]*server\.stop\(\)/
  )
  // Disabling remote demotes to mediaOnly while a cast session is active.
  assert.match(
    remoteIpcSource,
    /if \(activeCastUsn \|\| server\.isMediaOnly\(\)\) \{\s*await server\.start\(preferredPort, \{ mode: 'mediaOnly' \}\)/
  )
  assert.match(remoteIpcSource, /await server\.stop\(\)/)
})
