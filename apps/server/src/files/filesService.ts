/**
 * FilesService — the Files BFF's data layer.
 *
 * STOCK hermes v0.15.2 exposes NO workspace API (the retired dashboard
 * overlay's `/api/workspace/{roots,tree,file}` do not exist). So the BFF derives
 * the workspace roots PORTABLY and reads the filesystem itself:
 *
 *   ROOTS  — `GET /api/status` returns `hermes_home`; the BFF (which has fs
 *            access) enumerates `${hermes_home}/workspace` (the default profile)
 *            plus `${hermes_home}/profiles/<name>/workspace` (named profiles, per
 *            hermes_cli/profiles.py). Returns `[]` (never crashes) when none.
 *   READS  — `listDirectory` / `readFile` / `readRaw` are direct BFF-local fs
 *            reads, each path resolved through the {@link resolveInsideRoot}
 *            lexical guard AND the {@link assertRealpathInsideRoot} symlink
 *            re-assertion BEFORE the fs call, so a symlink inside a root cannot
 *            escape it. Sensitive files (.env / auth.json / config.* / …) stay
 *            blocked for read.
 *   WRITES — ENABLED inside the genuine WORK roots (playgrounds, terminal.cwd,
 *            workspace, named-profile workspaces): `readOnly: false`. The
 *            write/create/rename/delete ops resolve every path through the same
 *            two-layer path-guard the reads use (lexical containment + symlink
 *            realpath re-assertion + the sensitive-file denylist), so a write
 *            cannot escape its root or touch a credential file. The `home` root
 *            (hermes_home itself — which holds config.yaml/auth.json/profiles)
 *            stays `readOnly: true`: broad writes there are refused even though
 *            the guard already blocks the individual sensitive files.
 *
 * A test seam ({@link FilesService.setRootResolver}) lets a suite target a temp
 * dir without the dashboard.
 *
 * SECURITY: the dashboard session token never leaves the server; sensitive files
 * are blocked by the guard before any fs call.
 */
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
  access,
  open,
} from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { parse as parseYaml } from 'yaml'
import type { DashboardClient } from '../hermes/dashboardClient'
import { resolveInsideRoot, assertRealpathInsideRoot, isSensitivePath } from './pathGuard'
import type { FileContent, FileEntry, FileListing, FileMutationResult, FileRoot } from './types'

export class FilesServiceError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'conflict' | 'invalid' | 'read_only' = 'invalid',
  ) {
    super(message)
    this.name = 'FilesServiceError'
  }
}

type RootResolver = (id: string) => Promise<FileRoot | null>

/** Image extensions the BFF will stream for the `<img>` preview, mapped to MIME. */
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
}

/** Cap raw image previews so a huge file can't exhaust memory. */
const MAX_RAW_BYTES = 16 * 1024 * 1024

/** Cap a guarded download so a huge file can't exhaust server memory. */
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024

/** Cap a text-file read so a giant file can't exhaust memory. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024

/** Cap directory entries returned in one listing (the rest is `truncated`). */
const MAX_DIR_ENTRIES = 1000

/** A small text/code extension → MIME map for the read preview. Falls back to
 * `text/plain` for anything else readable. */
const TEXT_CONTENT_TYPES: Record<string, string> = {
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/plain',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.jsx': 'text/javascript',
  '.py': 'text/x-python',
  '.sh': 'text/x-shellscript',
  '.xml': 'text/xml',
}

/** Best-effort MIME for a file read, from its extension. */
function mimeForExt(name: string): string {
  const ext = extname(name).toLowerCase()
  return IMAGE_CONTENT_TYPES[ext] ?? TEXT_CONTENT_TYPES[ext] ?? 'text/plain'
}

/**
 * Is this root the Hermes credential home (`~/.hermes`)? Only that root exposes
 * `config.yaml` / `profiles/<name>/config.yaml`, where the runtime-config family
 * holds live provider credentials — so only there is that family path-guarded as
 * sensitive (everywhere else, `config.json`/`settings.json` are ordinary project
 * files). Keyed on the stable derived root id from {@link FilesService.listRoots}.
 */
