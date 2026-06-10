import { z } from 'zod'

/**
 * MCP SERVER MANAGER contract — the typed shapes behind the "tools your agent
 * can call" surface (`/mcp`). MCP (Model Context Protocol) servers live in
 * `~/.hermes/config.yaml` under `mcp_servers`; today they are CLI-only
 * (`hermes mcp add/list/test/...`). This surface gives them a calm web home.
 *
 * The honest model (NO fake states — every boundary below is non-negotiable):
 *  - "ENABLED" is the CONFIG FLAG (`mcp_servers.<name>.enabled`), NOT a live
 *    "connected" state. A connection is not persisted, so the surface NEVER shows
 *    a fake green "connected" dot — only the enabled/disabled config truth.
 *  - Toggling enable/disable or removing a server is a CONFIG WRITE that only
 *    takes effect on a NEW gateway session — the surface says so and reuses the
 *    real Maintenance-dock gateway restart.
 *  - For OAuth servers a clean `test` probe is NOT proof of auth (servers often
 *    serve `tools/list` unauthenticated), so the surface flags them
 *    "authenticate via `hermes mcp login <name>`" — never a green check.
 *  - The curated catalog's OAuth-add + git-bootstrap installs are surfaced as the
 *    `hermes mcp …` command to run; the surface does NOT fake them in-browser.
 *  - Secrets are SHAPE-ONLY across the wire: a stored key surfaces as `isSet` +
 *    a `redactedValue` preview (via the existing `/api/env` path); the plaintext
 *    is NEVER returned or logged.
 */

/** A server's transport. `stdio` = a local launched command; `http` = a URL. */
export const McpTransport = z.enum(['stdio', 'http'])
export type McpTransport = z.infer<typeof McpTransport>

/** How a server authenticates. `oauth` = a clean probe is NOT proof of auth. */
export const McpAuthKind = z.enum(['none', 'api_key', 'oauth'])
export type McpAuthKind = z.infer<typeof McpAuthKind>

/**
 * One configured server, projected from the `mcp_servers.<name>` config block.
 *  - `enabled` is the CONFIG FLAG, never a connection state.
 *  - `transportDetail` is a short sanitized human label (HTTP origin/path, or
 *    `command + args` with secret-like stdio values redacted), truncated
 *    server-side so no long path/secret-bearing value crosses the wire.
 *  - `toolCount` is the count from the config's `tools.include` selection, or
 *    null when the config selects "all" (the real count is only known after a
 *    `test` probe — we never guess one).
 */
export const McpConfiguredServer = z.object({
  /** The server's key in `mcp_servers` (e.g. `context7`). */
  name: z.string(),
  transport: McpTransport,
  /** A short, safe human label for the transport. */
  transportDetail: z.string(),
  authKind: McpAuthKind,
  /** The config `enabled` flag (defaults true when absent). NOT "connected". */
  enabled: z.boolean(),
  /**
   * Number of explicitly-selected tools (`tools.include`), or null when the
   * config selects all tools (the true count needs a live `test` probe).
   */
  toolCount: z.number().int().nonnegative().nullable(),
})
export type McpConfiguredServer = z.infer<typeof McpConfiguredServer>

/**
 * A curated catalog entry (read from `optional-mcps/<name>/manifest.yaml`).
 * `requiresInstall` (a git-bootstrap manifest) and `authKind === 'oauth'` both
 * mean the install is NOT done in-browser — the surface shows the
 * `hermes mcp install <name>` command to run instead.
 */
export const McpCatalogEntry = z.object({
  name: z.string(),
  description: z.string(),
  transport: McpTransport,
  authKind: McpAuthKind,
  /** The entry's docs/source URL, or null. */
  sourceUrl: z.string().nullable(),
  /** True when the manifest has a git-bootstrap install step (CLI-only). */
  requiresInstall: z.boolean(),
  /** True when this catalog entry is already present in `mcp_servers`. */
  installed: z.boolean(),
})
export type McpCatalogEntry = z.infer<typeof McpCatalogEntry>

/** The whole `/mcp` read payload: configured servers + the curated catalog. */
export const McpState = z.object({
  servers: z.array(McpConfiguredServer),
  catalog: z.array(McpCatalogEntry),
})
export type McpState = z.infer<typeof McpState>

