// Raw Error.message values escaping IPC/fetch are technical English noise
// ("fetch failed", "net::ERR_..."), unusable in the UI.
//
// This is now a thin adapter over the shared error presenter, which owns the
// wrapper peeling, the `[TE-ERR:code]` sentinel and the platform-English
// classification. Before, this module hardcoded Chinese for every recognized
// failure class, so an English-language user still got Chinese copy for a failed
// network request; routing through `presentError` renders those in the active
// locale instead.
//
// The signature is unchanged because ~20 call sites pass literal Chinese
// fallbacks. `presentError` accepts either a catalog key or literal prose there,
// so those call sites keep working and can migrate to keys one at a time.
import { currentLocale } from '../../app/useLocale.ts'
import { presentError } from '../../../../shared/errors/presentError.ts'

/**
 * Turn a caught streaming error into copy the user can read.
 *
 * A recognized network/auth/rate-limit failure reads as `<fallback>：<reason>`,
 * matching how these pages already phrase "loading the playlist failed: check
 * your connection". Copy our own code already localized passes through verbatim.
 */
export function friendlyStreamingError(error: unknown, fallback: string): string {
  return presentError(currentLocale(), error, fallback, { prefixFallback: true })
}