function isHermesHomeRoot(root: FileRoot): boolean {
  return root.id === 'home'
}

/** Head size sniffed to decide if a file is binary (NUL / non-printable bytes). */
const BINARY_SNIFF_BYTES = 4096

/**
 * Is this byte slice (a file's head) BINARY rather than decodable text?
 *
 * A `slice.toString('utf8')` on a binary file produces mojibake (and, worse,
 * offers Edit → saving destroys it). We sniff the head exactly like git does:
 *  - ANY NUL byte ⇒ binary (the strongest, near-zero-false-positive signal).
 *  - else a high ratio of "non-text" control bytes (outside the printable +
 *    common-whitespace set, treating high bytes as possible UTF-8) ⇒ binary.
 * An empty slice is text (an empty file is editable). This is intentionally
 * conservative: real UTF-8 text (incl. multibyte) stays text.
 */
function isBinaryBuffer(slice: Buffer): boolean {
  if (slice.length === 0) return false
  let suspicious = 0
  for (let i = 0; i < slice.length; i++) {
    const b = slice[i]!
    if (b === 0) return true
    // Printable ASCII (0x20–0x7e) + tab/newline/carriage-return/form-feed/esc
    // are text; high bytes (>=0x80) are presumed UTF-8 continuation/lead bytes.
    const isText =
      b === 0x09 ||
      b === 0x0a ||
      b === 0x0c ||
      b === 0x0d ||
      b === 0x1b ||
      (b >= 0x20 && b <= 0x7e) ||
      b >= 0x80
    if (!isText) suspicious++
  }
  // >30% control bytes in the head ⇒ binary (git uses a similar threshold).
  return suspicious / slice.length > 0.3
}

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath)
    return true
  } catch {
    return false
  }
}

/** True iff `absPath` exists and is a directory (follows symlinks). */
async function isDir(absPath: string): Promise<boolean> {
  try {
    return (await stat(absPath)).isDirectory()
  } catch {
    return false
  }
}

/** The `terminal.cwd` placeholder values hermes itself maps to `$HOME`
 * (gateway/run.py: unset or one of these → `Path.home()`). */
const TERMINAL_CWD_PLACEHOLDERS = new Set(['.', 'auto', 'cwd'])

/**
 * Read `terminal.cwd` from `${hermesHome}/config.yaml`, MIRRORING hermes's own
 * resolution (gateway/run.py): an unset/blank cwd or a placeholder (`.`, `auto`,
 * `cwd`) means `$HOME` — that is where the agent's terminal actually runs, so
 * Files/Terminal must point there too (NOT at hermes_home, which used to make
 * the panels show a different tree than the agent works in). An ABSOLUTE cwd is
 * honored as-is; any other relative value is resolved under hermes_home (never
 * above it — a `..`-escaping value collapses to hermes_home so a hostile config
 * can't point Files at `/etc`). Presence-safe: a missing/garbled config reads as
 * unset (→ `$HOME`), exactly like hermes.
 */
async function readTerminalCwd(hermesHome: string, home: string): Promise<string> {
  let raw: string
  try {
    raw = await readFile(join(hermesHome, 'config.yaml'), 'utf8')
  } catch {
    return home
  }
  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch {
    return home
  }
  if (!parsed || typeof parsed !== 'object') return home
  const terminal = (parsed as Record<string, unknown>).terminal
  if (!terminal || typeof terminal !== 'object') return home
  const cwd = (terminal as Record<string, unknown>).cwd
  if (typeof cwd !== 'string' || cwd.trim() === '') return home
  const trimmed = cwd.trim()
  if (TERMINAL_CWD_PLACEHOLDERS.has(trimmed)) return home
  if (isAbsolute(trimmed)) return resolve(trimmed)
  // Relative → confine under hermes_home; a `..`-escape collapses to home.
  const resolved = resolve(hermesHome, trimmed)
  if (resolved !== hermesHome && !resolved.startsWith(hermesHome + '/')) return hermesHome
  return resolved
}

