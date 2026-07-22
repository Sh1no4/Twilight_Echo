const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const electronBuilder = require.resolve('electron-builder/out/cli/cli.js')

function run(args, environment = process.env) {
  return spawnSync(process.execPath, [electronBuilder, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...environment, TWILIGHT_PACKAGE_STRIP: '1' }
  })
}

function main(args = process.argv.slice(2)) {
  const result = run(args)
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

if (require.main === module) main()

module.exports = { electronBuilder, main, run }
