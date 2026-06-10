import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readSkillBody,
  writeSkillBody,
  createSkill,
  deleteSkill,
  resolveSkillPathByName,
  SkillNotFoundError,
  SkillExistsError,
} from './skillsFs'
import { PathGuardError } from '../files/pathGuard'

/**
 * skillsFs operates on the on-disk skills tree under <HERMES_HOME>/skills. A
 * skill's IDENTITY is its directory path relative to that root (e.g.
 * `creative/ascii-art` or `dogfood`) — unambiguous + path-guardable. Each leaf
 * holds a SKILL.md (the editable body). These tests use a real temp HERMES_HOME.
 */

let home: string
const skill = (rel: string, body: string) => {
  const dir = join(home, 'skills', rel)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), body, 'utf8')
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ad-skills-'))
  mkdirSync(join(home, 'skills'), { recursive: true })
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('symlink-escape guard (realpath re-assertion, parity with resolveProfileDir)', () => {
  it('refuses to write a skill dir that is a symlink pointing OUTSIDE the skills root', () => {
    // Attacker-planted symlink: <skills>/evil -> <outside>/target (holds a SKILL.md).
    // The lexical path `skills/evil` is in-root, but the realpath escapes.
    const outside = mkdtempSync(join(tmpdir(), 'ad-outside-'))
    mkdirSync(join(outside, 'target'), { recursive: true })
    writeFileSync(join(outside, 'target', 'SKILL.md'), '# OUTSIDE\nuntouched', 'utf8')
    symlinkSync(join(outside, 'target'), join(home, 'skills', 'evil'))

    expect(() => writeSkillBody(home, 'evil', '# CLOBBERED')).toThrow(PathGuardError)
    // The out-of-root file is UNTOUCHED.
    expect(readFileSync(join(outside, 'target', 'SKILL.md'), 'utf8')).toContain('untouched')
    rmSync(outside, { recursive: true, force: true })
  })

  it('refuses to create a skill under a symlinked category that escapes the root', () => {
    const outside = mkdtempSync(join(tmpdir(), 'ad-outside-'))
    symlinkSync(outside, join(home, 'skills', 'evilcat'))
    expect(() => createSkill(home, 'newskill', 'evilcat')).toThrow(PathGuardError)
    expect(existsSync(join(outside, 'newskill'))).toBe(false)
    rmSync(outside, { recursive: true, force: true })
  })

  it('still allows an IN-ROOT symlink (resolves inside the skills root)', () => {
    skill('real/skill', '# Real')
    symlinkSync(join(home, 'skills', 'real'), join(home, 'skills', 'alias'))
    // alias/skill resolves to real/skill, still inside the root → allowed.
    expect(() => writeSkillBody(home, 'alias/skill', '# Edited')).not.toThrow()
  })
})

describe('readSkillBody', () => {
  it('reads a nested skill SKILL.md and reports no extra files', () => {
    skill('creative/ascii-art', '# ASCII\nhello')
    const res = readSkillBody(home, 'creative/ascii-art')
    expect(res.exists).toBe(true)
    expect(res.content).toContain('# ASCII')
    expect(res.hasExtraFiles).toBe(false)
  })

  it('reads a top-level (uncategorized) skill', () => {
    skill('dogfood', '# Dogfood')
    const res = readSkillBody(home, 'dogfood')
    expect(res.exists).toBe(true)
    expect(res.content).toContain('# Dogfood')
  })

  it('flags a skill that carries extra linked files (deferred scope)', () => {
    skill('creative/p5js', '# p5js')
    writeFileSync(join(home, 'skills', 'creative/p5js', 'README.md'), 'extra', 'utf8')
    mkdirSync(join(home, 'skills', 'creative/p5js', 'scripts'), { recursive: true })
    const res = readSkillBody(home, 'creative/p5js')
    expect(res.hasExtraFiles).toBe(true)
  })

  it('returns exists:false for a missing SKILL.md without throwing', () => {
    mkdirSync(join(home, 'skills', 'empty'), { recursive: true })
    const res = readSkillBody(home, 'empty')
    expect(res.exists).toBe(false)
    expect(res.content).toBe('')
  })

  it('rejects a traversal path (fail-closed)', () => {
    expect(() => readSkillBody(home, '../../etc/passwd')).toThrow(PathGuardError)
  })

  it('neutralizes a leading slash to an in-root (non-escaping) path', () => {
    // normalizeRelative strips the leading slash → `/etc` becomes the in-root
    // `etc`, a benign non-existent skill (NOT an escape to the real /etc).
    const res = readSkillBody(home, '/etc')
    expect(res.exists).toBe(false)
  })
})

