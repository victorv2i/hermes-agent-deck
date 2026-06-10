import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DashboardClient } from '../hermes/dashboardClient'
import { startMockDashboard, type MockDashboardHandle } from '../hermes/mockDashboard.test-support'
import { FilesService, FilesServiceError } from './filesService'
import { PathGuardError } from './pathGuard'

let dashboard: MockDashboardHandle
let tmpRoot: string

/** Build a FilesService whose reads hit the mock dashboard and whose write root
 * is a real temp dir (registered under id "tmp"). */
function makeService(): FilesService {
  const client = new DashboardClient({
    hermesDashboardUrl: dashboard.url,
    hermesDashboardHost: dashboard.host,
  })
  return new FilesService(client)
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'ad-files-'))
})

afterEach(async () => {
  await dashboard?.close()
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('FilesService.listRoots (derived from /api/status hermes_home + BFF fs)', () => {
  it('NEVER requests any /api/workspace/* path (the retired overlay endpoint)', async () => {
    dashboard = await startMockDashboard({ statusBody: { hermes_home: tmpRoot } })
    await makeService().listRoots()
    expect(dashboard.calls.some((c) => c.path.startsWith('/api/workspace'))).toBe(false)
    // It DID consult /api/status for hermes_home.
    expect(dashboard.calls.some((c) => c.path === '/api/status')).toBe(true)
  })

  it('ALWAYS includes hermes_home itself as a guaranteed root (Files is never blank)', async () => {
    // Stock reality: NO ${hermes_home}/workspace, NO playgrounds. Files must
    // still surface at least one REAL, existing root so the surface isn't dark.
    dashboard = await startMockDashboard({ statusBody: { hermes_home: tmpRoot } })
    const roots = await makeService().listRoots()
    expect(roots.length).toBeGreaterThanOrEqual(1)
    const home = roots.find((r) => r.id === 'home')
    expect(home).toBeDefined()
    expect(home!.path).toBe(tmpRoot)
    expect(home!.label).toBe('Hermes home')
    // hermes_home itself stays READ-ONLY: it holds config.yaml / auth.json /
    // profiles, so broad writes there are refused even though the path-guard
    // already blocks the individual sensitive files. Work happens in the
    // writable workspace/playground roots below.
    expect(home!.readOnly).toBe(true)
  })

  it('includes each ${hermes_home}/playgrounds/* dir when present (stock layout)', async () => {
    // Mirrors the verified stock layout: ~/.hermes/playgrounds/hermes-workspace.
    await mkdir(join(tmpRoot, 'playgrounds', 'hermes-workspace'), { recursive: true })
    await mkdir(join(tmpRoot, 'playgrounds', 'scratch'), { recursive: true })
    dashboard = await startMockDashboard({ statusBody: { hermes_home: tmpRoot } })
    const roots = await makeService().listRoots()
    const byPath = roots.map((r) => r.path)
    expect(byPath).toContain(join(tmpRoot, 'playgrounds', 'hermes-workspace'))
    expect(byPath).toContain(join(tmpRoot, 'playgrounds', 'scratch'))
    // The playground roots are labelled by their dir name + carry a description.
    const pg = roots.find((r) => r.path === join(tmpRoot, 'playgrounds', 'scratch'))!
    expect(pg.label).toBe('scratch')
    expect(pg.description).toBe('playground')
    // Playgrounds are genuine scratch dirs → WRITABLE (the path-guard confines
    // every write inside the root and blocks sensitive files).
    expect(pg.readOnly).toBe(false)
  })

  it('ignores a non-directory entry under playgrounds/', async () => {
    await mkdir(join(tmpRoot, 'playgrounds'), { recursive: true })
    await writeFile(join(tmpRoot, 'playgrounds', 'a-file.txt'), 'x')
    dashboard = await startMockDashboard({ statusBody: { hermes_home: tmpRoot } })
    const roots = await makeService().listRoots()
    expect(roots.some((r) => r.path === join(tmpRoot, 'playgrounds', 'a-file.txt'))).toBe(false)
  })

  it('includes terminal.cwd from config.yaml, resolved against hermes_home, when it exists', async () => {
    // config.yaml carries `terminal.cwd: workdir`; that dir exists → it is a root.
    await mkdir(join(tmpRoot, 'workdir'), { recursive: true })
    await writeFile(join(tmpRoot, 'config.yaml'), 'terminal:\n  cwd: workdir\n')
    dashboard = await startMockDashboard({ statusBody: { hermes_home: tmpRoot } })
    const roots = await makeService().listRoots()
    expect(roots.some((r) => r.path === join(tmpRoot, 'workdir'))).toBe(true)
  })

  it('treats a `terminal.cwd: .` (the stock default) as hermes_home (no dupe root)', async () => {
    // Stock ships `terminal.cwd: .` → resolves to hermes_home itself; must not
    // produce a second root with the same path as `home`.
    await writeFile(join(tmpRoot, 'config.yaml'), 'terminal:\n  cwd: .\n')
    dashboard = await startMockDashboard({ statusBody: { hermes_home: tmpRoot } })
    const roots = await makeService().listRoots()
    const paths = roots.map((r) => r.path)
    expect(paths.filter((p) => p === tmpRoot)).toHaveLength(1)
  })

  it('keeps a real ${hermes_home}/workspace ONLY when it actually exists', async () => {
    const ws = join(tmpRoot, 'workspace')
    await mkdir(ws, { recursive: true })
    dashboard = await startMockDashboard({ statusBody: { hermes_home: tmpRoot } })
    const roots = await makeService().listRoots()
    const workspace = roots.find((r) => r.id === 'default')
    expect(workspace).toBeDefined()
    expect(workspace!.path).toBe(ws)
    expect(workspace!.label).toBe('Workspace')
    // The workspace is a work area → WRITABLE.
    expect(workspace!.readOnly).toBe(false)
  })

  it('does NOT synthesize a non-existent workspace root', async () => {
    // No ${hermes_home}/workspace on disk → no `default` root is fabricated.
    dashboard = await startMockDashboard({ statusBody: { hermes_home: tmpRoot } })
    const roots = await makeService().listRoots()
    expect(roots.some((r) => r.id === 'default')).toBe(false)
  })

  it('also returns named-profile workspaces under ${hermes_home}/profiles/<name>/workspace', async () => {
    await mkdir(join(tmpRoot, 'workspace'), { recursive: true })
    await mkdir(join(tmpRoot, 'profiles', 'coder', 'workspace'), { recursive: true })
    await mkdir(join(tmpRoot, 'profiles', 'writer', 'workspace'), { recursive: true })
    dashboard = await startMockDashboard({ statusBody: { hermes_home: tmpRoot } })
    const roots = await makeService().listRoots()
    // home is always first; then workspace, then the named-profile workspaces.
    expect(roots.map((r) => r.id)).toContain('coder')
    expect(roots.map((r) => r.id)).toContain('writer')
    expect(roots.map((r) => r.path)).toContain(join(tmpRoot, 'profiles', 'coder', 'workspace'))
    expect(roots.map((r) => r.path)).toContain(join(tmpRoot, 'profiles', 'writer', 'workspace'))
    // Named-profile workspaces are work areas → WRITABLE; only `home` (the
    // hermes_home root) stays read-only.
    expect(roots.find((r) => r.id === 'coder')!.readOnly).toBe(false)
    expect(roots.find((r) => r.id === 'writer')!.readOnly).toBe(false)
    expect(roots.find((r) => r.id === 'home')!.readOnly).toBe(true)
  })

  it('skips a named profile that has no workspace subdir', async () => {
    await mkdir(join(tmpRoot, 'profiles', 'coder', 'workspace'), { recursive: true })
    await mkdir(join(tmpRoot, 'profiles', 'empty'), { recursive: true })
    dashboard = await startMockDashboard({ statusBody: { hermes_home: tmpRoot } })
    const roots = await makeService().listRoots()
    expect(roots.map((r) => r.id)).toContain('coder')
    expect(roots.map((r) => r.id)).not.toContain('empty')
  })

  it('on a STOCK ~/.hermes layout (NO workspace, WITH playgrounds) resolves >=1 real root', async () => {
    // The integration assertion: a tmp dir mirroring stock — no ./workspace, a
    // playgrounds/hermes-workspace dir, and the stock `terminal.cwd: .`. Files
    // must NOT be blank: at minimum hermes_home + the playground resolve.
    await mkdir(join(tmpRoot, 'playgrounds', 'hermes-workspace'), { recursive: true })
    await writeFile(join(tmpRoot, 'config.yaml'), 'terminal:\n  cwd: .\n')
    dashboard = await startMockDashboard({ statusBody: { hermes_home: tmpRoot } })
    const roots = await makeService().listRoots()
    expect(roots.length).toBeGreaterThanOrEqual(1)
    // Every returned root is a REAL existing path.
    for (const r of roots) {
      expect((await stat(r.path)).isDirectory()).toBe(true)
    }
    expect(roots.some((r) => r.path === tmpRoot)).toBe(true)
    expect(roots.some((r) => r.path === join(tmpRoot, 'playgrounds', 'hermes-workspace'))).toBe(
      true,
    )
    // No ./workspace was synthesized.
    expect(roots.some((r) => r.id === 'default')).toBe(false)
  })

  it('a write to a DERIVED writable root (playground) actually lands on disk', async () => {
    // End-to-end proof the gate flip is REAL, not just a flag: derive the roots
    // the production way (no setRootResolver), then write through that root id and
    // confirm the bytes are on disk. The mutation buttons in the UI back a write
    // that genuinely succeeds — not a control that can only fail.
    await mkdir(join(tmpRoot, 'playgrounds', 'scratch'), { recursive: true })
    dashboard = await startMockDashboard({ statusBody: { hermes_home: tmpRoot } })
    const svc = makeService()
    const roots = await svc.listRoots()
    const pg = roots.find((r) => r.id === 'playground:scratch')!
    expect(pg.readOnly).toBe(false)

    const result = await svc.writeFile(pg.id, 'note.txt', 'hello')
    expect(result.path).toBe('note.txt')
    const onDisk = await readFile(join(tmpRoot, 'playgrounds', 'scratch', 'note.txt'), 'utf8')
    expect(onDisk).toBe('hello')
  })

  it('a write to the read-only `home` root is refused (read_only) even when derived', async () => {
    // hermes_home stays read-only: a write against the derived `home` root must
    // 403 (read_only) — the credential/config home is never broadly writable.
    dashboard = await startMockDashboard({ statusBody: { hermes_home: tmpRoot } })
    const svc = makeService()
    await svc.listRoots()
    await expect(svc.writeFile('home', 'note.txt', 'x')).rejects.toMatchObject({
      code: 'read_only',
    })
  })

  it('returns [] when /api/status omits hermes_home', async () => {
    dashboard = await startMockDashboard({ statusBody: { version: '0.15.2' } })
    expect(await makeService().listRoots()).toEqual([])
  })

  it('returns [] (never throws) when the dashboard is unreachable', async () => {
    dashboard = await startMockDashboard({ statusBody: { hermes_home: tmpRoot } })
    // A client pointed at a dead port: listRoots must swallow the error → [].
    const dead = new DashboardClient({
      hermesDashboardUrl: 'http://127.0.0.1:1',
      hermesDashboardHost: '127.0.0.1:1',
      requestTimeoutMs: 500,
    })
    expect(await new FilesService(dead).listRoots()).toEqual([])
  })
})

describe('FilesService reads (BFF-local fs, realpath-guarded BEFORE every read)', () => {
  /** A FilesService whose only root "default" maps to the temp workspace dir. */
  function serviceWithWorkspace(): FilesService {
    const svc = makeService()
    svc.setRootResolver(async (id) =>
      id === 'default'
        ? {
            id: 'default',
            label: 'Workspace',
            description: 'default',
            path: tmpRoot,
            readOnly: true,
          }
        : null,
    )
    return svc
  }

  it('lists a directory from disk (no /api/workspace/* call)', async () => {
    dashboard = await startMockDashboard()
    await mkdir(join(tmpRoot, 'src'), { recursive: true })
    await writeFile(join(tmpRoot, 'src', 'app.ts'), 'x'.repeat(42))
    await mkdir(join(tmpRoot, 'src', 'lib'), { recursive: true })
    const listing = await serviceWithWorkspace().listDirectory('default', 'src')
    expect(listing.root).toBe('default')
    expect(listing.path).toBe('src')
    const byName = Object.fromEntries(listing.entries.map((e) => [e.name, e]))
    expect(byName['app.ts']).toMatchObject({ type: 'file', size: 42 })
    expect(byName['lib']).toMatchObject({ type: 'dir' })
    expect(dashboard.calls.some((c) => c.path.startsWith('/api/workspace'))).toBe(false)
  })

  it('marks sensitive listing entries as suppressed without surfacing metadata', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, '.env'), 'SECRET=1')
    await writeFile(join(tmpRoot, 'auth.json.bak'), '{"token":"secret"}')
    await mkdir(join(tmpRoot, '.secrets'), { recursive: true })
    await writeFile(join(tmpRoot, 'server.pem'), 'private key')
    await writeFile(join(tmpRoot, 'normal.txt'), 'hello')

    const listing = await serviceWithWorkspace().listDirectory('default', '')
    const byName = Object.fromEntries(listing.entries.map((e) => [e.name, e]))
    for (const name of ['.env', '.secrets', 'auth.json.bak', 'server.pem']) {
      expect(byName[name]).toMatchObject({
        suppressed: true,
        reason: 'secret',
        preview: 'none',
        modified: null,
        size: null,
      })
    }
    expect(byName['normal.txt']).toMatchObject({
      suppressed: false,
      reason: null,
      preview: 'full',
    })
  })

  it('marks VCS config material as suppressed when listed', async () => {
    dashboard = await startMockDashboard()
    await mkdir(join(tmpRoot, '.git'), { recursive: true })
    await writeFile(join(tmpRoot, '.git', 'config'), '[credential]\nhelper = store\n')

    const listing = await serviceWithWorkspace().listDirectory('default', '.git')
    expect(listing.entries.find((e) => e.name === 'config')).toMatchObject({
      suppressed: true,
      reason: 'secret',
      preview: 'none',
    })
  })

  it('reads a text file from disk', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, 'README.md'), '# Hi')
    const file = await serviceWithWorkspace().readFile('default', 'README.md')
    expect(file).toMatchObject({ root: 'default', path: 'README.md', content: '# Hi' })
    expect(dashboard.calls.some((c) => c.path.startsWith('/api/workspace'))).toBe(false)
  })

  it('flags a BINARY file (NUL bytes) and returns no decoded content (no mojibake)', async () => {
    // A file with a NUL byte is binary; toString("utf8") would be mojibake AND
    // would let the UI offer Edit, whose Save clobbers the bytes. The service
    // must flag it binary + withhold the decoded content.
    dashboard = await startMockDashboard()
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    )
    await writeFile(join(tmpRoot, 'pixel.png'), png)
    const file = await serviceWithWorkspace().readFile('default', 'pixel.png')
    expect(file.binary).toBe(true)
    expect(file.encoding).toBe('binary')
    expect(file.content).toBe('')
    // Size is still reported (the metadata is non-sensitive).
    expect(file.size).toBe(png.length)
  })

  it('does NOT flag ordinary UTF-8 text (incl. multibyte) as binary', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, 'unicode.md'), '# Héllo 世界 — café\n\nbody')
    const file = await serviceWithWorkspace().readFile('default', 'unicode.md')
    expect(file.binary).toBe(false)
    expect(file.content).toContain('世界')
    expect(file.encoding).toBe('utf-8')
  })

  it('treats an empty file as text (editable, not binary)', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, 'empty.txt'), '')
    const file = await serviceWithWorkspace().readFile('default', 'empty.txt')
    expect(file.binary).toBe(false)
    expect(file.content).toBe('')
  })

  it('returns only the bounded head for a huge text preview', async () => {
    dashboard = await startMockDashboard()
    const head = 'a'.repeat(2 * 1024 * 1024)
    await writeFile(join(tmpRoot, 'huge.txt'), `${head}tail`)

    const file = await serviceWithWorkspace().readFile('default', 'huge.txt')

    expect(file.size).toBe(head.length + 'tail'.length)
    expect(file.content).toHaveLength(head.length)
    expect(file.content).not.toContain('tail')
    expect(file.previewMode).toBe('head')
    expect(file.truncated).toBe(true)
  })

  it('rejects a traversal path before any fs read', async () => {
    dashboard = await startMockDashboard()
    await expect(
      serviceWithWorkspace().listDirectory('default', '../escape'),
    ).rejects.toBeInstanceOf(PathGuardError)
  })

  it('blocks reading a sensitive file', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, '.env'), 'SECRET=1')
    await expect(serviceWithWorkspace().readFile('default', '.env')).rejects.toBeInstanceOf(
      PathGuardError,
    )
    await mkdir(join(tmpRoot, 'sub'), { recursive: true })
    await writeFile(join(tmpRoot, 'sub', 'auth.json'), '{}')
    await expect(
      serviceWithWorkspace().readFile('default', 'sub/auth.json'),
    ).rejects.toBeInstanceOf(PathGuardError)
  })

  it('on the HERMES HOME root, still blocks config.yaml + marks it suppressed (no weakening)', async () => {
    // The `home` root exposes ~/.hermes, where config.yaml holds provider keys.
    // Scoping must NOT weaken that: the real config stays unreadable + suppressed.
    dashboard = await startMockDashboard()
    const svc = makeService()
    svc.setRootResolver(async (id) =>
      id === 'home'
        ? {
            id: 'home',
            label: 'Hermes home',
            description: 'hermes_home',
            path: tmpRoot,
            readOnly: true,
          }
        : null,
    )
    await writeFile(join(tmpRoot, 'config.yaml'), 'provider:\n  key: secret\n')
    await mkdir(join(tmpRoot, 'profiles', 'work'), { recursive: true })
    await writeFile(join(tmpRoot, 'profiles', 'work', 'config.yaml'), 'key: 2\n')
    await writeFile(join(tmpRoot, 'notes.md'), '# ok')

    // Reads of the home config family are blocked.
    await expect(svc.readFile('home', 'config.yaml')).rejects.toBeInstanceOf(PathGuardError)
    await expect(svc.readFile('home', 'profiles/work/config.yaml')).rejects.toBeInstanceOf(
      PathGuardError,
    )
    // It's also marked suppressed in the listing (no metadata leaked).
    const listing = await svc.listDirectory('home', '')
    expect(listing.entries.find((e) => e.name === 'config.yaml')).toMatchObject({
      suppressed: true,
      reason: 'secret',
      preview: 'none',
    })
    // An ordinary file under the home root still reads fine.
    expect((await svc.readFile('home', 'notes.md')).content).toBe('# ok')
  })

  it('REALPATH-guards a directory listing: refuses a symlink that escapes the root', async () => {
    dashboard = await startMockDashboard()
    const outside = await mkdtemp(join(tmpdir(), 'ad-outside-list-'))
    try {
      await mkdir(join(outside, 'secretdir'), { recursive: true })
      await symlink(join(outside, 'secretdir'), join(tmpRoot, 'escape'), 'dir')
      await expect(
        serviceWithWorkspace().listDirectory('default', 'escape'),
      ).rejects.toBeInstanceOf(PathGuardError)
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('REALPATH-guards a file read: refuses a symlink that escapes the root', async () => {
    dashboard = await startMockDashboard()
    const outside = await mkdtemp(join(tmpdir(), 'ad-outside-read-'))
    try {
      await writeFile(join(outside, 'secret.txt'), 'top secret')
      await symlink(join(outside, 'secret.txt'), join(tmpRoot, 'innocent.txt'))
      await expect(
        serviceWithWorkspace().readFile('default', 'innocent.txt'),
      ).rejects.toBeInstanceOf(PathGuardError)
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})

describe('FilesService writes (direct fs, path-guarded)', () => {
  /** A service whose roots resolver returns our temp dir for id "tmp". */
  function serviceWithTmpRoot(): FilesService {
    const svc = makeService()
    // Inject a roots resolver so writes target the temp dir without the dashboard.
    svc.setRootResolver(async (id) =>
      id === 'tmp'
        ? { id: 'tmp', label: 'Tmp', description: '', path: tmpRoot, readOnly: false }
        : null,
    )
    return svc
  }

  it('writes a new file and reports size', async () => {
    dashboard = await startMockDashboard()
    const res = await serviceWithTmpRoot().writeFile('tmp', 'notes/hello.txt', 'hello world')
    expect(await readFile(join(tmpRoot, 'notes/hello.txt'), 'utf8')).toBe('hello world')
    expect(res.size).toBe('hello world'.length)
    expect(res.path).toBe('notes/hello.txt')
  })

  it('overwrites an existing file', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, 'a.txt'), 'old')
    await serviceWithTmpRoot().writeFile('tmp', 'a.txt', 'new')
    expect(await readFile(join(tmpRoot, 'a.txt'), 'utf8')).toBe('new')
  })

  it('refuses to write a sensitive file', async () => {
    dashboard = await startMockDashboard()
    await expect(serviceWithTmpRoot().writeFile('tmp', '.env', 'SECRET=1')).rejects.toBeInstanceOf(
      PathGuardError,
    )
    await expect(serviceWithTmpRoot().writeFile('tmp', 'auth.json', '{}')).rejects.toBeInstanceOf(
      PathGuardError,
    )
  })

  it('ALLOWS an ordinary config.yaml/settings.json write in a non-home work root', async () => {
    // Config files are credential-bearing only under the Hermes home; in a
    // playground/workspace root they are ordinary project files — writable.
    dashboard = await startMockDashboard()
    await serviceWithTmpRoot().writeFile('tmp', 'config.yaml', 'port: 3000\n')
    expect(await readFile(join(tmpRoot, 'config.yaml'), 'utf8')).toBe('port: 3000\n')
    await serviceWithTmpRoot().writeFile('tmp', '.vscode/settings.json', '{}')
    expect(await readFile(join(tmpRoot, '.vscode/settings.json'), 'utf8')).toBe('{}')
  })

  it('refuses to write outside the root via traversal', async () => {
    dashboard = await startMockDashboard()
    await expect(
      serviceWithTmpRoot().writeFile('tmp', '../escape.txt', 'x'),
    ).rejects.toBeInstanceOf(PathGuardError)
  })

  it('creates a directory', async () => {
    dashboard = await startMockDashboard()
    await serviceWithTmpRoot().createEntry('tmp', 'newdir', 'dir')
    expect((await stat(join(tmpRoot, 'newdir'))).isDirectory()).toBe(true)
  })

  it('creates an empty file', async () => {
    dashboard = await startMockDashboard()
    await serviceWithTmpRoot().createEntry('tmp', 'fresh.md', 'file')
    expect(await readFile(join(tmpRoot, 'fresh.md'), 'utf8')).toBe('')
  })

  it('refuses to create an entry that already exists', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, 'dupe.txt'), 'x')
    await expect(
      serviceWithTmpRoot().createEntry('tmp', 'dupe.txt', 'file'),
    ).rejects.toBeInstanceOf(FilesServiceError)
  })

  it('renames a file (both paths guarded)', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, 'from.txt'), 'data')
    await serviceWithTmpRoot().renameEntry('tmp', 'from.txt', 'to.txt')
    expect(await readFile(join(tmpRoot, 'to.txt'), 'utf8')).toBe('data')
    await expect(stat(join(tmpRoot, 'from.txt'))).rejects.toThrow()
  })

  it('refuses to rename onto a sensitive destination', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, 'from.txt'), 'data')
    await expect(
      serviceWithTmpRoot().renameEntry('tmp', 'from.txt', '.env'),
    ).rejects.toBeInstanceOf(PathGuardError)
  })

  it('deletes a file', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, 'gone.txt'), 'x')
    await serviceWithTmpRoot().deleteEntry('tmp', 'gone.txt')
    await expect(stat(join(tmpRoot, 'gone.txt'))).rejects.toThrow()
  })

  it('deletes a directory recursively', async () => {
    dashboard = await startMockDashboard()
    await mkdir(join(tmpRoot, 'd/sub'), { recursive: true })
    await writeFile(join(tmpRoot, 'd/sub/f.txt'), 'x')
    await serviceWithTmpRoot().deleteEntry('tmp', 'd')
    await expect(stat(join(tmpRoot, 'd'))).rejects.toThrow()
  })

  it('refuses to delete the root itself', async () => {
    dashboard = await startMockDashboard()
    await expect(serviceWithTmpRoot().deleteEntry('tmp', '')).rejects.toBeInstanceOf(
      FilesServiceError,
    )
  })

  it('throws FilesServiceError for an unknown root', async () => {
    dashboard = await startMockDashboard({ routes: { '/api/workspace/roots': { roots: [] } } })
    await expect(makeService().writeFile('nope', 'a.txt', 'x')).rejects.toBeInstanceOf(
      FilesServiceError,
    )
  })
})

