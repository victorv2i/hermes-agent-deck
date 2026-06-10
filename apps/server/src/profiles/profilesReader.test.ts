import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readProfiles,
  readSoul,
  readMemory,
  readUserMemory,
  writeSoul,
  writeAvatar,
  writeActiveProfile,
  readProfileAvatar,
  ProfileNotFoundError,
} from './profilesReader'
import { PathGuardError } from '../files/pathGuard'

/**
 * The profiles surface reads the filesystem directly because Hermes' dashboard
 * profile route is minimal and path-bearing. The authoritative shape comes from
 * hermes_cli's
 * profiles.py:
 *  - "default" === HERMES_HOME (~/.hermes) itself, always listed first
 *  - named profiles live under <home>/profiles/<name>/, name matching
 *    /^[a-z0-9][a-z0-9_-]{0,63}$/
 *  - active profile is the trimmed content of <home>/active_profile; an
 *    absent/empty file means "default"
 *  - per-profile metadata: model/provider (from config.yaml `model`), whether a
 *    gateway is running (gateway.pid present + live pid), whether a .env exists,
 *    and a skill count (SKILL.md files under skills/, excluding .hub/.git).
 */

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'hermes-profiles-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

function writeYaml(dir: string, body: string): void {
  writeFileSync(join(dir, 'config.yaml'), body, 'utf8')
}

