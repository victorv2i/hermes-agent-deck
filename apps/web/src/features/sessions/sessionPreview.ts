/**
 * Session title/preview sanitizer.
 *
 * Hermes derives session titles and previews from the FIRST prompt text, which
 * for skill and cron runs is an injected system preamble like
 * `[IMPORTANT: The user has invoked the "outlook-email" skill, …` — machine
 * plumbing, not something a person typed. Every surface that names a session
 * (Home "Jump back in", the session rail, History, the ⌘K palette) runs the raw
 * title/preview through this one pure helper so they all read human:
 *
 *  - A leading bracketed system preamble (`[IMPORTANT: …]`, including truncated
 *    previews whose bracket never closes) is stripped.
 *  - If real user text follows the preamble, that text is shown.
 *  - Otherwise, when the preamble names an invoked skill, an honest human label
 *    ("Ran the outlook-email skill") stands in.
 *  - Whitespace/newlines are collapsed; normal previews pass through unchanged.
 *
 * Returns '' when nothing human remains, so callers keep their own
 * `|| 'Untitled …'` fallback chains.
 */

/** A leading bracketed system preamble: `[ALLCAPSWORD: …`. Lowercase brackets
 * (markdown links, `[sic]`) deliberately do not match. */
const LEADING_PREAMBLE = /^\[\s*[A-Z][A-Z0-9 _-]*:/

/** The skill-invocation phrasing inside a preamble: `invoked the "X" skill`. */
const SKILL_INVOCATION = /invoked the\s+["'“”‘’]?([\w@./:-]+)["'“”‘’]?\s+skill/i

/**
 * Make a session title/preview read like something a person said. See the
 * module doc for the exact rules.
 */
export function sanitizeSessionPreview(raw: string | null | undefined): string {
  if (!raw) return ''
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!LEADING_PREAMBLE.test(text)) return text
  // Previews are length-capped upstream, so the preamble's closing bracket may
  // be cut off; an unclosed bracket means the WHOLE preview is preamble.
  const close = text.indexOf(']')
  const preamble = close === -1 ? text : text.slice(0, close + 1)
  const rest = close === -1 ? '' : text.slice(close + 1).trim()
  if (rest) return rest
  const skill = preamble.match(SKILL_INVOCATION)
  if (skill) return `Ran the ${skill[1]} skill`
  return ''
}
