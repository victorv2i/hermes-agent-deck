import { z } from 'zod'

/**
 * Organization DTOs — Agent Deck's OWN project/tag metadata layer over the
 * read-only hermes session list. The dashboard's sessions carry no project/tag
 * fields, so this data lives in agent-deck's own server-side JSON store
 * (`<HERMES_HOME>/agent-deck/organization.json`) and syncs across the user's
 * devices (they drive the one `:7878` over Tailscale).
 *
 * Data model:
 *   - `projects: { id, name, color }[]` — a named, colored group. `color` is an
 *     opaque token id from the web's curated CATEGORICAL palette (the design
 *     language's allowed data-grouping exception, NOT the amber action accent);
 *     the server stores it verbatim and does not interpret it.
 *   - `assignments: { [sessionId]: { projectId?, tags? } }` — a session belongs
 *     to at most one project and has zero or more tags. A session id that no
 *     longer exists is simply ignored on read (advisory metadata; no orphan
 *     cleanup).
 *
 * SECURITY: nothing here is filesystem-shaped — the store path never appears in
 * any payload. Inputs are validated through these schemas; `parse()` drops
 * unknown keys so a client cannot smuggle extra fields into the store.
 */

/** Cap a project name to a sane length so the store stays bounded. */
const PROJECT_NAME_MAX = 80
/** Cap a single tag's length (post-normalization). */
export const TAG_MAX_LENGTH = 40
/** Cap how many tags a single session may carry. */
export const TAGS_MAX_COUNT = 30

/** A named, colored project group. */
export const Project = z.object({
  /** Stable, server-assigned id. */
  id: z.string().min(1),
  /** Display name (trimmed, non-empty). */
  name: z.string().min(1).max(PROJECT_NAME_MAX),
  /** Opaque categorical-palette token id (e.g. `teal`); stored verbatim. */
  color: z.string().min(1).max(40),
})
export type Project = z.infer<typeof Project>

/** A single session's organization metadata (project membership + tags). */
export const SessionAssignment = z.object({
  /** The project this session belongs to, if any. */
  projectId: z.string().min(1).optional(),
  /** Normalized tags (trimmed, lowercased, deduped) on this session. */
  tags: z.array(z.string()).optional(),
})
export type SessionAssignment = z.infer<typeof SessionAssignment>

/** The full organization store as surfaced by `GET /api/agent-deck/organization`. */
export const Organization = z.object({
  /** Every project, in creation order. */
  projects: z.array(Project),
  /** Per-session assignment metadata, keyed by session id. */
  assignments: z.record(z.string(), SessionAssignment),
})
export type Organization = z.infer<typeof Organization>

/** Request body for `POST /api/agent-deck/projects` (create). */
export const ProjectCreateInput = z.object({
  /** Display name — required, trimmed by the server before validation. */
  name: z.string().trim().min(1, 'A project name is required').max(PROJECT_NAME_MAX),
  /** Categorical-palette token id. */
  color: z.string().trim().min(1, 'A project color is required').max(40),
})
export type ProjectCreateInput = z.infer<typeof ProjectCreateInput>

/**
 * Request body for `PATCH /api/agent-deck/projects/:id` (rename/recolor). Both
 * fields optional so a caller can change just one; at least one is required.
 */
export const ProjectUpdateInput = z
  .object({
    name: z.string().trim().min(1).max(PROJECT_NAME_MAX).optional(),
    color: z.string().trim().min(1).max(40).optional(),
  })
  .refine((v) => v.name !== undefined || v.color !== undefined, {
    message: 'Provide a name or a color to update',
  })
export type ProjectUpdateInput = z.infer<typeof ProjectUpdateInput>

/**
 * Request body for `PUT /api/agent-deck/sessions/:id/organization`. `projectId`
 * is `string | null` (null clears the project); `tags` is the FULL desired set
 * (the server normalizes: trim, lowercase, dedupe, drop empties, cap length +
 * count). Raw tag strings come in un-normalized; normalization is the server's
 * job so the stored shape is canonical.
 */
export const SessionOrganizationInput = z.object({
  /** New project membership: a project id, or `null` to clear. */
  projectId: z.string().min(1).nullable(),
  /** The full desired tag set (normalized server-side). */
  tags: z.array(z.string()),
})
export type SessionOrganizationInput = z.infer<typeof SessionOrganizationInput>