describe('FilesService writes are blocked on a read-only root (I1)', () => {
  /** A service whose "ro" root reports read_only=true; the temp dir is real so a
   * leaked write would actually land on disk (the assertion that nothing lands
   * proves the gate fired BEFORE any fs call). */
  function serviceWithReadOnlyRoot(): FilesService {
    const svc = makeService()
    svc.setRootResolver(async (id) =>
      id === 'ro'
        ? { id: 'ro', label: 'RO', description: '', path: tmpRoot, readOnly: true }
        : null,
    )
    return svc
  }

  it('blocks writeFile with a read-only FilesServiceError and writes nothing', async () => {
    dashboard = await startMockDashboard()
    const err = await serviceWithReadOnlyRoot()
      .writeFile('ro', 'notes/hello.txt', 'hello')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FilesServiceError)
    expect((err as FilesServiceError).code).toBe('read_only')
    await expect(stat(join(tmpRoot, 'notes/hello.txt'))).rejects.toThrow()
  })

  it('blocks createEntry on a read-only root', async () => {
    dashboard = await startMockDashboard()
    const err = await serviceWithReadOnlyRoot()
      .createEntry('ro', 'newdir', 'dir')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FilesServiceError)
    expect((err as FilesServiceError).code).toBe('read_only')
    await expect(stat(join(tmpRoot, 'newdir'))).rejects.toThrow()
  })

  it('blocks renameEntry on a read-only root', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, 'from.txt'), 'data')
    const err = await serviceWithReadOnlyRoot()
      .renameEntry('ro', 'from.txt', 'to.txt')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FilesServiceError)
    expect((err as FilesServiceError).code).toBe('read_only')
    // Source untouched, destination never created.
    expect(await readFile(join(tmpRoot, 'from.txt'), 'utf8')).toBe('data')
    await expect(stat(join(tmpRoot, 'to.txt'))).rejects.toThrow()
  })

  it('blocks deleteEntry on a read-only root', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, 'keep.txt'), 'data')
    const err = await serviceWithReadOnlyRoot()
      .deleteEntry('ro', 'keep.txt')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FilesServiceError)
    expect((err as FilesServiceError).code).toBe('read_only')
    // The file survives.
    expect(await readFile(join(tmpRoot, 'keep.txt'), 'utf8')).toBe('data')
  })

  it('still allows READS on a read-only root (readRaw)', async () => {
    dashboard = await startMockDashboard()
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    )
    await writeFile(join(tmpRoot, 'pic.png'), png)
    const raw = await serviceWithReadOnlyRoot().readRaw('ro', 'pic.png')
    expect(raw.contentType).toBe('image/png')
  })
})

