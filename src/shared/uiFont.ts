/**
 * Global UI font choices. The value stored in `AppSettings.fontFamily` is one
 * of these keys; `system` resolves to a real OS stack instead of the packaged
 * Inter-first default so the app follows the system UI font by default.
 *
 * The resolver is the single place that maps a stored font value to a CSS
 * stack, shared by the renderer's DOM application and the main process's value
 * validation so the two can never disagree.
 */

export type UiFontFamily = 'system' | 'inter' | 'lxgw' | 'sarasa' | 'comic'

export const UI_FONT_FAMILIES: readonly UiFontFamily[] = [
  'system',
  'inter',
  'lxgw',
  'sarasa',
  'comic'
]

const SYSTEM_UI_STACK =
  "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', sans-serif"

/** CJK fallback for the packaged Latin fonts: bundled MiSans, then OS faces. */
const BUILTIN_UI_STACK = `'MiSans', ${SYSTEM_UI_STACK}`

export const UI_FONT_FAMILY_STACKS: Readonly<Record<UiFontFamily, string>> = {
  system: SYSTEM_UI_STACK,
  inter: `'Inter', 'Plus Jakarta Sans', ${BUILTIN_UI_STACK}`,
  lxgw: `'LXGW WenKai', ${BUILTIN_UI_STACK}`,
  sarasa: `'Sarasa Gothic SC', ${BUILTIN_UI_STACK}`,
  comic: `'Comic Sans MS', ${BUILTIN_UI_STACK}`
}

export function isUiFontFamily(value: unknown): value is UiFontFamily {
  return (
    typeof value === 'string' && (UI_FONT_FAMILIES as readonly string[]).includes(value)
  )
}

/**
 * Resolve any stored font value to a CSS stack. Unknown values fall back to the
 * system stack; validation (normalizeUiFontFamily) decides whether a value
 * should be persisted at all.
 */
export function resolveUiFontStack(fontFamily: string): string {
  return isUiFontFamily(fontFamily)
    ? UI_FONT_FAMILY_STACKS[fontFamily]
    : UI_FONT_FAMILY_STACKS.system
}

export function normalizeUiFontFamily(
  value: unknown,
  fallback: UiFontFamily = 'system'
): UiFontFamily {
  return isUiFontFamily(value) ? value : fallback
}
