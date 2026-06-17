import {
  CreateWorkspaceRequestSchema,
  WorkspacePaneDefinitionSchema,
  type CreateWorkspaceRequest,
  type WorkspaceDefinition,
  type WorkspacePaneDefinition,
} from '@agent-deck/protocol'

/**
 * Workspace import/export as JSON — a workspace is a portable, user-defined
 * template. Export strips the server-owned fields (id, timestamps), keeping the
 * shareable shape (name + panes, with each pane's id/label/cli/cwd). Import
 * validates that shape with the PROTOCOL schemas (the single source of truth — no
 * second schema to drift) and re-mints pane ids so an imported template never
 * collides with an existing pane.
 */

/** The portable, shareable shape (no server-owned id / timestamps). */
export interface WorkspaceTemplateFile {
  /** Marks the file kind so a stray JSON isn't mistaken for a template. */
  kind?: 'agentdeck.workspace-template'
  name: string
  description?: string
  panes: WorkspacePaneDefinition[]
}

/** Serialize a workspace definition to a portable template object. */
export function workspaceToTemplate(def: WorkspaceDefinition): WorkspaceTemplateFile {
  return {
    kind: 'agentdeck.workspace-template',
    name: def.name,
    ...(def.description !== undefined ? { description: def.description } : {}),
    panes: def.panes,
  }
}

/** Pretty JSON for a download. */
export function serializeWorkspaceTemplate(def: WorkspaceDefinition): string {
  return JSON.stringify(workspaceToTemplate(def), null, 2)
}

/** A filesystem-safe download filename for a workspace template. */
export function templateFileName(name: string): string {
  const slug = name
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return `${slug || 'workspace'}.agentdeck-workspace.json`
}

/** Trigger a browser download of a workspace as a portable template JSON. No-op
 * in a non-DOM context (SSR / tests without a document). */
export function downloadWorkspaceTemplate(def: WorkspaceDefinition): void {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return
  const blob = new Blob([serializeWorkspaceTemplate(def)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = templateFileName(def.name)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** A short arg/tmux-safe suffix for a re-minted pane id. */
function suffix(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * Parse + validate a template JSON string into a create request, re-minting pane
 * ids (so importing the same template twice never collides). Validation rides the
 * protocol schemas. Throws a clear Error on malformed JSON or an invalid shape.
 */
export function parseWorkspaceTemplate(
  json: string,
  mintSuffix: (index: number) => string = suffix,
): CreateWorkspaceRequest {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('That JSON is not a valid workspace template.')
  }
  const obj = raw as Record<string, unknown>
  const rawPanes = Array.isArray(obj.panes) ? obj.panes : []

  // Validate each pane through the protocol schema, then re-mint a fresh id.
  const panes: WorkspacePaneDefinition[] = rawPanes.map((pane, index) => {
    const parsed = WorkspacePaneDefinitionSchema.safeParse(pane)
    if (!parsed.success) {
      throw new Error('That JSON is not a valid workspace template.')
    }
    return { ...parsed.data, id: `${parsed.data.cli ?? 'shell'}-${index + 1}-${mintSuffix(index)}` }
  })

  // Final validation of the assembled request (name length, pane shape, etc.).
  const req = CreateWorkspaceRequestSchema.safeParse({
    name: obj.name,
    ...(typeof obj.description === 'string' ? { description: obj.description } : {}),
    panes,
  })
  if (!req.success) {
    throw new Error('That JSON is not a valid workspace template.')
  }
  return req.data
}