export class FilesService {
  private rootResolver: RootResolver
  /** The user's home dir — what hermes resolves a placeholder `terminal.cwd`
   * to. Injectable for hermetic tests. */
  private readonly homeDir: string

  constructor(
    private readonly dashboard: DashboardClient,
    opts: { homeDir?: string } = {},
  ) {
    this.homeDir = opts.homeDir ?? homedir()
    // Default: resolve a root id against the BFF-derived roots list.
    this.rootResolver = async (id) => {
      const roots = await this.listRoots()
      return roots.find((r) => r.id === id) ?? null
    }
  }

  /** Test seam: override how a root id maps to its trusted absolute path. */
  setRootResolver(resolver: RootResolver): void {
    this.rootResolver = resolver
  }

  // ---- READS (BFF-local fs, realpath-guarded) ----

  /**
   * Derive the browsable roots PORTABLY from stock hermes.
   *
   * Stock exposes NO workspace API; instead `GET /api/status` reports
   * `hermes_home`. Stock ALSO never creates a `${hermes_home}/workspace` layout —
   * the agent works in `~/.hermes` itself and in `~/.hermes/playgrounds/*`. So
   * deriving roots only from `workspace/` left Files (and the Terminal, which
   * shares these roots) permanently BLANK on a real install. This now sources, in
   * order, every root that ACTUALLY exists on disk:
   *
   *   1. the agent's REAL terminal cwd ({@link readTerminalCwd}, mirroring
   *      hermes: stock `terminal.cwd: .`/`auto`/unset → `$HOME`) — listed FIRST
   *      so Files and the Terminal (which spawns in the first root) open where
   *      the agent actually works.
   *   2. hermes_home itself ("Hermes home") — the guaranteed fallback so Files is
   *      NEVER blank on a stock install.
   *   3. each `${hermes_home}/playgrounds/<name>` directory (the stock scratch dirs).
   *   4. `${hermes_home}/workspace` ONLY if it actually exists (never synthesized).
   *   5. each `${hermes_home}/profiles/<name>/workspace` that exists (named profiles).
   *
   * Roots are de-duplicated by absolute path. A `terminal.cwd` that resolves to
   * hermes_home itself is NOT surfaced as a separate writable root — the
   * read-only `home` root keeps owning that path. Returns `[]` (never throws)
   * only when the dashboard is unreachable or `hermes_home` is absent.
   *
   * WRITABILITY: the genuine WORK roots (playgrounds, terminal.cwd, workspace,
   * named-profile workspaces) are writable (`readOnly: false`); only `home`
   * (hermes_home itself) stays read-only (it holds config/credential files).
   */
  async listRoots(): Promise<FileRoot[]> {
    let hermesHome: string
    try {
      const status = await this.dashboard.getJson<{ hermes_home?: unknown }>('/api/status')
      if (typeof status.hermes_home !== 'string' || status.hermes_home === '') return []
      hermesHome = status.hermes_home
    } catch {
      return []
    }

    const roots: FileRoot[] = []
    const seen = new Set<string>()
    const add = (root: FileRoot): void => {
      if (seen.has(root.path)) return
      seen.add(root.path)
      roots.push(root)
    }

    // 1. The agent's real terminal cwd (hermes semantics: stock placeholder →
    //    $HOME), FIRST so the Files default and the Terminal's spawn dir match
    //    where the agent actually runs commands. Never claims hermes_home itself
    //    (that path belongs to the read-only `home` root below).
    const terminalCwd = await readTerminalCwd(hermesHome, this.homeDir)
    if (terminalCwd !== resolve(hermesHome) && (await isDir(terminalCwd))) {
      add({
        id: 'terminal-cwd',
        label: terminalCwd === this.homeDir ? 'Home' : 'Terminal cwd',
        description: 'where the agent works',
        path: terminalCwd,
        readOnly: false,
      })
    }

    // 2. hermes_home itself — the guaranteed-existing fallback (Files never blank).
    if (await isDir(hermesHome)) {
      add({
        id: 'home',
        label: 'Hermes home',
        description: 'hermes_home',
        path: hermesHome,
        readOnly: true,
      })
    }

    // 3. ${hermes_home}/playgrounds/* — the stock scratch dirs.
    const playgroundsDir = join(hermesHome, 'playgrounds')
    let playgroundNames: string[]
    try {
      const ents = await readdir(playgroundsDir, { withFileTypes: true })
      playgroundNames = ents
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
    } catch {
      playgroundNames = []
    }
    for (const name of playgroundNames) {
      const dir = join(playgroundsDir, name)
      // isDir follows symlinks (a symlinked playground-to-dir still counts).
      if (await isDir(dir)) {
        add({
          id: `playground:${name}`,
          label: name,
          description: 'playground',
          path: dir,
          readOnly: false,
        })
      }
    }

    // 4. ${hermes_home}/workspace ONLY if it actually exists (never synthesized).
    const defaultWs = join(hermesHome, 'workspace')
    if (await isDir(defaultWs)) {
      add({
        id: 'default',
        label: 'Workspace',
        description: 'default',
        path: defaultWs,
        readOnly: false,
      })
    }

    // 5. Named profiles: ${hermes_home}/profiles/<name>/workspace
    const profilesDir = join(hermesHome, 'profiles')
    let names: string[]
    try {
      const ents = await readdir(profilesDir, { withFileTypes: true })
      names = ents
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
    } catch {
      names = [] // no profiles dir
    }
    for (const name of names) {
      const ws = join(profilesDir, name, 'workspace')
      if (await isDir(ws)) {
        add({ id: name, label: name, description: 'profile', path: ws, readOnly: false })
      }
    }
    return roots
  }

