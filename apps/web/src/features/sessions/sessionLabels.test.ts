import { beforeEach, describe, expect, it, vi } from 'vitest'

async function loadStore() {
  vi.resetModules()
  return import('./sessionLabels')
}

beforeEach(() => {
  localStorage.clear()
})

describe('sessionLabels', () => {
  it('reads only valid string labels from localStorage', async () => {
    localStorage.setItem(
      'agent-deck-session-labels',
      JSON.stringify({ a: '  Sprint plan  ', b: 42, c: '', d: 'many   spaces' }),
    )
    const store = await loadStore()
    expect(store.readStoredSessionLabels()).toEqual({ a: 'Sprint plan', d: 'many spaces' })
  })

  it('sets and clears local labels without throwing on storage failures', async () => {
    const store = await loadStore()
    store.setSessionLabel('sess-1', '  Parser work  ')
    expect(store.getSessionLabelsSnapshot()).toEqual({ 'sess-1': 'Parser work' })

    store.clearSessionLabel('sess-1')
    expect(store.getSessionLabelsSnapshot()).toEqual({})
  })
})
