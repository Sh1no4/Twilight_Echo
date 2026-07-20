import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CueParseError,
  MAX_CUE_BYTES,
  decodeCue,
  normalizeCueRange,
  parseCueSheet,
  parseCueTime,
  playbackSessionCueRangesAreValid
} from './cue.ts'

const UTF8_CUE = `REM generated for Twilight Echo
PERFORMER "Album Artist"
TITLE "Album"
FILE "album.flac" WAVE
  TRACK 01 AUDIO
    TITLE "Opening"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Second"
    INDEX 00 03:00:00
    PREGAP 00:02:00
    INDEX 01 03:02:00
`

test('CUE parser creates exclusive single-file ranges and retains INDEX 00/PREGAP semantics', () => {
  const parsed = parseCueSheet(Buffer.from(UTF8_CUE, 'utf8'), 241)
  assert.equal(parsed.encoding, 'utf-8')
  assert.equal(parsed.fileName, 'album.flac')
  assert.equal(parsed.title, 'Album')
  assert.deepEqual(
    parsed.tracks.map((track) => track.range),
    [
      {
        startSeconds: 0,
        endSeconds: 182,
        pregapSeconds: 0,
        virtualPregapSeconds: 0,
        sourcePregapSeconds: 0
      },
      {
        startSeconds: 182,
        endSeconds: 241,
        pregapSeconds: 2,
        virtualPregapSeconds: 2,
        sourcePregapSeconds: 2
      }
    ]
  )
})

test('CUE parser detects UTF-8 BOM, GBK, and GB18030 instead of replacing malformed bytes', () => {
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(UTF8_CUE, 'utf8')])
  assert.equal(decodeCue(bom).encoding, 'utf-8-bom')
  const gbk = Buffer.concat([
    Buffer.from('TITLE "', 'ascii'),
    Buffer.from([0xb2, 0xe2]),
    Buffer.from('"\nFILE "album.flac" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\n', 'ascii')
  ])
  assert.equal(decodeCue(gbk).encoding, 'gbk')

  // U+1F600 uses the unambiguous GB18030 four-byte form 94 39 FC 36. ICU may also accept this
  // through a decoder labelled GBK, so decodeCue performs byte-form detection before decoding.
  const gb18030 = Buffer.concat([
    Buffer.from('TITLE "', 'ascii'),
    Buffer.from([0x94, 0x39, 0xfc, 0x36]),
    Buffer.from('"\nFILE "album.flac" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\n', 'ascii')
  ])
  assert.equal(decodeCue(gb18030).encoding, 'gb18030')
  assert.match(decodeCue(gb18030).text, /😀/u)
  assert.throws(() => decodeCue(Buffer.from([0xff, 0xfe, 0xfd])), CueParseError)
  assert.throws(
    () =>
      decodeCue(
        Buffer.concat([
          Buffer.from('FILE "album.flac" WAVE\nTITLE "', 'ascii'),
          Buffer.from([0x81])
        ])
      ),
    /Unsupported|malformed|Invalid/
  )
  assert.throws(() => decodeCue(Buffer.alloc(MAX_CUE_BYTES + 1)), /2 MiB/)
})

test('INDEX 00 audio remains continuous while its pregap duration is exposed', () => {
  const parsed = parseCueSheet(
    Buffer.from(
      'FILE "disc.flac" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\n' +
        'TRACK 02 AUDIO\nINDEX 00 00:58:00\nINDEX 01 01:00:00\n'
    ),
    120
  )
  assert.deepEqual(
    parsed.tracks.map((track) => track.range),
    [
      {
        startSeconds: 0,
        endSeconds: 60,
        pregapSeconds: 0,
        virtualPregapSeconds: 0,
        sourcePregapSeconds: 0
      },
      {
        startSeconds: 60,
        endSeconds: 120,
        pregapSeconds: 2,
        virtualPregapSeconds: 0,
        sourcePregapSeconds: 2
      }
    ]
  )
})

