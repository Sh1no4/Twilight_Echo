let removePlaybackListener = null

export async function activate(context) {
  context.logger.info('Hello World Tool activated')
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