describe('readProfiles', () => {
  it('always lists the default profile (= HERMES_HOME) even with no profiles dir', () => {
    const result = readProfiles(home)
    expect(result.active).toBe('default')
    expect(result.profiles).toHaveLength(1)
    const def = result.profiles[0]!
    expect(def.name).toBe('default')
    expect(def.isDefault).toBe(true)
    expect(def.displayPath).toBe('Hermes home')
  })

  it('reads model + provider from the default profile config.yaml (nested model map)', () => {
    writeYaml(home, 'model:\n  default: gpt-5.5\n  provider: openai-codex\n')
    const result = readProfiles(home)
    const def = result.profiles[0]!
    expect(def.model).toBe('gpt-5.5')
    expect(def.provider).toBe('openai-codex')
  })

  it('reads a bare string model (model: foo) with no provider', () => {
    writeYaml(home, 'model: claude-opus\n')
    const def = readProfiles(home).profiles[0]!
    expect(def.model).toBe('claude-opus')
    expect(def.provider).toBeNull()
  })

  it('falls back to model.model when model.default is absent', () => {
    writeYaml(home, 'model:\n  model: hermes-4\n  provider: nous\n')
    const def = readProfiles(home).profiles[0]!
    expect(def.model).toBe('hermes-4')
    expect(def.provider).toBe('nous')
  })

  it('reports null model/provider when config.yaml is missing or malformed', () => {
    const a = readProfiles(home).profiles[0]!
    expect(a.model).toBeNull()
    expect(a.provider).toBeNull()
    writeYaml(home, ': : not yaml : :\n\t- broken')
    const b = readProfiles(home).profiles[0]!
    expect(b.model).toBeNull()
  })

  it('enumerates named profiles under profiles/, sorted, default first', () => {
    mkdirSync(join(home, 'profiles', 'zeta'), { recursive: true })
    mkdirSync(join(home, 'profiles', 'coder'), { recursive: true })
    writeYaml(join(home, 'profiles', 'coder'), 'model:\n  default: sonnet\n')
    const result = readProfiles(home)
    expect(result.profiles.map((p) => p.name)).toEqual(['default', 'coder', 'zeta'])
    const coder = result.profiles.find((p) => p.name === 'coder')!
    expect(coder.isDefault).toBe(false)
    expect(coder.model).toBe('sonnet')
    expect(coder.displayPath).toBe('profiles/coder')
  })

  it('ignores non-directory entries and names that violate the profile id pattern', () => {
    mkdirSync(join(home, 'profiles'), { recursive: true })
    writeFileSync(join(home, 'profiles', 'a-file.txt'), 'x')
    mkdirSync(join(home, 'profiles', 'Bad_Caps'))
    mkdirSync(join(home, 'profiles', '-leading-dash'))
    mkdirSync(join(home, 'profiles', 'good-one'))
    const names = readProfiles(home).profiles.map((p) => p.name)
    expect(names).toEqual(['default', 'good-one'])
  })

  it('resolves the active profile from active_profile (trimmed), absent => default', () => {
    mkdirSync(join(home, 'profiles', 'coder'), { recursive: true })
    writeFileSync(join(home, 'active_profile'), '  coder\n')
    expect(readProfiles(home).active).toBe('coder')
  })

  it('treats an empty active_profile file as default', () => {
    writeFileSync(join(home, 'active_profile'), '\n')
    expect(readProfiles(home).active).toBe('default')
  })

  it('marks the matching profile active=true and others active=false', () => {
    mkdirSync(join(home, 'profiles', 'coder'), { recursive: true })
    writeFileSync(join(home, 'active_profile'), 'coder')
    const result = readProfiles(home)
    expect(result.profiles.find((p) => p.name === 'coder')!.isActive).toBe(true)
    expect(result.profiles.find((p) => p.name === 'default')!.isActive).toBe(false)
  })

  it('detects a .env file (hasEnv) per profile', () => {
    writeFileSync(join(home, '.env'), 'API_SERVER_KEY=secret-should-not-leak')
    mkdirSync(join(home, 'profiles', 'coder'), { recursive: true })
    const result = readProfiles(home)
    expect(result.profiles.find((p) => p.name === 'default')!.hasEnv).toBe(true)
    expect(result.profiles.find((p) => p.name === 'coder')!.hasEnv).toBe(false)
  })

  it('never includes raw config / .env contents or secrets in the result', () => {
    writeFileSync(join(home, '.env'), 'API_SERVER_KEY=super-secret-value')
    writeYaml(home, 'model:\n  default: gpt-5.5\nAPI_SERVER_KEY: another-secret\n')
    const serialized = JSON.stringify(readProfiles(home))
    expect(serialized).not.toContain('super-secret-value')
    expect(serialized).not.toContain('another-secret')
    expect(serialized).not.toContain('API_SERVER_KEY')
  })

  it('never returns absolute profile paths to the browser-facing summary', () => {
    mkdirSync(join(home, 'profiles', 'coder'), { recursive: true })
    const serialized = JSON.stringify(readProfiles(home))
    expect(serialized).not.toContain(home)
    expect(serialized).toContain('profiles/coder')
  })

  it('counts skills (SKILL.md) excluding .hub and .git directories', () => {
    const skills = join(home, 'skills')
    mkdirSync(join(skills, 'alpha'), { recursive: true })
    writeFileSync(join(skills, 'alpha', 'SKILL.md'), '# alpha')
    mkdirSync(join(skills, 'beta'), { recursive: true })
    writeFileSync(join(skills, 'beta', 'SKILL.md'), '# beta')
    mkdirSync(join(skills, '.hub', 'cached'), { recursive: true })
    writeFileSync(join(skills, '.hub', 'cached', 'SKILL.md'), '# hub copy')
    mkdirSync(join(skills, '.git', 'objects'), { recursive: true })
    writeFileSync(join(skills, '.git', 'objects', 'SKILL.md'), '# not a skill')
    expect(readProfiles(home).profiles[0]!.skillCount).toBe(2)
  })

  it('reports gatewayRunning=false when there is no gateway.pid', () => {
    expect(readProfiles(home).profiles[0]!.gatewayRunning).toBe(false)
  })

  it('reports gatewayRunning=true when gateway.pid holds the live test process pid', () => {
    writeFileSync(join(home, 'gateway.pid'), JSON.stringify({ pid: process.pid }))
    expect(readProfiles(home).profiles[0]!.gatewayRunning).toBe(true)
  })

  it('reports gatewayRunning=false for a bare numeric pid that is not alive', () => {
    // PID 2^31-1 is effectively never a live process.
    writeFileSync(join(home, 'gateway.pid'), '2147483647')
    expect(readProfiles(home).profiles[0]!.gatewayRunning).toBe(false)
  })
})

/**
 * SOUL / MEMORY / USER readers + the SOUL writer. The profile dir for the
 * "default" profile IS HERMES_HOME; named profiles live under
 * <home>/profiles/<name>/. Verified file layout (hermes_cli/profiles.py):
 *   ${profile_dir}/SOUL.md
 *   ${profile_dir}/memories/MEMORY.md
 *   ${profile_dir}/memories/USER.md
 * Reads are presence-safe (never throw → { content, exists }); the SOUL write is
 * confined to the profile dir by the Files path guard.
 */
