/**
 * 播放进度采样策略（纯函数，便于单测）。
 *
 * 原生音频引擎可用时（nativePlaybackActive / 委托队列）由原生 time-pos
 * 驱动进度；兜底播放（HTMLAudio）时原生时钟与 <audio> timeupdate 双源竞争，
 * 会把真实采样误判为“倒带”而拒绝，最终进度冻结。因此兜底模式一律忽略原生
 * time-pos，只信任 <audio> timeupdate。
 */
export function shouldApplyNativeTimePosition(state: {
  nativePlaybackActive: boolean
  nativeQueueDelegated: boolean
}): boolean {
  return state.nativePlaybackActive || state.nativeQueueDelegated
}