  async listDirectory(root: string, path = ''): Promise<FileListing> {
    // REALPATH-GUARD BEFORE READ: resolve the dir through the lexical guard AND
    // the symlink re-assertion so a symlinked subdir cannot escape the root.
    const { abs, rootInfo } = await this.guardedAbs(root, path)
    // Only the Hermes home root marks the runtime-config family as secret.
    const hermesScoped = isHermesHomeRoot(rootInfo)
    let dirents: import('node:fs').Dirent[]
    try {
      dirents = await readdir(abs, { withFileTypes: true })
    } catch {
      throw new FilesServiceError(`Not found: ${path}`, 'not_found')
    }
    const sorted = dirents
      .filter((d) => d.isDirectory() || d.isFile())
      .sort((a, b) => a.name.localeCompare(b.name))
    const truncated = sorted.length > MAX_DIR_ENTRIES
    const limited = truncated ? sorted.slice(0, MAX_DIR_ENTRIES) : sorted
    const entries: FileEntry[] = []
    for (const d of limited) {
      const type: 'dir' | 'file' = d.isDirectory() ? 'dir' : 'file'
      const childRel = path === '' ? d.name : `${path}/${d.name}`
      const sensitive = isSensitivePath(childRel, { hermesScoped })
      let size: number | null = null
      let modified: string | null = null
      if (!sensitive) {
        try {
          const s = await stat(join(abs, d.name))
          modified = s.mtime.toISOString()
          size = type === 'file' ? s.size : null
        } catch {
          // Broken symlink / race: surface the entry without metadata.
        }
      }
      entries.push({
        name: d.name,
        path: childRel,
        type,
        modified,
        size,
        suppressed: sensitive,
        reason: sensitive ? 'secret' : null,
        preview: sensitive ? 'none' : type === 'dir' ? null : 'full',
      })
    }
    return { root, path, entries, truncated }
  }