describe('readSoul / readMemory / readUserMemory', () => {
  it('reads SOUL.md for the default profile (= HERMES_HOME)', () => {
    writeFileSync(join(home, 'SOUL.md'), '# Soul\nbe kind\n')
    const out = readSoul(home, 'default')
    expect(out.exists).toBe(true)
    expect(out.content).toBe('# Soul\nbe kind\n')
  })

  it('reads SOUL.md for a named profile from profiles/<name>/SOUL.md', () => {
    mkdirSync(join(home, 'profiles', 'coder'), { recursive: true })
    writeFileSync(join(home, 'profiles', 'coder', 'SOUL.md'), 'coder soul')
    const out = readSoul(home, 'coder')
    expect(out.exists).toBe(true)
    expect(out.content).toBe('coder soul')
  })

  it('returns exists:false and empty content when SOUL.md is missing', () => {
    const out = readSoul(home, 'default')
    expect(out.exists).toBe(false)
    expect(out.content).toBe('')
  })

  it('reads memories/MEMORY.md', () => {
    mkdirSync(join(home, 'memories'), { recursive: true })
    writeFileSync(join(home, 'memories', 'MEMORY.md'), '# Memory Index\n')
    const out = readMemory(home, 'default')
    expect(out.exists).toBe(true)
    expect(out.content).toBe('# Memory Index\n')
  })

  it('returns exists:false when memories/MEMORY.md is missing', () => {
    const out = readMemory(home, 'default')
    expect(out.exists).toBe(false)
    expect(out.content).toBe('')
  })

  it('reads memories/USER.md', () => {
    mkdirSync(join(home, 'profiles', 'coder', 'memories'), { recursive: true })
    writeFileSync(join(home, 'profiles', 'coder', 'memories', 'USER.md'), 'about the user')
    const out = readUserMemory(home, 'coder')
    expect(out.exists).toBe(true)
    expect(out.content).toBe('about the user')
  })

  it('rejects a profile name that escapes the home dir (path traversal)', () => {
    // A malicious "name" must never resolve outside <home>/profiles.
    expect(() => readSoul(home, '../../etc')).toThrow(PathGuardError)
  })
})

describe('writeSoul', () => {
  it('creates SOUL.md for the default profile and round-trips', () => {
    writeSoul(home, 'default', '# New soul\n')
    expect(readFileSync(join(home, 'SOUL.md'), 'utf8')).toBe('# New soul\n')
    expect(readSoul(home, 'default').content).toBe('# New soul\n')
  })

  it('overwrites an existing SOUL.md for a named profile', () => {
    mkdirSync(join(home, 'profiles', 'coder'), { recursive: true })
    writeFileSync(join(home, 'profiles', 'coder', 'SOUL.md'), 'old')
    writeSoul(home, 'coder', 'new')
    expect(readFileSync(join(home, 'profiles', 'coder', 'SOUL.md'), 'utf8')).toBe('new')
  })

  it('REJECTS a ../ escape from the profile dir (never writes outside)', () => {
    // The write must be confined to the profile dir by the path guard — a name
    // that walks up cannot land a file outside <home>/profiles.
    expect(() => writeSoul(home, '../../evil', 'pwned')).toThrow(PathGuardError)
  })
})

