/**
 * The main process's view of "what language is the user reading".
 *
 * The renderer has `navigator.language`; the main process has `app.getLocale()`,
 * which Electron resolves from the OS. Both funnel through the same
 * `resolveLocale` so a dialog title, a tray tooltip and a toast cannot disagree.
 *
 * Read at call time rather than cached: the user can change the setting without
 * restarting, and `runtime.appSettings` is already the live value.
 */
import { app } from 'electron'
import { runtime } from './runtime'
import { DEFAULT_LOCALE, resolveLocale, type AppLocale } from '../../shared/i18n/locale.ts'
import { createTranslator, translate, type MessageParams } from '../../shared/i18n/translate.ts'

/** The OS locale, guarded because `app` is unavailable in unit tests. */
function systemLocale(): string {
  try {
    return app.getLocale()
  } catch {
    return DEFAULT_LOCALE
  }
}

/** The locale to render main-process copy in, honouring the user's setting. */
export function mainLocale(): AppLocale {
  return resolveLocale(runtime.appSettings?.language, systemLocale())
}

/** Translate in the active main-process locale. */
export function mt(key: string, params?: MessageParams): string {
  return translate(mainLocale(), key, params)
}

/** Bind a translator once, for a block that renders several strings. */
export function mainTranslator(): ReturnType<typeof createTranslator> {
  return createTranslator(mainLocale())
}
