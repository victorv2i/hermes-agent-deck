/**
 * GUARDED VOICE CONFIG WRITE — turn an {@link UpdateVoiceConfigRequest} into a set
 * of dot-path patches CONFINED to the `tts` / `stt` / `voice` config blocks, then
 * apply them read-modify-write against the full hermes config.
 *
 * Stock hermes `PUT /api/config` (web_server.py:1239) does a FULL `save_config`
 * (no partial merge), so — exactly like the settings single-field write — we read
 * the full UNREDACTED config, set the few allowlisted dot-paths, and PUT the whole
 * object back. Every untouched key (incl. live credentials, model config, etc.)
 * round-trips verbatim.
 *
 * THE HONESTY BOUNDARY (non-negotiable): every dot-path this module produces is
 * rooted at `tts.`, `stt.`, or `voice.`. {@link assertVoiceBlockPath} re-asserts
 * that on EVERY patch before it is applied — a path outside those three blocks is
 * a hard throw, so this write can NEVER touch anything else even if a caller
 * skips the typed request. The request shape itself only carries provider/voice/
 * toggle scalars (it cannot even express an out-of-block key), and the TTS-voice
 * sub-field is resolved from the trusted {@link TTS_REGISTRY}, never from client
 * input — so the voice value cannot smuggle a `.`-path into another block.
 */
import type { UpdateVoiceConfigRequest } from '@agent-deck/protocol'
import { getTtsEntry } from './registry'

/** The three config blocks this surface is allowed to write into. */
const ALLOWED_BLOCKS = new Set(['tts', 'stt', 'voice'])

/** A dangerous prototype-pollution segment — never written as an object key. */
function isUnsafeSegment(seg: string): boolean {
  return seg === '__proto__' || seg === 'prototype' || seg === 'constructor'
}

/**
 * Re-assert a dot-path is rooted at an allowed voice block and carries no unsafe
 * segment. Throws on violation — defense in depth so an out-of-block write is
 * impossible even if the patch list were built wrong.
 */
export function assertVoiceBlockPath(path: string): void {
  const segments = path.split('.')
  if (segments.length === 0 || !ALLOWED_BLOCKS.has(segments[0]!)) {
    throw new Error(`Refusing to write a non-voice config path: ${path}`)
  }
  for (const seg of segments) {
    if (seg === '' || isUnsafeSegment(seg)) {
      throw new Error(`Refusing unsafe config path segment in: ${path}`)
    }
  }
}

/** One concrete patch: a dot-path (inside a voice block) + its scalar value. */
export interface ConfigPatch {
  path: string
  value: string | boolean
}

/**
 * Translate a typed {@link UpdateVoiceConfigRequest} into the concrete set of
 * voice-block dot-path patches. The TTS-voice sub-field comes from the registry
 * (NOT client input), so `tts.<provider>.<voiceField>` is always a known, safe
 * path. Every returned path is asserted in-block. An empty request yields no
 * patches (the route rejects that before calling here).
 */
export function buildVoicePatches(req: UpdateVoiceConfigRequest): ConfigPatch[] {
  const patches: ConfigPatch[] = []

  if (req.ttsProvider !== undefined) {
    patches.push({ path: 'tts.provider', value: req.ttsProvider })
  }
  if (req.ttsVoice !== undefined) {
    const entry = getTtsEntry(req.ttsVoice.provider)
    // The provider is governed by the enum + the registry; an unknown one is
    // refused rather than guessed (no path is produced).
    if (!entry) {
      throw new Error(`Unknown TTS provider: ${req.ttsVoice.provider}`)
    }
    patches.push({
      path: `tts.${entry.id}.${entry.voiceField}`,
      value: req.ttsVoice.voice,
    })
  }
  if (req.sttProvider !== undefined) {
    patches.push({ path: 'stt.provider', value: req.sttProvider })
  }
  if (req.sttEnabled !== undefined) {
    patches.push({ path: 'stt.enabled', value: req.sttEnabled })
  }
  if (req.autoTts !== undefined) {
    patches.push({ path: 'voice.auto_tts', value: req.autoTts })
  }
  if (req.beepEnabled !== undefined) {
    patches.push({ path: 'voice.beep_enabled', value: req.beepEnabled })
  }

  // Defense in depth: re-assert every produced path is in-block before returning.
  for (const p of patches) assertVoiceBlockPath(p.path)
  return patches
}

/**
 * Return a clone of `config` with one in-block dot-path set to `value`, leaving
 * every other key — INCLUDING SECRETS in other blocks — untouched. The input is
 * never mutated; only objects ALONG the patched path are cloned (sibling subtrees
 * are carried by reference, never mutated). Throws on an out-of-block or unsafe
 * path.
 */
export function applyVoicePatch(
  config: Record<string, unknown>,
  path: string,
  value: string | boolean,
): Record<string, unknown> {
  assertVoiceBlockPath(path)
  const segments = path.split('.')

  const root: Record<string, unknown> = { ...config }
  let cursor = root
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!
    const existing = cursor[seg]
    const child: Record<string, unknown> =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {}
    cursor[seg] = child
    cursor = child
  }
  cursor[segments[segments.length - 1]!] = value
  return root
}

/** Apply every patch in order to a config object (read-modify-write helper). */
export function applyVoicePatches(
  config: Record<string, unknown>,
  patches: readonly ConfigPatch[],
): Record<string, unknown> {
  let next = config
  for (const p of patches) {
    next = applyVoicePatch(next, p.path, p.value)
  }
  return next
}
