/**
 * 外部 URL 跳转白名单（纵深防御）。
 *
 * 默认仅放行 https:；http: 仅允许显式传入的域名白名单（用于本地/内网明确场景）。
 * 拒绝：超长 URL、控制字符、非 http(s) 协议。
 */
const MAX_EXTERNAL_URL_LENGTH = 8192

export function isSafeExternalUrl(
  url: unknown,
  allowHttpHosts: readonly string[] = []
): url is string {
  if (typeof url !== 'string') return false
  if (Buffer.byteLength(url, 'utf-8') > MAX_EXTERNAL_URL_LENGTH) return false
  if (/[\0\r\n]/.test(url)) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:') return true
    if (parsed.protocol === 'http:') {
      return allowHttpHosts.some(
        (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
      )
    }
    return false
  } catch {
    return false
  }
}
