const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { delimiter, dirname, resolve } = require('node:path')

const BLOCKING_SEVERITIES = ['moderate', 'high', 'critical']
const PNPM_PACKAGE_MANAGER = 'pnpm@11.7.0'

function fail(message) {
  throw new Error(`Production dependency audit failed: ${message}`)
}

function readVulnerabilityCounts(report) {
  const counts = report?.metadata?.vulnerabilities
  if (!counts || typeof counts !== 'object') {
    fail('pnpm audit JSON did not contain metadata.vulnerabilities')
  }

  const normalized = {}
  for (const severity of ['info', 'low', ...BLOCKING_SEVERITIES]) {
    const value = counts[severity] ?? 0
    if (!Number.isInteger(value) || value < 0) {
      fail(`metadata.vulnerabilities.${severity} must be a non-negative integer`)
    }
    normalized[severity] = value
  }
  return normalized
}

function readAdvisoryCounts(report) {
  const advisories = report?.advisories
  if (!advisories || typeof advisories !== 'object') {
    return undefined
  }

  // pnpm filters auditConfig.ignoreGhsas out of `advisories` (but leaves the raw
  // registry totals in metadata.vulnerabilities), and its own exit code is derived
  // from the filtered advisories. Count the same map so locally patched advisories
  // registered under auditConfig.ignoreGhsas behave identically to pnpm itself.
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }
  for (const advisory of Object.values(advisories)) {
    const severity = advisory?.severity
    if (!(severity in counts)) {
      fail(`advisory reported unknown severity "${severity}"`)
    }
    counts[severity] += 1
  }
  return counts
}

function validateAuditReport(report) {
  // Always keep the metadata shape check so a malformed report never passes.
  readVulnerabilityCounts(report)
  const counts = readAdvisoryCounts(report) ?? readVulnerabilityCounts(report)
  const blocking = BLOCKING_SEVERITIES.filter((severity) => counts[severity] > 0)
  if (blocking.length > 0) {
    fail(blocking.map((severity) => `${severity}=${counts[severity]}`).join(', '))
  }
  return counts
}

function parseAuditReport(text, source) {
  try {
    return JSON.parse(text)
  } catch (error) {
    fail(`${source} was not valid JSON (${error.message})`)
  }
}

function resolveBundledCorepackScript(
  nodeExecutable = process.execPath,
  environment = process.env,
  platform = process.platform,
  fileExists = existsSync
) {
  const searchDirectories = [dirname(nodeExecutable)]
  const pathValue = environment.PATH ?? environment.Path
  if (typeof pathValue === 'string') {
    const pathDelimiter = platform === 'win32' ? ';' : delimiter
    for (const pathEntry of pathValue.split(pathDelimiter)) {
      if (pathEntry) searchDirectories.push(pathEntry)
    }
  }

  for (const directory of searchDirectories) {
    const corepackScript = resolve(directory, 'node_modules', 'corepack', 'dist', 'corepack.js')
    if (fileExists(corepackScript)) return corepackScript
  }
  return undefined
}

function resolvePnpmInvocation(
  environment = process.env,
  platform = process.platform,
  nodeExecutable = process.execPath,
  corepackScript = resolveBundledCorepackScript(nodeExecutable, environment, platform)
) {
  const currentPnpm = environment.npm_execpath
  if (currentPnpm && currentPnpm.toLowerCase().includes('pnpm')) {
    return { command: nodeExecutable, prefixArgs: [currentPnpm] }
  }

  // Node cannot directly spawn a Windows .cmd shim with spawnSync. Prefer the
  // Corepack JavaScript bundled with this Node runtime so a bare `node` call
  // still uses the package-manager version pinned by this repository.
  if (corepackScript) {
    return { command: nodeExecutable, prefixArgs: [corepackScript, PNPM_PACKAGE_MANAGER] }
  }

  if (platform === 'win32') {
    fail('could not locate Corepack required for pnpm@11.7.0; install Corepack with the active Node runtime or add its install directory to PATH')
  }
  return { command: 'corepack', prefixArgs: [PNPM_PACKAGE_MANAGER] }
}

function runPnpmAudit(cwd) {
  const invocation = resolvePnpmInvocation()
  const result = spawnSync(
    invocation.command,
    [...invocation.prefixArgs, 'audit', '--prod', '--json'],
    {
      cwd,
      encoding: 'utf8',
      windowsHide: true
    }
  )

  if (result.error) {
    fail(`could not start pnpm audit --prod --json (${result.error.message})`)
  }
  const output = result.stdout.trim()
  if (!output) {
    fail(`pnpm audit produced no JSON output${result.stderr ? `: ${result.stderr.trim()}` : ''}`)
  }
  return parseAuditReport(output, 'pnpm audit output')
}

function parseArgs(args) {
  const options = { input: undefined, output: undefined }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') continue
    if (arg !== '--input' && arg !== '--output') {
      fail(`unknown argument ${arg}`)
    }
    const value = args[index + 1]
    if (!value || value.startsWith('--')) {
      fail(`${arg} requires a file path`)
    }
    options[arg.slice(2)] = resolve(process.cwd(), value)
    index += 1
  }
  return options
}

function writeReport(outputPath, report) {
  if (!outputPath) return
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
}

function main(args = process.argv.slice(2)) {
  const options = parseArgs(args)
  const report = options.input
    ? parseAuditReport(readFileSync(options.input, 'utf8'), options.input)
    : runPnpmAudit(process.cwd())
  writeReport(options.output, report)
  const counts = validateAuditReport(report)
  console.log(
    `Production dependency audit passed: moderate=${counts.moderate}, high=${counts.high}, critical=${counts.critical}`
  )
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = {
  BLOCKING_SEVERITIES,
  parseArgs,
  parseAuditReport,
  readAdvisoryCounts,
  readVulnerabilityCounts,
  resolveBundledCorepackScript,
  resolvePnpmInvocation,
  validateAuditReport,
  PNPM_PACKAGE_MANAGER
}
