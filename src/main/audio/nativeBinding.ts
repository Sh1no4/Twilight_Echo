import { existsSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'
import type { NativeAudioBinding } from './audioEngineTypes.ts'

const require = createRequire(import.meta.url)

type ElectronModule = typeof import('electron')

function resolveElectronApp(): ElectronModule['app'] | null {
  try {
    const electronModule = require('electron') as ElectronModule | string
    if (typeof electronModule === 'object' && electronModule && 'app' in electronModule) {
      return electronModule.app
    }
  } catch {
    // Node-side tests can import this module without an Electron runtime.
  }
  return null
}

const electronApp = resolveElectronApp()

export function getNativeAddonCandidates(): string[] {
  const binary = 'twilight_audio_node.node'
  const appPath = electronApp?.getAppPath?.() ?? process.cwd()
  return [
    join(process.resourcesPath ?? '', 'audio-engine', binary),
    join(appPath, 'resources', 'audio-engine', binary),
    join(appPath, 'audio-engine', 'build', 'default', binary),
    join(appPath, 'audio-engine', 'build', 'mingw-static', binary),
    join(appPath, 'audio-engine', 'build', 'windows-msvc', binary),
    join(appPath, '..', 'audio-engine', 'build', 'default', binary),
    join(appPath, '..', 'audio-engine', 'build', 'mingw-static', binary),
    join(appPath, '..', 'audio-engine', 'build', 'windows-msvc', binary)
  ]
}

export function rendererFallbackAllowed(): boolean {
  return process.env.TWILIGHT_ENABLE_HTMLAUDIO_FALLBACK === '1'
}

export function loadNativeBinding(
  getCandidates: () => string[] = getNativeAddonCandidates
): NativeAudioBinding | null {
  for (const candidate of getCandidates()) {
    if (!existsSync(candidate)) continue
    try {
      // Native addons must be loaded dynamically because the file is produced by CMake.
      return require(candidate) as NativeAudioBinding
    } catch (err) {
      console.warn('原生音频模块加载失败：', candidate, err)
    }
  }
  return null
}
