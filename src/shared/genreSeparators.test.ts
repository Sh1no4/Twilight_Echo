import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_GENRE_SEPARATORS,
  normalizeGenreSeparators,
  splitGenreValues
} from './genreSeparators.ts'

test('splits genre tags with default Chinese and western separators', () => {
  assert.deepEqual(splitGenreValues('Rock，Jazz；Fusion、Electronic / Ambient;Pop,Indie'), [
    'Rock',
    'Jazz',
    'Fusion',
    'Electronic',
    'Ambient',
    'Pop',
    'Indie'
  ])
})

test('keeps spaces inside genre names and deduplicates case-insensitively', () => {
  assert.deepEqual(splitGenreValues('Alternative Rock / rock / ROCK'), ['Alternative Rock', 'rock'])
})

test('supports a user-defined separator character set', () => {
  assert.deepEqual(splitGenreValues('Rock|Jazz+Fusion', '|+'), ['Rock', 'Jazz', 'Fusion'])
  assert.deepEqual(splitGenreValues('Rock/Jazz', '|+'), ['Rock/Jazz'])
})

test('normalizes duplicate and control separators with a safe fallback', () => {
  assert.equal(normalizeGenreSeparators('||++\n'), '|+')
  assert.equal(normalizeGenreSeparators(''), DEFAULT_GENRE_SEPARATORS)
  assert.equal(normalizeGenreSeparators(null), DEFAULT_GENRE_SEPARATORS)
})
