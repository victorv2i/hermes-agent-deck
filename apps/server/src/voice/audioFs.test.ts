import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  listAudioNotes,
  readAudioNote,
  isAudioFileName,
  audioRoot,
  AudioNotFoundError,
  NotAudioError,
} from './audioFs'
import { PathGuardError } from '../files/pathGuard'

/**
 * AUDIO FS TESTS — the security core of the Voice Console. The serve key is
 * attacker-influenced, so the path guard (traversal/escape rejected), the
 * audio-only gate (non-audio refused), and the symlink-escape re-assertion are
 * the load-bearing assertions here.
 */

let home: string
let audioDir: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'voice-audio-'))
  audioDir = audioRoot(home)
  mkdirSync(audioDir, { recursive: true })
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('isAudioFileName', () => {
  it('accepts bare .ogg / .mp3 names', () => {
    expect(isAudioFileName('audio_0075e7c8e022.ogg')).toBe(true)
    expect(isAudioFileName('note.mp3')).toBe(true)
  })

  it('rejects traversal, separators, and non-audio extensions', () => {
    expect(isAudioFileName('../config.yaml')).toBe(false)
    expect(isAudioFileName('sub/dir.ogg')).toBe(false)
    expect(isAudioFileName('a\\b.ogg')).toBe(false)
    expect(isAudioFileName('note.txt')).toBe(false)
    expect(isAudioFileName('note.wav')).toBe(false)
    expect(isAudioFileName('.env')).toBe(false)
    expect(isAudioFileName('')).toBe(false)
    expect(isAudioFileName('..')).toBe(false)
  })
})

describe('listAudioNotes', () => {
  it('lists only audio files, newest first, with size + mtime', () => {
    writeFileSync(join(audioDir, 'audio_a.ogg'), Buffer.from('OggS-a'))
    writeFileSync(join(audioDir, 'audio_b.mp3'), Buffer.from('ID3-bb'))
    // a non-audio file is NOT listed
    writeFileSync(join(audioDir, 'notes.txt'), 'ignore me')
    // a subdir is NOT listed
    mkdirSync(join(audioDir, 'sub'))

    const { notes, truncated } = listAudioNotes(home)
    expect(truncated).toBe(false)
    expect(notes.map((n) => n.name).sort()).toEqual(['audio_a.ogg', 'audio_b.mp3'])
    const a = notes.find((n) => n.name === 'audio_a.ogg')!
    expect(a.ext).toBe('ogg')
    expect(a.size).toBe(6)
    expect(typeof a.modifiedAt).toBe('string')
  })

  it('returns an empty list when the audio dir is missing (never throws)', () => {
    rmSync(audioDir, { recursive: true, force: true })
    expect(listAudioNotes(home)).toEqual({ notes: [], truncated: false })
  })
})

describe('readAudioNote', () => {
  it('serves a real audio file with the right content type', () => {
    writeFileSync(join(audioDir, 'audio_x.ogg'), Buffer.from('OggS-data'))
    const served = readAudioNote(home, 'audio_x.ogg')
    expect(served.contentType).toBe('audio/ogg')
    expect(served.size).toBe(9)
    expect(served.data.toString()).toBe('OggS-data')

    writeFileSync(join(audioDir, 'audio_y.mp3'), Buffer.from('ID3'))
    expect(readAudioNote(home, 'audio_y.mp3').contentType).toBe('audio/mpeg')
  })

  it('REJECTS path traversal out of the audio dir', () => {
    // Plant a secret one level up so a successful traversal would be observable.
    writeFileSync(join(home, 'cache', 'secret.ogg'), Buffer.from('SECRET'))
    // A name with a separator is refused at the audio-name gate (NotAudioError) —
    // the strictest possible rejection, before the path even reaches the guard.
    // Either rejection is correct; what matters is the secret is NEVER served.
    expect(() => readAudioNote(home, '../secret.ogg')).toThrow()
    expect(() => readAudioNote(home, '..%2Fsecret.ogg')).toThrow()
    // A name that is audio-shaped but encodes traversal hits the PATH GUARD.
    expect(() => readAudioNote(home, '..%2F..%2Fsecret.ogg')).toThrow()
  })

  it('REJECTS a non-audio file even if it exists in the dir', () => {
    writeFileSync(join(audioDir, 'config.yaml'), 'secret: value')
    expect(() => readAudioNote(home, 'config.yaml')).toThrow(NotAudioError)
    writeFileSync(join(audioDir, 'note.txt'), 'hello')
    expect(() => readAudioNote(home, 'note.txt')).toThrow(NotAudioError)
  })

  it('REJECTS a symlink that escapes the audio dir', () => {
    const outside = join(home, 'outside.ogg')
    writeFileSync(outside, Buffer.from('ESCAPED'))
    const link = join(audioDir, 'evil.ogg')
    symlinkSync(outside, link)
    expect(() => readAudioNote(home, 'evil.ogg')).toThrow(PathGuardError)
  })

  it('404s a missing audio file', () => {
    expect(() => readAudioNote(home, 'nope.ogg')).toThrow(AudioNotFoundError)
  })

  it('404s a directory named like an audio file', () => {
    mkdirSync(join(audioDir, 'fake.ogg'))
    expect(() => readAudioNote(home, 'fake.ogg')).toThrow(AudioNotFoundError)
  })
})