describe('resolveProfileDir hardening', () => {
  it('rejects a multi-segment or wrongly-cased profile name (single-segment only)', () => {
    // Only single-segment _PROFILE_ID_RE names are valid; looser names the raw
    // guard would merely nest must be rejected up front.
    expect(() => readSoul(home, 'foo/bar')).toThrow(PathGuardError)
    expect(() => readSoul(home, 'Foo')).toThrow(PathGuardError)
  })

  it('rejects a profile dir that symlinks outside the profiles root (symlink defense)', () => {
    // A planted symlink under <home>/profiles must not redirect reads outside HERMES_HOME.
    const outside = mkdtempSync(join(tmpdir(), 'hermes-outside-'))
    try {
      writeFileSync(join(outside, 'SOUL.md'), 'leaked')
      mkdirSync(join(home, 'profiles'), { recursive: true })
      symlinkSync(outside, join(home, 'profiles', 'evil'), 'dir')
      expect(() => readSoul(home, 'evil')).toThrow(PathGuardError)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('avatar read/write (.agent-deck/identity.json)', () => {
  it('reads null when no identity.json is present (default profile)', () => {
    expect(readProfileAvatar(home, 'default')).toBeNull()
    expect(readProfiles(home).profiles[0]!.avatar).toBeNull()
  })

  it('writeAvatar then readProfileAvatar round-trips a governed id', () => {
    writeAvatar(home, 'default', 'v2')
    expect(readProfileAvatar(home, 'default')).toBe('v2')
    expect(JSON.parse(readFileSync(join(home, '.agent-deck', 'identity.json'), 'utf8'))).toEqual({
      avatar: 'v2',
    })
  })

  it('reads null on a garbled / unrecognized identity.json (corruption-safe)', () => {
    mkdirSync(join(home, '.agent-deck'), { recursive: true })
    writeFileSync(join(home, '.agent-deck', 'identity.json'), 'not json {{{')
    expect(readProfileAvatar(home, 'default')).toBeNull()
    writeFileSync(join(home, '.agent-deck', 'identity.json'), JSON.stringify({ avatar: 'v99' }))
    expect(readProfileAvatar(home, 'default')).toBeNull()
  })

  it('writeAvatar to a missing profile throws ProfileNotFoundError', () => {
    expect(() => writeAvatar(home, 'ghost', 'v1')).toThrow(ProfileNotFoundError)
  })

  it('writeAvatar rejects a traversal name via the path guard', () => {
    expect(() => writeAvatar(home, 'foo/bar', 'v1')).toThrow(PathGuardError)
  })

  it('writeAvatar persists a displayName alongside the avatar', () => {
    writeAvatar(home, 'default', 'v3', 'Mercury')
    const raw = JSON.parse(readFileSync(join(home, '.agent-deck', 'identity.json'), 'utf8'))
    expect(raw).toEqual({ avatar: 'v3', displayName: 'Mercury' })
  })

  it('writeAvatar with empty displayName omits the field', () => {
    writeAvatar(home, 'default', 'v3', '')
    const raw = JSON.parse(readFileSync(join(home, '.agent-deck', 'identity.json'), 'utf8'))
    expect(raw).toEqual({ avatar: 'v3' })
  })

  it('writeAvatar without displayName does not add the field', () => {
    writeAvatar(home, 'default', 'v3')
    const raw = JSON.parse(readFileSync(join(home, '.agent-deck', 'identity.json'), 'utf8'))
    expect(raw).toEqual({ avatar: 'v3' })
  })

  it('writeAvatar without a displayName PRESERVES an existing one (an avatar-only edit must not wipe the name)', () => {
    writeAvatar(home, 'default', 'v2', 'Mercury')
    writeAvatar(home, 'default', 'v3') // avatar-only edit — no displayName passed
    const raw = JSON.parse(readFileSync(join(home, '.agent-deck', 'identity.json'), 'utf8'))
    expect(raw).toEqual({ avatar: 'v3', displayName: 'Mercury' })
  })

  it('writeAvatar with an explicit blank displayName CLEARS a previously-set name', () => {
    writeAvatar(home, 'default', 'v2', 'Mercury')
    writeAvatar(home, 'default', 'v3', '') // explicit clear
    const raw = JSON.parse(readFileSync(join(home, '.agent-deck', 'identity.json'), 'utf8'))
    expect(raw).toEqual({ avatar: 'v3' })
  })

  it('readProfiles surfaces displayName from identity.json', () => {
    writeAvatar(home, 'default', 'v3', 'Mercury')
    const profile = readProfiles(home).profiles[0]!
    expect(profile.displayName).toBe('Mercury')
  })

  it('readProfiles sets displayName to null when identity.json has no displayName', () => {
    writeAvatar(home, 'default', 'v3')
    const profile = readProfiles(home).profiles[0]!
    expect(profile.displayName).toBeNull()
  })

  it('readProfiles sets displayName to null when no identity.json exists', () => {
    const profile = readProfiles(home).profiles[0]!
    expect(profile.displayName).toBeNull()
  })
})

describe('writeActiveProfile (atomic active_profile switch)', () => {
  it('writes the name and the list reads it back as active', () => {
    mkdirSync(join(home, 'profiles', 'coder'), { recursive: true })
    writeActiveProfile(home, 'coder')
    expect(readFileSync(join(home, 'active_profile'), 'utf8').trim()).toBe('coder')
    expect(readProfiles(home).active).toBe('coder')
  })

  it('accepts the literal "default" (clears the sticky pointer)', () => {
    writeFileSync(join(home, 'active_profile'), 'coder\n')
    writeActiveProfile(home, 'default')
    expect(readProfiles(home).active).toBe('default')
    expect(() => readFileSync(join(home, 'active_profile'), 'utf8')).toThrow()
  })

  it('rejects an invalid name (no write)', () => {
    expect(() => writeActiveProfile(home, 'Bad Name')).toThrow(PathGuardError)
    expect(() => writeActiveProfile(home, '../evil')).toThrow(PathGuardError)
  })
})
