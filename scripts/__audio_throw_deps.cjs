'use strict'
// Scratch: find which audio throw strings other code/tests/docs depend on.
const fs = require('node:fs')
const path = require('node:path')

const STRINGS = [
  '原生音频引擎尚未初始化',
  'DSP 资料库尚未初始化',
  'VST3 目录尚未初始化',
  'DSP 资料类型无效',
  'DSP 校正资料标识无效',
  'DSP 校正资料不存在',
  'DSP 资料标识无效',
  '不支持独占模式',
  '原生音频独占模式切换失败',
  '原生音频独占模式配置应用失败',
  '原生音频输出设备切换失败',
  '音频服务在输出拓扑更新期间重启',
  '音频服务在读取输出拓扑 ACK 时重启',
  '直通声道路由应用失败',
  '原生音频输出配置重开失败',
  '原生音频输出配置应用失败',
  '音频地址为空',
  '原生音频播放失败',
  '原生音频停止失败',
  '原生音频队列加载失败',
  '原生播放模式同步失败',
  '原生播放模式切换失败',
  '未加载 twilight_audio_node.node',
  '原生音频引擎未返回有效 VST3 描述',
  '音频服务 IPC 发送失败',
  '原生音频引擎不可用'
]

const THROW_SITES = new Set([
  'src/main/audio/engineIpc.ts',
  'src/main/audio/outputRouter.ts',
  'src/main/audio/playbackController.ts',
  'src/main/audio/dspOrchestrator.ts',
  'src/main/audio/nativeBinding.ts',
  'src/main/audioEngineServiceClient.ts'
])

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|vue|cjs|mjs|md)$/.test(entry.name)) out.push(full)
  }
  return out
}

const files = [...walk('src'), ...walk('scripts'), ...walk('docs')]
let anyDependency = false

for (const needle of STRINGS) {
  const refs = []
  for (const file of files) {
    const rel = path.relative('.', file).split(path.sep).join('/')
    if (rel.startsWith('scripts/__')) continue
    const source = fs.readFileSync(file, 'utf8')
    if (!source.includes(needle)) continue
    if (THROW_SITES.has(rel)) continue
    refs.push(rel)
  }
  if (refs.length > 0) {
    anyDependency = true
    console.log(`DEPENDENCY  ${needle}`)
    for (const ref of refs) console.log(`              ${ref}`)
  }
}

if (!anyDependency) {
  console.log('No external dependencies: every string is used only at its throw site.')
}
