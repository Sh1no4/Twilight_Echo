/**
 * Structured, localizable errors that survive Electron's IPC boundary.
 *
 * The problem: `ipcMain.handle` rejections reach the renderer as a *string*.
 * Electron serializes the rejection as
 * `Error invoking remote method 'ch': Error: <message>` and drops every custom
 * property on the Error instance. So `err.code` cannot be read on the far side,
 * and a pre-rendered Chinese message can never be re-rendered in English.
 *
 * The fix: carry `code` and `params` inside the message itself, as a trailing
 * sentinel the renderer strips before display.
 *
 *   "audio service failed to start [TE-ERR:audio.serviceStartFailed:reason=EPERM]"
 *
 * The prose before the sentinel is a developer-facing fallback (English, for
 * logs and crash reports); the sentinel is what the UI actually renders. This
 * keeps the 225 existing IPC handlers' signatures untouched — a handler opts in
 * by throwing `AppError` instead of `Error`, and any handler that has not been
 * migrated still works, just without localization.
 */
import type { MessageParams } from '../i18n/translate.ts'

/** Bracketed so it cannot collide with prose, and greppable in log files. */
const SENTINEL = /\s*\[TE-ERR:([a-zA-Z0-9_.-]+)(?::([^\]]*))?\]\s*$/

/**
 * Electron's invoke wrapper, plus the `Error:` prefixes it stacks up. Peeled off
 * before classification so a provider's own copy does not reach the UI with
 * English plumbing bolted to its front.
 */
const REMOTE_INVOKE_WRAPPER = /^Error invoking remote method\s+'[^']*':\s*/
const ERROR_PREFIXES = /^(?:\w*Error:\s*)+/

export interface AppErrorFields {
  /** Message-catalog key suffix, e.g. `audio.serviceStartFailed`. */
  code: string
  /** Placeholder values for the catalog template. */
  params?: MessageParams
}

/**
 * An error that knows its own message-catalog key.
 *
 * `message` stays a readable English sentence so logs and stack traces are
 * useful on their own; `toIpcMessage()` appends the sentinel for transport.
 */
export class AppError extends Error {
  readonly code: string
  readonly params: MessageParams

  constructor(code: string, developerMessage: string, params: MessageParams = {}) {
    super(developerMessage)
    this.name = 'AppError'
    this.code = code
    this.params = params
  }

  /** The wire form: developer prose plus the machine-readable sentinel. */
  toIpcMessage(): string {
    return encodeAppError(this.code, this.message, this.params)
  }
}

export interface ParsedAppError {
  /** Present only when a sentinel was found. */
  code: string | null
  params: MessageParams
  /** The message with the sentinel stripped and IPC wrappers peeled. */
  message: string
}

/** Serialize params compactly. Values are URI-encoded so `;` and `=` are safe. */
function encodeParams(params: MessageParams): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (!/^\w+$/.test(key)) continue
    parts.push(`${key}=${encodeURIComponent(String(value))}`)
  }
  return parts.join(';')
}

function decodeParams(raw: string | undefined): MessageParams {
  if (!raw) return {}
  const params: MessageParams = {}
  for (const pair of raw.split(';')) {
    if (!pair) continue
    const separator = pair.indexOf('=')
    const key = separator === -1 ? pair : pair.slice(0, separator)
    if (!/^\w+$/.test(key)) continue
    const value = separator === -1 ? '' : pair.slice(separator + 1)
    try {
      params[key] = decodeURIComponent(value)
    } catch {
      // A hand-mangled sentinel must not take down the error path: keep the
      // raw value rather than throwing while reporting another error.
      params[key] = value
    }
  }
  return params
}

export function encodeAppError(
  code: string,
  developerMessage: string,
  params: MessageParams = {}
): string {
  const encoded = encodeParams(params)
  const suffix = encoded ? `[TE-ERR:${code}:${encoded}]` : `[TE-ERR:${code}]`
  const prose = developerMessage.trim()
  return prose ? `${prose} ${suffix}` : suffix
}

/**
 * Strip Electron's invoke wrapper. Applied before sentinel extraction so a
 * wrapped rejection still yields its code.
 */
export function unwrapRemoteInvokeMessage(message: string): string {
  const unwrapped = message.replace(REMOTE_INVOKE_WRAPPER, '')
  if (unwrapped === message) return message
  return unwrapped.replace(ERROR_PREFIXES, '').trim() || message
}

/**
 * Pull `code`/`params` out of anything that crossed IPC. Tolerates a plain
 * Error, a string, or a value with no sentinel at all (`code: null`).
 */
export function parseAppError(error: unknown): ParsedAppError {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : error &&
            typeof error === 'object' &&
            typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : ''
  // A local (non-IPC) AppError still carries its fields directly; prefer them.
  if (error instanceof AppError) {
    return { code: error.code, params: error.params, message: error.message }
  }
  const unwrapped = unwrapRemoteInvokeMessage(raw.trim())
  const match = SENTINEL.exec(unwrapped)
  if (!match) return { code: null, params: {}, message: unwrapped }
  return {
    code: match[1],
    params: decodeParams(match[2]),
    message: unwrapped.replace(SENTINEL, '').trim()
  }
}

/** True when the value carries a sentinel (or is a local AppError). */
export function isAppError(error: unknown): boolean {
  return parseAppError(error).code !== null
}

/**
 * Remove the sentinel without interpreting it — for surfaces that must show
 * *something* textual (a log line, a copy-to-clipboard block) but should not
 * leak the machine tail to the user.
 */
export function stripAppErrorSentinel(message: string): string {
  return message.replace(SENTINEL, '').trim()
}

/** Build an AppError whose wire message is ready to throw across IPC. */
export function appError(
  code: string,
  developerMessage: string,
  params: MessageParams = {}
): AppError {
  return new AppError(code, developerMessage, params)
}

/**
 * Throw across an IPC handler boundary.
 *
 * Electron drops custom properties, so the sentinel has to live in `message`.
 * Handlers use this instead of `throw new AppError(...)` when the throw site is
 * an `ipcMain.handle` callback.
 */
export function ipcError(
  code: string,
  developerMessage: string,
  params: MessageParams = {}
): Error {
  return new Error(encodeAppError(code, developerMessage, params))
}