test('explicit PREGAP is virtual silence and never shifts or duplicates source ranges', () => {
  const parsed = parseCueSheet(
    Buffer.from(
      'FILE "disc.flac" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\n' +
        'TRACK 02 AUDIO\nPREGAP 00:02:00\nINDEX 01 01:00:00\n'
    ),
    120
  )
  assert.deepEqual(parsed.tracks[0].range, {
    startSeconds: 0,
    endSeconds: 60,
    pregapSeconds: 0,
    virtualPregapSeconds: 0,
    sourcePregapSeconds: 0
  })
  assert.deepEqual(parsed.tracks[1].range, {
    startSeconds: 60,
    endSeconds: 120,
    pregapSeconds: 2,
    virtualPregapSeconds: 2,
    sourcePregapSeconds: 0
  })
})

test('CUE parser rejects missing INDEX 01, unsupported tracks, and out-of-file ranges', () => {
  assert.throws(
    () => parseCueSheet(Buffer.from('FILE "a.flac" WAVE\nTRACK 01 AUDIO\nTITLE "x"\n'), 12),
    /INDEX 01/
  )
  assert.throws(
    () =>
      parseCueSheet(Buffer.from('FILE "a.flac" WAVE\nTRACK 01 MODE1/2352\nINDEX 01 00:00:00'), 12),
    /AUDIO/
  )
  assert.throws(
    () => parseCueSheet(Buffer.from('FILE "a.flac" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:10:00'), 5),
    /non-positive|outside/
  )
  assert.throws(
    () =>
      parseCueSheet(
        Buffer.from(
          'FILE "a.flac" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\n' +
            'TRACK 01 AUDIO\nINDEX 01 00:05:00\n'
        ),
        10
      ),
    /duplicate/
  )
  assert.throws(
    () =>
      parseCueSheet(
        Buffer.from(
          'FILE "a.flac" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\n' +
            'FILE "b.flac" WAVE\nTRACK 02 AUDIO\nINDEX 01 00:05:00\n'
        ),
        10
      ),
    /single-audio-file/
  )
  assert.equal(parseCueTime('01:02:37'), 62 + 37 / 75)
  assert.throws(() => parseCueTime('00:60:00'), CueParseError)
})

test('CUE range validation is shared by queue and persisted-session boundaries', () => {
  assert.deepEqual(normalizeCueRange({ startSeconds: 10, endSeconds: 20 }), {
    startSeconds: 10,
    endSeconds: 20,
    pregapSeconds: 0,
    virtualPregapSeconds: 0,
    sourcePregapSeconds: 0
  })
  assert.equal(normalizeCueRange({ startSeconds: 20, endSeconds: 10, pregapSeconds: 0 }), null)
  assert.equal(normalizeCueRange({ startSeconds: 0, endSeconds: Infinity, pregapSeconds: 0 }), null)
  assert.equal(
    normalizeCueRange({
      startSeconds: 10,
      endSeconds: 20,
      pregapSeconds: 2,
      virtualPregapSeconds: 2,
      sourcePregapSeconds: 11
    }),
    null
  )

  const goodTrack = {
    id: 'local:cue:good',
    cueRange: { startSeconds: 0, endSeconds: 60, pregapSeconds: 0 }
  }
  assert.equal(
    playbackSessionCueRangesAreValid({ track: goodTrack, queue: [goodTrack, { id: 'plain' }] }),
    true
  )
  assert.equal(
    playbackSessionCueRangesAreValid({
      track: goodTrack,
      queue: [goodTrack, { id: 'bad', cueRange: { startSeconds: 60, endSeconds: 59 } }]
    }),
    false
  )
  assert.equal(
    playbackSessionCueRangesAreValid({
      track: { id: 'bad', cueRange: { startSeconds: -1, endSeconds: 10, pregapSeconds: 0 } }
    }),
    false
  )
})
