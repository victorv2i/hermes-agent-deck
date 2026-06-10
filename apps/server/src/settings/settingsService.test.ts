import { describe, it, expect } from 'vitest'
import { buildSettingsPayload } from './settingsService'
import type { DashboardConfigSchema } from './settingsTypes'
import { REDACTED } from './redact'

const schema: DashboardConfigSchema = {
  category_order: ['general', 'agent', 'auxiliary', 'security'],
  fields: {
    model: { type: 'string', description: 'Default model', category: 'general' },
    'agent.max_turns': { type: 'number', description: 'Agent → Max Turns', category: 'agent' },
    'terminal.backend': {
      type: 'select',
      description: 'Terminal execution backend',
      category: 'terminal',
      options: ['local', 'docker'],
    },
    'auxiliary.vision.api_key': {
      type: 'string',
      description: 'Auxiliary → Vision → Api Key',
      category: 'auxiliary',
    },
    'auxiliary.vision.model': {
      type: 'string',
      description: 'Auxiliary → Vision → Model',
      category: 'auxiliary',
    },
  },
}

const config = {
  model: 'anthropic/claude-sonnet-4.6',
  agent: { max_turns: 90 },
  terminal: { backend: 'local' },
  auxiliary: { vision: { api_key: 'sk-LEAK', model: 'gpt-4o' } },
}

describe('buildSettingsPayload', () => {
  it('groups fields into sections ordered by the schema category_order', () => {
    const payload = buildSettingsPayload(config, schema)
    const cats = payload.sections.map((s) => s.category)
    // general, agent, auxiliary present; "terminal" is appended after the
    // explicit order (it has a field but isn't in category_order).
    expect(cats.slice(0, 3)).toEqual(['general', 'agent', 'auxiliary'])
    expect(cats).toContain('terminal')
    // "security" is in category_order but has no fields → omitted.
    expect(cats).not.toContain('security')
  })

  it('resolves each field value from the (redacted) config by its dot-path', () => {
    const payload = buildSettingsPayload(config, schema)
    const general = payload.sections.find((s) => s.category === 'general')!
    const modelField = general.fields.find((f) => f.key === 'model')!
    expect(modelField.value).toBe('anthropic/claude-sonnet-4.6')
    expect(modelField.type).toBe('string')

    const agent = payload.sections.find((s) => s.category === 'agent')!
    expect(agent.fields.find((f) => f.key === 'agent.max_turns')!.value).toBe(90)
  })

  it('never surfaces a real secret — api_key fields come back redacted', () => {
    const payload = buildSettingsPayload(config, schema)
    const aux = payload.sections.find((s) => s.category === 'auxiliary')!
    const keyField = aux.fields.find((f) => f.key === 'auxiliary.vision.api_key')!
    expect(keyField.value).toBe(REDACTED)
    expect(keyField.isSecret).toBe(true)
    // and the model sibling is untouched
    expect(aux.fields.find((f) => f.key === 'auxiliary.vision.model')!.value).toBe('gpt-4o')
    // hard guarantee: the whole serialized payload never carries the secret
    expect(JSON.stringify(payload)).not.toContain('sk-LEAK')
  })

  it('marks select fields with their options', () => {
    const payload = buildSettingsPayload(config, schema)
    const term = payload.sections.find((s) => s.category === 'terminal')!
    const backend = term.fields.find((f) => f.key === 'terminal.backend')!
    expect(backend.type).toBe('select')
    expect(backend.options).toEqual(['local', 'docker'])
  })

  it('uses null for a field whose value is absent from the config', () => {
    const sparseConfig = { model: 'm' }
    const payload = buildSettingsPayload(sparseConfig, schema)
    const agent = payload.sections.find((s) => s.category === 'agent')!
    expect(agent.fields.find((f) => f.key === 'agent.max_turns')!.value).toBeNull()
  })

  it('reports the surface is read-only (v1)', () => {
    const payload = buildSettingsPayload(config, schema)
    expect(payload.editable).toBe(false)
  })
})
