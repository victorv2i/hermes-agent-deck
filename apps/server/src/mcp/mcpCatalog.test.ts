import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCatalog, parseManifestEntry, resolveCatalogDir } from './mcpCatalog'

const LINEAR = `manifest_version: 1
name: linear
description: Find, create, and update Linear issues.
source: https://linear.app/docs/mcp
transport:
  type: http
  url: https://mcp.linear.app/mcp
auth:
  type: oauth
`

const N8N = `manifest_version: 1
name: n8n
description: Manage and inspect n8n workflows from Hermes.
source: https://github.com/example/hermes-n8n-mcp
transport:
  type: stdio
  command: "\${INSTALL_DIR}/.venv/bin/python"
install:
  type: git
  url: https://github.com/example/hermes-n8n-mcp.git
  ref: main
auth:
  type: api_key
  env:
    - name: N8N_API_KEY
`

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcp-catalog-'))
  await mkdir(join(dir, 'linear'), { recursive: true })
  await mkdir(join(dir, 'n8n'), { recursive: true })
  await writeFile(join(dir, 'linear', 'manifest.yaml'), LINEAR, 'utf8')
  await writeFile(join(dir, 'n8n', 'manifest.yaml'), N8N, 'utf8')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('mcpCatalog', () => {
  it('reads both manifests, sorted by name, mapping transport + auth', async () => {
    const out = await readCatalog(dir, new Set())
    expect(out.map((e) => e.name)).toEqual(['linear', 'n8n'])
    const linear = out[0]!
    expect(linear.transport).toBe('http')
    expect(linear.authKind).toBe('oauth')
    expect(linear.requiresInstall).toBe(false)
    expect(linear.sourceUrl).toBe('https://linear.app/docs/mcp')
  })

  it('flags a git-bootstrap manifest as requiresInstall (CLI-only)', async () => {
    const out = await readCatalog(dir, new Set())
    const n8n = out.find((e) => e.name === 'n8n')!
    expect(n8n.requiresInstall).toBe(true)
    expect(n8n.transport).toBe('stdio')
    expect(n8n.authKind).toBe('api_key')
  })

  it('marks entries already present in mcp_servers as installed', async () => {
    const out = await readCatalog(dir, new Set(['linear']))
    expect(out.find((e) => e.name === 'linear')!.installed).toBe(true)
    expect(out.find((e) => e.name === 'n8n')!.installed).toBe(false)
  })

  it('returns an empty list when the catalog dir is missing', async () => {
    expect(await readCatalog(join(dir, 'does-not-exist'), new Set())).toEqual([])
  })

  it('skips a malformed manifest rather than throwing', async () => {
    await mkdir(join(dir, 'broken'), { recursive: true })
    await writeFile(join(dir, 'broken', 'manifest.yaml'), 'name:\n  - not a string\n', 'utf8')
    const out = await readCatalog(dir, new Set())
    expect(out.map((e) => e.name)).toEqual(['linear', 'n8n'])
  })

  it('rejects a manifest with a missing name/description', () => {
    expect(parseManifestEntry({ name: 'x' }, new Set())).toBeNull()
    expect(parseManifestEntry({ description: 'y' }, new Set())).toBeNull()
    expect(parseManifestEntry({ name: 'bad name', description: 'z' }, new Set())).toBeNull()
  })

  it('resolveCatalogDir honors the HERMES_OPTIONAL_MCPS override', () => {
    expect(resolveCatalogDir({ HERMES_OPTIONAL_MCPS: '/custom' }, '/fallback')).toBe('/custom')
    expect(resolveCatalogDir({}, '/fallback')).toBe('/fallback')
  })
})
