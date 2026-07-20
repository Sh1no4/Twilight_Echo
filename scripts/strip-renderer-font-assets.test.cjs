'use strict'
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),test=require('node:test')
const {stripRendererFontAssets}=require('./strip-renderer-font-assets.cjs')
test('strips unused Outfit and non-WOFF2 Phosphor fallbacks',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'te-font-strip-'));try{const assets=path.join(root,'assets');fs.mkdirSync(assets);for(const n of ['Outfit-x.woff2','Phosphor-x.woff','Phosphor-x.ttf','Phosphor-x.woff2','primeicons.woff2'])fs.writeFileSync(path.join(assets,n),'x');stripRendererFontAssets(root);assert.deepEqual(fs.readdirSync(assets).sort(),['Phosphor-x.woff2','primeicons.woff2'])}finally{fs.rmSync(root,{recursive:true,force:true})}})
