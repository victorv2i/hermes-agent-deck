/**
 * GUARDED MCP config read/write — the ONLY place the BFF touches
 * `~/.hermes/config.yaml`'s `mcp_servers` slice.
 *
 * SECURITY DISCIPLINE (load-bearing):
 *  - PATH-GUARDED. The config path is ALWAYS `<hermesHome>/config.yaml`, resolved
 *    + realpath-contained inside `hermesHome` (a symlinked config that escapes
 *    the home is refused) BEFORE any read/write. No client-supplied path ever
 *    reaches the filesystem.
 *  - ALLOWLISTED WRITE. The write is a read-modify-write that touches ONLY the
 *    top-level `mcp_servers` key: it parses the full config, replaces JUST that
 *    slice, and re-serializes. Every untouched key (incl. live credentials like
 *    `API_SERVER_KEY`, provider api_keys) round-trips verbatim. The BFF never
 *    writes a credential into config.yaml — masked keys live in `.env` via the
 *    existing `/api/env` path; this slice only references the env var.
 *  - The `yaml` lib preserves the document well enough for a slice swap; we keep
 *    the write minimal (parse → set one key → stringify) so the change is small
 *    and auditable, mirroring the settings read-modify-write.
 */
import { readFile, writeFile, rename, realpath } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { isPathInsideRoot } from '../files/pathGuard'

/** The single, fixed config file this module is allowed to touch. */
export function configPathFor(hermesHome: string): string {
  return join(hermesHome, 'config.yaml')
}

/**
 * Resolve + verify the config path is the real `<hermesHome>/config.yaml` and
 * that it sits inside `hermesHome` after symlinks are followed. Returns the real
 * absolute path to operate on. Throws on any escape.
 */
async function assertConfigPath(hermesHome: string): Promise<string> {
  const target = configPathFor(hermesHome)
  // Compute the real boundary of the home (resolve any symlinked home dir) so the
  // containment compares real-path against real-path.
  let realHome: string
  try {
    realHome = await realpath(hermesHome)
  } catch {
    realHome = hermesHome
  }

  // If config.yaml EXISTS, follow it: a symlinked config that points outside the
  // home must be refused (it would redirect the write to a foreign file).
  try {
    const realTarget = await realpath(target)
    if (!isPathInsideRoot(realHome, realTarget)) {
      throw new Error('config path escapes the hermes home')
    }
    return realTarget
  } catch (err) {
    // A genuine escape (we threw above) propagates; an ENOENT (file not yet
    // created) falls through to the directory-anchored path below.
    if (err instanceof Error && err.message.includes('escapes the hermes home')) throw err
  }

  // File absent (a first write): realpath the directory, re-attach the FIXED
  // basename so a symlinked config dir cannot redirect the write elsewhere.
  let realDir: string
  try {
    realDir = await realpath(dirname(target))
  } catch {
    realDir = dirname(target)
  }
  const realTarget = join(realDir, basename(target))
  if (!isPathInsideRoot(realHome, realTarget)) {
    throw new Error('config path escapes the hermes home')
  }
  return realTarget
}

/**
 * Read + parse the full config.yaml. Returns `{}` when the file is ABSENT. Throws a
 * fixed, content-free error when the file exists but is INVALID YAML (see below).
 */
export async function readConfig(hermesHome: string): Promise<Record<string, unknown>> {
  const path = await assertConfigPath(hermesHome)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return {} // absent file = no config yet (fine)
  }
  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch {
    // Malformed YAML: throw a FIXED, content-free message. NEVER let the yaml
    // parser's own error reach a client — it embeds the offending config line(s),
    // which can sit right next to a credential. And NEVER return {} here: the slice
    // WRITE path (writeMcpServers) reads via this function, so {} would make it
    // OVERWRITE the unparseable file and destroy the user's other config.
    throw new Error('The Hermes config.yaml could not be parsed (invalid YAML).')
  }
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
}

/** Read JUST the `mcp_servers` block, or `{}` when absent/malformed. */
export async function readMcpServers(hermesHome: string): Promise<Record<string, unknown>> {
  const config = await readConfig(hermesHome)
  const block = config.mcp_servers
  return block && typeof block === 'object' ? (block as Record<string, unknown>) : {}
}

/**
 * GUARDED slice write: read the full config, replace ONLY `mcp_servers` with
 * `servers`, write it back. When `servers` is empty the key is removed entirely
 * (matching the CLI's `_remove_mcp_server` behavior). Every other key is
 * untouched. Returns the new `mcp_servers` block.
 */
export async function writeMcpServers(
  hermesHome: string,
  servers: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const path = await assertConfigPath(hermesHome)
  const config = await readConfig(hermesHome)

  if (Object.keys(servers).length === 0) {
    delete config.mcp_servers
  } else {
    config.mcp_servers = servers
  }

  // ATOMIC write: write to a temp file in the SAME directory, then rename(2) over
  // the target. rename is atomic on POSIX within a filesystem, so a crash / power
  // loss / disk-full mid-write can NEVER leave config.yaml (which holds EVERYTHING —
  // model, API_SERVER_KEY, provider key refs, agent settings, mcp_servers) truncated
  // or half-written, and a concurrent reader (e.g. the gateway) sees the old or the
  // new file, never a partial one. An in-place truncating writeFile has neither
  // guarantee. The temp name is unique per process + call to avoid collisions.
  atomicWriteSeq += 1
  const tmp = `${path}.${process.pid}.${atomicWriteSeq}.tmp`
  await writeFile(tmp, stringifyYaml(config), 'utf8')
  await rename(tmp, path)
  return servers
}

/** Monotonic counter making each in-flight atomic temp filename unique per process. */
let atomicWriteSeq = 0
