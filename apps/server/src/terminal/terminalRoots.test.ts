import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { resolveTerminalRoots, resolveTerminalCwdAvailable } from './terminalRoots'
import type { FileRoot } from '../files/types'

/** A minimal stand-in for FilesService.listRoots. */
function fakeFiles(impl: () => Promise<FileRoot[]>): { listRoots: () => Promise<FileRoot[]> } {
  return { listRoots: impl }
}

function root(id: string, path: string): FileRoot {
  return { id, label: id, description: '', path, readOnly: true }
}

describe('resolveTerminalRoots', () => {
  it('returns the absolute paths of the dashboard workspace roots in order', async () => {
    const files = fakeFiles(async () => [
      { id: 'p', label: 'Projects', description: '', path: '/home/u/Projects', readOnly: true },
      { id: 'd', label: 'Docs', description: '', path: '/home/u/Docs', readOnly: true },
    ])
    expect(await resolveTerminalRoots(files)).toEqual(['/home/u/Projects', '/home/u/Docs'])
  })

  it('returns [] (→ $HOME fallback) when the dashboard is unreachable', async () => {
    const files = fakeFiles(async () => {
      throw new Error('dashboard down')
    })
    expect(await resolveTerminalRoots(files)).toEqual([])
  })

  it('returns [] when the dashboard reports no roots', async () => {
    const files = fakeFiles(async () => [])
    expect(await resolveTerminalRoots(files)).toEqual([])
  })

  it('skips roots with a missing/blank path', async () => {
    const files = fakeFiles(async () => [
      { id: 'a', label: 'A', description: '', path: '', readOnly: true },
      { id: 'b', label: 'B', description: '', path: '/home/u/B', readOnly: true },
    ])
    expect(await resolveTerminalRoots(files)).toEqual(['/home/u/B'])
  })
})

describe('resolveTerminalCwdAvailable', () => {
  const ORIGINAL = process.env.AGENT_DECK_TERMINAL_ALLOW_HOME
  beforeEach(() => {
    delete process.env.AGENT_DECK_TERMINAL_ALLOW_HOME
  })
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.AGENT_DECK_TERMINAL_ALLOW_HOME
    else process.env.AGENT_DECK_TERMINAL_ALLOW_HOME = ORIGINAL
  })

  it('is true when at least one workspace root resolves', async () => {
    const files = fakeFiles(async () => [root('p', '/home/u/Projects')])
    expect(await resolveTerminalCwdAvailable(files)).toBe(true)
  })

  it('is false when no workspace root resolves and ALLOW_HOME is unset', async () => {
    const files = fakeFiles(async () => [])
    expect(await resolveTerminalCwdAvailable(files)).toBe(false)
  })

  it('is true when no root resolves but AGENT_DECK_TERMINAL_ALLOW_HOME=1', async () => {
    process.env.AGENT_DECK_TERMINAL_ALLOW_HOME = '1'
    const files = fakeFiles(async () => [])
    expect(await resolveTerminalCwdAvailable(files)).toBe(true)
  })

  it('treats any value other than "1" as unset', async () => {
    process.env.AGENT_DECK_TERMINAL_ALLOW_HOME = 'true'
    const files = fakeFiles(async () => [])
    expect(await resolveTerminalCwdAvailable(files)).toBe(false)
  })

  it('is true on a STOCK ~/.hermes layout (listRoots always yields hermes_home)', async () => {
    // The un-break: stock hermes has NO ./workspace, but listRoots now always
    // surfaces hermes_home itself as a root → the terminal cwd is available
    // WITHOUT the operator opting into $HOME. Terminal no longer depends on the
    // (never-created) workspace concept.
    const files = fakeFiles(async () => [
      {
        id: 'home',
        label: 'Hermes home',
        description: 'hermes_home',
        path: '/home/u/.hermes',
        readOnly: true,
      },
    ])
    expect(await resolveTerminalCwdAvailable(files)).toBe(true)
  })
})
