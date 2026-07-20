import assert from 'node:assert/strict'
import test from 'node:test'

const {
  DEFAULT_PODCAST_SUBSCRIPTIONS,
  clonePodcastSubscriptionsDocument,
  isPodcastSubscriptionsDocument,
  podcastEpisodeProgressRatio
} = (await import(
  new URL('./podcastSubscriptions.ts', import.meta.url).href
)) as typeof import('./podcastSubscriptions')

test('podcast subscriptions document validates and clones', () => {
  const document = clonePodcastSubscriptionsDocument({
    ...DEFAULT_PODCAST_SUBSCRIPTIONS,
    subscriptions: [
      {
        id: 'podcast_1',
        feedUrl: 'https://example.com/feed.xml',
        title: 'Demo Cast',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        episodes: [
          {
            guid: 'ep-1',
            title: 'Pilot',
            mediaUrl: 'https://cdn.example.com/ep1.mp3',
            durationSeconds: 3600,
            progressSeconds: 900
          }
        ]
      }
    ]
  })
  assert.equal(isPodcastSubscriptionsDocument(document), true)
  assert.equal(podcastEpisodeProgressRatio(document.subscriptions[0].episodes[0]), 0.25)
  document.subscriptions[0].episodes[0].title = 'mutated'
  assert.equal(DEFAULT_PODCAST_SUBSCRIPTIONS.subscriptions.length, 0)
})

test('podcast document rejects oversized episode lists and bad urls', () => {
  assert.equal(
    isPodcastSubscriptionsDocument({
      schemaVersion: 1,
      subscriptions: [
        {
          id: 'x',
          feedUrl: 'not-a-url',
          title: 'Bad',
          createdAt: 't',
          updatedAt: 't',
          episodes: []
        }
      ]
    }),
    false
  )
})
