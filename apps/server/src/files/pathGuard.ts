/**
 * PATH-GUARD — the security core of the Files BFF.
 *
 * The dashboard's `/api/workspace/*` surface is READ-ONLY (GET roots/tree/file
 * only — confirmed live, every root reports `read_only: true`). So the BFF must
 * perform write/create/rename/delete itself, directly on the filesystem. That
 * makes these guards load-bearing: every path the BFF reads or writes is
 * normalized, confined to an allowlisted workspace root, and screened against a
 * sensitive-file denylist BEFORE any fs call.
 *
 * Rules (defense in depth, intentionally at least as strict as the dashboard):
 *  - No `..` traversal anywhere (also after percent-decoding); no control bytes
 *    (incl. NUL).
 *  - The resolved absolute path must sit *inside* the given root — a sibling
 *    directory sharing a name prefix (e.g. `Projects-evil` vs `Projects`) is NOT
 *    inside `Projects`.
 *  - Sensitive files are blocked for BOTH read and write: dotenv files, auth /
 *    credential / key / cert material, db/sqlite files, and anything under a
 *    secret directory (.ssh/.aws/.gnupg/.kube/.docker/secrets/.secrets). The
 *    runtime-config family (config.yaml/json, settings.*) is blocked only when a
 *    caller flags the path as inside the Hermes credential home (where it holds
 *    provider keys) — elsewhere those are ordinary project config and open fine.
 *
 * SECURITY: never read, log, or surface the *contents* of a blocked file; the
 * guard only ever inspects the path. Callers map {@link PathGuardError} to a 403.
 */
import { posix, sep } from 'node:path'
import { realpath } from 'node:fs/promises'

export class PathGuardError extends Error {
  constructor(
    message: string,
    /** Stable machine code so the route layer can pick the HTTP status. */
    readonly code: 'traversal' | 'outside_root' | 'sensitive' = 'traversal',
  ) {
    super(message)
    this.name = 'PathGuardError'
  }
}

/** Files blocked by exact (case-insensitive) name. */
const SENSITIVE_FILE_NAMES = new Set([
  '.env',
  '.netrc',
  '.npmrc',
  '.pypirc',
  'auth.json',
  'credentials',
  'credentials.json',
  // Hermes channel-config files holding LIVE messaging credentials (Telegram/Discord
  // bot tokens, webhook keys) under ~/.hermes — Hermes writes them mode 0600. They do
  // not match any pattern below, so block them by exact name.
  'channel_directory.json',
  'dashboard_chat_channels.json',
  // SSH / PKI private-key + trust material (SEC-2). `.ssh` as a dir is already
  // blocked; these catch the same files copied OUTSIDE ~/.ssh. (.pub public keys
  // are intentionally NOT listed.)
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'identity',
  'known_hosts',
  'authorized_keys',
  // VCS / package / cloud credential files (SEC-2).
  '.git-credentials',
  '.gitconfig',
  '.dockercfg',
  '.pgpass',
  '.terraformrc',
])

/**
 * Runtime-config files that ARE credential-bearing under the Hermes home
 * (`config.yaml` holds provider keys; `settings.*` likewise) but are ordinary,
 * harmless project files ANYWHERE else (`config.json`, `settings.json`, etc. are
 * everyday tooling/app config). Blocking them by bare basename labelled every
 * project's config as SECRET + unopenable. So they are sensitive ONLY when the
 * caller flags the path as being inside the Hermes credential home (the `home`
 * root, which exposes `~/.hermes/config.yaml` + the per-profile `config.yaml`) —
 * mirroring the existing `.git/config` path-scoping. The real Hermes config stays
 * fully blocked; ordinary `config.json`/`settings.json` in a workspace open fine.
 */
const HERMES_HOME_CONFIG_NAMES = new Set([
  'config.yaml',
  'config.yml',
  'config.json',
  'settings.yaml',
  'settings.yml',
  'settings.json',
])

/** Files blocked by extension (case-insensitive). */
const SENSITIVE_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.secret',
  '.db',
  '.sqlite',
  '.sqlite3',
  // Cert / key / keystore material (SEC-2). Public certs are low-value to preview
  // and a `.crt`/`.asc` can carry private material — block by default.
  '.crt',
  '.cer',
  '.der',
  '.gpg',
  '.asc',
  '.kdbx',
  '.keystore',
  '.jks',
  '.ppk',
])

/**
 * Strip trailing backup/temp markers so a COPY of a secret file is still caught
 * (SEC-1): `auth.json.bak-2026…` → `auth.json`, `config.yaml~` → `config.yaml`,
 * `server.key.save` → `server.key`. Loops so chained suffixes reduce fully. A
 * non-secret name just falls through unchanged (no over-blocking).
 */
function stripBackupSuffix(name: string): string {
  let n = name
  for (let i = 0; i < 4; i++) {
    const next = n
      .replace(/~+$/, '')
      .replace(/\.(bak|backup|old|orig|save|swp|swo|tmp|copy)(?:[.\-~][^/]*)?$/i, '')
    if (next === n) break
    n = next
  }
  return n
}

