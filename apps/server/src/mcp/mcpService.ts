/**
 * MCP SERVICE — the PURE projection behind the MCP Server Manager BFF.
 *
 * It maps a raw `mcp_servers` config block (the `~/.hermes/config.yaml` slice)
 * onto the wire {@link McpConfiguredServer} DTOs, and folds a server entry's
 * env/header secret into a SHAPE-ONLY field — never a plaintext value. No I/O
 * here (the route reads the config + env; this just shapes them), so every
 * mapping decision is unit-testable.
 *
 * HONESTY: `enabled` is the config flag (default true when absent), NEVER a
 * connection state. `toolCount` is the explicit `tools.include` selection count,
 * or null when the config selects "all" (the real count needs a `test` probe).
 * Transport detail is sanitized + truncated so no secret-bearing value crosses
 * the wire.
 */
import type { McpAuthKind, McpConfiguredServer, McpTransport } from '@agent-deck/protocol'

/** A raw `mcp_servers.<name>` entry. Only the recognized keys are ever read. */
export interface RawMcpServerConfig {
  url?: unknown
  command?: unknown
  args?: unknown
  auth?: unknown
  enabled?: unknown
  headers?: unknown
  tools?: unknown
}

const MAX_DETAIL = 60
const MAX_STDIO_ARGS = 2
const REDACTED = '[redacted]'
const SECRET_NAME_RE =
  /(?:^|[-_./:])(api[-_]?key|auth(?:orization)?|bearer|credential|key|password|passwd|pwd|secret|token)(?:$|[-_./:])/i
const SECRET_VALUE_MARKER_RE =
  /\b(api[-_]?key|authorization|bearer|credential|password|passwd|secret|token)\b/i
const SECRET_VALUE_SHAPE_RE =
  /^(sk-[A-Za-z0-9_-]{8,}|gh[opsu]_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.?[A-Za-z0-9_-]*)$/

/** Coerce the config's `enabled` (bool or string) — defaults TRUE when absent. */
export function readEnabled(raw: RawMcpServerConfig): boolean {
  const v = raw.enabled
  if (v === undefined || v === null) return true
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return ['true', '1', 'yes'].includes(v.trim().toLowerCase())
  return Boolean(v)
}

/** Decide the transport from the entry shape: a `url` is http, else stdio. */
export function readTransport(raw: RawMcpServerConfig): McpTransport {
  return typeof raw.url === 'string' && raw.url.trim() !== '' ? 'http' : 'stdio'
}

/**
 * Decide the auth kind. Explicit `auth: oauth` wins. Otherwise, a `headers` map
 * carrying an auth/key-shaped header (or any `${ENV}` reference) means `api_key`;
 * a bare server with neither is `none`. We never inspect a VALUE, only the shape.
 */
export function readAuthKind(raw: RawMcpServerConfig): McpAuthKind {
  if (typeof raw.auth === 'string' && raw.auth.trim().toLowerCase() === 'oauth') return 'oauth'
  const headers = raw.headers
  if (headers && typeof headers === 'object') {
    const keys = Object.keys(headers as Record<string, unknown>)
    if (keys.some((k) => /key|auth|token/i.test(k))) return 'api_key'
    // Any header value that references an env var implies a stored credential.
    const values = Object.values(headers as Record<string, unknown>)
    if (values.some((v) => typeof v === 'string' && /\$\{[^}]+\}/.test(v))) return 'api_key'
  }
  return 'none'
}

/** A short, safe transport label: sanitized URL, or `command + first args`, truncated. */
export function readTransportDetail(raw: RawMcpServerConfig): string {
  if (typeof raw.url === 'string' && raw.url.trim() !== '') {
    return truncate(sanitizeHttpUrl(raw.url.trim()))
  }
  if (typeof raw.command === 'string' && raw.command.trim() !== '') {
    const argv = sanitizeStdioArgs(raw.args)
    return truncate([raw.command.trim(), ...argv].join(' '))
  }
  return 'unknown'
}

/**
 * The selected-tool count from `tools.include`, or null when the config selects
 * "all" (no `include` list). An `exclude`-only config also returns null — the
 * true count is only known after a probe, so we never invent a number.
 */
