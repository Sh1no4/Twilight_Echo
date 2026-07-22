const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const electronBuilder = path.join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
)

function run(args, environment = process.env) {
  return spawnSync(electronBuilder, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...environment, TWILIGHT_PACKAGE_STRIP: '1' }
  })
}

function main(args = process.argv.slice(2)) {
  const result = run(args)
  process.exit(result.status ?? 1)
}

if (require.main === module) main()

module.exports = { electronBuilder, main, run }
