'use strict'
// Scratch: compare thrown audio error codes against catalog keys.
const fs = require('node:fs')
const path = require('node:path')
const ROOT = path.join(__dirname, '..')

const FILES = [
  'src/main/audio/outputRouter.ts',
  'src/main/audio/playbackController.ts',
  'src/main/audio/dspOrchestrator.ts',
  'src/main/audio/engineIpc.ts',
  'src/main/audioEngineServiceClient.ts'
]

const thrown = new Set()
for (const rel of FILES) {
  const full = path.join(ROOT, rel)
  if (!fs.existsSync(full)) continue
  const src = fs.readFileSync(full, 'utf8')
  for (const m of src.matchAll(/'(audio\.[a-z0-9_]+)'/g)) thrown.add(m[1])
}

function catalogKeys(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const keys = new Set()
  for (const m of src.matchAll(/^\s{2}'([^']+)':/gm)) keys.add(m[1])
  return keys
}
const zh = catalogKeys('src/shared/i18n/messages/zh-CN.ts')

const thrownSorted = [...thrown].sort()
console.log('thrown codes: ' + thrownSorted.length)
const noCopy = thrownSorted.filter((c) => !zh.has('error.' + c))
console.log('\nTHROWN but NO catalog copy (' + noCopy.length + '):')
for (const c of noCopy) console.log('  ' + c)

const audioKeys = [...zh].filter((k) => k.startsWith('error.audio.')).sort()
const noThrow = audioKeys.filter((k) => !thrown.has(k.slice('error.'.length)))
console.log('\nCATALOG error.audio.* with NO thrower (' + noThrow.length + '):')
for (const k of noThrow) console.log('  ' + k)