/** Does this basename (already lower-cased) match a name/extension/pattern rule? */
function nameIsSensitive(name: string): boolean {
  if (SENSITIVE_FILE_NAMES.has(name)) return true
  if (SENSITIVE_EXTENSIONS.has(extensionOf(name))) return true
  if (matchesSensitivePattern(name)) return true
  return false
}

/** Any path segment equal to one of these (a directory) is blocked. */
const SENSITIVE_DIR_NAMES = new Set([
  'secrets',
  '.secrets',
  '.ssh',
  '.aws',
  '.gnupg',
  '.kube',
  '.docker',
])

/** Glob-ish name patterns blocked (matched against the basename, lower-cased). */
function matchesSensitivePattern(name: string): boolean {
  // .env, .env.local, .env.production, etc.
  if (name === '.env' || name.startsWith('.env.')) return true
  if (name.startsWith('credentials')) return true
  if (name.startsWith('secrets')) return true
  // *service-account*.json / *service_account*.json
  if (/service[-_]account/.test(name) && name.endsWith('.json')) return true
  // OAuth / API token stores: token.json, access_token.json, refresh_token.json,
  // bot-token.json, tokens.json — `token(s)` bounded by a separator or the ext, so
  // a non-secret like `tokenizer.json` (the `token` is not bounded) is NOT blocked.
  if (name.endsWith('.json') && /(^|[._-])tokens?([._-]|$)/.test(name)) return true
  return false
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  // A leading-dot file (".env") has no extension in this sense.
  if (dot <= 0) return ''
  return name.slice(dot).toLowerCase()
}

/**
 * Normalize a client-supplied relative path into a clean POSIX relative path.
 * Rejects traversal and control bytes. Percent-encoded segments are decoded
 * first so `%2e%2e` cannot smuggle a `..` past the check. Leading slashes are
 * stripped (treated as root-relative); spaces are legal in filenames.
 */
export function normalizeRelative(rel: string | undefined): string {
  let raw = (rel ?? '').trim()
  // Decode once; a malformed sequence is treated as a hard reject.
  try {
    raw = decodeURIComponent(raw)
  } catch {
    throw new PathGuardError('Malformed path encoding')
  }
  // Reject any ASCII control character (incl. NUL) — none belong in a path.
  for (let i = 0; i < raw.length; i++) {
    if (raw.charCodeAt(i) < 0x20) throw new PathGuardError('Path contains control character')
  }

  raw = raw.replace(/\\/g, '/')

  const parts: string[] = []
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') throw new PathGuardError('Path traversal is not allowed')
    parts.push(part)
  }
  return parts.join('/')
}

/**
 * Is this relative path a sensitive file/dir that must never be read or written?
 * Inspects every segment + the basename. Accepts raw or normalized input.
 *
 * `opts.hermesScoped` marks the path as living inside the Hermes credential home
 * (the `home` root). When set, the runtime-config family
 * ({@link HERMES_HOME_CONFIG_NAMES}: `config.yaml`/`config.json`/`settings.*`) is
 * ALSO blocked — there those files hold live provider credentials. Off (the
 * default, e.g. a playground/workspace root), they are ordinary project config
 * and open normally.
 */
export function isSensitivePath(rel: string, opts: { hermesScoped?: boolean } = {}): boolean {
  const normalized = rel.replace(/\\/g, '/')
  const segments = normalized.split('/').filter((s) => s !== '' && s !== '.')
  if (segments.length === 0) return false

  // Any ancestor (or the basename itself) being a secret directory blocks it.
  const lower = segments.map((s) => s.toLowerCase())
  for (const seg of lower) {
    if (SENSITIVE_DIR_NAMES.has(seg)) return true
  }

  // A VCS config that can carry credentials: `.git/config` — distinct from a
  // plain `config` file elsewhere, which is not sensitive.
  if (lower.length >= 2 && lower[lower.length - 1] === 'config' && lower.includes('.git')) {
    return true
  }

  // Check the literal basename AND the name with backup/temp suffixes stripped,
  // so a `.bak`/`~`/`.orig` copy of a secret file is caught (SEC-1).
  const name = lower[lower.length - 1]!
  if (nameIsSensitive(name) || nameIsSensitive(stripBackupSuffix(name))) return true

  // Runtime-config family — credential-bearing ONLY inside the Hermes home, so
  // scoped to that root (parity with the `.git/config` scoping above) rather than
  // blocked by bare basename everywhere.
  if (opts.hermesScoped) {
    if (HERMES_HOME_CONFIG_NAMES.has(name) || HERMES_HOME_CONFIG_NAMES.has(stripBackupSuffix(name)))
      return true
  }
  return false
}

/**
 * Resolve a relative path under `rootAbsPath` to an absolute path, enforcing that
 * the result stays inside the root and is not sensitive. `rootAbsPath` is a
 * trusted absolute path obtained from the dashboard's workspace roots.
 */