describe('writeSkillBody', () => {
  it('writes the SKILL.md body of an existing skill', () => {
    skill('mlops/axolotl', '# old')
    writeSkillBody(home, 'mlops/axolotl', '# new body')
    expect(readFileSync(join(home, 'skills', 'mlops/axolotl', 'SKILL.md'), 'utf8')).toBe(
      '# new body',
    )
  })

  it('throws SkillNotFoundError when the skill dir does not exist (never conjures one)', () => {
    expect(() => writeSkillBody(home, 'ghost/skill', '# x')).toThrow(SkillNotFoundError)
    expect(existsSync(join(home, 'skills', 'ghost'))).toBe(false)
  })

  it('rejects a traversal path before any write', () => {
    expect(() => writeSkillBody(home, '..\\..\\evil', '# x')).toThrow(PathGuardError)
  })
})

describe('createSkill', () => {
  it('creates a new skill dir + SKILL.md from a minimal template', () => {
    const rel = createSkill(home, 'my-skill')
    expect(rel).toBe('my-skill')
    const md = readFileSync(join(home, 'skills', 'my-skill', 'SKILL.md'), 'utf8')
    expect(md).toContain('name: my-skill')
    expect(md).toContain('description:')
  })

  it('creates a categorized skill under a (possibly new) category dir', () => {
    const rel = createSkill(home, 'tagger', 'productivity')
    expect(rel).toBe('productivity/tagger')
    expect(existsSync(join(home, 'skills', 'productivity', 'tagger', 'SKILL.md'))).toBe(true)
  })

  it('throws SkillExistsError when a SKILL.md already lives there', () => {
    skill('dup', '# already here')
    expect(() => createSkill(home, 'dup')).toThrow(SkillExistsError)
    // existing content untouched
    expect(readFileSync(join(home, 'skills', 'dup', 'SKILL.md'), 'utf8')).toBe('# already here')
  })

  it('rejects an invalid skill name (fail-closed, no dir created)', () => {
    expect(() => createSkill(home, 'Bad Name!')).toThrow(PathGuardError)
    expect(() => createSkill(home, '../escape')).toThrow(PathGuardError)
  })

  it('rejects an invalid category', () => {
    expect(() => createSkill(home, 'ok', '../evil')).toThrow(PathGuardError)
  })
})

describe('deleteSkill', () => {
  it('deletes the whole skill directory', () => {
    skill('throwaway/temp', '# temp')
    deleteSkill(home, 'throwaway/temp')
    expect(existsSync(join(home, 'skills', 'throwaway/temp'))).toBe(false)
  })

  it('throws SkillNotFoundError when the dir has no SKILL.md (refuses to nuke a non-skill)', () => {
    mkdirSync(join(home, 'skills', 'creative'), { recursive: true })
    expect(() => deleteSkill(home, 'creative')).toThrow(SkillNotFoundError)
    // the category dir is NOT removed
    expect(existsSync(join(home, 'skills', 'creative'))).toBe(true)
  })

  it('rejects a traversal path before any delete', () => {
    expect(() => deleteSkill(home, '../../home')).toThrow(PathGuardError)
  })

  it('refuses to delete the skills root itself', () => {
    expect(() => deleteSkill(home, '')).toThrow(PathGuardError)
  })
})

describe('resolveSkillPathByName', () => {
  it('maps a dashboard skill (name + category) to its on-disk relative path', () => {
    skill('creative/ascii-art', '---\nname: ascii-art\n---\n# A')
    skill('dogfood', '---\nname: dogfood\n---\n# D')
    expect(resolveSkillPathByName(home, 'ascii-art', 'creative')).toBe('creative/ascii-art')
    expect(resolveSkillPathByName(home, 'dogfood', null)).toBe('dogfood')
  })

  it('falls back to the directory name when frontmatter has no name', () => {
    skill('mlops/axolotl', '# no frontmatter name')
    expect(resolveSkillPathByName(home, 'axolotl', 'mlops')).toBe('mlops/axolotl')
  })

  it('returns null when no matching skill is found', () => {
    skill('creative/ascii-art', '---\nname: ascii-art\n---')
    expect(resolveSkillPathByName(home, 'nonexistent', 'creative')).toBeNull()
  })

  it('skips excluded dirs (.hub/.archive/.git)', () => {
    skill('.archive/old', '---\nname: old\n---')
    expect(resolveSkillPathByName(home, 'old', null)).toBeNull()
  })
})
