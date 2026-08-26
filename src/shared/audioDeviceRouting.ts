/**
 * Which output backend an enumerated audio device belongs to.
 *
 * `EnumerateDevices` returns WASAPI/CoreAudio/ALSA endpoints and ASIO drivers in
 * one merged list, and both the main process (compatibility resolution) and the
 * renderer (device pickers) have to narrow it the same way. Keeping the rule here
 * is what stops the two sides from drifting apart.
 *
 * This is structural — it reads the `backend`/`pathKind` fields the enumerator
 * sets and the `asio:` id prefix. It deliberately does not inspect driver names:
 * routing decisions never depend on name matching (see `dsdProxyDrivers.ts`).
 */

export interface AudioDeviceRoutingOption {
  id: string
  backend?: string
  pathKind?: string
}

export function deviceOptionIsAsio(option: AudioDeviceRoutingOption | undefined): boolean {
  if (!option) return false
  return (
    option.backend === 'asio' ||
    option.pathKind === 'asio' ||
    option.id.toLowerCase().startsWith('asio:')
  )
}

/**
 * Narrows the merged device list to what `output` can actually open.
 *
 * The output-device picker must use this. Presenting the merged list lets a user
 * pick an ASIO driver while the WASAPI backend is selected — which
 * `resolveCompatibleDevice` then silently snaps back to the system default — and
 * offers a "系统默认" row under ASIO, which has no system-default endpoint at all,
 * so the driver actually bound stays invisible.
 *
 * The DSD route picker deliberately does NOT use this: it targets a second
 * backend that differs from the main output on purpose, and needs the full list.
 */
export function deviceOptionsForOutput<T extends AudioDeviceRoutingOption>(
  output: string,
  options: readonly T[]
): T[] {
  if (output === 'asio') return options.filter((option) => deviceOptionIsAsio(option))
  return options.filter((option) => !deviceOptionIsAsio(option))
}
