import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  readdirSync,
  existsSync,
  statSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { ProfileIdentity, type AvatarId } from '@agent-deck/protocol'
import {
  normalizeRelative,
  resolveInsideRoot,
  isPathInsideRoot,
  PathGuardError,
} from '../files/pathGuard'

/**
 * Filesystem reader for Hermes profiles. Stock Hermes exposes a minimal
 * dashboard `/api/profiles` route today, but it returns absolute filesystem
 * paths and omits Agentdeck-specific fields. This surface reads HERMES_HOME
 * directly so the browser contract stays path-safe and complete.
 *
 * The shape is a faithful, read-only port of hermes_cli/profiles.py:
 *  - the "default" profile IS HERMES_HOME (~/.hermes) itself, listed first
 *  - named profiles live under <home>/profiles/<name>/, where <name> matches
 *    {@link PROFILE_ID_RE}
 *  - the sticky active profile is the trimmed content of <home>/active_profile;
 *    an absent or empty file means "default"
 *
 * SECURITY: this reads config.yaml/.env presence and the `model` key only. It
 * NEVER returns raw file contents, API keys, secrets, or absolute filesystem
 * paths — only the presence/shape (model name, provider, hasEnv) is surfaced.
 */

/** Profile-name pattern from profiles.py `_PROFILE_ID_RE`. */
const PROFILE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/**
 * agent-deck's per-profile identity sidecar, relative to the profile dir. The
 * `.agent-deck` directory is OURS (not part of stock hermes); it holds the chosen
 * avatar so the agent has a face. Read presence-safely; written atomically.
 */
const IDENTITY_DIR = '.agent-deck'
const IDENTITY_FILE = 'identity.json'

export interface ProfileSummary {
  /** Profile identifier ("default" for HERMES_HOME itself). */
  name: string
  /** Browser-safe location label; never an absolute filesystem path. */
  displayPath: string
  /** True for the built-in default profile (= HERMES_HOME). */
  isDefault: boolean
  /** True when this is the sticky active profile. */
  isActive: boolean
  /** Default model from config.yaml `model`, or null when unknown. */
  model: string | null
  /** Provider from config.yaml `model.provider`, or null when unknown. */
  provider: string | null
  /** Whether the profile carries a `.env` file (presence only — never its contents). */
  hasEnv: boolean
  /** Count of installed skills (SKILL.md under skills/, excluding .hub/.git). */
  skillCount: number
  /** Whether a gateway process is currently running for this profile. */
  gatewayRunning: boolean
  /**
   * The chosen avatar id from `<profile_dir>/.agent-deck/identity.json`, or null
   * when unset/missing/garbled (the UI then resolves a deterministic default by
   * name hash). Presence-safe — a missing or malformed file never throws.
   */
  avatar: AvatarId | null
  /**
   * The user-chosen display name for this agent (e.g. "Mercury"), written during the
   * identity ceremony or via the edit dialog. Null when the field is absent (the UI
   * then falls back to the profile id or "your agent" copy). Presence-safe.
   */
  displayName: string | null
}

export interface ProfilesResult {
  /** The sticky active profile name ("default" when none is set). */
  active: string
  /** All profiles, default first, named profiles sorted by name. */
  profiles: ProfileSummary[]
}

/** Read model + provider from a profile's config.yaml. Mirrors `_read_config_model`. */
function readConfigModel(profileDir: string): { model: string | null; provider: string | null } {
  const configPath = join(profileDir, 'config.yaml')
  let raw: string
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch {
    return { model: null, provider: null }
  }
  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch {
    return { model: null, provider: null }
  }
  if (!parsed || typeof parsed !== 'object') return { model: null, provider: null }
  const modelCfg = (parsed as Record<string, unknown>).model
  if (typeof modelCfg === 'string') {
    return { model: modelCfg, provider: null }
  }
  if (modelCfg && typeof modelCfg === 'object') {
    const m = modelCfg as Record<string, unknown>
    const model =
      (typeof m.default === 'string' && m.default) ||
      (typeof m.model === 'string' && m.model) ||
      null
    const provider = typeof m.provider === 'string' ? m.provider : null
    return { model, provider }
  }
  return { model: null, provider: null }
}

