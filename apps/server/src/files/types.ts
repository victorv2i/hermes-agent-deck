/**
 * Feature-local types for the Files BFF. Kept here (not in packages/protocol)
 * so this surface stays self-contained. The web feature
 * mirrors the wire shapes in its own `api.ts`.
 *
 * Shapes track the dashboard's `/api/workspace/*` payloads
 * (the stock Hermes dashboard contract + the retired overlay's
 * `workspace_browser.py` source), re-exposed under the BFF's own routes.
 */

/** A browsable workspace root (e.g. Hermes Home, Projects). */
export interface FileRoot {
  id: string
  label: string
  description: string
  /** Absolute on-disk path (server-side only; used to resolve writes). */
  path: string
  /** The dashboard reports its roots read-only; the BFF adds write itself. */
  readOnly: boolean
}

/** A single directory entry in a listing. */
export interface FileEntry {
  name: string
  /** Root-relative POSIX path. */
  path: string
  type: 'dir' | 'file'
  /** ISO timestamp, or null when unavailable/suppressed. */
  modified: string | null
  /** Byte size for files, null for dirs/suppressed. */
  size: number | null
  /** True when the entry is hidden from preview (secret / unsupported / binary). */
  suppressed: boolean
  /** Why it is suppressed (e.g. "secret", "unsupported_type", "too_large"). */
  reason: string | null
  /** Preview capability hint: "full" | "bounded" | "none" | null (dirs). */
  preview: string | null
}

/** A directory listing for one path under a root. */
export interface FileListing {
  root: string
  /** Root-relative POSIX path of this directory ("" = root). */
  path: string
  entries: FileEntry[]
  /** True when more entries existed than the cap returned. */
  truncated: boolean
}

/** A text file's decoded content + metadata. */
export interface FileContent {
  root: string
  path: string
  content: string
  encoding: string
  size: number
  modified: string | null
  mime: string
  /** "full" | "head" | "tail" — how the content was read. */
  previewMode: string
  truncated: boolean
  /**
   * True when the file is BINARY (NUL / high non-printable ratio in the head).
   * Binary files carry NO decoded `content` (it would be mojibake) — the client
   * shows an honest "binary file" state and gates Edit (a Save would clobber it).
   */
  binary: boolean
}

/** Result of a write/create/rename/delete mutation. */
export interface FileMutationResult {
  root: string
  path: string
  /** Fresh size after a write (bytes), when applicable. */
  size?: number
  /** Fresh modified timestamp (ISO), when applicable. */
  modified?: string | null
}
