/**
 * Organization store — the persistence layer for Agentdeck's project/tag
 * metadata. Owns a single JSON file (default `<HERMES_HOME>/agent-deck/
 * organization.json`) holding `{ projects, assignments }`.
 *
 * Why server-side: the dashboard's sessions are read-only and carry no
 * project/tag fields, so this metadata lives in agent-deck's OWN store. Keeping
 * it on the server (not localStorage) means it syncs across the user's devices,
 * which drive the single `:7878` over Tailscale.
 *
 * Durability: writes are ATOMIC (write a temp sibling, then rename over the
 * target — rename is atomic on the same filesystem, so a crash mid-write never
 * leaves a half-written store). Reads are TOLERANT: a missing OR corrupt file
 * yields an empty store rather than throwing, so a stray edit can't brick the
 * surface. The store path is INJECTABLE for hermetic tests.
 *
 * This module is pure persistence + the small mutation primitives the routes
 * compose; it does no HTTP and no input validation (the routes validate via the
 * protocol DTOs before calling in).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Organization, Project, SessionAssignment } from '@agent-deck/protocol'

/** An empty store — the shape returned for a missing/corrupt file. */
export function emptyOrganization(): Organization {
  return { projects: [], assignments: {} }
}

/** Default on-disk location of the store under a hermes home. */
export function defaultStorePath(hermesHome: string): string {
  return join(hermesHome, 'agent-deck', 'organization.json')
}

/**
 * Narrow an arbitrary parsed value into a well-formed {@link Organization},
 * dropping anything that doesn't fit. Defensive so a hand-edited or partially
 * corrupt file degrades to "as much valid data as we can read" instead of
 * throwing. (The routes still re-validate every WRITE through the DTOs.)
 */
function coerceOrganization(value: unknown): Organization {
  if (!value || typeof value !== 'object') return emptyOrganization()
  const raw = value as { projects?: unknown; assignments?: unknown }

  const projects: Project[] = Array.isArray(raw.projects)
    ? raw.projects.flatMap((p): Project[] => {
        if (!p || typeof p !== 'object') return []
        const { id, name, color } = p as Record<string, unknown>
        if (typeof id !== 'string' || typeof name !== 'string' || typeof color !== 'string') {
          return []
        }
        return [{ id, name, color }]
      })
    : []

  const assignments: Record<string, SessionAssignment> = {}
  if (raw.assignments && typeof raw.assignments === 'object') {
    for (const [sessionId, entry] of Object.entries(raw.assignments as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue
      const { projectId, tags } = entry as Record<string, unknown>
      const out: SessionAssignment = {}
      if (typeof projectId === 'string' && projectId !== '') out.projectId = projectId
      if (Array.isArray(tags)) out.tags = tags.filter((t): t is string => typeof t === 'string')
      if (out.projectId !== undefined || out.tags !== undefined) assignments[sessionId] = out
    }
  }

  return { projects, assignments }
}

/**
 * The organization store: loads/saves the JSON file and exposes the small
 * mutation primitives the routes compose (create/update/delete project, set a
 * session's organization). Each mutation reads the current store, applies the
 * change, persists atomically, and returns the resulting state.
 */
export class OrganizationStore {
  constructor(private readonly path: string) {}

  /** Construct a store at the default path under `hermesHome`. */
  static forHermesHome(hermesHome: string): OrganizationStore {
    return new OrganizationStore(defaultStorePath(hermesHome))
  }

  /**
   * Load the store. A missing file or unparseable/invalid contents yield an
   * empty store (never throws on a bad file). Other I/O errors propagate.
   */
  async load(): Promise<Organization> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyOrganization()
      throw err
    }
    try {
      return coerceOrganization(JSON.parse(text))
    } catch {
      // Corrupt/garbage JSON — tolerate it rather than brick the surface.
      return emptyOrganization()
    }
  }

  /**
   * Persist the store atomically: ensure the parent dir exists, write a unique
   * temp sibling, then rename it over the target. The rename is atomic on the
   * same filesystem, so a concurrent reader sees either the old or the new
   * file, never a partial one.
   */
  async save(org: Organization): Promise<void> {
    const dir = dirname(this.path)
    await mkdir(dir, { recursive: true })
    const tmp = join(dir, `.organization.${randomUUID()}.tmp`)
    await writeFile(tmp, JSON.stringify(org, null, 2), 'utf8')
    await rename(tmp, this.path)
  }

  /** Create a project with a server-assigned id; returns the new project. */
  async createProject(input: { name: string; color: string }): Promise<Project> {
    const org = await this.load()
    const project: Project = { id: randomUUID(), name: input.name, color: input.color }
    org.projects.push(project)
    await this.save(org)
    return project
  }

  /**
   * Rename/recolor a project. Returns the updated project, or `null` if no
   * project has that id (the route maps null → 404).
   */
  async updateProject(
    id: string,
    patch: { name?: string; color?: string },
  ): Promise<Project | null> {
    const org = await this.load()
    const project = org.projects.find((p) => p.id === id)
    if (!project) return null
    if (patch.name !== undefined) project.name = patch.name
    if (patch.color !== undefined) project.color = patch.color
    await this.save(org)
    return project
  }

  /**
   * Delete a project and strip its id from EVERY assignment (so no session is
   * left pointing at a project that no longer exists). Returns whether a
   * project was removed (false → 404).
   */
  async deleteProject(id: string): Promise<boolean> {
    const org = await this.load()
    const before = org.projects.length
    org.projects = org.projects.filter((p) => p.id !== id)
    if (org.projects.length === before) return false
    for (const [sessionId, entry] of Object.entries(org.assignments)) {
      if (entry.projectId !== id) continue
      const { tags } = entry
      // Drop the now-dangling projectId; keep tags. An assignment with neither
      // projectId nor (non-empty) tags is pruned so the store doesn't bloat.
      if (tags && tags.length > 0) org.assignments[sessionId] = { tags }
      else delete org.assignments[sessionId]
    }
    await this.save(org)
    return true
  }

  /**
   * Set a session's organization (project membership + tags). `projectId` of
   * `null` clears membership; `tags` is the full normalized desired set. An
   * assignment that ends up empty (no project, no tags) is pruned. Returns the
   * resulting assignment.
   */
  async setSessionOrganization(
    sessionId: string,
    next: { projectId: string | null; tags: string[] },
  ): Promise<SessionAssignment> {
    const org = await this.load()
    const assignment: SessionAssignment = {}
    if (next.projectId !== null) assignment.projectId = next.projectId
    if (next.tags.length > 0) assignment.tags = next.tags

    if (assignment.projectId === undefined && assignment.tags === undefined) {
      delete org.assignments[sessionId]
    } else {
      org.assignments[sessionId] = assignment
    }
    await this.save(org)
    return assignment
  }
}
