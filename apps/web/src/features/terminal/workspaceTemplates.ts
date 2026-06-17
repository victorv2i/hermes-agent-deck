import type { CliId, WorkspacePaneDefinition } from '@agent-deck/protocol'

/**
 * Workspace templates — preset pane layouts a new workspace can start from, so a
 * common setup (Hermes + Claude Code side by side, three shells, a build+watch
 * pair) is one click instead of hand-adding panes. Each template is a pure
 * blueprint; instantiating it mints fresh, collision-free pane ids so two
 * workspaces from the same template never share an id.
 *
 * User-defined templates ride the SAME pane shape: a workspace exported to JSON
 * (see {@link ./workspaceJson}) is a portable template a user can re-import.
 */

export interface WorkspaceTemplate {
  /** Stable template id (the picker's value). */
  id: string
  /** Human label shown in the picker. */
  label: string
  /** One-line description of the layout. */
  description: string
  /** The panes, as (cli, label) blueprints; ids are minted at instantiation. */
  panes: ReadonlyArray<{ cli: CliId; label: string }>
}

/** The built-in templates, in picker order. "Blank" is the calm default. */
export const WORKSPACE_TEMPLATES: readonly WorkspaceTemplate[] = [
  {
    id: 'blank',
    label: 'Blank',
    description: 'One shell to start; add panes any time.',
    panes: [{ cli: 'shell', label: 'Shell 1' }],
  },
  {
    id: 'hermes-claude',
    label: 'Hermes + Claude Code',
    description: 'Your Hermes agent and Claude Code, side by side.',
    panes: [
      { cli: 'hermes', label: 'Hermes' },
      { cli: 'claude', label: 'Claude Code' },
    ],
  },
  {
    id: 'three-shells',
    label: 'Three shells',
    description: 'Three plain shells for a build / run / logs split.',
    panes: [
      { cli: 'shell', label: 'Shell 1' },
      { cli: 'shell', label: 'Shell 2' },
      { cli: 'shell', label: 'Shell 3' },
    ],
  },
  {
    id: 'build-watch',
    label: 'Build + watch',
    description: 'A working shell plus a dedicated watch pane.',
    panes: [
      { cli: 'shell', label: 'Build' },
      { cli: 'shell', label: 'Watch' },
    ],
  },
] as const

export function findTemplate(id: string): WorkspaceTemplate | undefined {
  return WORKSPACE_TEMPLATES.find((t) => t.id === id)
}

/** A short arg/tmux-safe random suffix for a minted pane id. */
function defaultSuffix(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * Instantiate a template into concrete pane definitions with fresh, unique,
 * arg-safe ids (`<cli>-<n>-<suffix>`). `suffixFor` is injectable for deterministic
 * tests. Returns `[]` for an unknown template id (the caller falls back to blank).
 */
export function instantiateTemplate(
  id: string,
  suffixFor: (index: number) => string = defaultSuffix,
): WorkspacePaneDefinition[] {
  const template = findTemplate(id)
  if (!template) return []
  return template.panes.map((pane, index) => ({
    id: `${pane.cli}-${index + 1}-${suffixFor(index)}`,
    label: pane.label,
    cli: pane.cli,
  }))
}
