import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MAX_CUE_BYTES } from '../../shared/cue.ts'
import { deriveCueTracks, resolveCueAudioPath } from './cueLibrary.ts'

test('CUE library derivation replaces one audio file with stable logical tracks', () => {
  const root = mkdtempSync(join(tmpdir(), 'twilight-cue-'))
  try {
    const audio = join(root, 'disc.flac')
    const cue = join(root, 'disc.cue')
    writeFileSync(audio, 'fixture')
    writeFileSync(
      cue,
      'PERFORMER "Artist"\nTITLE "Album"\nFILE "disc.flac" WAVE\nTRACK 01 AUDIO\nTITLE "One"\nINDEX 01 00:00:00\nTRACK 02 AUDIO\nTITLE "Two"\nINDEX 01 01:00:00\n'
    )
    const base = {
      id: 'unstable',
      title: 'disc',
      artist: 'fallback',
      album: 'fallback album',
      filePath: audio,
      fileName: 'disc.flac',
      duration: 120,
      size: 7,
      cover: null,
      lyrics: null
    }
    const first = deriveCueTracks(audio, 120, base, ['.flac'])
    const second = deriveCueTracks(audio, 120, base, ['.flac'])
    assert.ok(first)
    assert.equal(first.length, 2)
    assert.deepEqual(
      first.map((item) => item.id),
      second?.map((item) => item.id)
    )
    assert.deepEqual(
      first.map((item) => item.duration),
      [60, 60]
    )
    assert.equal(first[1].cueRange.startSeconds, 60)
    assert.equal(first[0].album, 'Album')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('CUE referenced file cannot escape its containing directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'twilight-cue-path-'))
  try {
    assert.throws(() => resolveCueAudioPath(root, '../outside.flac', ['.flac']), /relative|escapes/)
    if (process.platform === 'win32') {
      assert.throws(
        () => resolveCueAudioPath(root, '..\\outside.flac', ['.flac']),
        /relative|escapes/
      )
    }
    assert.throws(
      () => resolveCueAudioPath(root, join(root, 'absolute.flac'), ['.flac']),
      /relative/
    )
    assert.throws(() => resolveCueAudioPath(root, 'inside.txt', ['.flac']), /extension/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('CUE library derivation rejects an oversized sheet before parsing it', () => {
  const root = mkdtempSync(join(tmpdir(), 'twilight-cue-size-'))
  try {
    const audio = join(root, 'disc.flac')
    writeFileSync(audio, 'fixture')
    writeFileSync(join(root, 'disc.cue'), Buffer.alloc(MAX_CUE_BYTES + 1, 0x20))
    assert.equal(
      deriveCueTracks(
        audio,
        120,
        { id: 'base', filePath: audio, fileName: 'disc.flac', duration: 120 },
        ['.flac']
      ),
      null
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('CUE library derivation retains GB18030 identity, pregap, and source ReplayGain', () => {
  const root = mkdtempSync(join(tmpdir(), 'twilight-cue-gb18030-'))
  try {
    const audio = join(root, 'disc.flac')
    const cue = join(root, 'disc.cue')
    writeFileSync(audio, 'fixture')
    writeFileSync(
      cue,
      Buffer.concat([
        Buffer.from('TITLE "', 'ascii'),
        Buffer.from([0x94, 0x39, 0xfc, 0x36]),
        Buffer.from(
          '"\nFILE "disc.flac" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\n' +
            'TRACK 02 AUDIO\nPREGAP 00:02:00\nINDEX 01 01:00:00\n',
          'ascii'
        )
      ])
    )
    const tracks = deriveCueTracks(
      audio,
      120,
      {
        id: 'base',
        title: 'disc',
        artist: 'Artist',
        album: 'Album',
        filePath: audio,
        fileName: 'disc.flac',
        duration: 120,
        size: 7,
        cover: null,
        lyrics: null,
        replayGainTrackGainDb: -7.5,
        r128AlbumGainDb: -6
      },
      ['.flac']
    )

    assert.ok(tracks)
    assert.equal(tracks[0].cueEncoding, 'gb18030')
    assert.equal(tracks[0].album, '😀')
    assert.equal(tracks[1].cueRange.pregapSeconds, 2)
    assert.equal(tracks[1].cueRange.virtualPregapSeconds, 2)
    assert.equal(tracks[1].cueRange.sourcePregapSeconds, 0)
    assert.equal(tracks[1].duration, 62)
    assert.equal(tracks[1].replayGainTrackGainDb, -7.5)
    assert.equal(tracks[1].r128AlbumGainDb, -6)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
