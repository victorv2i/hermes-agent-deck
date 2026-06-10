/**
 * Tests for the terminal-dock store. The dock shares the ONE right side-panel
 * slot with the Preview + Work panels, so opening it must close the other two
 * (and opening either of them closes the dock). The dock also persists a single
 * stable session id so a browser refresh REATTACHES the same parked shell.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  useTerminalPanelStore,
  initDockSessionId,
  TERMINAL_DOCK_SESSION_KEY,
} from './terminalPanelStore'
import { usePreviewStore } from '@/features/preview/previewStore'
import { useWorkPanelStore } from '@/features/work-panel/workPanelStore'

function resetStores() {
  // The session id is resolved once at store creation; leave it intact (it's a
  // stable, persisted value), only reset the open flags.
  useTerminalPanelStore.setState({ open: false })
  usePreviewStore.setState({ open: false })
  useWorkPanelStore.setState({ open: false })
}

describe('terminalPanelStore', () => {
  beforeEach(() => {
    localStorage.clear()
    resetStores()
  })

  it('starts closed', () => {
    expect(useTerminalPanelStore.getState().open).toBe(false)
  })

  it('open sets open=true', () => {
    useTerminalPanelStore.getState().openDock()
    expect(useTerminalPanelStore.getState().open).toBe(true)
  })

  it('close sets open=false', () => {
    useTerminalPanelStore.getState().openDock()
    useTerminalPanelStore.getState().close()
    expect(useTerminalPanelStore.getState().open).toBe(false)
  })

  it('toggle flips open', () => {
    expect(useTerminalPanelStore.getState().open).toBe(false)
    useTerminalPanelStore.getState().toggle()
    expect(useTerminalPanelStore.getState().open).toBe(true)
    useTerminalPanelStore.getState().toggle()
    expect(useTerminalPanelStore.getState().open).toBe(false)
  })

  it('opening the dock CLOSES the preview + work panels (one slot, mutually exclusive)', () => {
    usePreviewStore.setState({ open: true })
    useWorkPanelStore.setState({ open: true })
    useTerminalPanelStore.getState().openDock()
    expect(useTerminalPanelStore.getState().open).toBe(true)
    expect(usePreviewStore.getState().open).toBe(false)
    expect(useWorkPanelStore.getState().open).toBe(false)
  })

  it('toggling the dock OPEN also closes preview + work', () => {
    usePreviewStore.setState({ open: true })
    useWorkPanelStore.setState({ open: true })
    useTerminalPanelStore.getState().toggle()
    expect(useTerminalPanelStore.getState().open).toBe(true)
    expect(usePreviewStore.getState().open).toBe(false)
    expect(useWorkPanelStore.getState().open).toBe(false)
  })

  it('toggling the dock CLOSED leaves preview + work alone', () => {
    useTerminalPanelStore.getState().openDock()
    // closing the dock must not reopen anything
    useTerminalPanelStore.getState().toggle()
    expect(useTerminalPanelStore.getState().open).toBe(false)
    expect(usePreviewStore.getState().open).toBe(false)
    expect(useWorkPanelStore.getState().open).toBe(false)
  })

  it('exposes a stable, dock-prefixed session id (resolved once at store creation)', () => {
    const id = useTerminalPanelStore.getState().dockSessionId()
    expect(id).toBeTruthy()
    expect(id).toMatch(/^dock-/)
    // (Persistence to localStorage is a property of initDockSessionId — covered
    // below — and happens at store creation, before this test clears storage.)
  })

  it('dockSessionId() is a PURE getter — calling it never writes the store (no render-phase set)', () => {
    const setSpy = vi.spyOn(useTerminalPanelStore, 'setState')
    const id1 = useTerminalPanelStore.getState().dockSessionId()
    // Repeated reads (as a render body would do) are stable and never mutate state.
    const id2 = useTerminalPanelStore.getState().dockSessionId()
    expect(id2).toBe(id1)
    expect(setSpy).not.toHaveBeenCalled()
    setSpy.mockRestore()
  })

  it('initDockSessionId mints + persists a fresh id when storage is empty', () => {
    localStorage.removeItem(TERMINAL_DOCK_SESSION_KEY)
    const id = initDockSessionId()
    expect(id).toMatch(/^dock-/)
    expect(localStorage.getItem(TERMINAL_DOCK_SESSION_KEY)).toBe(id)
  })

  it('initDockSessionId reuses the persisted id (refresh reattaches the same shell)', () => {
    localStorage.setItem(TERMINAL_DOCK_SESSION_KEY, 'dock-persisted-1234')
    expect(initDockSessionId()).toBe('dock-persisted-1234')
    // A second resolution (e.g. another page load) returns the SAME persisted id.
    expect(initDockSessionId()).toBe('dock-persisted-1234')
  })

  it('initDockSessionId tolerates unavailable localStorage', () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const id = initDockSessionId()
    expect(id).toMatch(/^dock-/)
    getSpy.mockRestore()
    setSpy.mockRestore()
  })
})
