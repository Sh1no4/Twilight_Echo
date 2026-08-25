const assert = require('node:assert/strict')
const test = require('node:test')

const {
  parseArgs,
  readVulnerabilityCounts,
  resolveBundledCorepackScript,
  resolvePnpmInvocation,
  validateAuditReport,
  PNPM_PACKAGE_MANAGER
} = require('./verify-production-dependency-audit.cjs')

function report(overrides = {}) {
  return {
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0,
        ...overrides
      }
    }
  }
}

test('production audit accepts reports without moderate, high, or critical findings', () => {
  assert.deepEqual(validateAuditReport(report({ low: 2 })), {
    info: 0,
    low: 2,
    moderate: 0,
    high: 0,
    critical: 0
  })
})

test('production audit rejects every blocking severity', () => {
  assert.throws(
    () => validateAuditReport(report({ moderate: 1, high: 2, critical: 3 })),
    /moderate=1, high=2, critical=3/
  )
})

test('production audit rejects malformed vulnerability metadata', () => {
  assert.throws(() => readVulnerabilityCounts({ metadata: {} }), /metadata\.vulnerabilities/)
  assert.throws(
    () => readVulnerabilityCounts(report({ high: -1 })),
    /must be a non-negative integer/
  )
})

test('production audit CLI accepts reproducible input and output paths only', () => {
  const options = parseArgs(['--', '--input', 'audit.json', '--output', 'evidence/audit.json'])
  assert.match(options.input, /audit\.json$/)
  assert.match(options.output, /evidence[\\/]audit\.json$/)
  assert.throws(() => parseArgs(['--input']), /requires a file path/)
  assert.throws(() => parseArgs(['--unexpected']), /unknown argument/)
})

test('production audit reuses the pnpm executable that started the script', () => {
  assert.deepEqual(
    resolvePnpmInvocation(
      { npm_execpath: 'C:/tools/pnpm/11.7.0/bin/pnpm.cjs' },
      'win32',
      'node.exe'
    ),
    { command: 'node.exe', prefixArgs: ['C:/tools/pnpm/11.7.0/bin/pnpm.cjs'] }
  )
  assert.deepEqual(resolvePnpmInvocation({}, 'win32', 'node.exe', 'C:/node/corepack.js'), {
    command: 'node.exe',
    prefixArgs: ['C:/node/corepack.js', PNPM_PACKAGE_MANAGER]
  })
})

test('production audit locates Corepack from PATH when a bundled runtime has no local copy', () => {
  const corepackScript = resolveBundledCorepackScript(
    'C:/isolated-runtime/node.exe',
    { PATH: 'C:/tools;C:/node-install' },
    'win32',
    (candidate) => candidate.endsWith('node-install\\node_modules\\corepack\\dist\\corepack.js')
  )
  assert.match(corepackScript, /node-install[\\/]node_modules[\\/]corepack[\\/]dist[\\/]corepack\.js$/)
  assert.deepEqual(resolvePnpmInvocation({}, 'win32', 'C:/isolated-runtime/node.exe', corepackScript), {
    command: 'C:/isolated-runtime/node.exe',
    prefixArgs: [corepackScript, PNPM_PACKAGE_MANAGER]
  })
})

test('production audit fails explicitly when Windows Corepack cannot be located', () => {
  assert.throws(
    () => resolvePnpmInvocation({}, 'win32', 'C:/isolated-runtime/node.exe', undefined),
    /could not locate Corepack/
  )
})
