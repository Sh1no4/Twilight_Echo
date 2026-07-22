import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
import {
  DEFAULT_RADIO_STATIONS,
  MAX_RADIO_NAME_LENGTH,
  MAX_RADIO_STATIONS,
  MAX_RADIO_TAG_LENGTH,
  MAX_RADIO_TAGS,
  cloneRadioStationsDocument,
  isInsecureHttpUrl,
  isHttpOrHttpsUrl,
  isRadioStationsDocument,
  normalizeRadioStationName,
  normalizeRadioStreamUrl,
  type RadioStation,
  type RadioStationsDocument
} from '../../shared/radioStations.ts'
import {
  DEFAULT_PODCAST_SUBSCRIPTIONS,
  MAX_PODCAST_EPISODES_PER_FEED,
  MAX_PODCAST_SUBSCRIPTIONS,
  MAX_PODCAST_TITLE_LENGTH,
  MAX_PODCAST_URL_LENGTH,
  clonePodcastSubscriptionsDocument,
  isPodcastSubscriptionsDocument,
  type PodcastEpisode,
  type PodcastSubscription,
  type PodcastSubscriptionsDocument
} from '../../shared/podcastSubscriptions.ts'
import { VersionedDataStore } from '../persistence/versionedDataStore.ts'
import { parsePodcastFeedXml } from './rssParser.ts'
import { parseRadioPlaylist, type ImportedRadioEntry } from './playlistImport.ts'

const MAX_RADIO_STATIONS_BYTES = 4 * 1024 * 1024
const MAX_PODCAST_SUBSCRIPTIONS_BYTES = 16 * 1024 * 1024
const MAX_FEED_FETCH_BYTES = 8 * 1024 * 1024
const DEFAULT_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface RadioMediaServiceOptions {
  userDataPath?: string
  now?: () => string
  fetchText?: (url: string) => Promise<string>
  refreshIntervalMs?: number
}

function resolveUserDataPath(explicit?: string): string {
  if (explicit) return explicit
  // Lazy-load electron so unit tests can inject userDataPath without requiring Electron ESM.
  const electron = require('electron') as { app?: { getPath: (name: string) => string } }
  if (!electron.app?.getPath) {
    throw new Error('RadioMediaService requires userDataPath outside Electron')
  }
  return electron.app.getPath('userData')
}

