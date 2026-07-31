const assert = require('node:assert/strict')
const test = require('node:test')

const { parseArguments } = require('./verify-asio-abi-manifest.cjs')

test('ASIO ABI manifest command requires a golden manifest and at least one probe', () => {
  assert.equal(parseArguments([]).ok, false)
  assert.equal(parseArguments(['--golden', 'golden.json']).ok, false)
  assert.equal(parseArguments(['--golden', 'golden.json', '--manifest', 'mingw.exe']).ok, true)
})
