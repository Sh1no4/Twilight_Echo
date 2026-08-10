/**
 * DSD 代理 ASIO 驱动识别 —— 仅用于 UI 标签，绝不参与路由决策。
 *
 * 这类代理（foo_dsd_asio 及同类）把自己注册进系统 ASIO 驱动表，接受裸 DSD 再
 * 转成硬件要的线格式。它们是独立的系统级驱动：是否安装与 foobar2000 装在哪、
 * 装不装完全无关，因此这里只做驱动名匹配，不做任何目录探测。
 *
 * 匹配结果只用来在设备下拉里给用户一个「这看起来是 DSD 代理」的提示。路由本身
 * 永远是用户显式选的 backend + device，所以：
 *  - 匹配不到也不影响用户手动选中该设备；
 *  - 代理改名或换厂商也不会让路由失效。
 */

/** 保守的已知代理标记。全部小写，连字符已归一为下划线后再比对。 */
const KNOWN_PROXY_MARKERS = ['foo_dsd_asio', 'asio_proxy', 'dsd_transcoder'] as const

function normalizeDriverIdentity(value: string): string {
  return value.toLowerCase().replaceAll('-', '_').replaceAll(/\s+/g, '_')
}

/**
 * 判断一个 ASIO 设备的可见标识是否像 DSD 代理驱动。
 * 传入设备的 id / label / name / driverName 的任意组合拼接串即可。
 */
export function looksLikeDsdProxyDriver(identity: string): boolean {
  if (typeof identity !== 'string' || identity.length === 0) return false
  const normalized = normalizeDriverIdentity(identity)
  return KNOWN_PROXY_MARKERS.some((marker) => normalized.includes(marker))
}

export interface DsdProxyCandidateInput {
  id?: string
  label?: string
  name?: string
  driverName?: string
}

/** 把设备各标识字段拼成一个待匹配串。 */
export function dsdProxyIdentityOf(device: DsdProxyCandidateInput): string {
  return [device.id, device.label, device.name, device.driverName]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ')
}

export function isDsdProxyDevice(device: DsdProxyCandidateInput): boolean {
  return looksLikeDsdProxyDriver(dsdProxyIdentityOf(device))
}

/** 供设置页展示：过滤出疑似代理设备，保持原有顺序。 */
export function filterDsdProxyDevices<T extends DsdProxyCandidateInput>(
  devices: readonly T[]
): T[] {
  return devices.filter((device) => isDsdProxyDevice(device))
}
