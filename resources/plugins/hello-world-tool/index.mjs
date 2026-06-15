let removePlaybackListener = null

export async function activate(context) {
  const activateCount = Number(await context.settings.get('activateCount')) || 0
  await context.settings.set('activateCount', activateCount + 1)
  context.logger.info('Hello World Tool activated')
  context.logger.info(`Private activate count: ${activateCount + 1}`)
  removePlaybackListener = context.twilight.events.on('player:playback-info', (info) => {
    const state = info && typeof info === 'object' ? info.state : 'unknown'
    context.logger.info(`Playback info event: ${state}`)
  })
}

export async function deactivate() {
  if (removePlaybackListener) {
    removePlaybackListener()
    removePlaybackListener = null
  }
}
