/**
 * AUDIO CACHE FS — the path-guarded LIST + SERVE of the real cached voice notes
 * under `<HERMES_HOME>/cache/audio/`. The agent writes its TTS output there
 * (`audio_<hex>.{ogg,mp3}`); the native dashboard has NO route for it, so this is
 * a net-new, BFF-local fs surface — and therefore load-bearing to guard.
 *
 * LAYOUT (verified live): `~/.hermes/cache/audio/audio_<hex>.{ogg,mp3}` — a FLAT
 * directory of Opus (`.ogg`) + MP3 (`.mp3`) files. No subdirs are listed/served.
 *
 * SECURITY (every rule the spec pins):
 *  - The serve key is a BARE filename from the request — attacker-influenced — so
 *    it is run through the Files path guard ({@link resolveInsideRoot}) against
 *    the audio root: `..` traversal, absolute escapes, separators, and sensitive
 *    names are rejected BEFORE any fs call.
 *  - A SECOND gate: the name must match `audio-file shape` AND carry an allowed
 *    audio extension (.ogg/.mp3). A non-audio file is refused even if it sits in
 *    the dir — this surface serves AUDIO only.
 *  - A symlink-escape re-assertion (`realpathSync`) confirms the resolved file
 *    really lives inside the real audio root before it is read/streamed.
 *  - Only regular files are served; the listing skips dirs + non-audio entries.
 */
import { readdirSync, statSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { resolveInsideRoot, isPathInsideRoot, PathGuardError } from '../files/pathGuard'
import type { AudioNote, AudioNoteList, AudioExtension } from '@agent-deck/protocol'

/** The two real audio formats hermes writes to the cache. */
const ALLOWED_EXTENSIONS: Record<string, { ext: AudioExtension; contentType: string }> = {
  '.ogg': { ext: 'ogg', contentType: 'audio/ogg' },
  '.mp3': { ext: 'mp3', contentType: 'audio/mpeg' },
}

/** Max notes returned by the listing (newest first). The cache holds 100s. */
const MAX_NOTES = 200

/** Thrown when a requested audio file is missing/not a regular audio file. */
export class AudioNotFoundError extends Error {
  constructor(name: string) {
    super(`Audio note "${name}" not found`)
    this.name = 'AudioNotFoundError'
  }
}

/** Thrown when a requested name is not a servable audio file (wrong shape/ext). */
export class NotAudioError extends Error {
  constructor(name: string) {
    super(`"${name}" is not a servable audio file`)
    this.name = 'NotAudioError'
  }
}

/** The audio cache root for a HERMES_HOME. */
export function audioRoot(hermesHome: string): string {
  return join(hermesHome, 'cache', 'audio')
}

/** Lowercased extension (incl. the dot) of a filename, or '' when none. */
function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return ''
  return name.slice(dot).toLowerCase()
}

/** Is this filename a servable audio file? A bare name with an allowed audio
 * extension and no path separators. (The path guard also enforces no traversal.) */
export function isAudioFileName(name: string): boolean {
  if (name === '' || name.includes('/') || name.includes('\\')) return false
  if (name === '.' || name === '..') return false
  return extOf(name) in ALLOWED_EXTENSIONS
}

/**
 * SYMLINK-ESCAPE re-assertion (parity with skillsFs): {@link resolveInsideRoot}
 * proves only LEXICAL containment; a symlink planted in the audio root could point
 * at `/etc`, `~/.ssh`, etc. So before reading we `realpath` the target and the
 * root and re-assert the real path stays inside the real root. A missing root or
 * file is treated as not-found by the caller (this only throws on an ESCAPE).
 */
function assertRealpathInside(root: string, file: string): void {
  let realRoot: string
  try {
    realRoot = realpathSync(root)
  } catch {
    // No audio root yet — nothing to escape through; the read will simply fail.
    return
  }
  let realFile: string
  try {
    realFile = realpathSync(file)
  } catch {
    // File missing — not an escape; the caller maps the failed read to not-found.
    return
  }
  if (!isPathInsideRoot(realRoot, realFile)) {
    throw new PathGuardError('Audio file escapes the audio cache via a symlink', 'outside_root')
  }
}

/**
 * LIST the real cached audio files (newest first, capped at {@link MAX_NOTES}).
 * Only regular files with an allowed audio extension are included; dirs, symlinks
 * to dirs, and non-audio files are skipped. A missing/unreadable root yields an
 * empty list (never throws) — the surface then shows a calm empty state.
 */
export function listAudioNotes(hermesHome: string): AudioNoteList {
  const root = audioRoot(hermesHome)
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return { notes: [], truncated: false }
  }

  const notes: AudioNote[] = []
  for (const name of names) {
    if (!isAudioFileName(name)) continue
    const meta = ALLOWED_EXTENSIONS[extOf(name)]
    if (!meta) continue
    let st
    try {
      st = statSync(join(root, name))
    } catch {
      continue
    }
    if (!st.isFile()) continue
    notes.push({
      name,
      ext: meta.ext,
      size: st.size,
      modifiedAt: st.mtime.toISOString(),
    })
  }

  // Newest first.
  notes.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  const truncated = notes.length > MAX_NOTES
  return { notes: truncated ? notes.slice(0, MAX_NOTES) : notes, truncated }
}

/** A served audio file's bytes + its content type. */
export interface ServedAudio {
  data: Buffer
  contentType: string
  size: number
}

/**
 * SERVE one cached audio file by its bare filename, path-guarded. Rejects, in
 * order: a non-audio name ({@link NotAudioError}), a traversal/escape
 * ({@link PathGuardError}), a symlink escape ({@link PathGuardError}), and a
 * missing/non-file target ({@link AudioNotFoundError}). On success returns the
 * bytes + the audio content type for the response.
 */
export function readAudioNote(hermesHome: string, name: string): ServedAudio {
  // Gate 1: must be a servable audio name (shape + extension) — before any fs op.
  if (!isAudioFileName(name)) {
    throw new NotAudioError(name)
  }
  const meta = ALLOWED_EXTENSIONS[extOf(name)]
  if (!meta) {
    throw new NotAudioError(name)
  }

  const root = audioRoot(hermesHome)
  // Gate 2: path guard (traversal / absolute / sensitive) against the audio root.
  const abs = resolveInsideRoot(root, name)
  // Gate 3: symlink-escape re-assertion on the real path.
  assertRealpathInside(root, abs)

  // Gate 4: must be a regular file (not a dir / special).
  let st
  try {
    st = statSync(abs)
  } catch {
    throw new AudioNotFoundError(name)
  }
  if (!st.isFile()) {
    throw new AudioNotFoundError(name)
  }

  // Only the bytes + content type leave; the absolute path never crosses the wire.
  const data = readFileSync(abs)
  return { data, contentType: meta.contentType, size: st.size }
}
