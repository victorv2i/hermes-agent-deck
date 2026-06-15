/**
 * Workspace REST route plugin - the CRUD + cwd-picker surface for named,
 * server-persisted terminal workspaces. Mirrors `terminalRoutes.ts` (a Fastify
 * plugin mounted at base `/api/agent-deck/terminal`):
 *
 *   POST   /workspaces        → create (Zod-validated) → WorkspaceDefinition
 *   GET    /workspaces        → ListWorkspacesResponse (slim summaries)
 *   GET    /workspaces/:id    → WorkspaceDefinition (404 if missing)
 *   PATCH  /workspaces/:id    → update name/description/panes (404 if missing)
 *   DELETE /workspaces/:id    → { success: true }
 *   GET    /roots             → RootsResponse (allowlisted picker start dirs)
 *   GET    /dirs?path=<dir>   → DirListResponse (immediate subdirs; HARDENED)
 *
 * The full workspace DEFINITION lives in {@link WorkspaceStore} (write-through to
 * `~/.agent-deck/workspaces.json`); running pty/tmux continuity is the terminal
 * namespace's job via deterministic `sessionId`s and is NOT part of this surface.
 *
 * SECURITY (non-negotiable, from research):
 *  - The cwd picker `/dirs` and ANY `cwd` accepted into a pane are validated by
 *    {@link resolveDirInsideRoots}: `path.resolve` → `fs.promises.realpath` →
 *    a containment check against the allowlisted roots, comparing on a `/`
 *    boundary so `/Projects` cannot match a sibling `/Projects-evil`. We REJECT
 *    (400), never clamp, on traversal / symlink-escape / out-of-allowlist.
 *  - The allowlist is exactly the roots the terminal cwd gate already uses (the
 *    Files service roots), plus `$HOME` only when the operator opted in via
 *    AGENT_DECK_TERMINAL_ALLOW_HOME - so this never widens what dirs are reachable.
 *  - Workspace + pane ids are constrained to a process-arg/tmux-safe charset by
 *    the protocol DTOs before they reach the store (and later a process arg).
 *  - All filesystem access here is read-only directory listing via argv-based
 *    Node fs calls; this plugin never builds a shell string.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify'
import { readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve, sep } from 'node:path'
import {
  CreateWorkspaceRequestSchema,
  UpdateWorkspaceRequestSchema,
  type DirEntry,
  type DirListResponse,
  type ListWorkspacesResponse,
  type RootsResponse,
  type WorkspaceDefinition,
  type WorkspaceRoot,
} from '@agent-deck/protocol'
import { isPathInsideRoot } from '../files/pathGuard'
import { WorkspaceStore, generateWorkspaceId } from './workspaceStore'

export interface WorkspaceRoutesOptions extends FastifyPluginOptions {
  /** The persistence store. Injectable for hermetic tests. */
  store: WorkspaceStore
  /**
   * Resolver for the allowlisted picker roots (name + absolute path). Wired to
   * the Files service roots by the integrator so it consults the SAME derived
   * workspace roots the terminal cwd gate uses; injectable for tests.
   */
  roots: () => Promise<WorkspaceRoot[]>
  /**
   * Permit `$HOME` as an additional root + cwd (operator opt-in, mirrors
   * `resolveCwd`'s `allowHome`, AGENT_DECK_TERMINAL_ALLOW_HOME=1). Default false.
   */
  allowHome?: boolean
  /** The home dir used for the `$HOME` opt-in. Injectable for tests. */
  home?: string
}

/** Thrown when a requested cwd/dir fails the realpath + containment guard. */
class CwdRejectedError extends Error {
  constructor(message = 'path is outside the allowlisted workspace roots') {
    super(message)
    this.name = 'CwdRejectedError'
  }
}

/** A safe, content-free error body (no internals; mirrors the house pattern). */
interface ErrorReply {
  error: string
  message: string
}

/**
 * The effective allowlist of root paths: the injected roots, plus `$HOME` when
 * the operator opted in. Mirrors `resolveCwd(requested, roots, home, allowHome)`
 * so the picker can reach exactly what a pane shell could be anchored in.
 */
