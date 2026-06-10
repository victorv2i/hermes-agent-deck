import { describe, it, expect } from 'vitest'
import { splitDedicatedSections, hasAuxiliaryModelRows } from './dedicatedConfig'
import type { SettingsField, SettingsSection } from './types'

function field(key: string, extra: Partial<SettingsField> = {}): SettingsField {
  const seg = key.split('.').pop() ?? key
  return {
    key,
    label: seg,
    description: key,
    type: 'string',
    value: 'x',
    isSecret: false,
    ...extra,
  }
}

function section(category: string, keys: string[]): SettingsSection {
  return { category, fields: keys.map((k) => field(k)) }
}

describe('splitDedicatedSections', () => {
  it('drops voice config (tts/stt/voice/audio categories) and reports the voice domain', () => {
    const sections: SettingsSection[] = [
      section('general', ['model']),
      section('tts', ['tts.provider', 'tts.elevenlabs.voice_id']),
      section('stt', ['stt.enabled']),
      section('voice', ['voice.auto_tts', 'voice.beep_enabled']),
    ]
    const { kept, dropped } = splitDedicatedSections(sections)
    // The dump no longer carries any voice block category.
    expect(kept.map((s) => s.category)).toEqual(['general'])
    expect(dropped).toContain('voice')
  })

  it('drops voice config matched by key-prefix even under a differently-named category', () => {
    const sections: SettingsSection[] = [
      {
        category: 'general',
        fields: [field('model'), field('voice.auto_tts', { type: 'boolean' })],
      },
    ]
    const { kept, dropped } = splitDedicatedSections(sections)
    const general = kept.find((s) => s.category === 'general')!
    expect(general.fields.map((f) => f.key)).toEqual(['model'])
    expect(dropped).toContain('voice')
  })

  it('drops only auxiliary model/provider rows, keeping other auxiliary fields', () => {
    const sections: SettingsSection[] = [
      section('auxiliary', [
        'auxiliary.vision.model',
        'auxiliary.vision.provider',
        'auxiliary.vision.api_key',
        'auxiliary.vision.enabled',
      ]),
    ]
    const { kept } = splitDedicatedSections(sections)
    const aux = kept.find((s) => s.category === 'auxiliary')!
    expect(aux.fields.map((f) => f.key)).toEqual([
      'auxiliary.vision.api_key',
      'auxiliary.vision.enabled',
    ])
  })

  it('does NOT fold auxiliary model rows into a separate dropped domain (they belong to Models)', () => {
    const sections: SettingsSection[] = [section('auxiliary', ['auxiliary.vision.model'])]
    const { dropped } = splitDedicatedSections(sections)
    // auxiliary model rows fold into the existing Models link, not a new card.
    expect(dropped).not.toContain('auxiliary')
  })

  it('reports whether any auxiliary model row was dropped (for the Models note)', () => {
    expect(hasAuxiliaryModelRows([section('auxiliary', ['auxiliary.vision.model'])])).toBe(true)
    expect(hasAuxiliaryModelRows([section('auxiliary', ['auxiliary.vision.api_key'])])).toBe(false)
    expect(hasAuxiliaryModelRows([section('general', ['model'])])).toBe(false)
  })

  it('drops messaging platform tokens and reports the messaging domain', () => {
    const sections: SettingsSection[] = [
      section('messaging', ['telegram.bot_token', 'discord.bot_token']),
      section('general', ['model']),
    ]
    const { kept, dropped } = splitDedicatedSections(sections)
    expect(kept.map((s) => s.category)).toEqual(['general'])
    expect(dropped).toContain('messaging')
  })

  it('drops mcp / mcp_servers config and reports the mcp domain', () => {
    const sections: SettingsSection[] = [
      section('mcp', ['mcp_servers']),
      section('general', ['model']),
    ]
    const { kept, dropped } = splitDedicatedSections(sections)
    expect(kept.map((s) => s.category)).toEqual(['general'])
    expect(dropped).toContain('mcp')
  })

  it('drops the memory category ONLY when the schema emits it', () => {
    // present → dropped + reported
    const withMemory: SettingsSection[] = [
      section('memory', ['memory.provider', 'memory.limit']),
      section('general', ['model']),
    ]
    const a = splitDedicatedSections(withMemory)
    expect(a.kept.map((s) => s.category)).toEqual(['general'])
    expect(a.dropped).toContain('memory')

    // absent → no memory domain reported, nothing dropped
    const noMemory: SettingsSection[] = [section('general', ['model'])]
    const b = splitDedicatedSections(noMemory)
    expect(b.dropped).not.toContain('memory')
  })

  it('keeps the canonical app/general config in the dump', () => {
    const sections: SettingsSection[] = [
      section('general', ['model', 'compression.enabled']),
      section('agent', ['agent.max_turns']),
      section('tools', ['tools.command_allowlist']),
      section('security', ['security.something']),
      section('gateway', ['gateway.port']),
    ]
    const { kept, dropped } = splitDedicatedSections(sections)
    expect(kept.map((s) => s.category)).toEqual([
      'general',
      'agent',
      'tools',
      'security',
      'gateway',
    ])
    expect(dropped).toEqual([])
  })

  it('drops a section entirely when all its fields are dedicated', () => {
    const sections: SettingsSection[] = [section('tts', ['tts.provider'])]
    const { kept } = splitDedicatedSections(sections)
    expect(kept).toEqual([])
  })

  it('reports dropped domains in a stable order regardless of section order', () => {
    const sections: SettingsSection[] = [
      section('mcp', ['mcp_servers']),
      section('voice', ['voice.auto_tts']),
      section('messaging', ['telegram.bot_token']),
      section('memory', ['memory.provider']),
    ]
    const { dropped } = splitDedicatedSections(sections)
    expect(dropped).toEqual(['voice', 'messaging', 'mcp', 'memory'])
  })
})