export function resolveInsideRoot(
  rootAbsPath: string,
  rel: string | undefined,
  opts: { hermesScoped?: boolean } = {},
): string {
  const normalized = normalizeRelative(rel)
  if (isSensitivePath(normalized, opts)) {
    throw new PathGuardError('Sensitive file is blocked', 'sensitive')
  }

  // Work in POSIX space for the containment check (the dashboard reports POSIX
  // root paths; this BFF targets Linux/macOS).
  const rootPosix = rootAbsPath.split(sep).join('/').replace(/\/+$/, '')
  const joined = posix.normalize(normalized === '' ? rootPosix : `${rootPosix}/${normalized}`)

  // Containment: equal to the root, or a child separated by a `/` boundary. The
  // `${root}/` guard rejects sibling prefixes like `${root}-evil`.
  if (joined !== rootPosix && !joined.startsWith(`${rootPosix}/`)) {
    throw new PathGuardError('Resolved path is outside the workspace root', 'outside_root')
  }
  return joined
}

/** POSIX containment: `child` is the root itself or sits under it on a `/`
 * boundary (rejecting sibling prefixes like `${root}-evil`). */
function isContained(rootPosix: string, child: string): boolean {
  return child === rootPosix || child.startsWith(`${rootPosix}/`)
}

/**
 * Is `absChild` the same as, or contained within, `absRoot`? Both are absolute
 * on-disk paths (not relative). Normalizes to POSIX + trims trailing slashes so
 * the comparison is `/` boundary-aware — a sibling prefix like `${root}-evil` is
 * NOT contained. Exported so non-file callers (e.g. the terminal cwd guard) can
 * reuse the exact containment rule the Files BFF enforces.
 */
export function isPathInsideRoot(absRoot: string, absChild: string): boolean {
  const rootPosix = absRoot.split(sep).join('/').replace(/\/+$/, '')
  const childPosix = absChild.split(sep).join('/').replace(/\/+$/, '')
  if (rootPosix === '') return false
  return isContained(rootPosix, childPosix)
}

/**
 * SYMLINK-ESCAPE GUARD. The lexical {@link resolveInsideRoot} only proves a path
 * is *textually* inside the root; a symlink inside an allowlisted root can still
 * point at `/etc`, `~/.ssh`, etc. Before any fs call we therefore `realpath` the
 * resolved target (or, when it does not yet exist — a write/create/rename-dst —
 * its nearest existing ancestor) and RE-ASSERT that the real path stays inside
 * the root AND is not sensitive once the symlinks are followed.
 *
 * `rootAbsPath` is the trusted root; `absPath` is the already lexically-guarded
 * absolute path returned by {@link resolveInsideRoot}. Throws {@link PathGuardError}
 * on any escape (mapped to 403 by the route layer). On success returns the real
 * (symlink-resolved) absolute path the caller should operate on.
 */
export async function assertRealpathInsideRoot(
  rootAbsPath: string,
  absPath: string,
  opts: { hermesScoped?: boolean } = {},
): Promise<string> {
  const rootPosix = rootAbsPath.split(sep).join('/').replace(/\/+$/, '')
  // The root itself must resolve inside itself (e.g. the root is not a symlink
  // out). Resolve it once so we compare real-path against real-path.
  let realRoot: string
  try {
    realRoot = (await realpath(rootAbsPath)).split(sep).join('/').replace(/\/+$/, '')
  } catch {
    // Root unreadable/missing — treat as the configured path (best effort).
    realRoot = rootPosix
  }

  // Try to realpath the full target. If it exists, that is the real path we
  // must vet. If it does NOT exist (write/create new entry, rename dst), walk up
  // to the nearest existing ancestor and vet that, then re-attach the remaining
  // (not-yet-real) tail for the sensitive-name check.
  const targetPosix = absPath.split(sep).join('/').replace(/\/+$/, '') || absPath
  let realTarget: string
  try {
    realTarget = (await realpath(absPath)).split(sep).join('/').replace(/\/+$/, '')
  } catch {
    // Target missing: find the deepest existing ancestor.
    const segs = targetPosix.split('/')
    const tail: string[] = []
    let resolvedAncestor: string | null = null
    while (segs.length > 0) {
      tail.unshift(segs.pop()!)
      const candidate = segs.join('/')
      if (candidate === '') break
      try {
        resolvedAncestor = (await realpath(candidate)).split(sep).join('/').replace(/\/+$/, '')
        break
      } catch {
        // keep walking up
      }
    }
    if (resolvedAncestor === null) {
      // Could not resolve any ancestor — refuse rather than guess.
      throw new PathGuardError('Resolved path is outside the workspace root', 'outside_root')
    }
    const pendingTail = tail.join('/')
    realTarget = pendingTail ? `${resolvedAncestor}/${pendingTail}` : resolvedAncestor
  }

  if (!isContained(realRoot, realTarget)) {
    throw new PathGuardError('Resolved path is outside the workspace root', 'outside_root')
  }

  // Re-run the sensitive-name check on the REAL path relative to the root — a
  // symlink could resolve into a secret directory under a benign name.
  const relReal =
    realTarget === realRoot ? '' : realTarget.slice(realRoot.length).replace(/^\/+/, '')
  if (relReal !== '' && isSensitivePath(relReal, opts)) {
    throw new PathGuardError('Sensitive file is blocked', 'sensitive')
  }
  return realTarget
}