  async readFile(root: string, path: string): Promise<FileContent> {
    // REALPATH-GUARD BEFORE READ (symlink re-assertion), exactly like a write.
    const { abs } = await this.guardedAbs(root, path)
    let s: Awaited<ReturnType<typeof stat>>
    try {
      s = await stat(abs)
    } catch {
      throw new FilesServiceError(`Not found: ${path}`, 'not_found')
    }
    if (!s.isFile()) throw new FilesServiceError(`Not a file: ${path}`, 'invalid')
    const truncated = s.size > MAX_TEXT_BYTES
    const readBytes = Math.min(s.size, MAX_TEXT_BYTES)
    const handle = await open(abs, 'r')
    let slice: Buffer
    try {
      const buf = Buffer.alloc(readBytes)
      const result = await handle.read(buf, 0, readBytes, 0)
      slice = buf.subarray(0, result.bytesRead)
    } finally {
      await handle.close()
    }
    // BINARY GUARD: a `slice.toString('utf8')` on a binary file (image bytes, a
    // compiled object, etc.) yields mojibake AND lets the UI offer Edit, whose
    // Save would clobber the file. Sniff the head we already read; for a binary,
    // return NO decoded content + a `binary` flag so the client shows an honest
    // "binary file" state and gates Edit instead of rendering garbage.
    const binary = isBinaryBuffer(slice.subarray(0, Math.min(slice.length, BINARY_SNIFF_BYTES)))
    return {
      root,
      path,
      content: binary ? '' : slice.toString('utf8'),
      encoding: binary ? 'binary' : 'utf-8',
      size: s.size,
      modified: s.mtime.toISOString(),
      mime: mimeForExt(basename(abs)),
      previewMode: truncated ? 'head' : 'full',
      truncated,
      binary,
    }
  }

  /**
   * Read raw image bytes for the `<img>` preview. The dashboard's workspace API
   * is text-only (no binary route), so the BFF serves images itself — guarded by
   * the same root + sensitivity checks and capped in size. Only image extensions
   * are served (this is an image preview, not a generic file download).
   */
  async readRaw(
    rootId: string,
    path: string,
  ): Promise<{ data: Buffer; contentType: string; size: number }> {
    const { abs, contentType } = await this.guardedAbsForImage(rootId, path)
    let s: Awaited<ReturnType<typeof stat>>
    try {
      s = await stat(abs)
    } catch {
      throw new FilesServiceError(`Not found: ${path}`, 'not_found')
    }
    if (!s.isFile()) throw new FilesServiceError(`Not a file: ${path}`, 'invalid')
    if (s.size > MAX_RAW_BYTES) {
      throw new FilesServiceError('Image is too large to preview', 'invalid')
    }
    const data = await readFile(abs)
    return { data, contentType, size: s.size }
  }

  /**
   * Read a NON-SENSITIVE file's full bytes for a guarded `attachment` download.
   * Same two-layer path-guard as every other read (lexical containment + symlink
   * realpath re-assertion + sensitive-file denylist), so a download cannot escape
   * its root or stream a credential file. Size-capped ({@link MAX_DOWNLOAD_BYTES})
   * so a huge file can't exhaust memory. Works for ANY file type (this is a
   * download, not a preview) — binaries included. Returns the bytes + a clean
   * basename for the Content-Disposition filename.
   */
  async downloadFile(
    rootId: string,
    path: string,
  ): Promise<{ data: Buffer; filename: string; size: number }> {
    const { abs } = await this.guardedAbs(rootId, path)
    let s: Awaited<ReturnType<typeof stat>>
    try {
      s = await stat(abs)
    } catch {
      throw new FilesServiceError(`Not found: ${path}`, 'not_found')
    }
    if (!s.isFile()) throw new FilesServiceError(`Not a file: ${path}`, 'invalid')
    if (s.size > MAX_DOWNLOAD_BYTES) {
      throw new FilesServiceError('File is too large to download', 'invalid')
    }
    const data = await readFile(abs)
    return { data, filename: basename(abs), size: s.size }
  }

  private async guardedAbsForImage(
    rootId: string,
    path: string,
  ): Promise<{ abs: string; contentType: string }> {
    const { abs } = await this.guardedAbs(rootId, path)
    const contentType = IMAGE_CONTENT_TYPES[extname(abs).toLowerCase()]
    if (!contentType) {
      throw new FilesServiceError('Not a previewable image', 'invalid')
    }
    return { abs, contentType }
  }

  // ---- WRITES (direct fs, path-guarded) ----

