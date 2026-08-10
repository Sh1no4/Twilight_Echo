const { mkdirSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { join, resolve } = require('node:path')
const {
  resolveSmtcMsvcBuildDirectory,
  resolveSmtcMsvcEnvironment,
  validateSmtcMsvcToolchain
} = require('./smtc-msvc-toolchain.cjs')

const root = resolve(__dirname, '..')
const environment = resolveSmtcMsvcEnvironment()
const sourceDir = join(root, 'audio-engine', 'smtc')
const buildDir = resolveSmtcMsvcBuildDirectory(environment, root)
const nodeApiIncludeDir = join(root, 'node_modules', 'node-api-headers', 'include')

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (process.platform !== 'win32') fail('SMTC helpers can only be configured on Windows.')
const toolchain = validateSmtcMsvcToolchain({ env: environment })
if (!toolchain.ok) fail(toolchain.message)
const { installRoot } = toolchain

if (!require('node:fs').existsSync(join(nodeApiIncludeDir, 'node_api.h'))) {
  fail(`Node-API headers were not found under ${nodeApiIncludeDir}. Run pnpm install first.`)
}

mkdirSync(buildDir, { recursive: true })
const result = spawnSync(
  'cmake',
  [
    '-S',
    sourceDir,
    '-B',
    buildDir,
    '-G',
    'Visual Studio 17 2022',
    '-A',
    'x64',
    `-DCMAKE_GENERATOR_INSTANCE=${installRoot}`,
    `-DTAE_NODE_INCLUDE_DIR=${nodeApiIncludeDir}`
  ],
  { cwd: root, stdio: 'inherit', env: environment }
)
process.exit(result.status ?? 1)
