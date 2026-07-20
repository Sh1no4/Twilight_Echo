'use strict'
const fs = require('node:fs')
const path = require('node:path')
function stripRendererFontAssets(rendererDir) {
  const assets = path.join(rendererDir, 'assets')
  for (const name of fs.readdirSync(assets)) {
    if (/^Outfit-.*\.woff2$/i.test(name) || /^Phosphor-.*\.(woff|ttf)$/i.test(name)) {
      fs.rmSync(path.join(assets, name), { force: true })
    }
  }
  const publicFont = path.join(rendererDir, 'font', 'Outfit-VariableFont_wght.woff2')
  fs.rmSync(publicFont, { force: true })
}
if (require.main === module) stripRendererFontAssets(process.argv[2] || 'out/renderer')
module.exports = { stripRendererFontAssets }
