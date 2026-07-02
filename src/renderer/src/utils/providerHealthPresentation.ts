export interface ProviderHealthInput {
  available: boolean
  pluginStatus: string
  totalCalls: number
  successfulCalls: number
  failedCalls: number
  successRate: number
  methodStats?: Record<string, ProviderMethodHealthInput | undefined>
  lastError: string | null
  lastCheckedAt: string | null
}

export interface ProviderMethodHealthInput {
  totalCalls: number
  successfulCalls: number
  failedCalls: number
  successRate: number
  lastError: string | null
  lastCheckedAt: string | null
}

export interface ProviderHealthPresentation {
  state: 'ok' | 'warning' | 'error'
  label: string
  detail: string
}

export function buildProviderHealthPresentation({
  health,
  loggedIn
}: {
  health?: ProviderHealthInput
  loggedIn: boolean
}): ProviderHealthPresentation {
  if (!health) {
    return {
      state: 'warning',
      label: '未收到健康状态',
      detail: '等待宿主回传登录、API 和播放 URL 诊断'
    }
  }

  const state = providerHealthState(health, loggedIn)
  const label = providerHealthLabel(health, loggedIn)
  const playbackUrlHealth = health.methodStats?.getPlaybackUrl
  const detail = [
    `登录状态 ${loggedIn ? '已登录' : '未登录'}`,
    `成功率 ${formatProviderSuccessRate(health.successRate)}`,
    playbackUrlHealth ? `播放 URL 成功率 ${formatProviderSuccessRate(playbackUrlHealth.successRate)}` : '',
    `插件状态 ${health.pluginStatus}`,
    `调用 ${health.successfulCalls}/${health.totalCalls}`,
    playbackUrlHealth
      ? `播放 URL 调用 ${playbackUrlHealth.successfulCalls}/${playbackUrlHealth.totalCalls}`
      : '',
    health.lastError ? `最近错误 ${health.lastError}` : '',
    playbackUrlHealth?.lastError ? `播放 URL 最近错误 ${playbackUrlHealth.lastError}` : '',
    health.lastCheckedAt ? `最后检查 ${formatProviderCheckedAt(health.lastCheckedAt)}` : ''
  ].filter(Boolean).join(' · ')

  return { state, label, detail }
}

function providerHealthState(
  health: ProviderHealthInput,
  loggedIn: boolean
): ProviderHealthPresentation['state'] {
  if (health.pluginStatus !== 'enabled') return 'error'
  if (!loggedIn && isLoginError(health.lastError)) return 'error'
  if (!health.available) return 'error'
  if (!loggedIn) return 'warning'
  const playbackUrlHealth = health.methodStats?.getPlaybackUrl
  if (
    health.failedCalls > 0 ||
    health.successRate < 0.95 ||
    (playbackUrlHealth && (playbackUrlHealth.failedCalls > 0 || playbackUrlHealth.successRate < 0.95))
  ) {
    return 'warning'
  }
  return 'ok'
}

function providerHealthLabel(health: ProviderHealthInput, loggedIn: boolean): string {
  if (health.pluginStatus !== 'enabled') return '插件状态异常'
  if (!loggedIn && isLoginError(health.lastError)) return '登录已失效'
  if (!health.available) return '音源不可用'
  if (!loggedIn) return '未登录'
  if (health.failedCalls > 0) return '部分请求失败'
  return '音源可用'
}

function isLoginError(value: string | null): boolean {
  return !!value && /login|登录|cookie|unauthori[sz]ed|auth|账号|过期/i.test(value)
}

function formatProviderSuccessRate(value: number): string {
  if (!Number.isFinite(value)) return '未知'
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

function formatProviderCheckedAt(value: string): string {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return value
  return new Date(time).toLocaleString()
}
