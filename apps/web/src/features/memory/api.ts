/**
 * Memory/Soul surface — typed BFF client.
 *
 * Talks to the agent-deck BFF profile-file routes (apps/server/src/profiles):
 *   GET  /api/agent-deck/profiles/:name/soul    -> { content, exists }
 *   PUT  /api/agent-deck/profiles/:name/soul     body { content } -> { ok }
 *   GET  /api/agent-deck/profiles/:name/memory  -> { content, exists }
 *   PUT  /api/agent-deck/profiles/:name/memory   body { content } -> { ok }
 *   GET  /api/agent-deck/profiles/:name/user    -> { content, exists }
 *   PUT  /api/agent-deck/profiles/:name/user     body { content } -> { ok }
 *
 * These read/write the profile dir on the filesystem directly — the loopback
 * dashboard SWALLOWS /api/profiles/*, so a proxy is impossible. All three files
 * are editable here (symmetric writes). The HONEST BOUNDARY (editing MEMORY.md
 * does not stop the runtime memory provider rewriting it) lives in the UI copy.
 *
 * Types are feature-local (mirroring the server's shapes) to keep features decoupled.
 */
import { apiFetch } from '@/lib/apiFetch'

/** A profile text file's content + whether it exists on disk. */
export interface ProfileFile {
  content: string
  exists: boolean
}

/** The three profile files this surface reads, keyed by their tab. */
export type ProfileFileKind = 'soul' | 'memory' | 'user'

function enc(name: string): string {
  return encodeURIComponent(name)
}

export function fetchProfileFile(
  profile: string,
  kind: ProfileFileKind,
  signal?: AbortSignal,
): Promise<ProfileFile> {
  return apiFetch<ProfileFile>(`/profiles/${enc(profile)}/${kind}`, { signal })
}

/**
 * Persist a profile text file (soul/memory/user). The BFF confines the write to
 * the profile dir (atomic temp-file + rename, path-guarded). A PUT (not POST) —
 * so this hits apiFetch directly: apiPost hardcodes POST.
 */
export function writeProfileFile(
  profile: string,
  kind: ProfileFileKind,
  content: string,
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/profiles/${enc(profile)}/${kind}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
}
