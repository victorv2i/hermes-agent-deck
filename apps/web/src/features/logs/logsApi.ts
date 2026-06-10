import { AgentDeckLogs, type LogFile } from '@agent-deck/protocol'
import { apiFetch } from '@/lib/apiFetch'

/** Query inputs for a logs fetch. `level`/`search` are omitted when empty. */
export interface LogsQuery {
  file: LogFile
  lines: number
  /** Min-level filter; `'ALL'`/empty means no server-side level filter. */
  level?: string
  /** Free-text substring filter (applied server-side by the dashboard). */
  search?: string
}

/**
 * Fetch recent log lines (`GET /api/agent-deck/logs`) and parse them through the
 * protocol DTO. The BFF already parses each raw line into the structured shape
 * (level/logger/message) and constrains `level` to the known set; parsing here
 * is a belt-and-braces guard that the client only ever sees the whitelisted
 * shape. The `search` term is sent server-side so filtering scans the whole
 * file, not just the lines already on screen.
 */
export async function fetchLogs(query: LogsQuery, signal?: AbortSignal): Promise<AgentDeckLogs> {
  const params = new URLSearchParams({ file: query.file, lines: String(query.lines) })
  const level = query.level?.trim()
  if (level && level.toUpperCase() !== 'ALL') params.set('level', level)
  const search = query.search?.trim()
  if (search) params.set('search', search)
  return AgentDeckLogs.parse(await apiFetch(`/logs?${params.toString()}`, { signal }))
}
