// Raw Error.message values escaping IPC/fetch are technical English noise
// ("fetch failed", "net::ERR_..."), unusable inside the Chinese-language UI.
// Map known failure classes to friendly copy; messages our own code produced
// already read as user-facing Chinese and pass through untouched.

/**
 * Electron rebuilds a rejected `ipcRenderer.invoke` as
 * `Error invoking remote method 'channel': Error: <original>`. The wrapper is
 * plumbing, so it is peeled off before the message is classified or shown —
 * otherwise a provider's own Chinese copy reaches the UI with English noise
 * bolted to its front.
 */
function unwrapRemoteInvokeMessage(message: string): string {
  const unwrapped = message.replace(/^Error invoking remote method\s+'[^']*':\s*/, '')
  if (unwrapped === message) return message
  return unwrapped.replace(/^(?:\w*Error:\s*)+/, '').trim() || message
}

export function friendlyStreamingError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const message = unwrapRemoteInvokeMessage(raw.trim())
  if (!message) return fallback
  if (/[一-鿿]/.test(message)) return message
  if (
    /fetch failed|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_NETWORK|ERR_INTERNET|ERR_CONNECTION|timed? ?out/i.test(
      message
    )
  ) {
    return `${fallback}：网络连接失败，请检查网络后重试`
  }
  if (/\b(401|403)\b|unauthoriz|forbidden|need login|not login/i.test(message)) {
    return `${fallback}：登录状态已失效，请重新登录`
  }
  if (/\b429\b|too many requests/i.test(message)) {
    return `${fallback}：请求过于频繁，请稍后再试`
  }
  console.warn('[streaming] request failed:', message)
  return fallback
}