export function readToolCount(raw: RawMcpServerConfig): number | null {
  const tools = raw.tools
  if (!tools || typeof tools !== 'object') return null
  const include = (tools as Record<string, unknown>).include
  if (Array.isArray(include)) return include.length
  return null
}

function truncate(text: string): string {
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1)}…` : text
}

function sanitizeHttpUrl(raw: string): string {
  try {
    const url = new URL(raw)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return stripUserinfo(stripQueryAndFragment(raw))
  }
}

function stripQueryAndFragment(raw: string): string {
  const index = raw.search(/[?#]/)
  return index === -1 ? raw : raw.slice(0, index)
}

function stripUserinfo(raw: string): string {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/.exec(raw)
  if (!match) return raw
  const scheme = match[1]
  const authority = match[2]
  const rest = match[3] ?? ''
  if (scheme === undefined || authority === undefined) return raw
  const userinfoEnd = authority.lastIndexOf('@')
  if (userinfoEnd === -1) return raw
  return `${scheme}${authority.slice(userinfoEnd + 1)}${rest}`
}

function sanitizeStdioArgs(args: unknown): string[] {
  if (!Array.isArray(args)) return []

  const safe: string[] = []
  const rawArgs = args.filter((a): a is string => typeof a === 'string')
  for (let i = 0; i < rawArgs.length && safe.length < MAX_STDIO_ARGS; i += 1) {
    const arg = rawArgs[i]!.trim()
    if (arg === '') continue

    safe.push(redactStdioArg(arg))

    // A bare secret flag (e.g. `--api-key`) consumes the next arg as its value.
    // Only push the REDACTED placeholder when the cap still has room — otherwise
    // the secret flag occupies the final slot and the value is simply dropped.
    if (isBareSecretFlag(arg) && i + 1 < rawArgs.length && safe.length < MAX_STDIO_ARGS) {
      safe.push(REDACTED)
      i += 1
    }
  }
  return safe
}

function redactStdioArg(arg: string): string {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(arg)) return sanitizeHttpUrl(arg)

  const eq = arg.indexOf('=')
  if (eq > 0) {
    const name = arg.slice(0, eq)
    const value = arg.slice(eq + 1)
    if (isSecretName(name) || isSecretValue(value)) return `${name}=${REDACTED}`
  }

  const colon = arg.indexOf(':')
  if (colon > 0) {
    const name = arg.slice(0, colon)
    const value = arg.slice(colon + 1)
    if (isSecretName(name) || isSecretValue(value)) return `${name}: ${REDACTED}`
  }

  if (arg.startsWith('-')) return arg
  if (isSecretValue(arg)) return REDACTED
  return arg
}

function isBareSecretFlag(arg: string): boolean {
  return arg.startsWith('-') && !arg.includes('=') && isSecretName(arg.replace(/^-+/, ''))
}

function isSecretName(name: string): boolean {
  return SECRET_NAME_RE.test(name)
}

function isSecretValue(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return false
  return SECRET_VALUE_MARKER_RE.test(trimmed) || SECRET_VALUE_SHAPE_RE.test(trimmed)
}

/** Project ONE `mcp_servers.<name>` entry onto the wire DTO. */
export function projectServer(name: string, raw: RawMcpServerConfig): McpConfiguredServer {
  return {
    name,
    transport: readTransport(raw),
    transportDetail: readTransportDetail(raw),
    authKind: readAuthKind(raw),
    enabled: readEnabled(raw),
    toolCount: readToolCount(raw),
  }
}

/**
 * Project the whole `mcp_servers` block (name → entry) onto sorted DTOs. A
 * non-object block (absent / malformed) yields an empty list (honest: no servers
 * configured).
 */
export function projectServers(block: unknown): McpConfiguredServer[] {
  if (!block || typeof block !== 'object') return []
  return Object.entries(block as Record<string, unknown>)
    .filter(([, v]) => v && typeof v === 'object')
    .map(([name, v]) => projectServer(name, v as RawMcpServerConfig))
    .sort((a, b) => a.name.localeCompare(b.name))
}
