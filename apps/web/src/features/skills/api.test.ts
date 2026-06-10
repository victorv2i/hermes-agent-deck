import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  fetchSkills,
  fetchSkillBody,
  writeSkillBody,
  createSkill,
  deleteSkill,
  normalizeSkillsResponse,
  toggleSkill,
} from './api'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('normalizeSkillsResponse', () => {
  it('keeps well-formed skills and resolves enabled', () => {
    const res = normalizeSkillsResponse({
      skills: [
        { name: 'axolotl', description: 'd', category: 'mlops', enabled: true },
        { name: 'verify', description: '', category: 'qa', enabled: false },
      ],
    })
    expect(res.skills).toHaveLength(2)
    expect(res.skills[1]!.enabled).toBe(false)
  })

  it('coerces empty/missing category to null', () => {
    const res = normalizeSkillsResponse({
      skills: [{ name: 'init', description: 'd', category: '', enabled: true }],
    })
    expect(res.skills[0]!.category).toBeNull()
  })

  it('drops nameless entries and defaults enabled to true when absent', () => {
    const res = normalizeSkillsResponse({
      skills: [{ description: 'no name' }, { name: 'ok', description: 'd' }],
    })
    expect(res.skills).toHaveLength(1)
    expect(res.skills[0]!).toEqual({
      name: 'ok',
      description: 'd',
      category: null,
      enabled: true,
      path: null,
    })
  })

  it('carries the on-disk path through when present', () => {
    const res = normalizeSkillsResponse({
      skills: [
        { name: 'a', description: '', category: 'creative', enabled: true, path: 'creative/a' },
      ],
    })
    expect(res.skills[0]!.path).toBe('creative/a')
  })

  it('degrades gracefully on a non-object / missing list', () => {
    expect(normalizeSkillsResponse(null).skills).toEqual([])
    expect(normalizeSkillsResponse({}).skills).toEqual([])
    expect(normalizeSkillsResponse({ skills: 'nope' }).skills).toEqual([])
  })
})

describe('fetchSkills', () => {
  it('GETs the BFF skills endpoint and normalizes', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ skills: [{ name: 'a', description: '', category: null, enabled: true }] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchSkills()
    expect(res.skills).toHaveLength(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/agent-deck/skills')
  })
})

describe('toggleSkill', () => {
  it('PUTs the toggle and returns the resolved state', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ name: 'axolotl', enabled: false }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const res = await toggleSkill('axolotl', false)
    expect(res).toEqual({ name: 'axolotl', enabled: false })
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('/api/agent-deck/skills/toggle')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'axolotl', enabled: false })
  })

  it('falls back to the requested state when the echo is thin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({})),
    )
    const res = await toggleSkill('verify', true)
    expect(res).toEqual({ name: 'verify', enabled: true })
  })
})

describe('fetchSkillBody', () => {
  it('GETs the body endpoint with the path query and normalizes', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ path: 'creative/a', content: '# A', exists: true, hasExtraFiles: false }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchSkillBody('creative/a')
    expect(res).toEqual({ path: 'creative/a', content: '# A', exists: true, hasExtraFiles: false })
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/agent-deck/skills/body?path=creative%2Fa')
  })
})

describe('writeSkillBody', () => {
  it('PUTs the body with path + content', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await writeSkillBody('mlops/axolotl', '# new')
    expect(res).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('/api/agent-deck/skills/body')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({ path: 'mlops/axolotl', content: '# new' })
  })
})

describe('createSkill', () => {
  it('POSTs name (+ category) and returns the created path', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ path: 'productivity/tagger' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const res = await createSkill('tagger', 'productivity')
    expect(res).toEqual({ path: 'productivity/tagger' })
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('/api/agent-deck/skills')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'tagger', category: 'productivity' })
  })

  it('omits category when none given', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ path: 'solo' }))
    vi.stubGlobal('fetch', fetchMock)
    await createSkill('solo')
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({ name: 'solo' })
  })
})

describe('deleteSkill', () => {
  it('DELETEs with the path', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await deleteSkill('throwaway/temp')
    expect(res).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('/api/agent-deck/skills')
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(init.body as string)).toEqual({ path: 'throwaway/temp' })
  })
})
