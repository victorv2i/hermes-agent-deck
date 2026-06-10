import { describe, it, expect } from 'vitest'
import {
  AgentDeckSkill,
  AgentDeckSkillsResponse,
  AgentDeckSkillToggleRequest,
  AgentDeckSkillToggleResponse,
} from './skills'

describe('AgentDeckSkill DTO', () => {
  it('parses a categorized, enabled skill', () => {
    const parsed = AgentDeckSkill.parse({
      name: 'axolotl',
      description: 'Fine-tune models with axolotl.',
      category: 'mlops',
      enabled: true,
    })
    expect(parsed.name).toBe('axolotl')
    expect(parsed.category).toBe('mlops')
    expect(parsed.enabled).toBe(true)
  })

  it('allows a null category (uncategorized top-level skill)', () => {
    const parsed = AgentDeckSkill.parse({
      name: 'init',
      description: 'Initialize a starter project file.',
      category: null,
      enabled: false,
    })
    expect(parsed.category).toBeNull()
    expect(parsed.enabled).toBe(false)
  })

  it('whitelists exactly the four display fields (drops on-disk leaks)', () => {
    const parsed = AgentDeckSkill.parse({
      name: 'axolotl',
      description: 'desc',
      category: 'mlops',
      enabled: true,
      // backend-side fields that must never reach the client:
      path: '/home/operator/.hermes/skills/mlops/axolotl/SKILL.md',
      frontmatter: { secret: 'x' },
    })
    expect(Object.keys(parsed).sort()).toEqual(
      ['category', 'description', 'enabled', 'name'].sort(),
    )
    expect(parsed).not.toHaveProperty('path')
    expect(parsed).not.toHaveProperty('frontmatter')
  })

  it('rejects a non-boolean enabled', () => {
    expect(() =>
      AgentDeckSkill.parse({ name: 'x', description: '', category: null, enabled: 'yes' }),
    ).toThrow()
  })
})

describe('AgentDeckSkillsResponse DTO', () => {
  it('parses a list response', () => {
    const parsed = AgentDeckSkillsResponse.parse({
      skills: [
        { name: 'a', description: '', category: 'mlops', enabled: true },
        { name: 'b', description: 'desc', category: null, enabled: false },
      ],
    })
    expect(parsed.skills).toHaveLength(2)
    expect(parsed.skills[1]!.category).toBeNull()
  })
})

describe('AgentDeckSkillToggle DTOs', () => {
  it('parses a valid toggle request', () => {
    const parsed = AgentDeckSkillToggleRequest.parse({ name: 'axolotl', enabled: false })
    expect(parsed).toEqual({ name: 'axolotl', enabled: false })
  })

  it('rejects an empty skill name', () => {
    expect(() => AgentDeckSkillToggleRequest.parse({ name: '', enabled: true })).toThrow()
  })

  it('rejects a missing enabled flag', () => {
    expect(() => AgentDeckSkillToggleRequest.parse({ name: 'axolotl' })).toThrow()
  })

  it('parses a toggle response', () => {
    const parsed = AgentDeckSkillToggleResponse.parse({ name: 'axolotl', enabled: true })
    expect(parsed).toEqual({ name: 'axolotl', enabled: true })
  })
})
