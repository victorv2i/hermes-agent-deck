import { Boxes, SquarePen, SunMoon, Trash2, type LucideIcon } from 'lucide-react'

/**
 * The composer's client-side slash-command registry. The gateway exposes NO
 * command set to the web app (verified in the build plan: the dashboard API has
 * no command registry and the run transport only knows run/resume/abort/
 * approval), so a leading `/` can only ever drive *UI* actions — never agent
 * commands. These commands are deliberately UI-scoped and mirror the ⌘K palette
 * + the global shortcut map, so the three surfaces agree.
 *
 * Each command names a UI action the Composer dispatches; an action is only
 * OFFERED when its handler is wired (e.g. `/clear` hides if the host passes no
 * `onClearChat`), so the menu never shows an inert row.
 */
export type SlashActionId = 'model' | 'new' | 'clear' | 'theme'

export interface SlashCommand {
  /** The action id the Composer dispatches. */
  id: SlashActionId
  /** The literal trigger, e.g. `/model` (always lowercase, no spaces). */
  command: string
  /** Short human label shown in the menu. */
  label: string
  /** One-line description of what running it does. */
  hint: string
  /** The command's glyph (Lucide line icon, per the design language). */
  icon: LucideIcon
  /** Extra match terms so e.g. `/clear` matches "reset". */
  keywords?: string[]
}

/** The full ordered command set (the menu filters this by the typed query). */
export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'model',
    command: '/model',
    label: 'Switch model',
    hint: 'Choose the model for the next run',
    icon: Boxes,
    keywords: ['model', 'switch', 'picker'],
  },
  {
    id: 'new',
    command: '/new',
    label: 'New chat',
    hint: 'Start a fresh conversation',
    icon: SquarePen,
    keywords: ['new', 'fresh', 'start'],
  },
  {
    id: 'clear',
    command: '/clear',
    label: 'Clear chat',
    hint: 'Clear the current conversation',
    icon: Trash2,
    keywords: ['clear', 'reset', 'empty'],
  },
  {
    id: 'theme',
    command: '/theme',
    label: 'Toggle theme',
    hint: 'Switch between dark and light',
    icon: SunMoon,
    keywords: ['theme', 'dark', 'light', 'appearance'],
  },
]

/**
 * Decide whether a composer value should open the slash menu, and with what
 * query. The menu opens only when the value is a single leading-`/` TOKEN (no
 * whitespace) — so a real message that merely starts with `/` (e.g. `/usr/bin`
 * followed by a space, or `/note to self`) is NEVER hijacked: as soon as a space
 * is typed the menu closes and the text sends verbatim.
 *
 * Returns the lowercased query AFTER the slash (so `/mo` → `mo`), or `null` when
 * the menu should be closed.
 */
export function slashQuery(value: string): string | null {
  if (!value.startsWith('/')) return null
  // Any whitespace means this is prose, not a command token.
  if (/\s/.test(value)) return null
  return value.slice(1).toLowerCase()
}

/**
 * Filter (and order) the command set for a given query. An empty query (just
 * `/`) lists every command; otherwise we keep commands whose command-name or
 * keywords contain the query, command-name matches ranked first.
 */
export function filterSlashCommands(query: string, commands = SLASH_COMMANDS): SlashCommand[] {
  const q = query.trim().toLowerCase()
  if (q === '') return commands
  const nameMatches: SlashCommand[] = []
  const keywordMatches: SlashCommand[] = []
  for (const cmd of commands) {
    // Match against the command WITHOUT its leading slash (so `mo` hits `/model`).
    if (cmd.command.slice(1).includes(q)) {
      nameMatches.push(cmd)
    } else if (cmd.keywords?.some((k) => k.includes(q))) {
      keywordMatches.push(cmd)
    }
  }
  return [...nameMatches, ...keywordMatches]
}
