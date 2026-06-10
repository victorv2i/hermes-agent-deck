import { z } from 'zod'

/**
 * MEMORY-PROVIDER contract — the typed shapes behind the memory-provider
 * section in the Agent tab and the System/Maintenance dock additions.
 *
 * Real stock Hermes routes (web_server.py):
 *   GET  /api/memory          -> MemoryStatus         (web_server.py:4983)
 *   PUT  /api/memory/provider -> { ok, active }       (web_server.py:5018)
 *   POST /api/memory/reset    -> { ok, deleted[] }    (web_server.py:5042)
 *
 * HONESTY rules:
 *  - "active" provider is what config.yaml says; the runtime may differ if
 *    a restart is needed. UI notes: "restart to apply" if the active changes.
 *  - "configured" is provider-level (has the plugin set up), NOT connection-
 *    probed. We never imply the provider is connected.
 *  - Reset is destructive and irreversible — the confirm dialog must name
 *    what will be erased (MEMORY.md, USER.md, or both).
 */

/** One memory provider entry from GET /api/memory. */
export const MemoryProvider = z.object({
  name: z.string(),
  description: z.string(),
  /** True when the provider plugin is configured (NOT necessarily connected). */
  configured: z.boolean(),
})
export type MemoryProvider = z.infer<typeof MemoryProvider>

/**
 * The shape returned by GET /api/memory (web_server.py:4983).
 * SLIM: only the browser-safe fields cross the wire.
 */
export const MemoryStatus = z.object({
  /** The currently-configured provider name, or empty string for built-in. */
  active: z.string(),
  /** All discovered providers (built-in is implicit / not listed by Hermes). */
  providers: z.array(MemoryProvider),
  /**
   * File sizes (bytes) of the built-in memory files. Used to show what a
   * reset would erase. A size of 0 means the file does not yet exist.
   */
  builtin_files: z.object({
    memory: z.number().nonnegative(),
    user: z.number().nonnegative(),
  }),
})
export type MemoryStatus = z.infer<typeof MemoryStatus>

/** Request body for PUT /api/agent-deck/memory-provider. */
export const MemoryProviderSelectRequest = z.object({
  /** Provider name to activate. Send empty string / "built-in" to use built-in. */
  provider: z.string(),
})
export type MemoryProviderSelectRequest = z.infer<typeof MemoryProviderSelectRequest>

/**
 * Reset target for POST /api/agent-deck/memory-provider/reset.
 * Mirrors the Hermes API (web_server.py:5042): all | memory | user.
 */
export const MemoryResetTarget = z.enum(['all', 'memory', 'user'])
export type MemoryResetTarget = z.infer<typeof MemoryResetTarget>

/** Request body for POST /api/agent-deck/memory-provider/reset. */
export const MemoryResetRequest = z.object({
  target: MemoryResetTarget,
})
export type MemoryResetRequest = z.infer<typeof MemoryResetRequest>

/** Response from the BFF memory-provider reset. */
export const MemoryResetResult = z.object({
  ok: z.boolean(),
  deleted: z.array(z.string()),
})
export type MemoryResetResult = z.infer<typeof MemoryResetResult>

/* -------------------------------------------------------------------------- */
/* Curator (skill maintenance background process)                             */
/* -------------------------------------------------------------------------- */

/**
 * Stock Hermes curator routes (web_server.py):
 *   GET  /api/curator          -> CuratorStatus   (web_server.py:844)
 *   PUT  /api/curator/paused   -> { ok, paused }  (web_server.py:869)
 *   POST /api/curator/run      -> { ok, pid, name } (web_server.py:877)
 *
 * HONESTY: "enabled" reflects what the curator module reports. The curator
 * may be unavailable (the module cannot be imported) — the route raises HTTP
 * 500 in that case, which the BFF surfaces as available: false.
 */
export const CuratorStatus = z.object({
  /**
   * Whether the curator is available (the module loaded). When false, the
   * pause/run-now controls are disabled. NOT fabricated — the BFF surfaces the
   * real 500 from Hermes as available: false.
   */
  available: z.boolean(),
  enabled: z.boolean(),
  paused: z.boolean(),
  interval_hours: z.number().nullable(),
  last_run_at: z.string().nullable(),
  min_idle_hours: z.number().nullable(),
  stale_after_days: z.number().nullable(),
  archive_after_days: z.number().nullable(),
})
export type CuratorStatus = z.infer<typeof CuratorStatus>

/* -------------------------------------------------------------------------- */
/* System stats (host OS + process resource snapshot)                         */
/* -------------------------------------------------------------------------- */

/**
 * Stock Hermes route:
 *   GET /api/system/stats -> raw JSON (web_server.py:756)
 *
 * SLIM: The raw response includes OS details (os, os_release, os_version,
 * platform, arch, hostname, python_version, python_impl, hermes_version,
 * cpu_count) plus psutil-enriched memory / disk / cpu / uptime / process
 * blocks when psutil is present. We carry only the user-meaningful,
 * non-sensitive subset. PIDs and absolute paths never cross the wire.
 */
export const SystemStatsMemory = z.object({
  total: z.number(),
  available: z.number(),
  used: z.number(),
  percent: z.number(),
})
export type SystemStatsMemory = z.infer<typeof SystemStatsMemory>

export const SystemStatsDisk = z.object({
  total: z.number(),
  used: z.number(),
  free: z.number(),
  percent: z.number(),
})
export type SystemStatsDisk = z.infer<typeof SystemStatsDisk>

/**
 * The slim, BFF-whitelisted system snapshot.
 * All numeric fields are optional: when psutil is absent from the Hermes
 * install the BFF degrades gracefully — the card shows what it has.
 */
export const SystemStats = z.object({
  /** True when psutil enrichment ran. Used by the UI to show a "psutil missing" note. */
  psutil: z.boolean(),
  os: z.string().optional(),
  arch: z.string().optional(),
  hermes_version: z.string().optional(),
  cpu_count: z.number().nullable().optional(),
  cpu_percent: z.number().optional(),
  load_avg: z.array(z.number()).optional(),
  uptime_seconds: z.number().optional(),
  memory: SystemStatsMemory.optional(),
  disk: SystemStatsDisk.optional(),
})
export type SystemStats = z.infer<typeof SystemStats>

/* -------------------------------------------------------------------------- */
/* Provider validate                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Stock Hermes route:
 *   POST /api/providers/validate -> { ok, reachable, message } (web_server.py:1974)
 *
 * HONESTY rules (matching the Hermes docstring):
 *  - ok=true + reachable=true  -> key accepted (green)
 *  - ok=false + reachable=true -> key rejected -- block the user (red)
 *  - ok=false + reachable=false -> network probe failed -- warn but allow save (amber)
 *  - ok=true + reachable=false -> no probe exists for this provider -- allow save (neutral)
 */
export const ProviderValidateResult = z.object({
  ok: z.boolean(),
  reachable: z.boolean(),
  message: z.string(),
})
export type ProviderValidateResult = z.infer<typeof ProviderValidateResult>
