import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('NCM API server starts once on the first request and gates fetch on readiness', async () => {
  const source = await readFile(new URL('./api.ts', import.meta.url), 'utf8')

  assert.match(source, /export function ensureNcmServer\(\): Promise<void>/)
  assert.match(source, /if \(runtime\.ncmServerPromise\) return runtime\.ncmServerPromise/)
  assert.match(source, /const startup = startNcmServer\(\)/)
  assert.match(source, /await ensureNcmServer\(\)/)
  assert.match(source, /const res = await fetch\(url, \{/)
  assert.match(source, /signal: controller\.signal,/)
  assert.match(source, /headers,/)
  assert.match(source, /dispatcher: NCM_KEEP_ALIVE_AGENT/)
  assert.doesNotMatch(source, /export async function setupNcmApi/)
})
