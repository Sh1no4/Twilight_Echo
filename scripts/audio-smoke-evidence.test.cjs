const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const {
  buildAudioSmokeEvidenceReport,
  buildEntriesFromSmokeSummary,
  buildCoverageSummary,
  readEntriesFromInputs
} = require('./audio-smoke-evidence.cjs')

test('audio smoke evidence report records opt-in real-device surfaces', () => {
  const report = buildAudioSmokeEvidenceReport({
    generatedAt: '2026-07-05T00:00:00.000Z',
    platform: 'win32',
    entries: [
      {
        id: 'wasapi-exclusive-pcm',
        label: 'WASAPI Exclusive PCM',
        status: 'pass',
        command: 'npm run smoke:wasapi -- --device "Desk DAC" --format-matrix',
        artifact: 'output/audio-smoke-evidence/wasapi-exclusive-pcm.json',
        notes: '24-bit PCM path matched actual output format'
      },
      {
        id: 'asio-native-dsd',
        label: 'ASIO Native DSD',
        status: 'not-run',
        command: 'npm run smoke:asio-native-dsd -- --driver "Studio ASIO"',
        artifact: '',
        notes: 'No ASIO driver attached on this machine'
      }
    ]
  })

  assert.match(report.markdown, /# Twilight Audio Real-Device Smoke Evidence/)
  assert.match(report.markdown, /WASAPI Exclusive PCM/)
  assert.match(report.markdown, /ASIO Native DSD/)
  assert.match(report.markdown, /npm run smoke:wasapi/)
  assert.match(report.markdown, /output\/audio-smoke-evidence\/wasapi-exclusive-pcm\.json/)
  assert.equal(report.json.schemaVersion, 1)
  assert.equal(report.json.requiredSurfaces.includes('DoP DAC'), true)
  assert.equal(report.json.requiredSurfaces.includes('SACD ISO'), true)
  assert.equal(report.json.entries[0].status, 'pass')
  assert.equal(report.json.entries[1].status, 'not-run')
  assert.equal(report.json.coverage.complete, false)
  assert.deepEqual(report.json.coverage.missingSurfaces, [
    'ASIO',
    'DoP DAC',
    'Native DSD',
    'SACD ISO'
  ])
  assert.equal(report.json.surfaceRows.length, 5)
  assert.equal(
    report.json.surfaceRows.some(
      (entry) => entry.surface === 'SACD ISO' && entry.status === 'not-run'
    ),
    true
  )
  assert.match(report.markdown, /\| SACD ISO \| not-run \|/)
  assert.match(report.markdown, /Coverage: 1\/5 required surfaces passed/)
  assert.match(report.markdown, /Complete: no/)
})

test('audio smoke evidence report can derive entries from smoke JSON summaries', () => {
  const entries = buildEntriesFromSmokeSummary(
    {
      device: { label: 'Desk DAC' },
      results: [
        {
          ok: true,
          label: 'WASAPI Exclusive hardware smoke',
          backend: 'wasapi-exclusive',
          info: { actualOutputFormat: 'int24-in32', actualSampleRate: 192000, outputPerfect: true }
        },
        {
          ok: false,
          label: 'ASIO Native DSD 2822400Hz',
          backend: 'asio',
          error: 'Driver rejected Native DSD',
          info: { nativeDsdRuntimeState: 'unproven' }
        }
      ]
    },
    'output/audio-smoke-evidence/desk-dac.json',
    'npm run smoke:wasapi -- --device "Desk DAC" --json'
  )

  assert.equal(entries.length, 2)
  assert.equal(entries[0].status, 'pass')
  assert.equal(entries[0].artifact, 'output/audio-smoke-evidence/desk-dac.json')
  assert.match(entries[0].notes, /Desk DAC/)
  assert.match(entries[0].notes, /int24-in32/)
  assert.equal(entries[1].status, 'fail')
  assert.match(entries[1].notes, /Driver rejected Native DSD/)
})

test('audio smoke evidence report expands missing required surfaces as not-run', () => {
  const report = buildAudioSmokeEvidenceReport({
    generatedAt: '2026-07-05T00:00:00.000Z',
    platform: 'win32',
    entries: [
      {
        id: 'wasapi-exclusive-pcm',
        label: 'WASAPI Exclusive hardware smoke',
        status: 'pass'
      }
    ]
  })

  assert.deepEqual(
    report.json.surfaceRows.map((entry) => entry.surface),
    ['WASAPI Exclusive', 'ASIO', 'DoP DAC', 'Native DSD', 'SACD ISO']
  )
  assert.equal(report.json.surfaceRows[0].status, 'pass')
  assert.equal(report.json.surfaceRows[1].status, 'not-run')
  assert.match(report.markdown, /\| ASIO \| not-run \|/)
  assert.match(report.markdown, /\| DoP DAC \| not-run \|/)
})

test('audio smoke evidence coverage is complete only when every required surface passes', () => {
  const coverage = buildCoverageSummary(
    ['WASAPI Exclusive', 'ASIO', 'DoP DAC', 'Native DSD', 'SACD ISO'].map((surface) => ({
      surface,
      status: 'pass'
    }))
  )

  assert.equal(coverage.complete, true)
  assert.equal(coverage.passCount, 5)
  assert.deepEqual(coverage.missingSurfaces, [])
  assert.deepEqual(coverage.failedSurfaces, [])
})

test('audio smoke evidence CLI rejects missing flag values', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'audio-smoke-evidence.cjs'), '--input', '--output-dir', 'unused'],
    { encoding: 'utf8' }
  )

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /--input requires a value/)
})

