import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDidlLiteMetadata, escapeXmlForDidl } from './didl.ts'

test('escapeXmlForDidl escapes markup characters', () => {
  assert.equal(escapeXmlForDidl(`a&b<"'>`), 'a&amp;b&lt;&quot;&apos;&gt;')
})

test('buildDidlLiteMetadata embeds title and res URL', () => {
  const xml = buildDidlLiteMetadata({
    title: 'Song & Co',
    artist: 'Artist',
    album: 'Album',
    resUrl: 'http://192.168.1.2:9000/media/token',
    contentType: 'audio/flac'
  })
  assert.match(xml, /DIDL-Lite/)
  assert.match(xml, /Song &amp; Co/)
  assert.match(xml, /protocolInfo="http-get:\*:audio\/flac:\*"/)
  assert.match(xml, /http:\/\/192\.168\.1\.2:9000\/media\/token/)
})