export class RadioMediaService {
  private readonly radioStore: VersionedDataStore<RadioStationsDocument>
  private readonly podcastStore: VersionedDataStore<PodcastSubscriptionsDocument>
  private readonly now: () => string
  private readonly fetchText: (url: string) => Promise<string>
  private readonly refreshIntervalMs: number
  private refreshTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: RadioMediaServiceOptions = {}) {
    const userDataPath = resolveUserDataPath(options.userDataPath)
    this.now = options.now ?? (() => new Date().toISOString())
    this.fetchText = options.fetchText ?? defaultFetchText
    this.refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS

    this.radioStore = new VersionedDataStore<RadioStationsDocument>({
      filePath: join(userDataPath, 'radio-stations.json'),
      label: 'radio stations',
      maxBytes: MAX_RADIO_STATIONS_BYTES,
      isData: isRadioStationsDocument,
      isLegacy: isRadioStationsDocument
    })
    this.podcastStore = new VersionedDataStore<PodcastSubscriptionsDocument>({
      filePath: join(userDataPath, 'podcast-subscriptions.json'),
      label: 'podcast subscriptions',
      maxBytes: MAX_PODCAST_SUBSCRIPTIONS_BYTES,
      isData: isPodcastSubscriptionsDocument,
      isLegacy: isPodcastSubscriptionsDocument
    })
  }

  startScheduledRefresh(): void {
    if (this.refreshTimer) return
    this.refreshTimer = setInterval(() => {
      void this.refreshAllSubscriptions().catch((error) => {
        console.warn('[radio] scheduled podcast refresh failed:', error)
      })
    }, this.refreshIntervalMs)
    if (typeof this.refreshTimer === 'object' && this.refreshTimer && 'unref' in this.refreshTimer) {
      this.refreshTimer.unref()
    }
  }

  stopScheduledRefresh(): void {
    if (!this.refreshTimer) return
    clearInterval(this.refreshTimer)
    this.refreshTimer = null
  }

  async loadRadioStations() {
    return (
      (await this.radioStore.load()) ?? {
        version: 2 as const,
        revision: 0,
        savedAt: this.now(),
        data: cloneRadioStationsDocument(DEFAULT_RADIO_STATIONS)
      }
    )
  }

  async saveRadioStations(document: RadioStationsDocument, expectedRevision: number) {
    if (!isRadioStationsDocument(document)) {
      throw new Error('Radio stations have an invalid structure')
    }
    return await this.radioStore.save(cloneRadioStationsDocument(document), expectedRevision)
  }

  async loadPodcastSubscriptions() {
    return (
      (await this.podcastStore.load()) ?? {
        version: 2 as const,
        revision: 0,
        savedAt: this.now(),
        data: clonePodcastSubscriptionsDocument(DEFAULT_PODCAST_SUBSCRIPTIONS)
      }
    )
  }

  async savePodcastSubscriptions(document: PodcastSubscriptionsDocument, expectedRevision: number) {
    if (!isPodcastSubscriptionsDocument(document)) {
      throw new Error('Podcast subscriptions have an invalid structure')
    }
    return await this.podcastStore.save(clonePodcastSubscriptionsDocument(document), expectedRevision)
  }

  createStationInput(input: {
    name: string
    streamUrl: string
    homepage?: string
    favicon?: string
    tags?: string[]
    allowInsecureHttp?: boolean
  }): RadioStation {
    const name = normalizeRadioStationName(input.name)
    const streamUrl = normalizeRadioStreamUrl(input.streamUrl)
    if (!name) throw new Error('Radio station name is required')
    if (!isHttpOrHttpsUrl(streamUrl)) throw new Error('Radio stream URL is invalid')
    const insecure = isInsecureHttpUrl(streamUrl)
    const allowInsecureHttp = Boolean(input.allowInsecureHttp)
    if (insecure && !allowInsecureHttp) {
      throw new Error('Plain HTTP radio streams require explicit allowInsecureHttp confirmation')
    }
    const now = this.now()
    const tags = Array.isArray(input.tags)
      ? input.tags
          .filter((tag): tag is string => typeof tag === 'string')
          .map((tag) => tag.trim().slice(0, MAX_RADIO_TAG_LENGTH))
          .filter(Boolean)
          .slice(0, MAX_RADIO_TAGS)
      : undefined
    return {
      id: `radio_${randomUUID()}`,
      name: name.slice(0, MAX_RADIO_NAME_LENGTH),
      streamUrl,
      homepage: input.homepage && isHttpOrHttpsUrl(input.homepage) ? input.homepage.trim() : undefined,
      favicon: input.favicon && isHttpOrHttpsUrl(input.favicon) ? input.favicon.trim() : undefined,
      tags,
      allowInsecureHttp: insecure ? true : allowInsecureHttp,
      createdAt: now,
      updatedAt: now
    }
  }

  importPlaylistEntries(
    text: string,
    options: { fileNameHint?: string; allowInsecureHttp?: boolean } = {}
  ): RadioStation[] {
    const entries = parseRadioPlaylist(text, options.fileNameHint ?? '')
    const allowInsecureHttp = Boolean(options.allowInsecureHttp)
    const stations: RadioStation[] = []
    for (const entry of entries) {
      if (isInsecureHttpUrl(entry.streamUrl) && !allowInsecureHttp) continue
      try {
        stations.push(
          this.createStationInput({
            name: entry.name,
            streamUrl: entry.streamUrl,
            allowInsecureHttp
          })
        )
      } catch {
        // skip invalid rows
      }
      if (stations.length >= MAX_RADIO_STATIONS) break
    }
    return stations
  }

  async subscribePodcast(feedUrl: string): Promise<{
    subscription: PodcastSubscription
    document: PodcastSubscriptionsDocument
    revision: number
  }> {
    const normalized = feedUrl.trim().slice(0, MAX_PODCAST_URL_LENGTH)
    if (!isHttpOrHttpsUrl(normalized)) throw new Error('Podcast feed URL is invalid')
    const loaded = await this.loadPodcastSubscriptions()
    const document = clonePodcastSubscriptionsDocument(loaded.data)
    if (document.subscriptions.length >= MAX_PODCAST_SUBSCRIPTIONS) {
      throw new Error('Podcast subscription limit reached')
    }
    if (document.subscriptions.some((sub) => sub.feedUrl === normalized)) {
      throw new Error('Podcast feed is already subscribed')
    }
    const subscription = await this.buildSubscriptionFromFeed(normalized)
    document.subscriptions = [subscription, ...document.subscriptions]
    const saved = await this.podcastStore.save(document, loaded.revision)
    return { subscription, document: saved.data, revision: saved.revision }
  }

  async refreshSubscription(subscriptionId: string): Promise<{
    subscription: PodcastSubscription
    document: PodcastSubscriptionsDocument
    revision: number
  }> {
    const loaded = await this.loadPodcastSubscriptions()
    const document = clonePodcastSubscriptionsDocument(loaded.data)
    const index = document.subscriptions.findIndex((sub) => sub.id === subscriptionId)
    if (index < 0) throw new Error('Podcast subscription was not found')
    const previous = document.subscriptions[index]
    try {
      const refreshed = await this.buildSubscriptionFromFeed(previous.feedUrl, previous)
      document.subscriptions[index] = refreshed
      const saved = await this.podcastStore.save(document, loaded.revision)
      return { subscription: refreshed, document: saved.data, revision: saved.revision }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      document.subscriptions[index] = {
        ...previous,
        lastError: message.slice(0, 500),
        updatedAt: this.now()
      }
      const saved = await this.podcastStore.save(document, loaded.revision)
      throw Object.assign(new Error(message), {
        subscription: saved.data.subscriptions[index],
        document: saved.data,
        revision: saved.revision
      })
    }
  }

  async refreshAllSubscriptions(): Promise<PodcastSubscriptionsDocument> {
    const loaded = await this.loadPodcastSubscriptions()
    let document = clonePodcastSubscriptionsDocument(loaded.data)
    let revision = loaded.revision
    for (const sub of [...document.subscriptions]) {
      try {
        const result = await this.refreshSubscription(sub.id)
        document = result.document
        revision = result.revision
      } catch {
        const latest = await this.loadPodcastSubscriptions()
        document = latest.data
        revision = latest.revision
      }
    }
    void revision
    return document
  }

  /**
   * Resolve an episode that belongs to a saved subscription.
   */
  async resolveSubscribedEpisode(
    subscriptionId: string,
    episodeGuid: string
  ): Promise<{
    subscription: PodcastSubscription
    episode: PodcastEpisode
    trackId: string
  }> {
    const id = subscriptionId.trim()
    const guid = episodeGuid.trim()
    if (!id || !guid) throw new Error('Podcast episode identity is invalid')
    const loaded = await this.loadPodcastSubscriptions()
    const subscription = loaded.data.subscriptions.find((sub) => sub.id === id)
    if (!subscription) throw new Error('Podcast subscription was not found')
    const episode = subscription.episodes.find((item) => item.guid === guid)
    if (!episode) throw new Error('Podcast episode was not found')
    if (!episode.mediaUrl || !/^https?:\/\//i.test(episode.mediaUrl)) {
      throw new Error('Podcast episode media URL is invalid')
    }
    return {
      subscription,
      episode,
      trackId: `podcast:${id}:${guid}`
    }
  }

  private async buildSubscriptionFromFeed(
    feedUrl: string,
    previous?: PodcastSubscription
  ): Promise<PodcastSubscription> {
    const xml = await this.fetchText(feedUrl)
    const parsed = parsePodcastFeedXml(xml)
    const now = this.now()
    const previousProgress = new Map(
      (previous?.episodes ?? []).map((episode) => [episode.guid, episode.progressSeconds] as const)
    )
    const episodes: PodcastEpisode[] = parsed.episodes
      .slice(0, MAX_PODCAST_EPISODES_PER_FEED)
      .map((episode) => ({
        ...episode,
        progressSeconds: previousProgress.get(episode.guid)
      }))
    return {
      id: previous?.id ?? `podcast_${randomUUID()}`,
      feedUrl,
      title: (parsed.title || previous?.title || 'Podcast').slice(0, MAX_PODCAST_TITLE_LENGTH),
      description: parsed.description ?? previous?.description,
      author: parsed.author ?? previous?.author,
      coverUrl: parsed.coverUrl ?? previous?.coverUrl,
      homepage: parsed.homepage ?? previous?.homepage,
      lastRefreshedAt: now,
      lastError: null,
      episodes,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now
    }
  }
}

async function defaultFetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      'User-Agent': 'TwilightEcho/1.0 (podcast)'
    }
  })
  if (!response.ok) {
    throw new Error(`Podcast feed request failed (${response.status})`)
  }
  const lengthHeader = response.headers.get('content-length')
  if (lengthHeader && Number(lengthHeader) > MAX_FEED_FETCH_BYTES) {
    throw new Error('Podcast feed response is too large')
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > MAX_FEED_FETCH_BYTES) {
    throw new Error('Podcast feed response is too large')
  }
  return buffer.toString('utf8')
}

export type { ImportedRadioEntry }