/**
 * Read the identity from `<profile_dir>/.agent-deck/identity.json`. Presence-
 * and corruption-safe: a missing file, non-JSON content, or an unrecognized avatar
 * id all resolve to `null` fields. Parsed through the protocol schema so only
 * governed values can ever surface.
 */
function readIdentity(profileDir: string): { avatar: AvatarId | null; displayName: string | null } {
  let raw: string
  try {
    raw = readFileSync(join(profileDir, IDENTITY_DIR, IDENTITY_FILE), 'utf8')
  } catch {
    return { avatar: null, displayName: null }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { avatar: null, displayName: null }
  }
  const result = ProfileIdentity.safeParse(parsed)
  if (!result.success) return { avatar: null, displayName: null }
  const dn = result.data.displayName
  return {
    avatar: result.data.avatar,
    displayName: typeof dn === 'string' && dn.trim().length > 0 ? dn.trim() : null,
  }
}

/** Read only the avatar id from identity.json (used by the setup probe). */
function readIdentityAvatar(profileDir: string): AvatarId | null {
  return readIdentity(profileDir).avatar
}

/** True if a gateway is running for this profile. Mirrors `_check_gateway_running`. */
function checkGatewayRunning(profileDir: string): boolean {
  const pidFile = join(profileDir, 'gateway.pid')
  let raw: string
  try {
    raw = readFileSync(pidFile, 'utf8').trim()
  } catch {
    return false
  }
  if (!raw) return false
  let pid: number
  try {
    if (raw.startsWith('{')) {
      const data = JSON.parse(raw) as { pid?: unknown }
      pid = Number(data.pid)
    } else {
      pid = Number(raw)
    }
  } catch {
    return false
  }
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    // Signal 0 is an existence/permission check — it does not actually signal.
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means the process exists but is owned by another user → still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Count SKILL.md files under skills/, excluding .hub/.git. Mirrors `_count_skills`. */
function countSkills(profileDir: string): number {
  const skillsDir = join(profileDir, 'skills')
  let count = 0
  const walk = (dir: string): void => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === '.hub' || entry.name === '.git') continue
        walk(join(dir, entry.name))
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        count += 1
      }
    }
  }
  walk(skillsDir)
  return count
}

function summarize(name: string, dir: string, isDefault: boolean, active: string): ProfileSummary {
  const { model, provider } = readConfigModel(dir)
  const { avatar, displayName } = readIdentity(dir)
  return {
    name,
    displayPath: isDefault ? 'Hermes home' : `profiles/${name}`,
    isDefault,
    isActive: name === active,
    model,
    provider,
    hasEnv: existsSync(join(dir, '.env')),
    skillCount: countSkills(dir),
    gatewayRunning: checkGatewayRunning(dir),
    avatar,
    displayName,
  }
}

/** Read the sticky active profile name. Mirrors `get_active_profile`. */
export function readActiveProfile(hermesHome: string): string {
  try {
    const name = readFileSync(join(hermesHome, 'active_profile'), 'utf8').trim()
    return name || 'default'
  } catch {
    return 'default'
  }
}

/**
 * Enumerate all Hermes profiles for the given HERMES_HOME (default `~/.hermes`).
 * Returns the active profile name and the full, ordered profile list.
 */
export function readProfiles(hermesHome: string): ProfilesResult {
  const active = readActiveProfile(hermesHome)
  const profiles: ProfileSummary[] = [summarize('default', hermesHome, true, active)]

  const profilesRoot = join(hermesHome, 'profiles')
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(profilesRoot, { withFileTypes: true })
  } catch {
    entries = []
  }
  const named = entries
    .filter((e) => {
      if (!PROFILE_ID_RE.test(e.name)) return false
      if (e.isDirectory()) return true
      // Resolve symlinks-to-dirs the way the CLI's is_dir() would.
      if (e.isSymbolicLink()) {
        try {
          return statSync(join(profilesRoot, e.name)).isDirectory()
        } catch {
          return false
        }
      }
      return false
    })
    .map((e) => e.name)
    .sort()

  for (const name of named) {
    profiles.push(summarize(name, join(profilesRoot, name), false, active))
  }

  return { active, profiles }
}

