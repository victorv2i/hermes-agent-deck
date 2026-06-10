/**
 * MESSAGING PLATFORM REGISTRY — the typed, hand-transcribed source of truth for
 * the v1 Messaging Hub. It encodes, per platform: the gateway id (the key that
 * appears in `/api/status`.gateway_platforms), the display label, the official
 * bot-creation URL, the honest human setup steps, and the writable token env
 * var(s).
 *
 * SOURCE OF TRUTH (verified against stock hermes, NOT guessed):
 *  - Platform ids — `gateway/config.py` `class Platform(Enum)`: the values
 *    `telegram` / `discord` / `slack` / `whatsapp` / `signal` / `email` are the
 *    literal keys the gateway reports in its per-platform connection rollup.
 *  - Token env vars — `hermes_cli/config.py` `OPTIONAL_ENV_VARS` (entries with
 *    `category: "messaging"`, `password: true`): `TELEGRAM_BOT_TOKEN`,
 *    `DISCORD_BOT_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`. The setup URLs
 *    + prompts come from the same entries.
 *  - Connected checks — `gateway/config.py` `_PLATFORM_CONNECTED_CHECKERS` + the
 *    generic `config.token or config.api_key` branch: Telegram/Discord/Slack are
 *    "connected" once their token is present (a paste-token + restart flow);
 *    WhatsApp/Signal/Email are NOT (see below).
 *
 * THE HONEST MODEL — WHY WhatsApp / Signal / Email ARE STATUS-ONLY (no token):
 *  - WhatsApp: `_PLATFORM_CONNECTED_CHECKERS[WHATSAPP] = lambda cfg: True`
 *    ("bridge handles auth"). Pairing is an out-of-band QR scan via the
 *    `hermes whatsapp` CLI — there is NO bot token to paste. Offering a token
 *    field would be a fake control.
 *  - Signal: connected iff `cfg.extra.get("http_url")` — it needs a signal-cli
 *    REST endpoint configured in config.yaml, plus a CLI-linked device. There is
 *    no single `SIGNAL_*` bot token in OPTIONAL_ENV_VARS to write.
 *  - Email: connected iff `cfg.extra.get("address")` — it needs IMAP/SMTP host +
 *    port + an address + an app password (multi-field), and those env vars are
 *    NOT in OPTIONAL_ENV_VARS, so `PUT /api/env` would not even accept them. Not
 *    a paste-one-token flow.
 *
 * So we include those three as status-only cards (real connection truth + honest
 * "setup is CLI/out-of-band" steps) and DROP their token fields rather than fake
 * a control that couldn't work. The BFF's write allowlist therefore only ever
 * covers the four real bot-token env vars above.
 */

/** One writable credential a platform needs (an env var the BFF may store). */
export interface RegistryTokenEnvVar {
  /** The env var name (e.g. `TELEGRAM_BOT_TOKEN`). MUST be a real messaging
   * `OPTIONAL_ENV_VARS` key, `password: true`. */
  readonly envVar: string
  /** Human label for the field (e.g. "Bot token"). */
  readonly label: string
}

/** Static registry metadata for one supported messaging platform. */
export interface MessagingRegistryEntry {
  /** Stable id — MUST match the gateway's `Platform` enum value / the
   * `/api/status`.gateway_platforms key. */
  readonly id: string
  /** Display name (e.g. "Telegram"). */
  readonly label: string
  /** The official page where the user creates the bot + gets the token, or null
   * when there is no single such page (status-only platforms). */
  readonly setupUrl: string | null
  /** Honest, ordered, jargon-free setup steps. For status-only platforms these
   * state the CLI/out-of-band reality plainly. */
  readonly steps: readonly string[]
  /** The writable token env var(s). EMPTY for status-only platforms (WhatsApp /
   * Signal / Email) — they cannot be connected by pasting a single token. */
  readonly tokenEnvVars: readonly RegistryTokenEnvVar[]
}

/**
 * The v1 registry. Order is intentional: the platforms the hub can actually
 * connect (paste-token + restart) come first, then the honestly status-only
 * ones.
 */
