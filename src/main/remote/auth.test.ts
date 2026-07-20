import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RemoteAuthSession,
  SlidingWindowRateLimiter,
  generateRemotePin,
  safeEqualText
} from './auth.ts'

test('generateRemotePin returns numeric PIN of requested length', () => {
  const pin = generateRemotePin(6)
  assert.match(pin, /^\d{6}$/)
})

test('safeEqualText is length-sensitive', () => {
  assert.equal(safeEqualText('123456', '123456'), true)
  assert.equal(safeEqualText('123456', '123457'), false)
  assert.equal(safeEqualText('123', '1234'), false)
})

test('RemoteAuthSession pairs with PIN and authorizes bearer/query token', () => {
  const session = new RemoteAuthSession({ pin: '654321' })
  assert.equal(session.isPaired(), false)
  const fail = session.pair('000000')
  assert.equal(fail.ok, false)
  const ok = session.pair('654321')
  assert.equal(ok.ok, true)
  if (!ok.ok) return
  assert.equal(session.isPaired(), true)
  assert.equal(session.authorizeBearer(`Bearer ${ok.token}`), true)
  assert.equal(session.authorizeBearer('Bearer wrong'), false)
  assert.equal(session.authorizeTokenQuery(ok.token), true)
  assert.equal(session.authorizeTokenQuery('nope'), false)
})

test('RemoteAuthSession rotatePin revokes token', () => {
  const session = new RemoteAuthSession({ pin: '111111' })
  const ok = session.pair('111111')
  assert.equal(ok.ok, true)
  if (!ok.ok) return
  const oldToken = ok.token
  const nextPin = session.rotatePin()
  assert.match(nextPin, /^\d{6}$/)
  assert.equal(session.isPaired(), false)
  assert.equal(session.authorizeBearer(`Bearer ${oldToken}`), false)
})

test('SlidingWindowRateLimiter enforces max within window', () => {
  let now = 1_000
  const limiter = new SlidingWindowRateLimiter(2, 1_000, () => now)
  assert.equal(limiter.tryConsume(), true)
  assert.equal(limiter.tryConsume(), true)
  assert.equal(limiter.tryConsume(), false)
  now = 2_100
  assert.equal(limiter.tryConsume(), true)
})

test('RemoteAuthSession rate-limits pair attempts', () => {
  let now = 10_000
  const session = new RemoteAuthSession({
    pin: '999999',
    now: () => now
  })
  for (let i = 0; i < 8; i++) {
    const result = session.pair('000000')
    assert.equal(result.ok, false)
  }
  const limited = session.pair('999999')
  assert.equal(limited.ok, false)
  if (limited.ok) return
  assert.equal(limited.reason, 'too_many_pair_attempts')
  now += 6 * 60_000
  const after = session.pair('999999')
  assert.equal(after.ok, true)
})