test('audio smoke evidence CLI accepts UTF-8 BOM JSON from Windows tools', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twilight-audio-evidence-test-'))
  try {
    const inputPath = path.join(dir, 'summary.json')
    fs.writeFileSync(
      inputPath,
      `\uFEFF${JSON.stringify({
        device: { label: 'Desk DAC' },
        results: [{ ok: true, label: 'WASAPI Exclusive hardware smoke', backend: 'wasapi-exclusive' }]
      })}`
    )
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, 'audio-smoke-evidence.cjs'), '--input', inputPath, '--output-dir', dir],
      { encoding: 'utf8' }
    )

    assert.equal(result.status, 0)
    assert.match(
      fs.readFileSync(path.join(dir, 'audio-smoke-evidence.md'), 'utf8'),
      /\| WASAPI Exclusive \| pass \|/
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('audio smoke evidence can merge multiple smoke summary files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twilight-audio-evidence-merge-test-'))
  try {
    const wasapiPath = path.join(dir, 'wasapi.json')
    const asioPath = path.join(dir, 'asio.json')
    fs.writeFileSync(
      wasapiPath,
      JSON.stringify({
        device: { label: 'Desk DAC' },
        results: [{ ok: true, label: 'WASAPI Exclusive hardware smoke', backend: 'wasapi-exclusive' }]
      })
    )
    fs.writeFileSync(
      asioPath,
      JSON.stringify({
        device: { label: 'Studio ASIO' },
        results: [{ ok: false, label: 'ASIO PCM smoke', backend: 'asio', error: 'Driver rejected PCM open' }]
      })
    )

    const entries = readEntriesFromInputs([wasapiPath, asioPath])
    const report = buildAudioSmokeEvidenceReport({ entries })

    assert.equal(entries.length, 2)
    assert.match(report.markdown, /\| WASAPI Exclusive \| pass \|/)
    assert.match(report.markdown, /\| ASIO \| fail \|/)
    assert.match(report.markdown, /Driver rejected PCM open/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('audio smoke evidence CLI can read a directory of smoke JSON summaries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twilight-audio-evidence-dir-test-'))
  const outputDir = path.join(dir, 'out')
  try {
    fs.writeFileSync(
      path.join(dir, 'dop.json'),
      JSON.stringify({
        device: { label: 'DoP DAC' },
        results: [{ ok: true, label: 'DoP DAC carrier smoke', backend: 'wasapi-exclusive', info: { dsdMode: 'dop' } }]
      })
    )
    fs.writeFileSync(
      path.join(dir, 'sacd.json'),
      JSON.stringify({
        device: { label: 'SACD ISO fixture' },
        results: [{ ok: true, label: 'SACD ISO playback smoke', backend: 'wasapi-exclusive' }]
      })
    )

    const result = spawnSync(
      process.execPath,
      [
        path.join(__dirname, 'audio-smoke-evidence.cjs'),
        '--input-dir',
        dir,
        '--output-dir',
        outputDir
      ],
      { encoding: 'utf8' }
    )

    assert.equal(result.status, 0)
    const markdown = fs.readFileSync(path.join(outputDir, 'audio-smoke-evidence.md'), 'utf8')
    assert.match(markdown, /\| DoP DAC \| pass \|/)
    assert.match(markdown, /\| SACD ISO \| pass \|/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('audio smoke evidence CLI can fail when required surface evidence is incomplete', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twilight-audio-evidence-strict-test-'))
  try {
    const inputPath = path.join(dir, 'wasapi.json')
    fs.writeFileSync(
      inputPath,
      JSON.stringify({
        device: { label: 'Desk DAC' },
        results: [{ ok: true, label: 'WASAPI Exclusive hardware smoke', backend: 'wasapi-exclusive' }]
      })
    )
    const result = spawnSync(
      process.execPath,
      [
        path.join(__dirname, 'audio-smoke-evidence.cjs'),
        '--input',
        inputPath,
        '--output-dir',
        dir,
        '--require-complete'
      ],
      { encoding: 'utf8' }
    )

    assert.equal(result.status, 1)
    assert.match(result.stderr, /Audio smoke evidence incomplete/)
    assert.match(result.stderr, /ASIO=not-run/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
