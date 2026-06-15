let removePlaybackInfoListener = null
let removeTrackChangeListener = null
let removePlayListener = null
let removePauseListener = null
let removeQueueListener = null
let latestTrackTitle = 'Nothing playing'
let observedEvents = 0

export async function activate(context) {
  context.logger.info('Scrobbler sample activated')
  removePlaybackInfoListener = context.twilight.events.on('player:playback-info', (info) => {
    latestTrackTitle = info?.title || info?.source || 'Unknown track'
    context.logger.info(`Observed playback: ${latestTrackTitle}`)
  })
  removeTrackChangeListener = context.twilight.events.on('player:track-change', (info) => {
    observedEvents += 1
    latestTrackTitle = info?.title || info?.source || 'Unknown track'
    context.logger.info(`Track changed: ${latestTrackTitle}`)
  })
  removePlayListener = context.twilight.events.on('player:play', () => {
    observedEvents += 1
    context.logger.info('Playback started')
  })
  removePauseListener = context.twilight.events.on('player:pause', () => {
    observedEvents += 1
    context.logger.info('Playback paused')
  })
  removeQueueListener = context.twilight.events.on('player:queue-change', (payload) => {
    observedEvents += 1
    context.logger.info(`Queue changed: ${payload?.queue?.length ?? 0} item(s)`)
  })

  context.twilight.ui.onCommand('scrobbler.showLatest', () => {
    context.logger.info(`Latest observed track: ${latestTrackTitle}`)
    return `Latest observed track: ${latestTrackTitle}`
  })

  context.twilight.ui.onCommand('scrobbler.openPage', () => {
    context.logger.info(`Scrobbler page opened after ${observedEvents} event(s)`)
    return {
      latestTrackTitle,
      observedEvents
    }
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

  await context.twilight.ui.register({
    id: 'scrobbler-sidebar',
    kind: 'sidebarPage',
    title: 'Scrobbler',
    description: '查看播放事件订阅示例的最近状态',
    icon: 'pi pi-send',
    command: 'scrobbler.openPage'
  })
}

export function deactivate() {
  removePlaybackInfoListener?.()
  removeTrackChangeListener?.()
  removePlayListener?.()
  removePauseListener?.()
  removeQueueListener?.()
  removePlaybackInfoListener = null
  removeTrackChangeListener = null
  removePlayListener = null
  removePauseListener = null
  removeQueueListener = null
}
