import * as React from 'react'
import type { AvatarId } from '@agent-deck/protocol'
import { cn } from '@/lib/utils'

/**
 * Avatar — the one governed agent-identity primitive. Consumed by the presence
 * chip, the switcher, the chat header/message gutter, the picker, ⌘K, and the
 * Home hero, so a profile shows ONE face everywhere.
 *
 * GOVERNANCE (load-bearing — the spine's two identity traps):
 *  - Identity is NEVER the amber action accent. The selection/figure-ground ring
 *    uses `var(--border-strong)` (NOT `--ring`, which is byte-identical to amber
 *    `--primary` in every palette). The lettermark fallback is neutral
 *    (`text-foreground` on `--surface-2`), never `text-primary`.
 *  - The face is an `<img>` (not an SVG), so when rendered inside a ⌘K
 *    CommandItem it does NOT inherit the active-row `[&_svg]:text-primary` tint.
 *
 * The art is the committed set of centered head-and-shoulders busts on their own
 * dark-slate ground, so each sits as a self-contained crest (reads on dark, cool,
 * and cream-light themes alike) on a neutral inner plate (no white flash while the
 * webp loads) with a 1px `--border-strong` hairline. The bust is `object-cover`
 * anchored to the TOP so the crown of the head is never clipped by the circle
 * (a centered bust crops a sliver of shoulder, not the face). Decorative by
 * default (`aria-hidden`, empty alt — the adjacent name carries the meaning);
 * pass `label` for the picker tiles, the one place a face needs its own
 * accessible name.
 */

export type AvatarSize = 24 | 28 | 32 | 44 | 56

const SIZE_CLASS: Record<AvatarSize, string> = {
  24: 'size-6 text-[11px]',
  28: 'size-7 text-xs',
  32: 'size-8 text-13',
  44: 'size-11 text-base',
  56: 'size-14 text-lg',
}

export interface AvatarProps {
  /** The resolved built-in avatar id to render (use `resolveAvatar` at the call site). */
  avatarId: AvatarId
  /** The agent name — drives the neutral lettermark fallback if the image fails. */
  name: string
  size?: AvatarSize
  /**
   * Accessible-name mode. Omitted (default) = DECORATIVE: the image is
   * `aria-hidden` with empty alt and contributes no accessible name. Provided =
   * LABELED (picker tiles only): the image carries this as its accessible name.
   */
  label?: string
  className?: string
}

/** First-letter lettermark for the image-missing fallback (never the accent). */
function lettermark(name: string): string {
  const ch = name.trim()[0]
  return ch ? ch.toUpperCase() : '·'
}

export function Avatar({ avatarId, name, size = 32, label, className }: AvatarProps) {
  const [failed, setFailed] = React.useState(false)
  const decorative = label === undefined

  const frame = cn(
    'relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full',
    'border border-[var(--border-strong)]',
    SIZE_CLASS[size],
    className,
  )

  if (failed) {
    // Neutral lettermark — NEVER text-primary; themed surface, not the image plate.
    return (
      <span
        className={cn(frame, 'bg-surface-2 font-wordmark leading-none text-foreground')}
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : label}
        role={decorative ? undefined : 'img'}
      >
        {lettermark(name)}
      </span>
    )
  }

  return (
    <span className={cn(frame, 'bg-surface-2')}>
      <img
        src={`/avatars/${avatarId}.webp`}
        alt={decorative ? '' : label}
        aria-hidden={decorative ? true : undefined}
        width={size}
        height={size}
        decoding="async"
        className="size-full object-cover object-top"
        onError={() => setFailed(true)}
      />
    </span>
  )
}
