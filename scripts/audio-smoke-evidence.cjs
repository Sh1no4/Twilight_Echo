const fs = require('node:fs')
const path = require('node:path')

const REQUIRED_SURFACES = [
  'WASAPI Exclusive',
  'ASIO',
  'DoP DAC',
  'Native DSD',
  'SACD ISO'
]

function inferSurface(entry) {
  const explicit = entry && entry.surface ? String(entry.surface) : ''
  if (REQUIRED_SURFACES.includes(explicit)) return explicit

  const text = [entry && entry.id, entry && entry.label, entry && entry.command, entry && entry.notes]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (text.includes('sacd') || text.includes('iso')) return 'SACD ISO'
  if (text.includes('native dsd') || text.includes('native-dsd')) return 'Native DSD'
  if (text.includes('dop')) return 'DoP DAC'
  if (text.includes('asio')) return 'ASIO'
  if (text.includes('wasapi') || text.includes('exclusive')) return 'WASAPI Exclusive'
  return 'Unmapped'
}

function normalizeEntry(entry) {
  return {
    surface: inferSurface(entry),
    id: String(entry && entry.id ? entry.id : 'unknown'),
    label: String(entry && entry.label ? entry.label : 'Unknown smoke surface'),
    status: entry && ['pass', 'fail', 'not-run', 'skip'].includes(entry.status)
      ? entry.status
      : 'not-run',
    command: String(entry && entry.command ? entry.command : ''),
    artifact: String(entry && entry.artifact ? entry.artifact : ''),
    notes: String(entry && entry.notes ? entry.notes : '')
  }
}

function markdownEscape(value) {
  return String(value || '').replaceAll('|', '\\|').replace(/\r?\n/g, '<br>')
}

function materializeRequiredSurfaceRows(entries) {
  const rows = []
  const grouped = new Map()
  for (const entry of entries) {
    const surface = entry.surface || inferSurface(entry)
    const list = grouped.get(surface) || []
    list.push(entry)
    grouped.set(surface, list)
  }

  for (const surface of REQUIRED_SURFACES) {
    const surfaceEntries = grouped.get(surface) || []
    if (surfaceEntries.length === 0) {
      rows.push(
        normalizeEntry({
          surface,
          id: surface.toLowerCase().replaceAll(' ', '-'),
          label: surface,
          status: 'not-run',
          notes: 'No opt-in real-device smoke evidence recorded yet.'
        })
      )
      continue
    }
    rows.push(...surfaceEntries)
  }

  for (const [surface, surfaceEntries] of grouped.entries()) {
    if (!REQUIRED_SURFACES.includes(surface)) rows.push(...surfaceEntries)
  }
  return rows
}

function buildCoverageSummary(surfaceRows) {
  const required = surfaceRows.filter((entry) => REQUIRED_SURFACES.includes(entry.surface))
  const passedSurfaces = []
  const failedSurfaces = []
  const missingSurfaces = []
  const skippedSurfaces = []

  for (const surface of REQUIRED_SURFACES) {
    const rows = required.filter((entry) => entry.surface === surface)
    if (rows.some((entry) => entry.status === 'pass')) {
      passedSurfaces.push(surface)
    } else if (rows.some((entry) => entry.status === 'fail')) {
      failedSurfaces.push(surface)
    } else if (rows.some((entry) => entry.status === 'skip')) {
      skippedSurfaces.push(surface)
    } else {
      missingSurfaces.push(surface)
    }
  }

  return {
    complete: passedSurfaces.length === REQUIRED_SURFACES.length,
    requiredCount: REQUIRED_SURFACES.length,
    passCount: passedSurfaces.length,
    failCount: failedSurfaces.length,
    missingCount: missingSurfaces.length,
    skipCount: skippedSurfaces.length,
    passedSurfaces,
    failedSurfaces,
    missingSurfaces,
    skippedSurfaces
  }
}

function compactSmokeInfo(info) {
  if (!info || typeof info !== 'object') return ''
  const parts = []
  if (info.actualOutputFormat || info.actualSampleRate || info.actualChannels) {
    parts.push(
      [info.actualOutputFormat, info.actualSampleRate ? `${info.actualSampleRate}Hz` : '', info.actualChannels ? `${info.actualChannels}ch` : '']
        .filter(Boolean)
        .join('/')
    )
  }
  if (typeof info.outputPerfect === 'boolean') parts.push(`outputPerfect=${info.outputPerfect}`)
  if (info.nativeDsdRuntimeState) parts.push(`nativeDsd=${info.nativeDsdRuntimeState}`)
  if (info.dsdMode) parts.push(`dsdMode=${info.dsdMode}`)
  return parts.filter(Boolean).join('; ')
}

