import { apiFetch } from '@/lib/apiFetch'
import type { Skill, SkillBody, SkillsResponse } from './types'

/**
 * Fetch + defensively normalize the Skills BFF payloads. We hand-roll validation
 * (no zod in the web package) so a partial / unexpected payload degrades
 * gracefully rather than crashing the surface.
 *
 *   fetchSkills()                  -> GET    /api/agent-deck/skills
 *   toggleSkill(name, enabled)     -> PUT    /api/agent-deck/skills/toggle
 *   fetchSkillBody(path)           -> GET    /api/agent-deck/skills/body?path=
 *   writeSkillBody(path, content)  -> PUT    /api/agent-deck/skills/body
 *   createSkill(name, category?)   -> POST   /api/agent-deck/skills
 *   deleteSkill(path)              -> DELETE /api/agent-deck/skills
 */

const asString = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)

function normalizeSkill(v: unknown): Skill | null {
  const obj = (v ?? {}) as Record<string, unknown>
  const name = asString(obj.name)
  if (!name) return null
  const category = typeof obj.category === 'string' && obj.category !== '' ? obj.category : null
  return {
    name,
    description: asString(obj.description),
    category,
    enabled: obj.enabled !== false,
    path: typeof obj.path === 'string' && obj.path !== '' ? obj.path : null,
  }
}

export function normalizeSkillsResponse(raw: unknown): SkillsResponse {
  const obj = (raw ?? {}) as Record<string, unknown>
  const skills = Array.isArray(obj.skills)
    ? obj.skills.map(normalizeSkill).filter((s): s is Skill => s !== null)
    : []
  return { skills }
}

export async function fetchSkills(signal?: AbortSignal): Promise<SkillsResponse> {
  return normalizeSkillsResponse(await apiFetch<unknown>('/skills', { signal }))
}

/** Enable/disable a skill by name. Resolves to the confirmed `{ name, enabled }`. */
export async function toggleSkill(
  name: string,
  enabled: boolean,
): Promise<{ name: string; enabled: boolean }> {
  const raw = await apiFetch<unknown>('/skills/toggle', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, enabled }),
  })
  const obj = (raw ?? {}) as Record<string, unknown>
  return {
    name: asString(obj.name) || name,
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : enabled,
  }
}

/** Read a skill's editable SKILL.md body by its relative path. */
export async function fetchSkillBody(path: string, signal?: AbortSignal): Promise<SkillBody> {
  const raw = await apiFetch<unknown>(`/skills/body?path=${encodeURIComponent(path)}`, { signal })
  const obj = (raw ?? {}) as Record<string, unknown>
  return {
    path: asString(obj.path) || path,
    content: asString(obj.content),
    exists: obj.exists !== false,
    hasExtraFiles: obj.hasExtraFiles === true,
  }
}

/** Persist a skill's SKILL.md body. The BFF confines the write to the skill dir. */
export async function writeSkillBody(path: string, content: string): Promise<{ ok: boolean }> {
  const raw = await apiFetch<unknown>('/skills/body', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  })
  return { ok: ((raw ?? {}) as Record<string, unknown>).ok === true }
}

/** Create a new skill from the minimal template. Resolves to its relative path. */
export async function createSkill(
  name: string,
  category?: string | null,
): Promise<{ path: string }> {
  const raw = await apiFetch<unknown>('/skills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(category ? { name, category } : { name }),
  })
  return { path: asString(((raw ?? {}) as Record<string, unknown>).path) }
}

/** Delete a skill (its whole directory) by relative path. */
export async function deleteSkill(path: string): Promise<{ ok: boolean }> {
  const raw = await apiFetch<unknown>('/skills', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  return { ok: ((raw ?? {}) as Record<string, unknown>).ok === true }
}
