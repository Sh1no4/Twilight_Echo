const assert = require('node:assert/strict')
const test = require('node:test')

const { FORBIDDEN_CONTENT, FORBIDDEN_PATHS } = require('./verify-asio-sdk-free.cjs')

test('ASIO SDK removal gate catches SDK paths and includes without matching internal compatibility headers', () => {
  assert.equal(
    FORBIDDEN_PATHS.some((pattern) =>
      pattern.test('audio-engine/third_party/ASIOSDK/common/asio.h')
    ),
    true
  )
  assert.equal(
    FORBIDDEN_PATHS.some((pattern) => pattern.test('audio-engine/output/asio/abi/AsioAbi.h')),
    false
  )
  assert.equal(
    FORBIDDEN_CONTENT.some((pattern) => pattern.test('#include "asiosys.h"')),
    true
  )
  assert.equal(
    FORBIDDEN_CONTENT.some((pattern) => pattern.test('#include "AsioAbi.h"')),
    false
  )
})
