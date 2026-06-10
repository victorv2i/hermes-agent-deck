import { describe, it, expect } from 'vitest'
import {
  filterSections,
  formatValue,
  isUnset,
  listItems,
  prettyCategory,
  prettyLabel,
  UNSET,
} from './format'
import type { SettingsSection } from './types'

describe('formatValue', () => {
  it('renders booleans as Enabled/Disabled', () => {
    expect(formatValue(true)).toBe('Enabled')
    expect(formatValue(false)).toBe('Disabled')
  })

  it('renders an empty string / null / undefined as the friendly "Not set" placeholder', () => {
    expect(formatValue('')).toBe(UNSET)
    expect(formatValue(null)).toBe(UNSET)
    expect(formatValue(undefined)).toBe(UNSET)
    expect(UNSET).toBe('Not set')
  })

  it('renders numbers and non-empty strings verbatim', () => {
    expect(formatValue(90)).toBe('90')
    expect(formatValue('anthropic/claude')).toBe('anthropic/claude')
  })

  it('renders an empty array as "Not set" and a populated one comma-joined', () => {
    expect(formatValue([])).toBe(UNSET)
    expect(formatValue(['a', 'b'])).toBe('a, b')
  })

  it('renders an empty object as "Not set" and a populated one as pretty JSON', () => {
    expect(formatValue({})).toBe(UNSET)
    expect(formatValue({ a: 1 })).toBe('{\n  "a": 1\n}')
  })
})

describe('isUnset', () => {
  it('treats empty primitives, arrays and objects as unset', () => {
    expect(isUnset(null)).toBe(true)
    expect(isUnset(undefined)).toBe(true)
    expect(isUnset('')).toBe(true)
    expect(isUnset([])).toBe(true)
    expect(isUnset({})).toBe(true)
  })

  it('treats present values as set', () => {
    expect(isUnset(false)).toBe(false)
    expect(isUnset(0)).toBe(false)
    expect(isUnset('x')).toBe(false)
    expect(isUnset(['a'])).toBe(false)
    expect(isUnset({ a: 1 })).toBe(false)
  })
})

describe('listItems', () => {
  it('returns the items of a non-empty array as strings', () => {
    expect(listItems(['Bash(ls)', 'Read'])).toEqual(['Bash(ls)', 'Read'])
    expect(listItems([1, 2])).toEqual(['1', '2'])
  })

  it('returns an empty array for unset / non-list values', () => {
    expect(listItems([])).toEqual([])
    expect(listItems('not a list')).toEqual([])
    expect(listItems(null)).toEqual([])
  })
})

describe('prettyCategory', () => {
  it('Title-cases a category id', () => {
    expect(prettyCategory('general')).toBe('General')
    expect(prettyCategory('tts')).toBe('Text-to-Speech')
    expect(prettyCategory('stt')).toBe('Speech-to-Text')
  })

  it('renders known abbreviations with plain-language names (no raw "Mcp" or "Llm")', () => {
    expect(prettyCategory('mcp')).toBe('Connections (MCP)')
    expect(prettyCategory('llm')).toBe('Language Model')
    expect(prettyCategory('api')).toBe('API')
    expect(prettyCategory('auxiliary')).toBe('Extra AI Models')
  })
})

describe('filterSections', () => {
  const sections: SettingsSection[] = [
    {
      category: 'general',
      fields: [
        {
          key: 'model',
          label: 'model',
          description: 'Default model',
          type: 'string',
          value: 'x',
          isSecret: false,
        },
        {
          key: 'compression.enabled',
          label: 'enabled',
          description: 'Compression',
          type: 'boolean',
          value: true,
          isSecret: false,
        },
      ],
    },
    {
      category: 'auxiliary',
      fields: [
        {
          key: 'auxiliary.vision.api_key',
          label: 'api_key',
          description: 'Vision key',
          type: 'string',
          value: '••',
          isSecret: true,
        },
      ],
    },
  ]

  it('returns all sections unchanged for a blank query', () => {
    expect(filterSections(sections, '')).toEqual(sections)
    expect(filterSections(sections, '   ')).toEqual(sections)
  })

  it('keeps only fields whose key/label/description match', () => {
    const out = filterSections(sections, 'model')
    expect(out).toHaveLength(1)
    expect(out[0]!.category).toBe('general')
    expect(out[0]!.fields.map((f) => f.key)).toEqual(['model'])
  })

  it('matches the dot-path key case-insensitively', () => {
    const out = filterSections(sections, 'API')
    expect(out).toHaveLength(1)
    expect(out[0]!.category).toBe('auxiliary')
  })

  it('keeps every field when the section CATEGORY matches', () => {
    const out = filterSections(sections, 'general')
    expect(out).toHaveLength(1)
    expect(out[0]!.fields).toHaveLength(2)
  })

  it('drops sections with no matching field', () => {
    expect(filterSections(sections, 'nonexistent')).toEqual([])
  })
})

describe('prettyLabel', () => {
  it('humanizes snake_case into Title Case words', () => {
    expect(prettyLabel('api_key')).toBe('API Key')
    expect(prettyLabel('enabled')).toBe('Enabled')
    expect(prettyLabel('command_allowlist')).toBe('Command Allowlist')
  })

  it('splits camelCase and upper-cases known acronyms', () => {
    expect(prettyLabel('maxTokens')).toBe('Max Tokens')
    expect(prettyLabel('baseUrl')).toBe('Base URL')
  })

  it('spells out speech abbreviations users see in settings', () => {
    expect(prettyLabel('auto_tts')).toBe('Auto Text-to-Speech')
    expect(prettyLabel('stt_provider')).toBe('Speech-to-Text Provider')
  })
})