describe('FilesService.readRaw (image/raw bytes, path-guarded)', () => {
  function serviceWithTmpRoot(): FilesService {
    const svc = makeService()
    svc.setRootResolver(async (id) =>
      id === 'tmp'
        ? { id: 'tmp', label: 'Tmp', description: '', path: tmpRoot, readOnly: false }
        : null,
    )
    return svc
  }

  it('returns bytes + a guessed content-type for an image', async () => {
    dashboard = await startMockDashboard()
    // A 1x1 transparent PNG.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    )
    await writeFile(join(tmpRoot, 'pixel.png'), png)
    const raw = await serviceWithTmpRoot().readRaw('tmp', 'pixel.png')
    expect(raw.contentType).toBe('image/png')
    expect(raw.data.equals(png)).toBe(true)
  })

  it('refuses a sensitive raw read', async () => {
    dashboard = await startMockDashboard()
    await expect(serviceWithTmpRoot().readRaw('tmp', '.env')).rejects.toBeInstanceOf(PathGuardError)
  })

  it('refuses traversal on raw read', async () => {
    dashboard = await startMockDashboard()
    await expect(serviceWithTmpRoot().readRaw('tmp', '../escape.png')).rejects.toBeInstanceOf(
      PathGuardError,
    )
  })

  it('404s a missing raw file', async () => {
    dashboard = await startMockDashboard()
    await expect(serviceWithTmpRoot().readRaw('tmp', 'nope.png')).rejects.toBeInstanceOf(
      FilesServiceError,
    )
  })
})

