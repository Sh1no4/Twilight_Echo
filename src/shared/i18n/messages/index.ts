import type { MessageCatalog } from '../translate.ts'
import { EN_US_MESSAGES } from './en-US.ts'
import { ZH_CN_MESSAGES } from './zh-CN.ts'

/**
 * Every shipped catalog, keyed by locale. zh-CN is the source of truth: its key
 * set is what `translate()` falls back to, and the catalog test asserts the
 * other locales match it exactly.
 */
export const MESSAGES: Readonly<Record<'zh-CN' | 'en-US', MessageCatalog>> = {
  'zh-CN': ZH_CN_MESSAGES,
  'en-US': EN_US_MESSAGES
}
