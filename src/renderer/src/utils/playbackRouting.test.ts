import assert from 'node:assert/strict'
import test from 'node:test'

const { isRendererDirectAudioTarget, shouldReuseResolvedStreamUrl, shouldUseNativePlaybackTarget } = (await import(
  new URL('./playbackRouting.ts', import.meta.url).href
)) as typeof import('./playbackRouting')

test('local files use native playback without requiring exclusive output', () => {
  for (const extension of ['ape', 'wma', 'wv', 'dsf']) {
    assert.equal(
      shouldUseNativePlaybackTarget('local', `D:\\music\\album\\track.${extension}`),
      true,
      `.${extension} should route to the native engine`
    )
  }
})

test('provider file and stream targets can enter the native playback path', () => {
  assert.equal(shouldUseNativePlaybackTarget('ncm', 'D:\\cache\\track.flac'), true)
  assert.equal(shouldUseNativePlaybackTarget('bili', 'http://127.0.0.1:39127/audio.flac'), true)
  assert.equal(shouldUseNativePlaybackTarget('ncm', 'https://example.test/track.flac'), true)
})

test('renderer-only targets stay on renderer audio path', () => {
  assert.equal(isRendererDirectAudioTarget('blob:twilight-track'), true)
  assert.equal(isRendererDirectAudioTarget('data:audio/mpeg;base64,AAAA'), true)

  assert.equal(shouldUseNativePlaybackTarget('local', 'blob:twilight-track'), false)
  assert.equal(shouldUseNativePlaybackTarget('local', 'data:audio/mpeg;base64,AAAA'), false)
})

test('Bilibili proxy stream URLs are treated as transient', () => {
  assert.equal(shouldReuseResolvedStreamUrl('local'), true)
  assert.equal(shouldReuseResolvedStreamUrl('ncm'), true)
  assert.equal(shouldReuseResolvedStreamUrl('bili'), false)
})
