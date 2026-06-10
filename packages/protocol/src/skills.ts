import { z } from 'zod'

/**
 * Skills surface contract — the SLIM, WHITELISTED view of the hermes dashboard's
 * `GET /api/skills` + `PUT /api/skills/toggle`.
 *
 * The dashboard enumerates every installed SKILL.md (bundled + external dirs)
 * and reports, per skill, its `name`, a `description`, the `category` it lives
 * under (the leading path segment, e.g. `mlops` — `null` for an uncategorized
 * top-level skill), and whether it is currently `enabled` (i.e. NOT in the
 * profile's disabled set). Category is the surface's filter/grouping dimension —
 * it is the only "kind" the backend actually exposes (there is no
 * builtin/custom/modified flag in the payload).
 *
 * SECURITY: the backend skill dict also carries no secrets, but it is shaped
 * from on-disk SKILL.md frontmatter. This DTO is the contract that whitelists
 * EXACTLY the four display fields below — a remote operator never learns the
 * skill's on-disk path or any field not declared here (parse() drops unknown
 * keys). The toggle is a deliberate, single-field mutation (enable/disable);
 * it never rewrites skill content.
 */

/** One installed skill as surfaced to the Skills page. */
export const AgentDeckSkill = z.object({
  /** Skill identifier (frontmatter `name`, or its directory name). */
  name: z.string(),
  /** One-line description (frontmatter `description`, or the first body line). */
  description: z.string(),
  /**
   * Category the skill lives under — the leading path segment of its skills-dir
   * relative path (e.g. `mlops`). `null` for a top-level / uncategorized skill.
   * This is the surface's filter dimension.
   */
  category: z.string().nullable(),
  /** Whether the skill is currently enabled (NOT in the disabled set). */
  enabled: z.boolean(),
})
export type AgentDeckSkill = z.infer<typeof AgentDeckSkill>

/** The Skills surface list response. */
export const AgentDeckSkillsResponse = z.object({
  /** Every installed skill, enabled flag resolved. */
  skills: z.array(AgentDeckSkill),
})
export type AgentDeckSkillsResponse = z.infer<typeof AgentDeckSkillsResponse>

/** Request body for `PUT /api/agent-deck/skills/toggle`. */
export const AgentDeckSkillToggleRequest = z.object({
  /** The skill to toggle, by name. */
  name: z.string().min(1),
  /** The desired enabled state. */
  enabled: z.boolean(),
})
export type AgentDeckSkillToggleRequest = z.infer<typeof AgentDeckSkillToggleRequest>

/** Response for a successful toggle (echoes the resolved state). */
export const AgentDeckSkillToggleResponse = z.object({
  /** The skill that was toggled. */
  name: z.string(),
  /** The resolved enabled state. */
  enabled: z.boolean(),
})
export type AgentDeckSkillToggleResponse = z.infer<typeof AgentDeckSkillToggleResponse>

// ---------------------------------------------------------------------------
// Skills Hub — browse + install / uninstall / update
// (Real stock routes: web_server.py:5390 / 5350 / 5367 / 5380)
// ---------------------------------------------------------------------------

/** One result from `GET /api/skills/hub/search`. */
export const SkillHubResult = z.object({
  name: z.string(),
  description: z.string(),
  source: z.string(),
  identifier: z.string(),
  trust_level: z.string(),
  repo: z.string().nullable().optional(),
  tags: z.array(z.string()),
})
export type SkillHubResult = z.infer<typeof SkillHubResult>

/** Response from `GET /api/agent-deck/skills/hub/search`. */
export const SkillHubSearchResponse = z.object({
  results: z.array(SkillHubResult),
})
export type SkillHubSearchResponse = z.infer<typeof SkillHubSearchResponse>

/**
 * The action name returned when a hub mutation spawns a background process.
 * `GET /api/actions/{name}/status` (web_server.py:1330) polls the outcome.
 */
export const HubActionName = z.enum(['skills-install', 'skills-uninstall', 'skills-update'])
export type HubActionName = z.infer<typeof HubActionName>

/** Response from any POST /api/agent-deck/skills/hub/* mutation. */
export const HubActionStarted = z.object({
  ok: z.boolean(),
  /** The action name to poll via GET /api/actions/{name}/status. */
  action: HubActionName,
})
export type HubActionStarted = z.infer<typeof HubActionStarted>

/** Response from `GET /api/agent-deck/skills/hub/action-status?name=...`. */
export const HubActionStatus = z.object({
  name: z.string(),
  running: z.boolean(),
  exit_code: z.number().nullable(),
  pid: z.number().nullable(),
  /** Last N log lines from the action's log file. */
  lines: z.array(z.string()),
})
export type HubActionStatus = z.infer<typeof HubActionStatus>

// ---------------------------------------------------------------------------
// Env surface — provider key management (shape-only, never plaintext)
// (Real stock routes: web_server.py:1926 / 1945 / 2029)
// ---------------------------------------------------------------------------

/**
 * One env-var entry as shaped by stock `GET /api/env` (web_server.py:1926).
 * `redacted_value` is the server-side masked preview (e.g. "sk-...abc4") — never
 * the plaintext. The BFF forwards the stock shape wholesale; it never reveals more.
 */
export const EnvVarEntry = z.object({
  is_set: z.boolean(),
  redacted_value: z.string().nullable(),
  description: z.string(),
  url: z.string().nullable().optional(),
  category: z.string(),
  is_password: z.boolean(),
  tools: z.array(z.string()),
  advanced: z.boolean(),
})
export type EnvVarEntry = z.infer<typeof EnvVarEntry>

/** The full env map as returned by `GET /api/agent-deck/env`. */
export const EnvMapResponse = z.object({
  env: z.record(z.string(), EnvVarEntry),
})
export type EnvMapResponse = z.infer<typeof EnvMapResponse>

/**
 * Groups env keys by provider/tool/voice/messaging for the UI.
 * Matches the grouping Hermes uses in its EnvPage.tsx.
 */
export const ENV_CATEGORY_LABELS: Record<string, string> = {
  provider: 'AI Providers',
  tool: 'Tools',
  voice: 'Voice',
  messaging: 'Messaging',
  setting: 'Settings',
}

/** Request body for `PUT /api/agent-deck/env`. */
export const EnvWriteRequest = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
})
export type EnvWriteRequest = z.infer<typeof EnvWriteRequest>

/** Request body for `DELETE /api/agent-deck/env`. */
export const EnvDeleteRequest = z.object({
  key: z.string().min(1),
})
export type EnvDeleteRequest = z.infer<typeof EnvDeleteRequest>