/* ────────────────────────────── SOUL ──────────────────────────────────────
 * The Soul surface reads (and edits) SOUL.md on the filesystem directly.
 * Verified layout (hermes_cli/profiles.py): ${profile_dir}/SOUL.md, where
 * profile_dir is HERMES_HOME for "default", else <home>/profiles/<name>.
 *
 * NOTE: the former MEMORY.md / USER.md readers+writers were REMOVED. Installed
 * hermes (config schema v29) has NO flat MEMORY.md / USER.md files in a profile
 * (memory is store-backed plus an external memory provider). Memory is authored
 * through the Studio surface (provider + memory.* config), never a flat-file edit.
 *
 * SECURITY: a profile <name> is attacker-influenced (it comes from a URL param),
 * so the profile dir is resolved through the Files path guard
 * ({@link resolveInsideRoot}) against HERMES_HOME — a name that walks up (../..)
 * is REJECTED before any fs call, and the SOUL write is likewise confined to the
 * resolved profile dir. Reads are presence-safe and never throw on a missing
 * file (only the path guard throws, on a hostile name). */

/** A profile text file's content + whether it exists. Missing → exists:false. */
export interface ProfileFile {
  content: string
  exists: boolean
}

/**
 * Resolve a profile's on-disk directory, guarding the (attacker-influenced)
 * `name`. "default" → HERMES_HOME itself; any other name → a path guarded to live
 * directly under <home>/profiles, so `../` escapes throw a {@link PathGuardError}.
 */
export function resolveProfileDir(hermesHome: string, name: string): string {
  if (name === 'default') return hermesHome
  // A legitimate profile name is a SINGLE segment (the CLI's _PROFILE_ID_RE).
  // Reject anything looser (multi-segment, traversal, control chars, casing) up
  // front, so an attacker-influenced name can never expand to a nested/escaping path.
  if (!PROFILE_ID_RE.test(name)) throw new PathGuardError('Invalid profile name', 'outside_root')
  const profilesRoot = join(hermesHome, 'profiles')
  const dir = resolveInsideRoot(profilesRoot, normalizeRelative(name))
  // Symlink defense-in-depth (parity with the Files BFF): if the dir exists, its
  // REAL path must still live under the profiles root — a planted symlink under
  // <home>/profiles cannot redirect reads/writes outside HERMES_HOME.
  if (existsSync(dir) && !isPathInsideRoot(realpathSync(profilesRoot), realpathSync(dir))) {
    throw new PathGuardError('Resolved profile path escapes the profiles root', 'outside_root')
  }
  return dir
}

/** True when a profile id names an existing on-disk profile directory. */
export function profileExists(hermesHome: string, name: string): boolean {
  if (name === 'default') return true
  const dir = resolveProfileDir(hermesHome, name)
  try {
    return statSync(dir).isDirectory()
  } catch {
    return false
  }
}

/** Presence-safe read of a file under a profile dir; missing → exists:false. */
function readProfileFile(profileDir: string, relative: string): ProfileFile {
  try {
    return { content: readFileSync(join(profileDir, relative), 'utf8'), exists: true }
  } catch {
    return { content: '', exists: false }
  }
}

/** Read ${profile_dir}/SOUL.md (presence-safe). Guards the profile name. */
export function readSoul(hermesHome: string, name: string): ProfileFile {
  return readProfileFile(resolveProfileDir(hermesHome, name), 'SOUL.md')
}

/**
 * Read a profile's chosen avatar from `.agent-deck/identity.json` (presence- and
 * corruption-safe → null). Guards the (attacker-influenced) name. Used by the
 * setup probe to decide `agentNamed` (the agent has a face) without re-reading the
 * whole profile list.
 */
export function readProfileAvatar(hermesHome: string, name: string): AvatarId | null {
  return readIdentityAvatar(resolveProfileDir(hermesHome, name))
}

/** Thrown when a SOUL write targets a profile whose dir does not exist. */
export class ProfileNotFoundError extends Error {
  constructor(name: string) {
    super(`Profile "${name}" not found`)
    this.name = 'ProfileNotFoundError'
  }
}