  private async resolveRoot(rootId: string): Promise<FileRoot> {
    const root = await this.rootResolver(rootId)
    if (!root) throw new FilesServiceError(`Unknown workspace root: ${rootId}`, 'not_found')
    return root
  }

  async writeFile(root: string, path: string, content: string): Promise<FileMutationResult> {
    const { abs, rootInfo } = await this.guardedAbs(root, path, { requireWritable: true })
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content, 'utf8')
    const s = await stat(abs)
    return { root: rootInfo.id, path, size: s.size, modified: s.mtime.toISOString() }
  }

  async createEntry(root: string, path: string, kind: 'file' | 'dir'): Promise<FileMutationResult> {
    const { abs, rootInfo } = await this.guardedAbs(root, path, { requireWritable: true })
    if (await pathExists(abs)) {
      throw new FilesServiceError(`Entry already exists: ${path}`, 'conflict')
    }
    if (kind === 'dir') {
      await mkdir(abs, { recursive: true })
    } else {
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, '', { encoding: 'utf8', flag: 'wx' })
    }
    return { root: rootInfo.id, path }
  }

  async renameEntry(root: string, from: string, to: string): Promise<FileMutationResult> {
    const src = await this.guardedAbs(root, from, { requireWritable: true })
    const dst = await this.guardedAbs(root, to, { requireWritable: true })
    if (!(await pathExists(src.abs))) {
      throw new FilesServiceError(`Source not found: ${from}`, 'not_found')
    }
    if (await pathExists(dst.abs)) {
      throw new FilesServiceError(`Destination already exists: ${to}`, 'conflict')
    }
    await mkdir(dirname(dst.abs), { recursive: true })
    await rename(src.abs, dst.abs)
    return { root: src.rootInfo.id, path: to }
  }

  async deleteEntry(root: string, path: string): Promise<FileMutationResult> {
    if (path.trim() === '' || path.trim() === '.') {
      throw new FilesServiceError('Refusing to delete the workspace root', 'invalid')
    }
    const { abs, rootInfo } = await this.guardedAbs(root, path, { requireWritable: true })
    if (!(await pathExists(abs))) {
      throw new FilesServiceError(`Not found: ${path}`, 'not_found')
    }
    await rm(abs, { recursive: true, force: true })
    return { root: rootInfo.id, path }
  }

  /**
   * Resolve + guard a relative path against the trusted root abs path. Two
   * layers: (1) the lexical {@link resolveInsideRoot} (traversal / sensitive /
   * textual containment), then (2) {@link assertRealpathInsideRoot}, which
   * follows symlinks and RE-ASSERTS real-path containment + sensitivity before
   * any fs call so a symlink inside the root cannot escape to `/etc`, `~/.ssh`,
   * etc. Returns the symlink-resolved real path the caller operates on.
   */
  private async guardedAbs(
    rootId: string,
    path: string,
    opts: { requireWritable?: boolean } = {},
  ): Promise<{ abs: string; rootInfo: FileRoot }> {
    const rootInfo = await this.resolveRoot(rootId)
    // READ-ONLY GATE: refuse any mutation against a root explicitly marked
    // read-only BEFORE any path resolution or fs call. Writes ARE enabled on
    // writable roots (e.g. playgrounds/workspace); only roots flagged readOnly
    // (e.g. the hermes-home root) reject mutations.
    if (opts.requireWritable && rootInfo.readOnly) {
      throw new FilesServiceError(`Root is read-only: ${rootId}`, 'read_only')
    }
    // The `home` root exposes the Hermes credential home (~/.hermes): scope the
    // runtime-config family (config.yaml/json, settings.*) as sensitive there,
    // but leave it openable in ordinary work roots (playgrounds/workspaces).
    const hermesScoped = isHermesHomeRoot(rootInfo)
    const lexical = resolveInsideRoot(rootInfo.path, path, { hermesScoped })
    const abs = await assertRealpathInsideRoot(rootInfo.path, lexical, { hermesScoped })
    return { abs, rootInfo }
  }
}
