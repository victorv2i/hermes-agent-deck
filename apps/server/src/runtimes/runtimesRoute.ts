/**
 * Unified runtimes surface — one history across Hermes, Claude Code, and Codex.
 *
 *   GET /api/agent-deck/runtimes/sessions → UnifiedSessionsResponse
 *
 * Each runtime is an adapter: Hermes wraps the existing dashboard `/api/sessions`
 * (full capabilities, NO behavior change — same data the Sessions surface reads),
 * while Claude Code and Codex are READ-ONLY adapters over their on-disk
 * transcripts. The response carries a per-runtime rollup (capabilities + count +
 * availability) so the client's source filter (All / Hermes / Claude Code / Codex)
 * and capability-gated affordances are driven by the server's honest truth.
 */
import type { FastifyInstance } from 'fastify'
import {
  type RuntimeCapabilities,
  type RuntimeSession,
  type RuntimeSource,
  type SessionSummary,
  type UnifiedSessionsResponse,
} from '@agent-deck/protocol'
import type { DashboardClient } from '../hermes/dashboardClient'
import { mapSessionSummary } from '../sessions/sessionMappers'
import {
  listClaudeSessions as defaultListClaude,
  listCodexSessions as defaultListCodex,
  READ_ONLY_CAPABILITIES,
} from './runtimeAdapters'

const HERMES_CAPABILITIES: RuntimeCapabilities = {
  chat: true,
  approvals: true,
  usage: true,
  sessions: true,
}

export interface RuntimesRouteOptions {
  /** Authenticated dashboard client (the Hermes adapter's data source). */
  dashboard: Pick<DashboardClient, 'getJson'>
  /** Claude Code session lister; injectable for tests. */
  listClaudeSessions?: (opts: { limit?: number }) => RuntimeSession[]
  /** Codex session lister; injectable for tests. */
  listCodexSessions?: (opts: { limit?: number }) => RuntimeSession[]
}

/** Normalize a Hermes timestamp to epoch MS (the dashboard stores unix seconds;
 * a value already in ms is left as-is). Null passes through. */
function toMs(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  // Anything below ~year 2001 in ms is really seconds → scale up.
  return value < 1e11 ? Math.round(value * 1000) : Math.round(value)
}

/** Map a Hermes SessionSummary to the unified RuntimeSession shape. */
export function hermesSessionToRuntime(s: SessionSummary): RuntimeSession {
  return {
    runtime: 'hermes',
    id: s.id,
    title: s.title,
    model: s.model,
    startedAt: toMs(s.started_at),
    lastActive: toMs(s.last_active),
    messageCount: s.message_count,
    inputTokens: s.input_tokens,
    outputTokens: s.output_tokens,
    cwd: null,
  }
}

interface RawListPayload {
  sessions?: unknown[]
}

export async function registerRuntimesRoute(
  app: FastifyInstance,
  options: RuntimesRouteOptions,
): Promise<void> {
  const listClaude = options.listClaudeSessions ?? defaultListClaude
  const listCodex = options.listCodexSessions ?? defaultListCodex

  app.get<{ Querystring: { limit?: string } }>(
    '/api/agent-deck/runtimes/sessions',
    async (req): Promise<UnifiedSessionsResponse> => {
      const limit = clampLimit(req.query.limit)

      // Hermes (full caps): wrap the SAME dashboard data the Sessions surface uses.
      // Any failure → honestly unavailable + empty, never an error to the client.
      let hermes: RuntimeSession[] = []
      let hermesOk = false
      try {
        const raw = await options.dashboard.getJson<RawListPayload>(`/api/sessions?limit=${limit}`)
        const rows = Array.isArray(raw.sessions) ? raw.sessions : []
        hermes = rows.map(mapSessionSummary).map(hermesSessionToRuntime)
        hermesOk = true
      } catch {
        // Dashboard unreachable → Hermes honestly unavailable (empty); the
        // read-only runtimes below still serve. hermesOk stays false.
      }

      // Read-only adapters: best-effort, empty when nothing is on disk.
      const claude = safeList(() => listClaude({ limit }))
      const codex = safeList(() => listCodex({ limit }))

      const sources: RuntimeSource[] = [
        {
          runtime: 'hermes',
          capabilities: HERMES_CAPABILITIES,
          sessionCount: hermes.length,
          available: hermesOk,
        },
        {
          runtime: 'claude',
          capabilities: READ_ONLY_CAPABILITIES,
          sessionCount: claude.length,
          available: true,
        },
        {
          runtime: 'codex',
          capabilities: READ_ONLY_CAPABILITIES,
          sessionCount: codex.length,
          available: true,
        },
      ]

      const sessions = [...hermes, ...claude, ...codex].sort(byRecencyDesc)
      return { sessions, sources }
    },
  )
}

/** Run a lister, swallowing any unexpected fs error into an empty list. */
function safeList(fn: () => RuntimeSession[]): RuntimeSession[] {
  try {
    return fn()
  } catch {
    return []
  }
}

/** Newest-active first; sessions with no timestamp sink to the bottom. */
function byRecencyDesc(a: RuntimeSession, b: RuntimeSession): number {
  return (b.lastActive ?? 0) - (a.lastActive ?? 0)
}

/** Clamp the limit to a sane 1..200 (default 40). */
function clampLimit(raw: string | undefined): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) return 40
  return Math.min(n, 200)
}
