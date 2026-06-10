import { z } from 'zod'

/**
 * MESSAGING HUB contract — the typed shapes behind the "your agent lives where
 * you do" surface (connect a Hermes bot to Telegram/Discord/Slack/WhatsApp/Signal/
 * Email and watch the REAL connection state).
 *
 * The honest model (no fake states):
 *  - "Connecting" = store a bot TOKEN (an env var like `TELEGRAM_BOT_TOKEN`) +
 *    restart the gateway. agent-deck cannot create the bot for you — you obtain the
 *    token from BotFather / the platform's dev console out of band.
 *  - Connection truth comes from the gateway's real per-platform state
 *    (`GET /api/status`.gateway_platforms) — never a guess.
 *  - Tokens are SHAPE-ONLY across the wire: a stored token surfaces as `isSet` +
 *    a `redactedValue` preview; the plaintext is NEVER returned or logged.
 */

/**
 * Per-platform connection state, fail-closed. `not_configured` = no token stored;
 * `connecting` = token present but the gateway hasn't reported connected yet;
 * `error` carries a human message; `unknown` = the gateway isn't running / didn't
 * report (we can't claim connected).
 */
export const MessagingConnection = z.enum([
  'connected',
  'connecting',
  'error',
  'not_configured',
  'unknown',
])
export type MessagingConnection = z.infer<typeof MessagingConnection>

/**
 * One credential the platform needs. The value NEVER crosses the wire — only
 * whether it `isSet` and a redacted preview (e.g. `sk-…abcd`) for recognition.
 */
export const MessagingTokenField = z.object({
  /** The env var name (e.g. `TELEGRAM_BOT_TOKEN`). */
  envVar: z.string(),
  /** Human label for the field (e.g. "Bot token"). */
  label: z.string(),
  /** Whether a value is currently stored in the gateway env. */
  isSet: z.boolean(),
  /** A shape-only masked preview, or null when unset. NEVER the plaintext. */
  redactedValue: z.string().nullable(),
})
export type MessagingTokenField = z.infer<typeof MessagingTokenField>

/** Static registry metadata for a supported messaging platform. */
export const MessagingPlatform = z.object({
  /** Stable id matching the gateway's platform key (e.g. `telegram`). */
  id: z.string(),
  /** Display name (e.g. "Telegram"). */
  label: z.string(),
  /** The official page where the user creates the bot + gets the token. */
  setupUrl: z.string().url().nullable(),
  /** Honest, ordered human setup steps (jargon-free). */
  steps: z.array(z.string()),
})
export type MessagingPlatform = z.infer<typeof MessagingPlatform>

/** A platform's registry metadata fused with its live state + credential fields. */
export const MessagingPlatformState = z.object({
  platform: MessagingPlatform,
  /** Real connection state from the gateway (fail-closed). */
  connection: MessagingConnection,
  /** A human error from the gateway when `connection === 'error'`, else null. */
  errorMessage: z.string().nullable(),
  /** The credential field(s) this platform needs, with set/preview status. */
  tokens: z.array(MessagingTokenField),
})
export type MessagingPlatformState = z.infer<typeof MessagingPlatformState>

/** The whole Messaging surface payload: every supported platform × live state. */
export const MessagingState = z.object({
  platforms: z.array(MessagingPlatformState),
  /**
   * Whether the gateway is currently running. When false, connection states are
   * not live truth — the UI says "start your agent to see connection status"
   * rather than implying a platform is disconnected.
   */
  gatewayRunning: z.boolean(),
})
export type MessagingState = z.infer<typeof MessagingState>

/**
 * Store/replace a platform credential. The BFF ALLOWLISTS `(platform, envVar)`
 * against the registry — an env var not owned by a known messaging platform is
 * rejected (no arbitrary env writes). `value` is masked in transit logs + scrubbed.
 */
export const SetMessagingTokenRequest = z.object({
  platform: z.string(),
  envVar: z.string(),
  value: z.string().min(1),
})
export type SetMessagingTokenRequest = z.infer<typeof SetMessagingTokenRequest>

/** Result of storing a token: the platform's refreshed field state (shape-only). */
export const SetMessagingTokenResponse = z.object({
  platform: z.string(),
  tokens: z.array(MessagingTokenField),
  /** True — a stored token only takes effect after a gateway restart. */
  restartRequired: z.literal(true),
})
export type SetMessagingTokenResponse = z.infer<typeof SetMessagingTokenResponse>