function allowlistPaths(roots: WorkspaceRoot[], home: string, allowHome: boolean): string[] {
  const paths = roots.map((r) => r.path).filter((p) => typeof p === 'string' && p !== '')
  if (allowHome && home) paths.push(home)
  return paths
}

/**
 * Resolve a requested directory to its REAL absolute path, asserting it stays
 * inside one of the allowlisted roots once symlinks are followed. The defense:
 *  1. `path.resolve(input)` - collapse `.`/`..`, make absolute.
 *  2. `fs.promises.realpath` - follow every symlink to the on-disk truth (also
 *     proves the dir EXISTS; a missing path throws → rejected, not 500).
 *  3. realpath each allowlisted root too, then a `/`-boundary containment check
 *     (via {@link isPathInsideRoot}) so a sibling prefix like `Projects-evil`
 *     is NOT accepted as inside `Projects`.
 * Throws {@link CwdRejectedError} on any failure - we REJECT, never clamp.
 */
async function resolveDirInsideRoots(input: string, allowRoots: string[]): Promise<string> {
  if (allowRoots.length === 0) throw new CwdRejectedError('no workspace roots are configured')
  let realTarget: string
  try {
    realTarget = await realpath(resolve(input))
  } catch {
    // Does not exist / unreadable / a broken symlink - reject, do not 500.
    throw new CwdRejectedError()
  }
  for (const root of allowRoots) {
    let realRoot: string
    try {
      realRoot = await realpath(root)
    } catch {
      continue // a configured root that no longer resolves can't contain anything
    }
    if (isPathInsideRoot(realRoot, realTarget)) return realTarget
  }
  throw new CwdRejectedError()
}

/** Is `p` one of the allowlisted roots (after realpath)? Used to omit `parent`. */
async function isRoot(p: string, allowRoots: string[]): Promise<boolean> {
  for (const root of allowRoots) {
    try {
      if ((await realpath(root)) === p) return true
    } catch {
      // ignore an unresolvable root
    }
  }
  return false
}

/**
 * Fastify plugin exposing the workspace CRUD + cwd picker. Register with a prefix:
 *   app.register(workspaceRoutes, { prefix: '/api/agent-deck/terminal', store, roots })
 */
