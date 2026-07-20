const assert = require('node:assert/strict')

async function main() {
  const loginQrCheck = require('@neteasecloudmusicapienhanced/api/module/login_qr_check.js')
  const result = await loginQrCheck({ key: 'quality-gate' }, async () => {
    throw new Error('simulated request failure')
  })

  assert.deepEqual(result, {
    status: 200,
    body: {
      code: -1,
      msg: 'simulated request failure'
    },
    cookie: []
  })
  console.log('NCM login_qr_check patch is installed and active')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
