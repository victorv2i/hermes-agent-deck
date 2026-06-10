import { z } from 'zod'

/**
 * TOOLSETS contract — the typed view of the agent's CONFIGURABLE TOOLSETS
 * behind the "Tools" surface (`/tools`).
 *
 * Stock hermes groups the agent's built-in capabilities into named toolsets (web
 * search, browser automation, terminal, file ops, vision, image gen, …) and
 * resolves which are enabled for the active platform from
 * `~/.hermes/config.yaml` (`platform_toolsets.cli`). The dashboard exposes this
 * inventory at `GET /api/tools/toolsets` (web_server.py:5716), returning per
 * toolset its `name`, `label`, `description`, the concrete `tools` it resolves
 * to, and whether it is currently `enabled` / `configured` (has the API keys it
 * needs).
 *
 * WRITE (real stock route exists — not fabricated):
 *  `PUT /api/tools/toolsets/{name}` (web_server.py:5752) accepts `{ "enabled": bool }`
 *  and persists the change to `platform_toolsets.cli` in config.yaml — the same
 *  helper the `hermes tools` TUI uses. It returns `{ ok, name, enabled }`.
 *
 * HONESTY (every boundary below is non-negotiable):
 *  - Toggling persists to config but the running gateway does NOT re-read it
 *    until restart. The UI shows honest "restart gateway to apply" copy — it
 *    never fakes instant activation.
 *  - "ENABLED" is the config truth for the `cli` platform, NOT a live probe.
 *  - "CONFIGURED" means required API keys are present; a toolset can be
 *    enabled-but-not-configured (the agent won't use the tool until its key is
 *    set). That state is surfaced honestly.
 *  - No secrets cross the wire — only the booleans + the public tool/label text.
 */

/** One configurable toolset as surfaced to the Tools page. */
export const AgentDeckToolset = z.object({
  /** Toolset key (the `hermes tools` identifier, e.g. `web`, `browser`). */
  name: z.string(),
  /** Friendly label (emoji stripped on the server), e.g. "Web Search & Scraping". */
  label: z.string(),
  /** One-line description of what the toolset gives the agent. */
  description: z.string(),
  /**
   * Whether the toolset is currently enabled for the `cli` platform — the config
   * truth the agent's sessions load. NOT a live probe.
   */
  enabled: z.boolean(),
  /**
   * Whether the toolset's required API keys are present. An enabled-but-not
   * configured toolset is surfaced honestly (the agent won't get the tool until
   * its key is set). Toolsets that need no key are always `configured: true`.
   */
  configured: z.boolean(),
  /** The concrete tool names this toolset resolves to (sorted, may be empty). */
  tools: z.array(z.string()),
})
export type AgentDeckToolset = z.infer<typeof AgentDeckToolset>

/** The Tools surface list response. */
export const AgentDeckToolsetsResponse = z.object({
  /** Every configurable toolset, enabled/configured flags resolved. */
  toolsets: z.array(AgentDeckToolset),
})
export type AgentDeckToolsetsResponse = z.infer<typeof AgentDeckToolsetsResponse>

/**
 * Request body for the BFF toggle route:
 *   PUT /api/agent-deck/toolsets/:name → proxies PUT /api/tools/toolsets/{name}
 */
export const ToggleToolsetRequest = z.object({
  enabled: z.boolean(),
})
export type ToggleToolsetRequest = z.infer<typeof ToggleToolsetRequest>

/**
 * Response from the BFF toggle route (mirrors stock's `{ ok, name, enabled }`).
 * Stock returns these three fields (web_server.py:5752 `toggle_toolset`).
 */
export const ToggleToolsetResponse = z.object({
  ok: z.boolean(),
  name: z.string(),
  enabled: z.boolean(),
})
export type ToggleToolsetResponse = z.infer<typeof ToggleToolsetResponse>