function buildEntriesFromSmokeSummary(summary, artifact = '', command = '') {
  const results = Array.isArray(summary && summary.results) ? summary.results : []
  const device = summary && summary.device ? summary.device : {}
  const deviceLabel = device.label || device.name || device.id || summary.deviceSelector || ''
  return results.map((result, index) => {
    const infoNotes = compactSmokeInfo(result.info)
    return normalizeEntry({
      id: result.id || `${String(result.backend || 'audio-smoke')}-${index + 1}`,
      label: result.label || `${result.backend || 'Audio'} smoke`,
      status: result.ok === true ? 'pass' : result.ok === false ? 'fail' : 'not-run',
      command,
      artifact,
      notes: [deviceLabel ? `device=${deviceLabel}` : '', infoNotes, result.error || result.notes || '']
        .filter(Boolean)
        .join('; ')
    })
  })
}

function buildAudioSmokeEvidenceReport(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString()
  const platform = options.platform || process.platform
  const entries = Array.isArray(options.entries) ? options.entries.map(normalizeEntry) : []
  const surfaceRows = materializeRequiredSurfaceRows(entries)
  const coverage = buildCoverageSummary(surfaceRows)
  const json = {
    schemaVersion: 1,
    generatedAt,
    platform,
    requiredSurfaces: [...REQUIRED_SURFACES],
    coverage,
    entries,
    surfaceRows
  }

  const lines = [
    '# Twilight Audio Real-Device Smoke Evidence',
    '',
    `Generated: ${generatedAt}`,
    `Platform: ${platform}`,
    `Coverage: ${coverage.passCount}/${coverage.requiredCount} required surfaces passed`,
    `Complete: ${coverage.complete ? 'yes' : 'no'}`,
    '',
    'Required opt-in surfaces:',
    ...REQUIRED_SURFACES.map((surface) => `- ${surface}`),
    '',
    '| Surface | Status | Command | Artifact | Notes |',
    '|---|---|---|---|---|'
  ]

  for (const entry of surfaceRows) {
    lines.push(
      `| ${markdownEscape(entry.surface)} | ${markdownEscape(entry.status)} | ${markdownEscape(
        entry.command
      )} | ${markdownEscape(entry.artifact)} | ${markdownEscape(
        entry.label === entry.surface ? entry.notes : `${entry.label}; ${entry.notes}`.replace(/; $/, '')
      )} |`
    )
  }

  return {
    json,
    markdown: `${lines.join('\n')}\n`
  }
}

function readEntries(filePath) {
  if (!filePath) return []
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) return parsed
  if (Array.isArray(parsed.entries)) return parsed.entries
  return buildEntriesFromSmokeSummary(parsed, filePath)
}

function readEntriesFromInputs(filePaths) {
  return filePaths.flatMap((filePath) => readEntries(filePath))
}

function argValue(args, name) {
  const index = args.indexOf(name)
  if (index < 0) return ''
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

function argValues(args, name) {
  const values = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue
    const value = args[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`${name} requires a value`)
    }
    values.push(value)
    index += 1
  }
  return values
}

function collectInputFiles(args) {
  const inputFiles = argValues(args, '--input')
  const inputDirs = argValues(args, '--input-dir')
  for (const inputDir of inputDirs) {
    const entries = fs
      .readdirSync(inputDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map((entry) => path.join(inputDir, entry.name))
      .sort((left, right) => left.localeCompare(right))
    inputFiles.push(...entries)
  }
  return inputFiles
}

function main() {
  const args = process.argv.slice(2)
  const inputFiles = collectInputFiles(args)
  const requireComplete = args.includes('--require-complete')
  const outputDir =
    args.includes('--output-dir')
      ? argValue(args, '--output-dir')
      : path.join(process.cwd(), 'output', 'audio-smoke-evidence')
  const report = buildAudioSmokeEvidenceReport({
    entries: readEntriesFromInputs(inputFiles)
  })

  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(path.join(outputDir, 'audio-smoke-evidence.md'), report.markdown)
  fs.writeFileSync(
    path.join(outputDir, 'audio-smoke-evidence.json'),
    `${JSON.stringify(report.json, null, 2)}\n`
  )
  console.log(path.join(outputDir, 'audio-smoke-evidence.md'))
  if (requireComplete && !report.json.coverage.complete) {
    const missing = [
      ...report.json.coverage.failedSurfaces.map((surface) => `${surface}=fail`),
      ...report.json.coverage.missingSurfaces.map((surface) => `${surface}=not-run`),
      ...report.json.coverage.skippedSurfaces.map((surface) => `${surface}=skip`)
    ].join(', ')
    console.error(`Audio smoke evidence incomplete: ${missing}`)
    process.exitCode = 1
  }
}

if (require.main === module) {
  main()
}

module.exports = {
  REQUIRED_SURFACES,
  buildAudioSmokeEvidenceReport,
  buildEntriesFromSmokeSummary,
  buildCoverageSummary,
  readEntriesFromInputs
}
