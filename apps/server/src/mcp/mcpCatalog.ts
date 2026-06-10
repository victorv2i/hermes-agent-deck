/**
 * MCP CATALOG READER — the curated, Nous-approved catalog projected for the
 * surface. Each entry lives at `optional-mcps/<name>/manifest.yaml` in the hermes
 * checkout; we read + parse those manifests into {@link McpCatalogEntry} DTOs.
 *
 * SECURITY / HONESTY:
 *  - PATH-GUARDED. We only ever read `<catalogDir>/<child>/manifest.yaml` where
 *    `<child>` is a real first-level subdir of the catalog root, realpath-checked
 *    to stay inside the root (a symlinked entry that escapes is skipped). No
 *    client input reaches the filesystem — the catalog dir is server config.
 *  - `requiresInstall` (a manifest `install:` git-bootstrap) and
 *    `authKind === 'oauth'` both mean the install is CLI-only — the surface shows
 *    the `hermes mcp install <name>` command rather than faking an in-browser add.
 *  - A malformed manifest is skipped silently (mirrors the CLI's `list_catalog`).
 */
import { readdir, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { McpCatalogEntry, McpAuthKind, McpTransport } from '@agent-deck/protocol'
import { isPathInsideRoot } from '../files/pathGuard'

/** Resolve the catalog root: the `HERMES_OPTIONAL_MCPS` override, else `fallback`. */
export function resolveCatalogDir(env: NodeJS.ProcessEnv, fallback: string): string {
  const override = env.HERMES_OPTIONAL_MCPS?.trim()
  return override && override !== '' ? override : fallback
}

interface RawManifest {
  name?: unknown
  description?: unknown
  source?: unknown
  transport?: unknown
  auth?: unknown
  install?: unknown
}

/** Map a raw manifest `transport.type` to the wire transport (default stdio). */
function manifestTransport(raw: RawManifest): McpTransport {
  const t = raw.transport
  if (t && typeof t === 'object') {
    const type = (t as Record<string, unknown>).type
    if (type === 'http') return 'http'
  }
  return 'stdio'
}

/** Map a raw manifest `auth.type` to the wire auth kind (default none). */
function manifestAuthKind(raw: RawManifest): McpAuthKind {
  const a = raw.auth
  if (a && typeof a === 'object') {
    const type = (a as Record<string, unknown>).type
    if (type === 'oauth') return 'oauth'
    if (type === 'api_key') return 'api_key'
  }
  return 'none'
}

/** Parse ONE manifest object into a catalog entry, or null when invalid. */
export function parseManifestEntry(
  raw: unknown,
  installedNames: ReadonlySet<string>,
): McpCatalogEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as RawManifest
  const name = typeof m.name === 'string' ? m.name.trim() : ''
  const description = typeof m.description === 'string' ? m.description.trim() : ''
  if (name === '' || description === '') return null
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return null

  const sourceUrl = typeof m.source === 'string' && m.source.trim() !== '' ? m.source.trim() : null
  const requiresInstall = !!m.install && typeof m.install === 'object'

  return {
    name,
    description,
    transport: manifestTransport(m),
    authKind: manifestAuthKind(m),
    sourceUrl,
    requiresInstall,
    installed: installedNames.has(name),
  }
}

/**
 * Read every valid catalog entry from `catalogDir`, marking which are already in
 * `mcp_servers` (`installedNames`). A missing dir → empty list. Malformed
 * manifests are skipped. Sorted by name.
 */
export async function readCatalog(
  catalogDir: string,
  installedNames: ReadonlySet<string>,
): Promise<McpCatalogEntry[]> {
  let realRoot: string
  try {
    realRoot = await realpath(catalogDir)
  } catch {
    return []
  }

  let children: string[]
  try {
    children = (await readdir(realRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }

  const entries: McpCatalogEntry[] = []
  for (const child of children.sort()) {
    const manifestPath = join(realRoot, child, 'manifest.yaml')
    // Realpath-contain the manifest inside the catalog root (skip symlink escapes).
    let realManifest: string
    try {
      realManifest = await realpath(manifestPath)
    } catch {
      continue
    }
    if (!isPathInsideRoot(realRoot, realManifest)) continue

    let parsed: unknown
    try {
      parsed = parseYaml(await readFile(realManifest, 'utf8'))
    } catch {
      continue
    }
    const entry = parseManifestEntry(parsed, installedNames)
    if (entry) entries.push(entry)
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name))
}
