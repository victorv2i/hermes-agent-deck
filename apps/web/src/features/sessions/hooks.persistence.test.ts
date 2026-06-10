import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useRailUrlState,
  useShowExternalSources,
  setShowExternalSources,
  SHOW_EXTERNAL_SOURCES_STORAGE_KEY,
} from './hooks'

/**
 * P3 — refresh-durability of the rail's filter state. Search + the project/tag
 * filter live in the URL (deep-linkable + survive a reload); the sticky
 * external-source toggle lives in localStorage. These router-INDEPENDENT stores
 * back that, so the rail restores exactly where the user left it after a refresh.
 */

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.clear()
  // Reset the module-level external-source snapshot between tests.
  setShowExternalSources(false)
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.clear()
})

describe('useRailUrlState (URL-backed search/project/tag)', () => {
  it('seeds from the current URL on mount (refresh restores the filter)', () => {
    window.history.replaceState(null, '', '/?q=docker&project=p1&tag=infra')
    const { result } = renderHook(() => useRailUrlState())
    const [state] = result.current
    expect(state).toEqual({ search: 'docker', projectId: 'p1', tag: 'infra' })
  })

  it('defaults to empty/null when the URL carries no rail params', () => {
    const { result } = renderHook(() => useRailUrlState())
    expect(result.current[0]).toEqual({ search: '', projectId: null, tag: null })
  })

  it('writes search to the URL so a reload would restore it', () => {
    const { result } = renderHook(() => useRailUrlState())
    act(() => result.current[1]({ search: 'kubernetes' }))
    expect(new URLSearchParams(window.location.search).get('q')).toBe('kubernetes')
    expect(result.current[0].search).toBe('kubernetes')
  })

  it('clears a param from the URL when set back to empty/null', () => {
    window.history.replaceState(null, '', '/?q=old&project=p9')
    const { result } = renderHook(() => useRailUrlState())
    act(() => result.current[1]({ search: '', projectId: null }))
    const sp = new URLSearchParams(window.location.search)
    expect(sp.has('q')).toBe(false)
    expect(sp.has('project')).toBe(false)
  })

  it('uses replaceState (does not push history entries) as the filter changes', () => {
    const before = window.history.length
    const { result } = renderHook(() => useRailUrlState())
    act(() => result.current[1]({ search: 'a' }))
    act(() => result.current[1]({ search: 'ab' }))
    expect(window.history.length).toBe(before)
  })

  it('resyncs on browser back/forward (popstate)', () => {
    const { result } = renderHook(() => useRailUrlState())
    act(() => {
      window.history.replaceState(null, '', '/?q=fromnav')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(result.current[0].search).toBe('fromnav')
  })
})

describe('useShowExternalSources (localStorage-backed sticky toggle)', () => {
  it('defaults to false (web-first), matching the prior useState default', () => {
    const { result } = renderHook(() => useShowExternalSources())
    expect(result.current).toBe(false)
  })

  it('persists the on-state to localStorage so a refresh restores it', () => {
    const { result } = renderHook(() => useShowExternalSources())
    act(() => setShowExternalSources(true))
    expect(result.current).toBe(true)
    expect(localStorage.getItem(SHOW_EXTERNAL_SOURCES_STORAGE_KEY)).toBe('1')
  })

  it('removes the key (back to default) when toggled off', () => {
    act(() => setShowExternalSources(true))
    act(() => setShowExternalSources(false))
    expect(localStorage.getItem(SHOW_EXTERNAL_SOURCES_STORAGE_KEY)).toBeNull()
  })
})
