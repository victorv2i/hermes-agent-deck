/**
 * Workspace store - the persistence layer for Agent Deck's terminal WORKSPACES.
 *
 * A workspace is a named, freeform grid of terminal panes. The SERVER is the
 * source of truth for these DEFINITIONS so every device (Mac, Windows, iPhone
 * over the tailnet) that drives this one bind sees the same set; pty/tmux
 * continuity is handled separately by the terminal namespace via deterministic
 * `sessionId`s and is NOT this module's concern.
 *
 * This mirrors the single-file persistence pattern used by `auth.ts` (the
 * deck-owned `~/.agent-deck/...` file) and the atomic-write + tolerant-read
 * idiom of `organization/organizationStore.ts`:
 *
 *  - In-memory `Map<id, WorkspaceDefinition>` loaded LAZILY on first use; a
 *    missing OR corrupt file yields an EMPTY store rather than throwing, so a
 *    stray edit can never brick the surface or crash the server on boot.
 *  - Writes are ATOMIC: write a unique temp sibling, then `rename()` over the
 *    target. rename is atomic on the same filesystem, so a concurrent reader
 *    sees either the old or the new file, never a partial one.
 *  - A write that FAILS (read-only FS, a parent that is a file, etc.) is logged and
 *    swallowed - the in-memory map stays authoritative for the process lifetime
 *    so the server never crashes on a persistence failure.
 *
 * This module is pure persistence + the small CRUD primitives the routes
 * compose; it does no HTTP and no input validation (the routes validate via the
 * protocol DTOs before calling in, exactly like organizationStore).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  WorkspaceDefinitionSchema,
  type WorkspaceDefinition,
  type WorkspaceSummary,
} from '@agent-deck/protocol'

/** Default on-disk location of the store (deck-owned, alongside the auth token). */
export function defaultWorkspacesPath(home: string = homedir()): string {
  return join(home, '.agent-deck', 'workspaces.json')
}

/**
 * A short, stable, collision-resistant workspace id from `node:crypto` (no new
 * deps). A UUID with the dashes stripped, sliced to 12 hex chars - well within
 * the `^[A-Za-z0-9_-]{1,64}$` id charset and tiny enough to read in a URL.
 */
export function generateWorkspaceId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12)
}

/**
 * Narrow an arbitrary parsed value into a `Map` of well-formed definitions,
 * dropping anything that doesn't validate. Defensive so a hand-edited or
 * partially corrupt file degrades to "as much valid data as we can read"
 * instead of throwing. The on-disk shape is a plain object keyed by workspace id.
 */
function coerceStore(value: unknown): Map<string, WorkspaceDefinition> {
  const map = new Map<string, WorkspaceDefinition>()
  if (!value || typeof value !== 'object') return map
  for (const entry of Object.values(value as Record<string, unknown>)) {
    const parsed = WorkspaceDefinitionSchema.safeParse(entry)
    if (parsed.success) map.set(parsed.data.id, parsed.data)
  }
  return map
}

/** The slim list-view of a definition (no pane bodies) for the picker. */
function toSummary(def: WorkspaceDefinition): WorkspaceSummary {
  return {
    id: def.id,
    name: def.name,
    ...(def.description !== undefined ? { description: def.description } : {}),
    paneCount: def.panes.length,
    createdAt: def.createdAt,
    lastModifiedAt: def.lastModifiedAt,
  }
}

export class WorkspaceStore {
  /** Lazily-populated in-memory cache; `null` until the first load. */
  private cache: Map<string, WorkspaceDefinition> | null = null
  /** In-flight load, so concurrent first-callers share ONE map (no clobber). */
  private loading: Promise<Map<string, WorkspaceDefinition>> | null = null
  /** Serialize persists so atomic renames never interleave under concurrency. */
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly path: string = defaultWorkspacesPath()) {}

  /** Build a store at the default deck-owned path under a given home. */
  static forHome(home: string = homedir()): WorkspaceStore {
    return new WorkspaceStore(defaultWorkspacesPath(home))
  }

  /**
   * Load (and cache) the store. A missing file or unparseable/invalid contents
   * yield an empty store; this NEVER throws, so a bad file can't crash the
   * server on boot. Subsequent calls return the cached map.
   */
  private async ensureLoaded(): Promise<Map<string, WorkspaceDefinition>> {
    if (this.cache) return this.cache
    // Dedupe a concurrent first-load: every caller awaits the SAME promise, so
    // they all see one shared map rather than each creating their own (which
    // would clobber each other's writes under concurrency).
    if (!this.loading) this.loading = this.loadFromDisk()
    this.cache = await this.loading
    this.loading = null
    return this.cache
  }

  /** Read + coerce the file into a map; missing or corrupt yields an empty map. */
  private async loadFromDisk(): Promise<Map<string, WorkspaceDefinition>> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch {
      // Missing (or unreadable) - start empty.
      return new Map()
    }
    try {
      return coerceStore(JSON.parse(text))
    } catch {
      // Corrupt/garbage JSON - tolerate it rather than brick the surface.
      return new Map()
    }
  }

  /**
   * Persist the store atomically: ensure the parent dir exists, write a unique
   * temp sibling, then rename it over the target. A failure is logged and
   * swallowed - the in-memory map stays authoritative so a persistence error
   * never crashes the server.
   */
  private persist(map: Map<string, WorkspaceDefinition>): Promise<void> {
    // Chain writes so two concurrent persists never interleave their temp-write
    // + rename on the same target path. Each link snapshots the map AT WRITE
    // TIME, so the last write reflects the latest in-memory state.
    this.writeChain = this.writeChain.then(() => this.writeNow(map)).catch(() => {})
    return this.writeChain
  }

  private async writeNow(map: Map<string, WorkspaceDefinition>): Promise<void> {
    const obj = Object.fromEntries(map)
    const dir = dirname(this.path)
    try {
      await mkdir(dir, { recursive: true })
      const tmp = join(dir, `.workspaces.${randomUUID()}.tmp`)
      await writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8')
      await rename(tmp, this.path)
    } catch (err) {
      // Read-only FS, a parent that is a file, etc. Keep the in-memory map and
      // continue rather than crashing the server on a write failure.
      console.error('[workspaceStore] failed to persist workspaces:', (err as Error).message)
    }
  }

  /** A single workspace definition by id, or `undefined` when not present. */
  async getWorkspace(id: string): Promise<WorkspaceDefinition | undefined> {
    return (await this.ensureLoaded()).get(id)
  }

  /** Every workspace as a slim summary (no pane bodies). */
  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    const map = await this.ensureLoaded()
    return Array.from(map.values(), toSummary)
  }

  /**
   * Insert or replace a workspace by its `id`, then write through to disk.
   * Returns the stored definition. The caller (routes) owns id generation,
   * timestamps, and DTO validation.
   */
  async upsertWorkspace(def: WorkspaceDefinition): Promise<WorkspaceDefinition> {
    const map = await this.ensureLoaded()
    map.set(def.id, def)
    await this.persist(map)
    return def
  }

  /** Remove a workspace by id. Returns whether it existed. */
  async deleteWorkspace(id: string): Promise<boolean> {
    const map = await this.ensureLoaded()
    const existed = map.delete(id)
    if (existed) await this.persist(map)
    return existed
  }
}