export async function workspaceRoutes(
  app: FastifyInstance,
  options: WorkspaceRoutesOptions,
): Promise<void> {
  const { store, roots } = options
  const home = options.home ?? homedir()
  const allowHome = options.allowHome ?? false
  const effectiveRoots = async (): Promise<string[]> =>
    allowlistPaths(await roots(), home, allowHome)

  // --- CRUD ---

  app.post('/workspaces', async (request, reply): Promise<WorkspaceDefinition | ErrorReply> => {
    const parsed = CreateWorkspaceRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'invalid_request', message: 'invalid workspace' }
    }
    const panes = parsed.data.panes ?? []
    // Every pane cwd (when set) must sit inside the allowlist - reject otherwise.
    try {
      await assertPaneCwds(panes, effectiveRoots)
    } catch {
      reply.code(400)
      return { error: 'invalid_cwd', message: 'pane cwd is not allowed' }
    }
    const now = new Date().toISOString()
    const def: WorkspaceDefinition = {
      id: generateWorkspaceId(),
      name: parsed.data.name,
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      panes,
      createdAt: now,
      lastModifiedAt: now,
    }
    return store.upsertWorkspace(def)
  })

  app.get('/workspaces', async (): Promise<ListWorkspacesResponse> => {
    return { workspaces: await store.listWorkspaces() }
  })

  app.get<{ Params: { id: string } }>(
    '/workspaces/:id',
    async (request, reply): Promise<WorkspaceDefinition | ErrorReply> => {
      const def = await store.getWorkspace(request.params.id)
      if (!def) {
        reply.code(404)
        return { error: 'not_found', message: 'workspace not found' }
      }
      return def
    },
  )

  app.patch<{ Params: { id: string } }>(
    '/workspaces/:id',
    async (request, reply): Promise<WorkspaceDefinition | ErrorReply> => {
      const parsed = UpdateWorkspaceRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.code(400)
        return { error: 'invalid_request', message: 'invalid update' }
      }
      const existing = await store.getWorkspace(request.params.id)
      if (!existing) {
        reply.code(404)
        return { error: 'not_found', message: 'workspace not found' }
      }
      if (parsed.data.panes) {
        try {
          await assertPaneCwds(parsed.data.panes, effectiveRoots)
        } catch {
          reply.code(400)
          return { error: 'invalid_cwd', message: 'pane cwd is not allowed' }
        }
      }
      const updated: WorkspaceDefinition = {
        ...existing,
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.panes !== undefined ? { panes: parsed.data.panes } : {}),
        lastModifiedAt: new Date().toISOString(),
      }
      return store.upsertWorkspace(updated)
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/workspaces/:id',
    async (request): Promise<{ success: true }> => {
      await store.deleteWorkspace(request.params.id)
      return { success: true }
    },
  )

  // --- cwd picker ---

  app.get('/roots', async (): Promise<RootsResponse> => {
    const list = await roots()
    const out: WorkspaceRoot[] = list
      .filter((r) => typeof r.path === 'string' && r.path !== '')
      .map((r) => ({ name: r.name, path: r.path }))
    if (allowHome && home) {
      // Surface $HOME as a real, realpath'd root so the picker can start there.
      let realHome = home
      try {
        realHome = await realpath(home)
      } catch {
        // home didn't resolve - fall back to the configured path
      }
      if (!out.some((r) => r.path === realHome)) out.push({ name: 'Home', path: realHome })
    }
    return { roots: out }
  })

  app.get<{ Querystring: { path?: string } }>(
    '/dirs',
    async (request, reply): Promise<DirListResponse | ErrorReply> => {
      const allowRoots = await effectiveRoots()
      // No path → default to the first allowlisted root (so the picker opens
      // somewhere safe). With no roots at all there is nowhere safe → 400.
      const requested = request.query.path ?? allowRoots[0]
      if (!requested) {
        reply.code(400)
        return { error: 'invalid_cwd', message: 'no workspace roots are configured' }
      }
      let real: string
      try {
        real = await resolveDirInsideRoots(requested, allowRoots)
      } catch {
        reply.code(400)
        return { error: 'invalid_cwd', message: 'path is not an allowed directory' }
      }
      let dirents
      try {
        dirents = await readdir(real, { withFileTypes: true })
      } catch {
        reply.code(400)
        return { error: 'invalid_cwd', message: 'directory could not be read' }
      }
      const entries: DirEntry[] = dirents
        .filter((d) => d.isDirectory())
        .map((d) => ({ name: d.name, path: `${real}${sep}${d.name}` }))
        .sort((a, b) => a.name.localeCompare(b.name))
      // Offer "up one level" only when the listed dir is NOT itself a root and the
      // parent is still inside the allowlist (so the picker can't climb out).
      let parent: string | undefined
      if (!(await isRoot(real, allowRoots))) {
        const up = dirname(real)
        try {
          parent = await resolveDirInsideRoots(up, allowRoots)
        } catch {
          parent = undefined
        }
      }
      return { path: real, ...(parent !== undefined ? { parent } : {}), entries }
    },
  )
}

/**
 * Assert every pane `cwd` (panes without a cwd are fine - the namespace falls
 * back to a root) resolves inside the allowlist. Throws on the first rejection.
 */
async function assertPaneCwds(
  panes: { cwd?: string }[],
  effectiveRoots: () => Promise<string[]>,
): Promise<void> {
  const cwds = panes.map((p) => p.cwd).filter((c): c is string => typeof c === 'string' && c !== '')
  if (cwds.length === 0) return
  const allowRoots = await effectiveRoots()
  for (const cwd of cwds) {
    await resolveDirInsideRoots(cwd, allowRoots)
  }
}

export default workspaceRoutes
