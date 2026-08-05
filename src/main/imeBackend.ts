import { spawn } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'
import { readFileSync } from 'fs'

/**
 * Linux 输入法（fcitx5/ibus）后端选择。
 *
 * 背景：KWin（KDE Plasma）只有在 kwinrc 的 [Wayland] 组配置了
 * InputMethod（KDE 系统设置 → 虚拟键盘）时，才会向 Wayland 客户端暴露
 * zwp_input_method 协议 —— 这是 text-input 通道的前提。未配置时，
 * Chromium/Electron 在 Wayland 下无法通过 text-input 使用 fcitx5/ibus，
 * 只能回退到 X11（XWayland）后端（fcitx5 通过 GTK_IM_MODULE / XIM 工作）。
 *
 * 关键限制：Chromium 的 ozone 平台在 Electron 二进制启动阶段就已确定，
 * 早于任何主进程 JS 代码执行：
 * - 环境变量（OZONE_PLATFORM 等）对 Electron 无效；
 * - app.commandLine.appendSwitch() 只影响子进程（renderer/GPU），
 *   无法改变 browser 进程自身；
 * - 只有真实命令行参数 --ozone-platform=x11 才能让 browser 进程
 *   走 X11（XWayland）后端。
 * 因此需要 X11 回退时，只能「重启自身并携带该参数」。
 */

/** 强制 X11 后端的启动参数。 */
export const OZONE_X11_SWITCH = '--ozone-platform=x11'

/**
 * KWin 是否在 kwinrc 中配置了输入法/虚拟键盘（决定 Wayland 下
 * text-input 通道是否可用）。
 */
export function kwinHasInputMethodConfigured(): boolean {
  try {
    const kwinrcPath = join(homedir(), '.config', 'kwinrc')
    const content = readFileSync(kwinrcPath, 'utf8')
    const waylandSection = content.match(/^\[Wayland\]([\s\S]*?)(?=^\s*\[|$)/m)
    if (!waylandSection) return false
    return /^\s*InputMethod\s*=/m.test(waylandSection[1])
  } catch {
    return false
  }
}

/**
 * 当前环境是否需要以 X11（XWayland）后端运行。
 * 仅当：Linux + Wayland 会话 + KWin/Plasma + 未配置输入法时为 true。
 */
export function shouldUseX11Backend(): boolean {
  if (process.platform !== 'linux' || process.env.XDG_SESSION_TYPE !== 'wayland') {
    return false
  }
  const desktop = (
    process.env.XDG_CURRENT_DESKTOP ||
    process.env.XDG_SESSION_DESKTOP ||
    ''
  ).toLowerCase()
  const isKWin = desktop.includes('kde') || desktop.includes('plasma')
  return isKWin && !kwinHasInputMethodConfigured()
}

/**
 * 生产环境（打包后）入口调用：检测到需要 X11 后端且当前进程未携带
 * --ozone-platform=x11 时，以该参数重启自身，然后退出当前进程。
 *
 * 开发/预览模式（NODE_ENV_ELECTRON_VITE 已设置）不做自重启 ——
 * electron-vite 管理 electron 进程生命周期（electron 退出时 electron-vite
 * 也会退出，dev server 随之关闭），此时由 scripts/run-electron-vite.cjs
 * 在启动时透传参数。
 *
 * @returns 是否已触发重启（调用方此时应停止继续初始化）。
 */
export function relaunchWithX11BackendIfNeeded(): boolean {
  // electron-vite dev/preview 管理 electron 进程，交给启动脚本处理
  if (process.env.NODE_ENV_ELECTRON_VITE) return false
  if (!shouldUseX11Backend()) return false
  // 当前已携带该参数（重启后的进程），无需再次重启
  if (process.argv.includes(OZONE_X11_SWITCH)) return false

  // 以相同参数（保留 argv[1] = app 入口）重启自身，追加 X11 参数。
  // 打包后 argv[1] 是 app.asar 路径；stdio inherit 保持终端日志连续。
  const args = process.argv.slice(1).concat([OZONE_X11_SWITCH])
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: process.env
  })
  child.on('error', (err) => {
    console.error('[ime-backend] 无法以 X11 后端重启应用，继续当前模式：', err)
  })
  // 无论如何立即退出当前（Wayland 后端）进程。
  process.exit(0)
  return true
}
