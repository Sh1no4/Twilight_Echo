import assert from 'node:assert/strict'
import test from 'node:test'

const { isRendererDirectAudioTarget, shouldUseNativePlaybackTarget } = (await import(
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

test('renderer-direct targets stay on renderer audio path', () => {
  assert.equal(isRendererDirectAudioTarget('https://example.test/track.mp3'), true)
  assert.equal(isRendererDirectAudioTarget('blob:twilight-track'), true)
  assert.equal(isRendererDirectAudioTarget('data:audio/mpeg;base64,AAAA'), true)

  assert.equal(shouldUseNativePlaybackTarget('local', 'https://example.test/track.mp3'), false)
  assert.equal(shouldUseNativePlaybackTarget('local', 'blob:twilight-track'), false)
  assert.equal(shouldUseNativePlaybackTarget('local', 'data:audio/mpeg;base64,AAAA'), false)
  assert.equal(shouldUseNativePlaybackTarget('ncm', 'D:\\cache\\track.flac'), false)
  assert.equal(shouldUseNativePlaybackTarget('bili', 'D:\\cache\\track.flac'), false)
})
