/**
 * MCP PROBE PARSER — turns the REAL `hermes mcp test <name>` STDOUT into a
 * {@link McpTestResult}. The probe is a one-shot connect → list-tools →
 * disconnect (`_probe_single_server`); it does NOT persist a connection, so its
 * result is "here are the tools this server offers", never a standing
 * "connected" dot.
 *
 * HONESTY:
 *  - Verified against live hermes output (`hermes mcp test context7`):
 *      `  ✓ Connected (1033ms)` / `  ✓ Tools discovered: 2` / `    name   desc`
 *      and the failure path `  ✗ Connection failed (Nms): <reason>`.
 *  - WHITELIST the recognized lines; an unrecognized body fails closed to
 *    `ok:false` with a generic reason (never a fabricated success).
 *  - OAuth servers: a clean probe is NOT proof of auth (servers often serve
 *    tools/list unauthenticated). The caller passes `authKind`; for `oauth` we
 *    attach an `authCaveat` even on success so the UI never shows a green check.
 *  - The reason string is the server's own short error; the route layer scrubs
 *    any secret-shaped substring before it crosses the wire.
 */
import type { McpAuthKind, McpDiscoveredTool, McpTestResult } from '@agent-deck/protocol'

// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g

/** OAuth caveat copy — an honest reminder that a clean probe is not auth proof. */
export function oauthCaveat(name: string): string {
  return `This server uses OAuth: a successful probe does not prove you're authenticated. If tool calls fail, authenticate via \`hermes mcp login ${name}\`.`
}

/**
 * Parse `hermes mcp test <name>` STDOUT into the wire result.
 *  - A `✓ Connected` line marks success; tool lines (indented `name  desc`)
 *    below the `Tools discovered:` header become the discovered tools.
 *  - A `✗ Connection failed` / `✗`-prefixed error → ok:false with the reason.
 */
export function parseProbeOutput(
  name: string,
  authKind: McpAuthKind,
  stdout: string,
): McpTestResult {
  const lines = stdout
    .replace(ANSI, '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))

  const failed = lines.find((l) => /✗\s+Connection failed/i.test(l))
  const connected = lines.some((l) => /✓\s+Connected/i.test(l))
  const authAttach = authKind === 'oauth' ? oauthCaveat(name) : null

  if (failed && !connected) {
    // Extract the reason after the `):` if present; else a generic message.
    const m = /Connection failed[^:]*:\s*(.+)$/i.exec(failed)
    const reason = m && m[1] ? m[1].trim() : 'The server could not be reached.'
    return { name, ok: false, tools: [], error: reason, authCaveat: authAttach }
  }

  if (!connected) {
    return {
      name,
      ok: false,
      tools: [],
      error: 'The probe did not report a successful connection.',
      authCaveat: authAttach,
    }
  }

  // Find the `Tools discovered:` header; tool lines follow it, each an indented
  // `name   description` pair. Lines that are headers / status markers are skipped.
  const tools: McpDiscoveredTool[] = []
  let inTools = false
  for (const line of lines) {
    if (/Tools discovered:/i.test(line)) {
      inTools = true
      continue
    }
    if (!inTools) continue
    const trimmed = line.trim()
    if (trimmed === '') continue
    // A tool line: a leading token, then 2+ spaces, then a description (the CLI
    // pads the name column). Description may be empty.
    const m = /^(\S+)(?:\s{2,}(.*))?$/.exec(trimmed)
    if (m && m[1]) {
      tools.push({ name: m[1], description: (m[2] ?? '').trim() })
    }
  }

  return { name, ok: true, tools, error: null, authCaveat: authAttach }
}
