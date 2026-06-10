import { SquareTerminal } from 'lucide-react'
import { ClaudeCode, Codex } from '@lobehub/icons'
import type { CliId } from './useTerminalClis'

/**
 * BRAND MARKS for the terminal launcher's CLIs. These identify the tools
 * (nominative use) — they are IDENTITY, never the amber action accent. Each mark
 * renders at its natural brand identity (real mark or neutral glyph), and is NEVER
 * wired to `--primary`.
 *
 * Accurate marks come from `@lobehub/icons` (MIT, accurate AI brand marks). Where
 * a brand genuinely has no accurate mark anywhere (none anywhere = zero sources),
 * we render a tasteful neutral MONOGRAM rather than a hand-drawn approximation.
 * See {@link ./cliBrandMeta} `MONOGRAM_FALLBACK_IDS`.
 *
 * Hermes: the Nous-girl brand image at /brands/hermes.webp — the official
 * NousResearch mascot mark for the Hermes agent. Shown as an <img> rather than an
 * SVG (the image captures the full character + brand accurately at all sizes).
 *
 * Codex: the real OpenAI Codex mark from @lobehub/icons.
 * ClaudeCode: the real Anthropic ClaudeCode mark from @lobehub/icons.
 *
 * Use {@link CliBrandMark} to render the right mark for a CLI id (it picks the
 * brand mark, or the neutral shell glyph for the raw shell). Size via `className`
 * (e.g. `size-4.5`).
 */

export interface CliBrandIconProps {
  /** Size via className (e.g. `size-4.5`); falls back to 1em. */
  className?: string
  title?: string
}

/**
 * Hermes CLI — NousResearch. Uses the official Nous-girl mascot image at
 * /brands/hermes.webp — the authentic visual identity for the Hermes agent.
 * Shown as an <img> so the full character mark reads correctly at icon sizes.
 */
export function HermesBrandIcon({ title, className }: CliBrandIconProps) {
  return (
    <img
      src="/brands/hermes.webp"
      alt={title ?? ''}
      aria-hidden={title ? undefined : true}
      className={className}
      style={{ objectFit: 'contain', borderRadius: '3px' }}
    />
  )
}

/**
 * Claude Code — Anthropic. The ACCURATE ClaudeCode mark from @lobehub/icons,
 * rendered in the Mono variant (currentColor for neutral theming) or Color for
 * richer contexts. Uses Anthropic's terracotta brand color (#D97757) for the
 * Color variant — identity, not the amber accent.
 */
export function ClaudeBrandIcon({ title, className }: CliBrandIconProps) {
  return (
    <ClaudeCode className={className} aria-hidden={title ? undefined : true} aria-label={title} />
  )
}

/**
 * Codex — OpenAI. The ACCURATE Codex mark from @lobehub/icons — the real
 * OpenAI Codex icon, rendered in the Mono variant (currentColor). This replaces
 * the previous hand-drawn "O" monogram with the real brand mark.
 */
export function CodexBrandIcon({ title, className }: CliBrandIconProps) {
  return <Codex className={className} aria-hidden={title ? undefined : true} aria-label={title} />
}

/**
 * The neutral, non-brand glyph for the raw shell — a lucide line icon in
 * currentColor (so the caller tints it). Exported as a component for symmetry with
 * the brand marks.
 */
export function ShellGlyph({ className }: CliBrandIconProps) {
  return <SquareTerminal className={className} aria-hidden />
}

/**
 * Render the right mark for a CLI id: the tool's BRAND mark for hermes/claude/codex,
 * or the neutral {@link ShellGlyph} for the raw shell. A single component (no
 * inline component creation at call sites).
 */
export function CliBrandMark({ cli, className, title }: { cli: CliId } & CliBrandIconProps) {
  switch (cli) {
    case 'hermes':
      return <HermesBrandIcon className={className} title={title} />
    case 'claude':
      return <ClaudeBrandIcon className={className} title={title} />
    case 'codex':
      return <CodexBrandIcon className={className} title={title} />
    case 'shell':
      return <ShellGlyph className={className} title={title} />
  }
}
