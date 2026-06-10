import type { CliId } from './useTerminalClis'

/**
 * Which CLI brand marks intentionally use a tasteful neutral MONOGRAM fallback
 * (rather than a real official logo). A wrong/ambiguous mark is worse than a
 * clean monogram.
 *
 * As of this version:
 * - hermes: uses the Nous-girl image (/brands/hermes.webp) — REAL MARK
 * - codex: uses the real @lobehub/icons Codex mark — REAL MARK
 * - claude: uses the real @lobehub/icons ClaudeCode mark — REAL MARK
 * - shell: uses a neutral Lucide glyph (not a brand, intentional)
 *
 * No CLI ids currently require the monogram fallback; this list is kept as
 * an extensibility point if a future CLI has no accurate mark available.
 */
export const MONOGRAM_FALLBACK_IDS: readonly CliId[] = []