/**
 * Guided "Add custom server" request. The BFF validates + writes ONLY the
 * `mcp_servers.<name>` slice (allowlisted) to config.yaml. An optional masked
 * header/env key is stored SEPARATELY via the existing `/api/env` path (its
 * plaintext never lands in config.yaml; the server entry references the env var).
 *
 *  - `name`: the server key (lowercase letters/digits/`-`/`_`, like the CLI).
 *  - `transport`: `http` requires `url`; `stdio` requires `command`.
 *  - `apiKeyEnvVar` + `apiKeyValue`: optional. When both are present the BFF
 *    stores the value via `/api/env` under `apiKeyEnvVar` and references it from
 *    the server entry's `headers` (http) — shape-only, never logged.
 */
export const AddMcpServerRequest = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, dashes, and underscores only.'),
    transport: McpTransport,
    /** Required for `http` transport: the server endpoint URL. */
    url: z.string().trim().url().optional(),
    /** Required for `stdio` transport: the launch command. */
    command: z.string().trim().min(1).optional(),
    /** Optional `stdio` args (each a plain token). */
    args: z.array(z.string()).optional(),
    /** Optional env var name to hold a masked key (stored via `/api/env`). */
    apiKeyEnvVar: z
      .string()
      .trim()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Env var names start with a letter/underscore.')
      .optional(),
    /** Optional plaintext key value — stored once via `/api/env`, never returned. */
    apiKeyValue: z.string().optional(),
  })
  .refine((v) => (v.transport === 'http' ? !!v.url : true), {
    message: 'An HTTP server needs a URL.',
    path: ['url'],
  })
  .refine((v) => (v.transport === 'stdio' ? !!v.command : true), {
    message: 'A stdio server needs a command.',
    path: ['command'],
  })
  .refine((v) => (v.apiKeyValue ? !!v.apiKeyEnvVar : true), {
    message: 'A key value needs an env var name to store it under.',
    path: ['apiKeyEnvVar'],
  })
export type AddMcpServerRequest = z.infer<typeof AddMcpServerRequest>

/** Toggle a configured server's `enabled` config flag. */
export const ToggleMcpServerRequest = z.object({
  enabled: z.boolean(),
})
export type ToggleMcpServerRequest = z.infer<typeof ToggleMcpServerRequest>

/**
 * The result of a config-write (add / toggle / remove): the refreshed full
 * {@link McpState} plus `restartRequired: true` — the write only takes effect on
 * a new gateway session, so the UI prompts the real gateway restart.
 */
export const McpMutationResult = z.object({
  state: McpState,
  /** Always true: an mcp_servers change needs a new gateway session to apply. */
  restartRequired: z.literal(true),
})
export type McpMutationResult = z.infer<typeof McpMutationResult>

/** One tool discovered by a `test` probe. */
export const McpDiscoveredTool = z.object({
  name: z.string(),
  description: z.string(),
})
export type McpDiscoveredTool = z.infer<typeof McpDiscoveredTool>

/**
 * Result of the REAL non-interactive `hermes mcp test <name>` probe.
 *  - `ok` true → the probe connected and listed tools (`tools`).
 *  - `ok` false → `error` carries a short human reason (no internals/secrets).
 *  - `authCaveat` is set for OAuth servers: a clean probe is NOT proof of auth,
 *    so the UI shows "authenticate via `hermes mcp login <name>`" even on `ok`.
 *
 * "enabled" ≠ "connected": this probe is a one-shot connect-then-disconnect, it
 * does NOT establish or persist a live connection — so the surface never renders
 * a standing "connected" dot from it.
 */
export const McpTestResult = z.object({
  name: z.string(),
  ok: z.boolean(),
  /** Discovered tools when `ok`; empty otherwise. */
  tools: z.array(McpDiscoveredTool),
  /** A short human failure reason when `!ok`, else null. Never carries secrets. */
  error: z.string().nullable(),
  /** OAuth caveat copy when the server uses OAuth, else null. */
  authCaveat: z.string().nullable(),
})
export type McpTestResult = z.infer<typeof McpTestResult>
