import { z } from 'zod'

/**
 * Terminal workspace DTOs — the REST contract for named, server-persisted,
 * cross-device terminal workspaces (`/api/agent-deck/terminal/workspaces`).
 *
 * A workspace is a freeform grid of panes; each pane runs a chosen CLI in a
 * chosen working directory. The server is the source of truth for these
 * DEFINITIONS (persisted to `~/.agent-deck/workspaces.json`); running pty/tmux
 * continuity is handled by the existing terminal namespace via deterministic
 * `sessionId`s and is NOT part of this contract.
 *
 * SECURITY: pane `id`s are constrained to a tmux/process-arg-safe charset, the
 * `name` is length-bounded, and unknown CLIs are rejected — so nothing here can
 * reach a process arg or tmux target unvalidated. Pane `cwd` is a plain string
 * here; it is realpath + allowlist-validated server-side before any launch.
 */

/**
 * The launcher CLI a pane runs — kept in lockstep with the server's
 * `cliDetector.ts` `CliId` (the four presets the OSS default ships). `attach`
 * (a foreign tmux session) is mutually exclusive with `cli`, same as today.
 */
export const CliIdSchema = z.enum(['hermes', 'claude', 'codex', 'shell'])
export type CliId = z.infer<typeof CliIdSchema>

/** Pane id charset: safe to reach a process arg or a tmux target unescaped. */
const PANE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** A workspace name: required, length-bounded so it stays a sane label. */
const WorkspaceNameSchema = z.string().min(1).max(80)

/**
 * One pane in a workspace's freeform grid. Panes are independent: each carries
 * its own `cli` and `cwd`. `attach` names a foreign tmux session and is
 * mutually exclusive with `cli`, mirroring the existing single-terminal launch.
 */
export const WorkspacePaneDefinitionSchema = z.object({
  /** Stable pane id (deterministic-sessionId input); tmux/arg-safe charset. */
  id: z.string().regex(PANE_ID_PATTERN),
  /** Human label shown in the pane header / tab. */
  label: z.string(),
  /** The launcher CLI; absent when the pane attaches a foreign tmux session. */
  cli: CliIdSchema.optional(),
  /** Working directory the pane launches in (server-validated before use). */
  cwd: z.string().optional(),
  /** A foreign tmux session to attach; mutually exclusive with `cli`. */
  attach: z.string().optional(),
})
export type WorkspacePaneDefinition = z.infer<typeof WorkspacePaneDefinitionSchema>

/**
 * A full workspace definition as stored server-side and returned by the
 * create / get / update routes. `createdAt` / `lastModifiedAt` are ISO-8601.
 */
export const WorkspaceDefinitionSchema = z.object({
  /** Server-generated stable id; same tmux/arg-safe charset as a pane id. */
  id: z.string().regex(PANE_ID_PATTERN),
  name: WorkspaceNameSchema,
  description: z.string().optional(),
  panes: z.array(WorkspacePaneDefinitionSchema),
  /** ISO-8601 creation timestamp. */
  createdAt: z.string(),
  /** ISO-8601 last-modified timestamp. */
  lastModifiedAt: z.string(),
})
export type WorkspaceDefinition = z.infer<typeof WorkspaceDefinitionSchema>

/**
 * The slim list-view of a workspace (no pane bodies) returned by
 * `GET /workspaces`, so the picker can render cards without the full grid.
 */
export const WorkspaceSummarySchema = z.object({
  id: z.string(),
  name: WorkspaceNameSchema,
  description: z.string().optional(),
  /** Number of panes in the workspace. */
  paneCount: z.number().int().min(0),
  /** ISO-8601 creation timestamp. */
  createdAt: z.string(),
  /** ISO-8601 last-modified timestamp. */
  lastModifiedAt: z.string(),
})
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>

/**
 * Body of `POST /workspaces`. `panes` is optional — a workspace can be created
 * empty and have panes added later.
 */
export const CreateWorkspaceRequestSchema = z.object({
  name: WorkspaceNameSchema,
  description: z.string().optional(),
  panes: z.array(WorkspacePaneDefinitionSchema).optional(),
})
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequestSchema>

/**
 * Body of `PATCH /workspaces/:id`. Every field is optional; only the provided
 * fields are updated. A provided `panes` replaces the whole pane set.
 */
export const UpdateWorkspaceRequestSchema = z.object({
  name: WorkspaceNameSchema.optional(),
  description: z.string().optional(),
  panes: z.array(WorkspacePaneDefinitionSchema).optional(),
})
export type UpdateWorkspaceRequest = z.infer<typeof UpdateWorkspaceRequestSchema>

/** Response of `GET /workspaces`. */
export const ListWorkspacesResponseSchema = z.object({
  workspaces: z.array(WorkspaceSummarySchema),
})
export type ListWorkspacesResponse = z.infer<typeof ListWorkspacesResponseSchema>

/** A single directory entry (name + absolute path) for the cwd picker. */
export const DirEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
})
export type DirEntry = z.infer<typeof DirEntrySchema>

/**
 * Response of `GET /dirs?path=<dir>` — the immediate subdirectories of an
 * allowlisted `<dir>`, plus the parent for "up one level" (absent at a root).
 */
export const DirListResponseSchema = z.object({
  /** The (validated, realpath'd) directory that was listed. */
  path: z.string(),
  /** The parent directory, or absent when `path` is an allowlist root. */
  parent: z.string().optional(),
  entries: z.array(DirEntrySchema),
})
export type DirListResponse = z.infer<typeof DirListResponseSchema>

/** A starting root the cwd picker may begin from (name + absolute path). */
export const WorkspaceRootSchema = z.object({
  name: z.string(),
  path: z.string(),
})
export type WorkspaceRoot = z.infer<typeof WorkspaceRootSchema>

/** Response of `GET /roots` — the allowlisted root dirs the cwd picker starts from. */
export const RootsResponseSchema = z.object({
  roots: z.array(WorkspaceRootSchema),
})
export type RootsResponse = z.infer<typeof RootsResponseSchema>
