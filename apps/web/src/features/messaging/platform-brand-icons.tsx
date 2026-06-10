import { Mail, MessagesSquare } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import { siDiscord, siSignal, siTelegram, siWhatsapp } from 'simple-icons'

/**
 * BRAND MARKS for the Messaging hub — component-only module (so React Fast Refresh
 * stays happy). The design spine: brand/provider LOGOS are IDENTITY, never the
 * amber `--primary` accent — each mark renders the platform's ACCURATE official
 * glyph in ITS OWN brand color (a hard-coded hex, NOT a theme token, so it stays
 * the real brand color on every theme). These marks identify the tools (nominative
 * use), consistent with the repo's trademark notice.
 *
 * The path data + brand `hex` come from the CC0-licensed `simple-icons` package
 * (real official path data) — we no longer hand-author the marks (a hand-drawn
 * logo is unreliable; a wrong mark is worse than a clean monogram). A platform
 * whose icon is ABSENT from simple-icons (e.g. Slack, removed at the brand's
 * request) falls back to a CLEAN lettermark in its brand color — never a
 * hand-drawn approximation.
 *
 * Email/SMTP has no single brandable logo, so it uses a tasteful NEUTRAL envelope
 * (lucide `Mail`). Unknown ids fall back to a neutral generic chat glyph.
 *
 * The id→mark registry + helper API live in the sibling `platformIcons.ts`.
 */

export type BrandIcon = ComponentType<SVGProps<SVGSVGElement>>

interface SimpleIcon {
  title: string
  hex: string
  path: string
}

/**
 * Render an accurate `simple-icons` glyph as a single-color brand mark. Brand
 * identity: filled in the icon's own `hex` (NOT a theme token, NEVER the amber
 * accent). `role="img"` + `aria-label` give it an accessible name (nominative use).
 */
function BrandGlyph({
  icon,
  label,
  ...props
}: { icon: SimpleIcon; label: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label={label} {...props}>
      <path fill={`#${icon.hex}`} d={icon.path} />
    </svg>
  )
}

/** Telegram — the official paper-plane mark in Telegram blue. */
export function TelegramMark(props: SVGProps<SVGSVGElement>) {
  return <BrandGlyph icon={siTelegram} label="Telegram" {...props} />
}

/** Discord — the official Clyde mark in Discord "blurple". */
export function DiscordMark(props: SVGProps<SVGSVGElement>) {
  return <BrandGlyph icon={siDiscord} label="Discord" {...props} />
}

/**
 * Slack — its icon was removed from simple-icons (at the brand's request), so we
 * render a CLEAN "S" lettermark in Slack's aubergine brand color rather than
 * hand-draw a garbled hash. FALLBACK lettermark (noted in the report).
 */
export function SlackMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label="Slack" {...props}>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#4A154B" />
      <text
        x="12"
        y="12.5"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="13"
        fontWeight={700}
        fill="#fff"
      >
        S
      </text>
    </svg>
  )
}

/** WhatsApp — the official phone-in-bubble mark in WhatsApp green. */
export function WhatsAppMark(props: SVGProps<SVGSVGElement>) {
  return <BrandGlyph icon={siWhatsapp} label="WhatsApp" {...props} />
}

/** Signal — the official speech-bubble mark in Signal blue. */
export function SignalMark(props: SVGProps<SVGSVGElement>) {
  return <BrandGlyph icon={siSignal} label="Signal" {...props} />
}

/**
 * SMTP — a NEUTRAL monogram-equivalent envelope (no single email brand to
 * reproduce faithfully). Renders lucide's `Mail` in the surface foreground.
 */
export function EmailMark(props: SVGProps<SVGSVGElement>) {
  return <Mail aria-label="Email" {...(props as SVGProps<SVGSVGElement>)} />
}

/** The neutral fallback glyph for a platform id we don't have a specific mark for. */
export function GenericPlatformMark(props: SVGProps<SVGSVGElement>) {
  return <MessagesSquare {...(props as SVGProps<SVGSVGElement>)} />
}
