/**
 * Filesystem CRUD for Hermes SKILLS — the create / edit / delete the dashboard
 * proxy (toggle-only) cannot do. The loopback dashboard `/api/skills` only LISTS
 * + toggles; there is no stock route to read a skill's body, write it, create a
 * new skill, or delete one. So — exactly like the SOUL/MEMORY profile files — the
 * BFF acts on the on-disk skills tree directly, path-guarded.
 *
 * LAYOUT (verified against hermes tools/skills_tool.py `_find_all_skills`):
 *   <HERMES_HOME>/skills/<category?>/<skill>/SKILL.md
 * A skill's IDENTITY here is its directory path RELATIVE to <HERMES_HOME>/skills
 * (e.g. `creative/ascii-art`, or `dogfood` for a top-level skill). That relative
 * path is unambiguous and path-guardable — unlike the dashboard `name` (the
 * SKILL.md frontmatter `name`, which can collide across categories). The editable
 * body is the SKILL.md itself.
 *
 * HONEST SCOPE: a skill may carry linked files (README, scripts/, references/,
 * frontmatter pointing at them). We edit the PRIMARY body (SKILL.md) and surface
 * `hasExtraFiles` so the UI can note the rest is out of this surface's scope.
 *
 * SECURITY: the relative skill path is attacker-influenced (it comes from a
 * request), so EVERY path is resolved through the Files path guard
 * ({@link resolveInsideRoot}) against the skills root — `..` traversal, absolute
 * escapes, and sensitive names are rejected BEFORE any fs call. Writes never
 * conjure a skill that does not exist; deletes refuse anything that is not a
 * leaf skill (a dir holding a SKILL.md), so a category dir can never be nuked.
 */
import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  readdirSync,
  rmSync,
  existsSync,
  realpathSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import {
  normalizeRelative,
  resolveInsideRoot,
  isPathInsideRoot,
  PathGuardError,
} from '../files/pathGuard'

/** Directory names excluded from skill discovery (mirrors hermes EXCLUDED_SKILL_DIRS). */
const EXCLUDED_SKILL_DIRS = new Set([
  '.git',
  '.github',
  '.hub',
  '.archive',
  '.venv',
  'venv',
  'node_modules',
  'site-packages',
  '__pycache__',
  '.tox',
  '.nox',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
])

/** A single path segment that is a valid skill OR category id. */
const SEGMENT_RE = /^[a-z0-9][a-z0-9_-]*$/

/** Thrown when a skill body write/delete targets a skill that does not exist. */
export class SkillNotFoundError extends Error {
  constructor(path: string) {
    super(`Skill "${path}" not found`)
    this.name = 'SkillNotFoundError'
  }
}

/** Thrown when create would clobber an existing skill. */
export class SkillExistsError extends Error {
  constructor(path: string) {
    super(`Skill "${path}" already exists`)
    this.name = 'SkillExistsError'
  }
}

/** A skill's SKILL.md content + presence + whether linked files exist alongside. */
export interface SkillBody {
  /** The relative skill path this body belongs to (echoed for the client). */
  path: string
  /** SKILL.md content, or '' when absent. */
  content: string
  /** Whether SKILL.md exists on disk. */
  exists: boolean
  /**
   * Whether the skill dir carries files OTHER than SKILL.md (README, scripts/,
   * references/, …). This surface edits only the primary body; the UI notes the
   * rest is out of scope.
   */
  hasExtraFiles: boolean
}

/** The skills root for a HERMES_HOME. */
function skillsRoot(hermesHome: string): string {
  return join(hermesHome, 'skills')
}

/**
 * Resolve a relative skill path under the skills root, guarding the (attacker-
 * influenced) input. An empty path resolves to the root itself — callers that
 * must operate on a real skill reject that case explicitly.
 */
function resolveSkillDir(hermesHome: string, relPath: string): string {
  const root = skillsRoot(hermesHome)
  const dir = resolveInsideRoot(root, normalizeRelative(relPath))
  assertRealpathInside(root, dir)
  return dir
}

/**
 * SYMLINK-ESCAPE re-assertion (parity with `resolveProfileDir` + the Files guard).
 * {@link resolveInsideRoot} proves only LEXICAL containment; a symlink planted
 * inside the skills root can still point at `/etc`, `~/.ssh`, an arbitrary dir,
 * etc. So before any fs op we `realpath` the target — or, when it does not yet
 * exist (a create), its nearest existing ancestor — and re-assert the REAL path
 * stays inside the REAL skills root. Throws {@link PathGuardError} on escape.
 * A skills root that does not exist yet (fresh tree) has nothing to escape
 * through — lexical containment already holds — so it is a no-op.
 */
function assertRealpathInside(root: string, dir: string): void {
  let realRoot: string
  try {
    realRoot = realpathSync(root)
  } catch {
    return // fresh tree: root not created yet; lexical guard already holds.
  }
  let probe = dir
  for (;;) {
    try {
      if (!isPathInsideRoot(realRoot, realpathSync(probe))) {
        throw new PathGuardError('Skill path escapes the skills root via a symlink', 'outside_root')
      }
      return
    } catch (err) {
      if (err instanceof PathGuardError) throw err
      // probe does not exist yet (create) — walk up to the nearest real ancestor.
      const parent = dirname(probe)
      if (parent === probe) {
        throw new PathGuardError('Could not resolve skill path inside the root', 'outside_root')
      }
      probe = parent
    }
  }
}

/** True if the dir is a leaf skill (holds a SKILL.md). */
function isSkillDir(dir: string): boolean {
  return existsSync(join(dir, 'SKILL.md'))
}

