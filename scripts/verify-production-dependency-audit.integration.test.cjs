const assert = require('node:assert/strict')
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { isAbsolute, join, relative, resolve, sep } = require('node:path')
const { tmpdir } = require('node:os')
const test = require('node:test')

const {
  PNPM_PACKAGE_MANAGER,
  resolveBundledCorepackScript
} = require('./verify-production-dependency-audit.cjs')

const candidate = process.env.TWILIGHT_AUDIT_INTEGRATION_CANDIDATE

test(
  'production audit starts from a real pinned pnpm process in an isolated candidate',
  { skip: !candidate && 'set TWILIGHT_AUDIT_INTEGRATION_CANDIDATE to run this integration test' },
  () => {
    const candidateRoot = resolve(candidate)
    const corepackScript = resolveBundledCorepackScript()
    assert.ok(corepackScript, 'the active Node runtime must provide Corepack')
    assert.ok(
      existsSync(join(candidateRoot, 'package.json')),
      'candidate must contain package.json'
    )
    const forbiddenCandidateOutputPath = join(
      candidateRoot,
      'output',
      'production-dependency-audit.integration.json'
    )
    assert.equal(
      existsSync(forbiddenCandidateOutputPath),
      false,
      'candidate source scope must start without integration audit output'
    )

    const outputRoot = mkdtempSync(join(tmpdir(), 'twilight-production-audit-'))
    const outputPath = join(outputRoot, 'production-dependency-audit.integration.json')
    try {
      const outputFromCandidate = relative(candidateRoot, outputRoot)
      assert.ok(
        outputFromCandidate === '..' ||
          outputFromCandidate.startsWith(`..${sep}`) ||
          isAbsolute(outputFromCandidate),
        'integration audit output root must be outside the candidate source scope'
      )
      const result = spawnSync(
        process.execPath,
        [
          corepackScript,
          PNPM_PACKAGE_MANAGER,
          'run',
          'audit:production',
          '--',
          '--output',
          outputPath
        ],
        { cwd: candidateRoot, encoding: 'utf8', timeout: 240_000, windowsHide: true }
      )

      assert.equal(result.error, undefined, result.error?.message)
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stdout, /Production dependency audit passed/)
      assert.ok(existsSync(outputPath), 'the real candidate audit must emit its JSON report')
      const report = JSON.parse(readFileSync(outputPath, 'utf8'))
      assert.deepEqual(report.metadata.vulnerabilities, {
        info: 0,
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0
      })
    } finally {
      rmSync(outputRoot, { recursive: true, force: true })
      assert.equal(existsSync(outputPath), false, 'integration audit output must be removed')
      assert.equal(existsSync(outputRoot), false, 'integration audit temp root must be removed')
      assert.equal(
        existsSync(forbiddenCandidateOutputPath),
        false,
        'integration audit must not add output to the candidate source scope'
      )
    }
  }
)
