/**
 * Memory-provider + curator + system-stats web client.
 *
 * Talks to the agent-deck BFF routes:
 *   GET  /api/agent-deck/system/stats             -> SystemStats
 *   GET  /api/agent-deck/curator                  -> CuratorStatus
 *   PUT  /api/agent-deck/curator/paused           -> { ok, paused }
 *   POST /api/agent-deck/curator/run              -> { ok }
 *   GET  /api/agent-deck/memory-provider          -> MemoryStatus
 *   PUT  /api/agent-deck/memory-provider          -> { ok, active, restart_required }
 *   POST /api/agent-deck/memory-provider/reset    -> MemoryResetResult
 *   POST /api/agent-deck/providers/validate       -> ProviderValidateResult
 */
import { apiFetch, apiPost } from '@/lib/apiFetch'
import {
  SystemStats,
  CuratorStatus,
  MemoryStatus,
  MemoryResetResult,
  ProviderValidateResult,
  type MemoryResetTarget,
} from '@agent-deck/protocol'

/** Live host/process snapshot (psutil-enriched when available). */
export async function fetchSystemStats(signal?: AbortSignal): Promise<SystemStats> {
  return SystemStats.parse(await apiFetch<unknown>('/system/stats', { signal }))
}

/** Fetch curator status (available/enabled/paused + schedule config). */
export async function fetchCurator(signal?: AbortSignal): Promise<CuratorStatus> {
  return CuratorStatus.parse(await apiFetch<unknown>('/curator', { signal }))
}

/** Pause or resume the curator (PUT). */
export async function setCuratorPaused(paused: boolean): Promise<{ ok: boolean; paused: boolean }> {
  return apiFetch<{ ok: boolean; paused: boolean }>('/curator/paused', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paused }),
  })
}

/** Trigger a curator review now (backgrounded in Hermes). */
export async function runCuratorNow(): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>('/curator/run', {})
}

/** Fetch the memory-provider status (active + catalog + built-in file sizes). */
export async function fetchMemoryProvider(signal?: AbortSignal): Promise<MemoryStatus> {
  return MemoryStatus.parse(await apiFetch<unknown>('/memory-provider', { signal }))
}

/**
 * Switch the active memory provider. Returns restart_required=true always (a
 * gateway restart is needed to apply the change — the UI surfaces this honestly).
 */
export async function setMemoryProvider(
  provider: string,
): Promise<{ ok: boolean; active: string; restart_required: boolean }> {
  return apiFetch<{ ok: boolean; active: string; restart_required: boolean }>('/memory-provider', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  })
}

/** Reset (destructively delete) the built-in memory files. Irreversible. */
export async function resetMemory(target: MemoryResetTarget): Promise<MemoryResetResult> {
  return MemoryResetResult.parse(await apiPost<unknown>('/memory-provider/reset', { target }))
}

/** Live-probe a provider credential. Fails open (allow-save) on network error. */
export async function validateProviderKey(
  key: string,
  value: string,
): Promise<ProviderValidateResult> {
  return ProviderValidateResult.parse(await apiPost<unknown>('/providers/validate', { key, value }))
}