/** Does the skill dir carry anything other than SKILL.md? (presence-safe). */
function dirHasExtraFiles(dir: string): boolean {
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  return entries.some((e) => e.name !== 'SKILL.md')
}

/**
 * Read a skill's SKILL.md (presence-safe). Guards the relative path. A missing
 * SKILL.md returns `exists:false` (never throws); only a hostile path throws.
 */
export function readSkillBody(hermesHome: string, relPath: string): SkillBody {
  const dir = resolveSkillDir(hermesHome, relPath)
  let content = ''
  let exists = false
  try {
    content = readFileSync(join(dir, 'SKILL.md'), 'utf8')
    exists = true
  } catch {
    // Missing SKILL.md → exists stays false (presence-safe; never throws).
  }
  return { path: relPath, content, exists, hasExtraFiles: exists && dirHasExtraFiles(dir) }
}

/**
 * Atomic write: temp file in the same dir then rename over the target, so a
 * concurrent reader never sees a half-written file. Mirrors profilesReader.
 */
function atomicWrite(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true })
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, target)
}

/**
 * Write a skill's SKILL.md body ATOMICALLY, confined to the skill dir. The skill
 * must already exist ({@link SkillNotFoundError} otherwise — a body write never
 * conjures a new skill). The relative path is path-guarded.
 */
export function writeSkillBody(hermesHome: string, relPath: string, content: string): void {
  const dir = resolveSkillDir(hermesHome, relPath)
  if (!isSkillDir(dir)) throw new SkillNotFoundError(relPath)
  atomicWrite(join(dir, 'SKILL.md'), content)
}

/** The minimal SKILL.md template a new skill is born with. */
function skillTemplate(name: string): string {
  return `---
name: ${name}
description: ""
---

# ${name}

Describe what this skill does and when the agent should use it.
`
}

/**
 * Create a new skill from the minimal template at `<category?>/<name>/SKILL.md`.
 * Both `name` and the optional `category` must be valid single segments
 * (lowercase id) — anything looser is rejected by the path guard BEFORE any dir
 * is created. Refuses to clobber an existing skill ({@link SkillExistsError}).
 * Returns the relative skill path of the created skill.
 */
export function createSkill(hermesHome: string, name: string, category?: string | null): string {
  if (!SEGMENT_RE.test(name)) {
    throw new PathGuardError('Invalid skill name', 'outside_root')
  }
  if (category != null && category !== '' && !SEGMENT_RE.test(category)) {
    throw new PathGuardError('Invalid skill category', 'outside_root')
  }
  const relPath = category ? `${category}/${name}` : name
  const dir = resolveSkillDir(hermesHome, relPath)
  if (isSkillDir(dir)) throw new SkillExistsError(relPath)
  mkdirSync(dir, { recursive: true })
  atomicWrite(join(dir, 'SKILL.md'), skillTemplate(name))
  return relPath
}

/**
 * Delete a skill's whole directory. Refuses anything that is not a leaf skill (a
 * dir holding a SKILL.md) → {@link SkillNotFoundError}, so a category dir or the
 * skills root can never be removed. The relative path is path-guarded; an empty
 * path (the root) is rejected up front.
 */
export function deleteSkill(hermesHome: string, relPath: string): void {
  const normalized = normalizeRelative(relPath)
  if (normalized === '') {
    throw new PathGuardError('Refusing to delete the skills root', 'outside_root')
  }
  const dir = resolveSkillDir(hermesHome, normalized)
  if (!isSkillDir(dir)) throw new SkillNotFoundError(relPath)
  rmSync(dir, { recursive: true, force: true })
}

/** Read the frontmatter `name:` from a SKILL.md (best-effort, first match). */
function frontmatterName(skillMdPath: string): string | null {
  let raw: string
  try {
    raw = readFileSync(skillMdPath, 'utf8').slice(0, 4000)
  } catch {
    return null
  }
  if (!raw.startsWith('---')) return null
  const end = raw.indexOf('\n---', 3)
  const block = end === -1 ? raw : raw.slice(0, end)
  const m = block.match(/^name:\s*["']?([^"'\n\r]+)["']?\s*$/m)
  return m ? m[1]!.trim() : null
}

/**
 * Map a dashboard skill (its `name` + `category`) back to its on-disk relative
 * path by scanning <HERMES_HOME>/skills for a SKILL.md whose effective name (its
 * frontmatter `name`, else its directory name) matches. The dashboard surfaces
 * the frontmatter name, NOT the path, so this is how the create/edit/delete
 * surface reaches the right directory. Returns the relative path, or null when no
 * match is found (the UI then disables edit/delete for that row, honestly).
 *
 * Excluded dirs (.hub/.archive/.git/…) are skipped, mirroring hermes discovery.
 */
export function resolveSkillPathByName(
  hermesHome: string,
  name: string,
  category: string | null,
): string | null {
  const root = skillsRoot(hermesHome)
  let found: string | null = null

  const walk = (dir: string, rel: string): void => {
    if (found) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    // A SKILL.md here makes this dir a skill leaf — check it.
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
      const skillMd = join(dir, 'SKILL.md')
      const effectiveName = frontmatterName(skillMd) ?? rel.split('/').pop() ?? ''
      if (effectiveName === name) {
        // Category = leading segment when nested ≥1 level, else null.
        const segs = rel.split('/')
        const skillCategory = segs.length >= 2 ? segs[0]! : null
        if ((category ?? null) === skillCategory) {
          found = rel
          return
        }
      }
    }
    for (const e of entries) {
      if (found) return
      if (!e.isDirectory()) continue
      if (EXCLUDED_SKILL_DIRS.has(e.name)) continue
      walk(join(dir, e.name), rel ? `${rel}/${e.name}` : e.name)
    }
  }

  walk(root, '')
  return found
}