describe('FilesService.downloadFile (guarded attachment download)', () => {
  function serviceWithTmpRoot(): FilesService {
    const svc = makeService()
    svc.setRootResolver(async (id) =>
      id === 'tmp'
        ? { id: 'tmp', label: 'Tmp', description: '', path: tmpRoot, readOnly: false }
        : null,
    )
    return svc
  }

  it('returns the full bytes + a clean basename for a text file', async () => {
    dashboard = await startMockDashboard()
    await mkdir(join(tmpRoot, 'sub'), { recursive: true })
    await writeFile(join(tmpRoot, 'sub', 'notes.txt'), 'hello download')
    const out = await serviceWithTmpRoot().downloadFile('tmp', 'sub/notes.txt')
    expect(out.filename).toBe('notes.txt')
    expect(out.data.toString('utf8')).toBe('hello download')
    expect(out.size).toBe('hello download'.length)
  })

  it('downloads BINARY bytes verbatim (this is a download, not a preview)', async () => {
    dashboard = await startMockDashboard()
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    )
    await writeFile(join(tmpRoot, 'pixel.png'), png)
    const out = await serviceWithTmpRoot().downloadFile('tmp', 'pixel.png')
    expect(out.data.equals(png)).toBe(true)
  })

  it('refuses to download a sensitive file', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, '.env'), 'SECRET=1')
    await expect(serviceWithTmpRoot().downloadFile('tmp', '.env')).rejects.toBeInstanceOf(
      PathGuardError,
    )
  })

  it('refuses traversal on download', async () => {
    dashboard = await startMockDashboard()
    await expect(serviceWithTmpRoot().downloadFile('tmp', '../escape.txt')).rejects.toBeInstanceOf(
      PathGuardError,
    )
  })

  it('404s a missing download target', async () => {
    dashboard = await startMockDashboard()
    await expect(serviceWithTmpRoot().downloadFile('tmp', 'nope.txt')).rejects.toBeInstanceOf(
      FilesServiceError,
    )
  })

  it('refuses to download through a symlink that escapes the root', async () => {
    dashboard = await startMockDashboard()
    const outside = await mkdtemp(join(tmpdir(), 'ad-dl-out-'))
    try {
      await writeFile(join(outside, 'secret.txt'), 'top secret')
      await symlink(join(outside, 'secret.txt'), join(tmpRoot, 'innocent.txt'))
      await expect(serviceWithTmpRoot().downloadFile('tmp', 'innocent.txt')).rejects.toBeInstanceOf(
        PathGuardError,
      )
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})

describe('FilesService symlink-escape guard (realpath re-assertion)', () => {
  /** An "outside" directory that the symlinks point at — NOT inside tmpRoot. */
  let outside: string

  beforeEach(async () => {
    outside = await mkdtemp(join(tmpdir(), 'ad-outside-'))
  })
  afterEach(async () => {
    await rm(outside, { recursive: true, force: true })
  })

  function serviceWithTmpRoot(): FilesService {
    const svc = makeService()
    svc.setRootResolver(async (id) =>
      id === 'tmp'
        ? { id: 'tmp', label: 'Tmp', description: '', path: tmpRoot, readOnly: false }
        : null,
    )
    return svc
  }

  it('refuses to READ RAW (direct fs read) through a symlink that escapes the root', async () => {
    dashboard = await startMockDashboard()
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    )
    await writeFile(join(outside, 'evil.png'), png)
    await symlink(join(outside, 'evil.png'), join(tmpRoot, 'pic.png'))
    await expect(serviceWithTmpRoot().readRaw('tmp', 'pic.png')).rejects.toBeInstanceOf(
      PathGuardError,
    )
  })

  it('refuses to READ RAW a file that resolves into a symlinked sensitive dir', async () => {
    dashboard = await startMockDashboard()
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    )
    // A real secret dir outside, then a non-sensitive-named symlink to it inside.
    await mkdir(join(outside, '.ssh'), { recursive: true })
    await writeFile(join(outside, '.ssh', 'avatar.png'), png)
    await symlink(join(outside, '.ssh'), join(tmpRoot, 'innocent'), 'dir')
    await expect(serviceWithTmpRoot().readRaw('tmp', 'innocent/avatar.png')).rejects.toBeInstanceOf(
      PathGuardError,
    )
  })

  it('refuses to WRITE through a symlinked directory that escapes the root', async () => {
    dashboard = await startMockDashboard()
    // A directory symlink inside the root pointing outside; a write under it would
    // land outside the workspace.
    await symlink(outside, join(tmpRoot, 'escape'), 'dir')
    await expect(
      serviceWithTmpRoot().writeFile('tmp', 'escape/planted.txt', 'x'),
    ).rejects.toBeInstanceOf(PathGuardError)
    // Nothing was written outside.
    await expect(stat(join(outside, 'planted.txt'))).rejects.toThrow()
  })

  it('refuses to CREATE through a symlinked directory that escapes the root', async () => {
    dashboard = await startMockDashboard()
    await symlink(outside, join(tmpRoot, 'escape'), 'dir')
    await expect(
      serviceWithTmpRoot().createEntry('tmp', 'escape/new.txt', 'file'),
    ).rejects.toBeInstanceOf(PathGuardError)
    await expect(stat(join(outside, 'new.txt'))).rejects.toThrow()
  })

  it('refuses to DELETE a symlink whose target escapes the root', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(outside, 'keep.txt'), 'data')
    await symlink(join(outside, 'keep.txt'), join(tmpRoot, 'link.txt'))
    await expect(serviceWithTmpRoot().deleteEntry('tmp', 'link.txt')).rejects.toBeInstanceOf(
      PathGuardError,
    )
    // The outside target survives.
    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('data')
  })

  it('refuses to RENAME from a symlink-escaped source', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(outside, 'src.txt'), 'data')
    await symlink(join(outside, 'src.txt'), join(tmpRoot, 'from.txt'))
    await expect(
      serviceWithTmpRoot().renameEntry('tmp', 'from.txt', 'to.txt'),
    ).rejects.toBeInstanceOf(PathGuardError)
  })

  it('refuses to RENAME into a symlinked-escaping destination directory', async () => {
    dashboard = await startMockDashboard()
    await writeFile(join(tmpRoot, 'real.txt'), 'data')
    await symlink(outside, join(tmpRoot, 'escape'), 'dir')
    await expect(
      serviceWithTmpRoot().renameEntry('tmp', 'real.txt', 'escape/moved.txt'),
    ).rejects.toBeInstanceOf(PathGuardError)
    await expect(stat(join(outside, 'moved.txt'))).rejects.toThrow()
  })

  it('still allows a normal (non-symlinked) write + raw read inside the root', async () => {
    dashboard = await startMockDashboard()
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    )
    await writeFile(join(tmpRoot, 'sub', 'ok.png'), png).catch(async () => {
      await mkdir(join(tmpRoot, 'sub'), { recursive: true })
      await writeFile(join(tmpRoot, 'sub', 'ok.png'), png)
    })
    const raw = await serviceWithTmpRoot().readRaw('tmp', 'sub/ok.png')
    expect(raw.contentType).toBe('image/png')
  })

  it('allows an INTERNAL symlinked dir that stays inside the root', async () => {
    dashboard = await startMockDashboard()
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    )
    await mkdir(join(tmpRoot, 'real'), { recursive: true })
    await writeFile(join(tmpRoot, 'real', 'pic.png'), png)
    // A symlink that points to another location *inside* the same root is fine.
    await symlink(join(tmpRoot, 'real'), join(tmpRoot, 'alias'), 'dir')
    const raw = await serviceWithTmpRoot().readRaw('tmp', 'alias/pic.png')
    expect(raw.contentType).toBe('image/png')
  })
})
