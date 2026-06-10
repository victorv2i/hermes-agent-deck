/**
 * Settings data client. Talks to the BFF (`/api/agent-deck/config`), which has
 * already redacted every secret — the browser only ever sees masked values.
 */
import { apiFetch, apiPost } from '@/lib/apiFetch'
import type { SettingsPayload } from './types'

export async function fetchSettings(signal?: AbortSignal): Promise<SettingsPayload> {
  return apiFetch<SettingsPayload>('/config', { signal })
}

/** The BFF's response to a successful single-field config write. */
export interface ConfigFieldWriteResult {
  ok: true
  key: string
  value: string | number
}

/**
 * Write ONE allowlisted, non-secret scalar config field via the guarded BFF
 * endpoint (`POST /api/agent-deck/config/field`). The server read-modify-writes
 * the full config so secrets round-trip untouched, and refuses (400) anything
 * off its allowlist — so this never silently corrupts a credential.
 */
export async function updateConfigField(
  key: string,
  value: string | number,
): Promise<ConfigFieldWriteResult> {
  return apiPost<ConfigFieldWriteResult>('/config/field', { key, value })
}