/**
 * Atomic write: write to a sibling temp file then rename over the target, so a
 * concurrent reader never sees a half-written file (and a crash mid-write leaves
 * the old content intact, not a truncated one). The temp file lives in the same
 * directory as the target so the rename stays on one filesystem.
 */
function atomicWrite(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true })
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, target)
}

/**
 * Write a profile text file ATOMICALLY (temp-file + rename), confined to the
 * profile dir. The profile dir must already exist ({@link ProfileNotFoundError}
 * otherwise — a write never conjures a new profile). The (attacker-influenced)
 * name is path-guarded by {@link resolveProfileDir}; the `relative` is a constant
 * caller-supplied path re-asserted inside the profile dir (defense in depth). The
 * `memories/` dir is created as needed.
 */
function writeProfileFile(
  hermesHome: string,
  name: string,
  relative: string,
  content: string,
): void {
  const profileDir = resolveProfileDir(hermesHome, name)
  if (!existsSync(profileDir)) throw new ProfileNotFoundError(name)
  const target = resolveInsideRoot(profileDir, relative)
  atomicWrite(target, content)
}

/**
 * Write ${profile_dir}/SOUL.md. The profile dir must already exist (a SOUL write
 * never conjures a new profile) → {@link ProfileNotFoundError} otherwise. The
 * profile name is path-guarded; the target stays inside the profile dir.
 */
export function writeSoul(hermesHome: string, name: string, content: string): void {
  writeProfileFile(hermesHome, name, 'SOUL.md', content)
}

/**
 * Write `<profile_dir>/.agent-deck/identity.json` with the chosen avatar and an
 * optional display name. The profile dir must already exist ({@link
 * ProfileNotFoundError} otherwise — an avatar write never conjures a profile).
 * The name is path-guarded; the `.agent-deck` dir is created if needed and the
 * write is atomic (reuses the writeSoul confinement discipline + a temp-file+rename
 * for atomicity). The avatar id is validated by the caller against {@link AvatarId}
 * before this runs. `displayName` is a PARTIAL update: `undefined` preserves the
 * existing name (an avatar-only edit must never wipe the name half of the identity
 * wedge); an explicit value sets it; an explicit blank clears it.
 */
export function writeAvatar(
  hermesHome: string,
  name: string,
  avatar: AvatarId,
  displayName?: string,
): void {
  const profileDir = resolveProfileDir(hermesHome, name)
  if (!existsSync(profileDir)) throw new ProfileNotFoundError(name)
  // Re-assert the target stays inside the profile dir (defense in depth — the
  // relative path is constant, but this keeps the guard load-bearing).
  const target = resolveInsideRoot(profileDir, join(IDENTITY_DIR, IDENTITY_FILE))
  // Partial-merge: an avatar-only edit (displayName === undefined) PRESERVES the
  // existing display name. The previous whole-file overwrite silently destroyed
  // the name on every face change — data loss on the crown identity feature.
  const effectiveName =
    displayName === undefined ? readIdentity(profileDir).displayName : displayName.trim() || null
  const body: ProfileIdentity = effectiveName ? { avatar, displayName: effectiveName } : { avatar }
  atomicWrite(target, `${JSON.stringify(body, null, 2)}\n`)
}

/**
 * Switch the sticky active profile by atomically writing `<home>/active_profile`
 * (temp-file + rename). The name is validated by {@link PROFILE_ID_RE}. The
 * literal "default" mirrors Hermes' `set_active_profile("default")`: remove the
 * sticky file so the default profile is inferred. This NEVER touches the gateway
 * — it only flips the sticky pointer.
 */
export function writeActiveProfile(hermesHome: string, name: string): void {
  if (name !== 'default' && !PROFILE_ID_RE.test(name)) {
    throw new PathGuardError('Invalid profile name', 'outside_root')
  }
  // active_profile lives directly in HERMES_HOME — a fixed, non-attacker path.
  if (name === 'default') {
    mkdirSync(hermesHome, { recursive: true })
    rmSync(join(hermesHome, 'active_profile'), { force: true })
    return
  }
  atomicWrite(join(hermesHome, 'active_profile'), `${name}\n`)
}