export const MESSAGING_REGISTRY: readonly MessagingRegistryEntry[] = [
  {
    id: 'telegram',
    label: 'Telegram',
    setupUrl: 'https://t.me/BotFather',
    steps: [
      'Open @BotFather in Telegram and send /newbot.',
      'Choose a name and a username for your bot; BotFather replies with a bot token.',
      'Paste that token below; we store it for your agent; we never create the bot for you.',
      'Restart the gateway to apply, then watch the connection status flip to connected.',
    ],
    tokenEnvVars: [{ envVar: 'TELEGRAM_BOT_TOKEN', label: 'Bot token' }],
  },
  {
    id: 'discord',
    label: 'Discord',
    setupUrl: 'https://discord.com/developers/applications',
    steps: [
      'Open the Discord Developer Portal and create a New Application.',
      'Under Bot, add a bot and copy its token (enable the Message Content intent).',
      'Invite the bot to your server with the OAuth2 URL generator (bot scope).',
      'Paste the bot token below, then restart the gateway to apply.',
    ],
    tokenEnvVars: [{ envVar: 'DISCORD_BOT_TOKEN', label: 'Bot token' }],
  },
  {
    id: 'slack',
    label: 'Slack',
    setupUrl: 'https://api.slack.com/apps',
    steps: [
      'Create a Slack app at api.slack.com/apps and enable Socket Mode.',
      'Under OAuth & Permissions, install the app and copy the Bot User OAuth token (xoxb-…).',
      'Under Basic Information → App-Level Tokens, create a token and copy it (xapp-…).',
      'Paste both tokens below, then restart the gateway to apply.',
    ],
    tokenEnvVars: [
      { envVar: 'SLACK_BOT_TOKEN', label: 'Bot token (xoxb-…)' },
      { envVar: 'SLACK_APP_TOKEN', label: 'App token (xapp-…)' },
    ],
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    setupUrl: null,
    steps: [
      'WhatsApp pairs through a built-in bridge; there is no token to paste here.',
      'Run `hermes whatsapp` in your terminal and scan the QR code with WhatsApp on your phone.',
      'Once paired, the gateway connects automatically; this card shows the live status.',
    ],
    tokenEnvVars: [],
  },
  {
    id: 'signal',
    label: 'Signal',
    setupUrl: null,
    steps: [
      'Signal connects through a signal-cli REST endpoint; there is no token to paste here.',
      'Run signal-cli and link a device, then point the gateway at it in your config (signal.http_url).',
      'Once linked, the gateway connects; this card shows the live status.',
    ],
    tokenEnvVars: [],
  },
  {
    id: 'email',
    label: 'Email',
    setupUrl: null,
    steps: [
      'Email uses IMAP/SMTP, not a single bot token; set it up in your config / .env.',
      'Provide an address, an app password, and your IMAP/SMTP host + port (e.g. Gmail app password).',
      'Once configured, the gateway connects; this card shows the live status.',
    ],
    tokenEnvVars: [],
  },
]

/** O(1) lookup by gateway id. Returns undefined for an unknown (or wrong-case)
 * id — ids are case-sensitive to match the gateway's exact key. */
const BY_ID = new Map<string, MessagingRegistryEntry>(MESSAGING_REGISTRY.map((p) => [p.id, p]))

export function getRegistryEntry(id: string): MessagingRegistryEntry | undefined {
  return BY_ID.get(id)
}

/**
 * The flat set of every env var the BFF is allowed to write — the union of all
 * registry `tokenEnvVars`. Anything outside this set is refused before any
 * dashboard call (no arbitrary env writes).
 */
export function registryTokenEnvVars(): Set<string> {
  const out = new Set<string>()
  for (const p of MESSAGING_REGISTRY) {
    for (const t of p.tokenEnvVars) out.add(t.envVar)
  }
  return out
}

/**
 * The allowlist gate for `POST /messaging/token`: a `(platform, envVar)` pair is
 * writable ONLY when `platform` is a known registry id AND `envVar` is one of
 * THAT platform's token env vars. Cross-platform writes (right var, wrong
 * platform), non-token messaging vars, and arbitrary env vars all return false.
 */
export function isRegistryToken(platform: string, envVar: string): boolean {
  const entry = BY_ID.get(platform)
  if (!entry) return false
  return entry.tokenEnvVars.some((t) => t.envVar === envVar)
}
