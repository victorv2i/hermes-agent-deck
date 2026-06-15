import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkspaceDefinition } from '@agent-deck/protocol'
import { WorkspaceStore, generateWorkspaceId } from './workspaceStore'

let dir: string
let storePath: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adk-ws-store-'))
  storePath = join(dir, 'workspaces.json')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function def(over: Partial<WorkspaceDefinition> = {}): WorkspaceDefinition {
  return {
    id: 'ws_a',
    name: 'Alpha',
    panes: [{ id: 'p1', label: 'one', cli: 'shell' }],
    createdAt: '2026-06-14T00:00:00.000Z',
    lastModifiedAt: '2026-06-14T00:00:00.000Z',
    ...over,
  }
}

describe('generateWorkspaceId', () => {
  it('produces a short id of the safe id charset', () => {
    const id = generateWorkspaceId()
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  })

  it('produces a fresh id each call (no collisions across a batch)', () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateWorkspaceId()))
    expect(ids.size).toBe(200)
  })
})

describe('WorkspaceStore CRUD', () => {
  it('starts empty on a missing file', async () => {
    const store = new WorkspaceStore(storePath)
    expect(await store.listWorkspaces()).toEqual([])
    expect(await store.getWorkspace('nope')).toBeUndefined()
  })

  it('upserts and reads a workspace back', async () => {
    const store = new WorkspaceStore(storePath)
    const created = await store.upsertWorkspace(def())
    expect(created).toEqual(def())
    expect(await store.getWorkspace('ws_a')).toEqual(def())
  })

  it('listWorkspaces returns slim summaries (no pane bodies) with paneCount', async () => {
    const store = new WorkspaceStore(storePath)
    await store.upsertWorkspace(
      def({
        id: 'ws_a',
        name: 'Alpha',
        description: 'first',
        panes: [
          { id: 'p1', label: 'one', cli: 'shell' },
          { id: 'p2', label: 'two', cli: 'hermes' },
        ],
      }),
    )
    const list = await store.listWorkspaces()
    expect(list).toEqual([
      {
        id: 'ws_a',
        name: 'Alpha',
        description: 'first',
        paneCount: 2,
        createdAt: '2026-06-14T00:00:00.000Z',
        lastModifiedAt: '2026-06-14T00:00:00.000Z',
      },
    ])
  })

  it('upsert replaces an existing workspace by id', async () => {
    const store = new WorkspaceStore(storePath)
    await store.upsertWorkspace(def({ name: 'Alpha' }))
    await store.upsertWorkspace(
      def({ name: 'Renamed', lastModifiedAt: '2026-06-15T00:00:00.000Z' }),
    )
    const got = await store.getWorkspace('ws_a')
    expect(got?.name).toBe('Renamed')
    expect((await store.listWorkspaces()).length).toBe(1)
  })

  it('deleteWorkspace removes a workspace and reports whether it existed', async () => {
    const store = new WorkspaceStore(storePath)
    await store.upsertWorkspace(def())
    expect(await store.deleteWorkspace('ws_a')).toBe(true)
    expect(await store.getWorkspace('ws_a')).toBeUndefined()
    expect(await store.deleteWorkspace('ws_a')).toBe(false)
  })
})

describe('WorkspaceStore persistence', () => {
  it('round-trips through disk: a fresh store instance reads what the first wrote', async () => {
    const a = new WorkspaceStore(storePath)
    await a.upsertWorkspace(def({ id: 'ws_a', name: 'Alpha' }))
    await a.upsertWorkspace(def({ id: 'ws_b', name: 'Bravo' }))
    const b = new WorkspaceStore(storePath)
    const ids = (await b.listWorkspaces()).map((w) => w.id).sort()
    expect(ids).toEqual(['ws_a', 'ws_b'])
    expect((await b.getWorkspace('ws_b'))?.name).toBe('Bravo')
  })

  it('persists as pretty JSON keyed by id', async () => {
    const store = new WorkspaceStore(storePath)
    await store.upsertWorkspace(def())
    const onDisk = JSON.parse(await readFile(storePath, 'utf8')) as Record<string, unknown>
    expect(Object.keys(onDisk)).toEqual(['ws_a'])
  })

  it('writes atomically (temp sibling then rename - no .tmp left behind)', async () => {
    const store = new WorkspaceStore(storePath)
    await store.upsertWorkspace(def())
    const left = (await readdir(dir)).filter((f) => f.endsWith('.tmp'))
    expect(left).toEqual([])
  })

  it('tolerates a corrupt file as an empty store (never throws on load)', async () => {
    await writeFile(storePath, '{ this is not json', 'utf8')
    const store = new WorkspaceStore(storePath)
    expect(await store.listWorkspaces()).toEqual([])
    // and a subsequent write recovers the file to valid JSON
    await store.upsertWorkspace(def())
    expect(await store.getWorkspace('ws_a')).toEqual(def())
  })

  it('drops malformed entries from a partially-corrupt file (keeps valid ones)', async () => {
    await writeFile(
      storePath,
      JSON.stringify({
        ws_a: def({ id: 'ws_a' }),
        ws_bad: { id: 'ws_bad' }, // missing name/panes/timestamps
        ws_alsobad: 42,
      }),
      'utf8',
    )
    const store = new WorkspaceStore(storePath)
    const ids = (await store.listWorkspaces()).map((w) => w.id)
    expect(ids).toEqual(['ws_a'])
  })

  it('never throws when the file cannot be written (logs + continues)', async () => {
    // Point the store at a path whose parent is a FILE, so mkdir/write fails.
    const fileAsDir = join(dir, 'blocker')
    await writeFile(fileAsDir, 'x', 'utf8')
    const badPath = join(fileAsDir, 'nested', 'workspaces.json')
    const store = new WorkspaceStore(badPath)
    // The in-memory upsert still returns the def and does not throw.
    await expect(store.upsertWorkspace(def())).resolves.toEqual(def())
    // The in-memory map still serves reads.
    expect(await store.getWorkspace('ws_a')).toEqual(def())
  })
})

describe('WorkspaceStore concurrency', () => {
  it('handles many concurrent upserts without losing or corrupting entries', async () => {
    const store = new WorkspaceStore(storePath)
    await Promise.all(
      Array.from({ length: 25 }, (_unused, i) =>
        store.upsertWorkspace(def({ id: `ws_${i}`, name: `n${i}` })),
      ),
    )
    expect((await store.listWorkspaces()).length).toBe(25)
    // The persisted file is valid JSON (no partial-write corruption).
    const reloaded = new WorkspaceStore(storePath)
    expect((await reloaded.listWorkspaces()).length).toBe(25)
  })
})
