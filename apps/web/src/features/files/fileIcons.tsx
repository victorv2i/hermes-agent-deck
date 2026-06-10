/**
 * File-type iconography for the Files surface.
 *
 * Folders and files should never read as a uniform wall of one hue. We map an
 * entry to a Lucide LINE icon + a *kind* color drawn from the governed semantic
 * palette (neutral / success / warning), so the eye can group by type at a
 * glance. The action accent (`--primary`) stays reserved for active/selected
 * state — no kind tint may be a near-primary blue, or a code file would read as
 * "selected."
 *
 * Colors are intentionally muted token classes — they distinguish kinds quietly,
 * they are not status signals.
 */
import {
  Braces,
  Database,
  File as FileIcon,
  FileArchive,
  FileChartColumn,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  Folder,
  type LucideIcon,
} from 'lucide-react'
import { extensionOf } from './api'

export interface FileGlyph {
  Icon: LucideIcon
  /** Tailwind text-color class for the icon (kind tint, never the action accent). */
  colorClass: string
}

// Folders read in a calm neutral-secondary — present but not competing with the
// active state. (The `--primary` accent is reserved for the *selected* row.)
const FOLDER_GLYPH: FileGlyph = { Icon: Folder, colorClass: 'text-muted-foreground' }
const DEFAULT_GLYPH: FileGlyph = { Icon: FileIcon, colorClass: 'text-foreground-tertiary' }

// Extension → glyph. Grouped by kind so related types share a tint:
//   code        → calm neutral    (.ts/.js/.py/.go/.rs/… — a quiet kind-marker)
//   data/config → success teal    (.json/.yaml/.toml/.env-like configs)
//   markup/docs → muted neutral   (.md/.txt/.rst)
//   media       → warning         (.png/.svg/.mp4 — distinct from the accent)
// Data + media are the two tints that "pop"; code and docs read as calm neutrals
// at the filename's own brightness so an icon never out-shouts the name beside it
// (code dominates a working dir — a column of loud icons would be a uniform wall).
// CODE deliberately avoids any blue: `--info` (#6ba8d9) sits a hair from the
// default Clay&Sky `--primary` (#7ba7d9), so a blue code icon read as the
// active/selected accent.
const CODE = 'text-muted-foreground'
const DATA = 'text-success'
const DOCS = 'text-muted-foreground'
const MEDIA = 'text-warning'

const EXT_GLYPH: Record<string, FileGlyph> = {}
function register(exts: string[], Icon: LucideIcon, colorClass: string) {
  for (const ext of exts) EXT_GLYPH[ext] = { Icon, colorClass }
}

register(
  [
    'ts',
    'tsx',
    'js',
    'jsx',
    'mjs',
    'cjs',
    'go',
    'rs',
    'py',
    'rb',
    'java',
    'c',
    'cc',
    'cpp',
    'h',
    'hpp',
    'cs',
    'php',
    'swift',
    'kt',
    'scala',
    'lua',
    'dart',
    'vue',
    'svelte',
  ],
  FileCode,
  CODE,
)
register(['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd'], FileTerminal, CODE)
register(['json', 'jsonc', 'json5'], FileJson, DATA)
register(['yaml', 'yml', 'toml', 'xml', 'csv'], Braces, DATA)
register(
  ['ini', 'cfg', 'conf', 'config', 'env', 'lock', 'gitignore', 'dockerignore', 'editorconfig'],
  FileCog,
  DATA,
)
register(['sql', 'db', 'sqlite', 'prisma'], Database, DATA)
register(['xls', 'xlsx', 'tsv'], FileSpreadsheet, DATA)
register(['csv'], FileChartColumn, DATA)
register(['md', 'markdown', 'mdx', 'rst', 'adoc'], FileType, DOCS)
register(['txt', 'text', 'log', 'pdf', 'doc', 'docx', 'rtf'], FileText, DOCS)
register(
  [
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'svg',
    'avif',
    'bmp',
    'ico',
    'mp4',
    'mov',
    'webm',
    'mp3',
    'wav',
  ],
  FileImage,
  MEDIA,
)
register(['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'xz'], FileArchive, MEDIA)

/**
 * Resolve the glyph (icon + kind tint) for an entry.
 * - directories → calm folder glyph
 * - suppressed (secret/restricted) → a lock glyph (caller may override color)
 * - otherwise → extension-keyed glyph, falling back to a generic file
 */
export function glyphFor(opts: {
  type: 'dir' | 'file'
  name: string
  suppressed?: boolean
}): FileGlyph {
  if (opts.type === 'dir') return FOLDER_GLYPH
  if (opts.suppressed) return { Icon: FileLock, colorClass: 'text-foreground-tertiary' }
  const ext = extensionOf(opts.name)
  return EXT_GLYPH[ext] ?? DEFAULT_GLYPH
}
