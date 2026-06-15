export async function activate(context) {
  context.logger.info('Registering Bilibili provider skeleton')
  await context.twilight.providers.register({
    id: 'bili',
    name: 'Bilibili Provider Skeleton',
    capabilities: ['search', 'playbackUrl', 'lyrics', 'cover', 'playlist'],
    async searchSongs(keywords, limit = 30, offset = 0) {
      context.logger.info(`searchSongs(${keywords}, ${limit}, ${offset})`)
      return { items: [], total: 0 }
    },
    async getPlaybackUrl(track) {
      context.logger.info(`getPlaybackUrl(${track?.id ?? 'unknown'})`)
      return null
    },
    async getLyrics() {
      return { lyrics: null, translatedLyrics: null }
    },
    async fetchPlaylistTracks() {
      return []
    }
  })
}

export function deactivate() {}
