'use strict'
// Scratch verification of the setAudioEngineError choke point. Deleted after use.
const { execFileSync } = require('node:child_process')
const { writeFileSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const runner = join(root, 'scripts', '__chokepoint_run.mts')

writeFileSync(
  runner,
  `
import { parseAppError, ipcError } from '../src/shared/errors/appError.ts'
import { presentError } from '../src/shared/errors/presentError.ts'
import { ZH_CN_MESSAGES } from '../src/shared/i18n/messages/zh-CN.ts'
import { EN_US_MESSAGES } from '../src/shared/i18n/messages/en-US.ts'

// Mirror of resolveAudioEngineErrorText in usePlayerStore.ts.
function resolve(locale: 'zh-CN' | 'en-US', error: string): string {
  const parsed = parseAppError(error)
  if (parsed.code !== null) return presentError(locale, error).trim()
  return error.trim()
}

let bad = 0

console.log('--- 1. structured error IS translated per locale, tail stripped ---')
const wire = ipcError('audio.service_start_failed', 'audio service failed to start').message
for (const locale of ['zh-CN', 'en-US'] as const) {
  const out = resolve(locale, wire)
  const expected = (locale === 'zh-CN' ? ZH_CN_MESSAGES : EN_US_MESSAGES)['error.audio.service_start_failed']
  const ok = out === expected && !out.includes('TE-ERR')
  if (!ok) bad++
  console.log('  ' + locale + ': ' + JSON.stringify(out) + '  ' + (ok ? 'OK' : 'FAIL'))
}

console.log('--- 2. our own catalog copy passes through verbatim in BOTH locales ---')
for (const locale of ['zh-CN', 'en-US'] as const) {
  const catalog = locale === 'zh-CN' ? ZH_CN_MESSAGES : EN_US_MESSAGES
  for (const key of [
    'error.audio.service_start_failed',
    'error.audio.output_route_not_restored',
    'error.audio.native_unavailable'
  ]) {
    const copy = catalog[key]
    const out = resolve(locale, copy)
    const ok = out === copy
    if (!ok) { bad++; console.log('  FAIL ' + locale + ' ' + key + ' -> ' + JSON.stringify(out)) }
  }
}
console.log('  all preserved: ' + (bad === 0 ? 'yes' : 'NO'))

console.log('--- 3. legacy un-migrated Chinese throw text still passes through ---')
for (const legacy of [
  '原生音频引擎尚未初始化',
  'wasapi 不支持独占模式',
  '原生播放模式同步失败：原生音频引擎不可用',
  '未加载 twilight_audio_node.node'
]) {
  const out = resolve('zh-CN', legacy)
  const ok = out === legacy
  if (!ok) bad++
  console.log('  ' + (ok ? 'OK  ' : 'FAIL') + ' ' + JSON.stringify(out))
}

console.log('--- 4. empty / whitespace clears rather than inventing copy ---')
for (const empty of ['', '   ']) {
  const out = resolve('en-US', empty)
  const ok = out === ''
  if (!ok) bad++
  console.log('  ' + JSON.stringify(empty) + ' -> ' + JSON.stringify(out) + ' ' + (ok ? 'OK' : 'FAIL'))
}

console.log('\\n' + (bad === 0 ? 'ALL CHOKEPOINT CHECKS PASS' : bad + ' FAILURES'))
`,
  'utf8'
)

try {
  console.log(
    execFileSync(process.execPath, ['--experimental-strip-types', runner], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  )
} catch (error) {
  console.log(error.stdout || '')
  console.log('STDERR:', error.stderr || '')
} finally {
  rmSync(runner, { force: true })
}
