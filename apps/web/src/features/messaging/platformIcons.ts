import {
  DiscordMark,
  EmailMark,
  GenericPlatformMark,
  SignalMark,
  SlackMark,
  TelegramMark,
  WhatsAppMark,
  type BrandIcon,
} from './platform-brand-icons'

/**
 * Per-platform BRAND-MARK registry + helper API for the Messaging hub. The marks
 * themselves live in `platform-brand-icons.tsx` (component-only); this module maps
 * the gateway's stable platform id (`telegram`, `discord`, …) to its mark and
 * answers "does this id have a real brand mark, or a neutral fallback?".
 *
 * Spine: brand logos are IDENTITY (their own brand colors), never the amber
 * `--primary` accent. Email/SMTP + unknown ids fall back to a neutral glyph rather
 * than a guessed/garbled mark.
 */
const BRAND_ICONS: Record<string, BrandIcon> = {
  telegram: TelegramMark,
  discord: DiscordMark,
  slack: SlackMark,
  whatsapp: WhatsAppMark,
  signal: SignalMark,
  email: EmailMark,
}

/** The neutral fallback glyph for a platform id we don't have a specific mark for. */
export const DEFAULT_PLATFORM_ICON: BrandIcon = GenericPlatformMark

/**
 * Platform ids that render a neutral monogram-equivalent glyph rather than a true
 * brand mark (email/SMTP has no single brand logo). Exposed so the UI can render
 * these without the brand-color treatment.
 */
export const NEUTRAL_PLATFORM_IDS = new Set(['email'])

/** Resolve a platform id to its brand mark, falling back to a generic chat glyph. */
export function platformIcon(id: string): BrandIcon {
  return BRAND_ICONS[id] ?? DEFAULT_PLATFORM_ICON
}

/** Whether this platform renders a real brand mark (vs. a neutral fallback glyph). */
export function hasBrandMark(id: string): boolean {
  return id in BRAND_ICONS && !NEUTRAL_PLATFORM_IDS.has(id)
}

export type { BrandIcon }
