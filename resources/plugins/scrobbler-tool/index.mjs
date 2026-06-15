let removePlaybackListener = null
let latestTrackTitle = 'Nothing playing'

export async function activate(context) {
  context.logger.info('Scrobbler sample activated')
  removePlaybackListener = context.twilight.events.on('player:playback-info', (info) => {
    latestTrackTitle = info?.title || info?.source || 'Unknown track'
    context.logger.info(`Observed playback: ${latestTrackTitle}`)
  })

  context.twilight.ui.onCommand('scrobbler.showLatest', () => {
    context.logger.info(`Latest observed track: ${latestTrackTitle}`)
  })

  await context.twilight.ui.register({
    id: 'scrobbler-player-button',
    kind: 'playerBarButton',
    title: 'Scrobble',
    description: '写入最近播放日志',
    icon: 'pi pi-send',
    command: 'scrobbler.showLatest'
  })

  await context.twilight.ui.register({
    id: 'scrobbler-settings',
    kind: 'settingsPanel',
    title: 'Scrobbler 示例',
    description: '展示工具插件如何暴露受控设置入口',
    command: 'scrobbler.showLatest'
  })
}

export function deactivate() {
  removePlaybackListener?.()
  removePlaybackListener = null
}
