import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createProfile,
  switchProfile,
  renameProfile,
  writeAvatar,
  deleteProfile,
  switchAppliedLine,
  restartCommand,
} from './mutations'

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetch(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status, json: async () => body } as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('switch honesty', () => {
  it('the applied line is the verbatim honest restart-required state, explaining WHY', () => {
    expect(switchAppliedLine('atlas')).toBe(
      'Switched to atlas. Hermes runs one agent at a time, so restart to make atlas the active agent.',
    )
    // It explains the real one-agent-at-a-time Hermes constraint (the WHY)…
    expect(switchAppliedLine('atlas')).toMatch(/one agent at a time/i)
    // …and is never a fake "live now" — the restart is still required.
    expect(switchAppliedLine('atlas')).toMatch(/restart/i)
  })

  it('the restart command is copyable + concrete', () => {
    expect(restartCommand()).toMatch(/restart/)
  })
})

describe('createProfile', () => {
  it('POSTs name + optional avatar to the create route', async () => {
    const fetchMock = mockFetch({ name: 'atlas', avatar: 'v3' }, true, 201)
    const res = await createProfile({ name: 'atlas', avatar: 'v3' })
    expect(res).toEqual({ name: 'atlas', avatar: 'v3' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/agent-deck/profiles')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ name: 'atlas', avatar: 'v3' })
  })

  it('surfaces a create failure (name taken)', async () => {
    mockFetch(
      { error: 'create_failed', message: 'Hermes could not create the profile.' },
      false,
      502,
    )
    await expect(createProfile({ name: 'atlas' })).rejects.toThrow(/could not create/i)
  })
})

describe('switchProfile', () => {
  it('POSTs the name to the switch route', async () => {
    const fetchMock = mockFetch({ active: 'atlas' })
    const res = await switchProfile('atlas')
    expect(res).toEqual({ active: 'atlas' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/agent-deck/profiles/switch')
    expect(JSON.parse(init.body)).toEqual({ name: 'atlas' })
  })
})

describe('renameProfile', () => {
  it('POSTs the new name to the rename route, source name path-encoded', async () => {
    const fetchMock = mockFetch({ name: 'mercury' })
    const res = await renameProfile('atlas', 'mercury')
    expect(res).toEqual({ name: 'mercury' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/agent-deck/profiles/atlas/rename')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ newName: 'mercury' })
  })

  it('surfaces a rename failure (target exists / default reserved)', async () => {
    mockFetch(
      { error: 'rename_failed', message: 'Hermes could not rename the profile.' },
      false,
      502,
    )
    await expect(renameProfile('atlas', 'default')).rejects.toThrow(/could not rename/i)
  })
})

describe('writeAvatar', () => {
  it('PUTs the avatar id to the avatar route, name path-encoded', async () => {
    const fetchMock = mockFetch({ ok: true })
    await writeAvatar('atlas', 'v3')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/agent-deck/profiles/atlas/avatar')
    expect(init.method).toBe('PUT')
    // No displayName argument → field OMITTED so the BFF preserves any existing name.
    expect(JSON.parse(init.body)).toEqual({ avatar: 'v3' })
  })

  it('forwards a trimmed display name when one is set', async () => {
    const fetchMock = mockFetch({ ok: true })
    await writeAvatar('atlas', 'v3', '  Mercury  ')
    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(init.body)).toEqual({ avatar: 'v3', displayName: 'Mercury' })
  })

  it('sends an explicit blank display name so the BFF CLEARS a previously-set one', async () => {
    const fetchMock = mockFetch({ ok: true })
    // An explicit empty string is a deliberate "clear" — it must reach the wire
    // (omitting it would instead preserve the old name).
    await writeAvatar('atlas', 'v3', '')
    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(init.body)).toEqual({ avatar: 'v3', displayName: '' })
  })
})

describe('deleteProfile', () => {
  it('sends DELETE to the profile route, name path-encoded', async () => {
    const fetchMock = mockFetch({ ok: true })
    const res = await deleteProfile('atlas')
    expect(res).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/agent-deck/profiles/atlas')
    expect(init.method).toBe('DELETE')
  })

  it('surfaces the BFF error on a failed delete', async () => {
    mockFetch(
      { error: 'conflict', message: 'Switch to another agent before deleting this one.' },
      false,
      409,
    )
    await expect(deleteProfile('atlas')).rejects.toThrow(/switch to another agent/i)
  })
})
