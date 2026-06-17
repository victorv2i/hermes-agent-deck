import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { McpConfiguredServer, McpTestResult } from '@agent-deck/protocol'
import { McpServerCard, type McpServerCardProps } from './McpServerCard'

/**
 * McpServerCard is the HONESTY-critical unit of the MCP surface. These tests pin
 * the no-fake-states rules:
 *  - the ENABLED badge is the CONFIG flag (semantic), never a fake "connected"
 *    dot — and it is NOT the sky-blue action accent;
 *  - OAuth servers carry the "hermes mcp login" caveat (a clean probe ≠ auth);
 *  - toggle/remove/test are offered and emit through callbacks;
 *  - a Test result lists discovered tools (a one-shot probe, not a live link).
 */

const HTTP_OAUTH: McpConfiguredServer = {
  name: 'context7',
  transport: 'http',
  transportDetail: 'https://mcp.context7.com/mcp',
  authKind: 'oauth',
  enabled: true,
  toolCount: null,
}

function setup(overrides: Partial<McpServerCardProps> = {}) {
  const props: McpServerCardProps = {
    server: HTTP_OAUTH,
    onToggle: vi.fn(),
    onRemove: vi.fn(),
    onTest: vi.fn(),
    testing: false,
    mutating: false,
    ...overrides,
  }
  render(<McpServerCard {...props} />)
  return props
}

describe('McpServerCard — enabled is the config flag, NOT a connection', () => {
  it('renders the server as its own labelled region with the transport detail', () => {
    setup()
    const region = screen.getByRole('region', { name: /context7/i })
    expect(within(region).getByText('https://mcp.context7.com/mcp')).toBeInTheDocument()
  })

  it('ENABLED reads as a semantic-success badge, never the amber action accent', () => {
    setup()
    const badge = screen.getByTestId('mcp-enabled')
    expect(badge).toHaveTextContent(/enabled/i)
    // Governance: the enabled flag is a success chip, NOT the sky-blue `active`/`default`.
    expect(badge.getAttribute('data-variant')).toBe('success')
    expect(badge.getAttribute('data-variant')).not.toBe('active')
    expect(badge.getAttribute('data-variant')).not.toBe('default')
    // It must never read "connected".
    expect(badge).not.toHaveTextContent(/connected/i)
  })

  it('a DISABLED server reads as a quiet neutral chip', () => {
    setup({ server: { ...HTTP_OAUTH, enabled: false } })
    const badge = screen.getByTestId('mcp-enabled')
    expect(badge).toHaveTextContent(/disabled/i)
    expect(badge.getAttribute('data-variant')).toBe('muted')
  })

  it('an OAuth server shows the `hermes mcp login` caveat (probe ≠ auth proof)', () => {
    setup()
    expect(screen.getByText(/hermes mcp login context7/i)).toBeInTheDocument()
  })

  it('a non-OAuth server shows NO auth caveat', () => {
    setup({ server: { ...HTTP_OAUTH, authKind: 'none' } })
    expect(screen.queryByText(/hermes mcp login/i)).not.toBeInTheDocument()
  })

  it('states that changes take effect after your agent restarts', () => {
    setup()
    expect(screen.getByText(/changes take effect after your agent restarts/i)).toBeInTheDocument()
  })
})

describe('McpServerCard — actions emit through callbacks', () => {
  it('Disable flips to !enabled', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: /^disable$/i }))
    expect(props.onToggle).toHaveBeenCalledWith(false)
  })

  it('Enable flips a disabled server to enabled', () => {
    const props = setup({ server: { ...HTTP_OAUTH, enabled: false } })
    fireEvent.click(screen.getByRole('button', { name: /^enable$/i }))
    expect(props.onToggle).toHaveBeenCalledWith(true)
  })

  it('Remove + Test fire their callbacks', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: /remove context7/i }))
    expect(props.onRemove).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /test tools/i }))
    expect(props.onTest).toHaveBeenCalled()
  })
})

describe('McpServerCard — probe result lists tools (one-shot, not a live link)', () => {
  const OK_RESULT: McpTestResult = {
    name: 'context7',
    ok: true,
    tools: [{ name: 'resolve-library-id', description: 'Resolves a name' }],
    error: null,
    authCaveat: 'OAuth — a clean probe is not auth proof.',
  }

  it('renders discovered tools + the OAuth caveat on success', () => {
    setup({ testResult: OK_RESULT })
    expect(screen.getByText(/1 tool discovered/i)).toBeInTheDocument()
    expect(screen.getByText('resolve-library-id')).toBeInTheDocument()
    expect(screen.getByText(/not auth proof/i)).toBeInTheDocument()
  })

  it('renders the failure reason on a failed probe (no fabricated success)', () => {
    setup({
      testResult: {
        name: 'context7',
        ok: false,
        tools: [],
        error: 'All attempts failed',
        authCaveat: null,
      },
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/all attempts failed/i)
  })
})
