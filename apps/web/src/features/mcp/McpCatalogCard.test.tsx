import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { McpCatalogEntry } from '@agent-deck/protocol'
import { McpCatalogCard } from './McpCatalogCard'

/**
 * McpCatalogCard pins the honest catalog rule: OAuth + git-bootstrap installs are
 * NOT faked in-browser — the card surfaces the exact `hermes mcp install <name>`
 * command to run. An already-installed entry reads as installed (no fake add).
 */

const LINEAR: McpCatalogEntry = {
  name: 'linear',
  description: 'Find, create, and update Linear issues.',
  transport: 'http',
  authKind: 'oauth',
  sourceUrl: 'https://linear.app/docs/mcp',
  requiresInstall: false,
  installed: false,
}

describe('McpCatalogCard — surfaces the CLI command, never a fake install', () => {
  it('shows the `hermes mcp install <name>` command for an uninstalled entry', () => {
    render(<McpCatalogCard entry={LINEAR} />)
    expect(screen.getByText('hermes mcp install linear')).toBeInTheDocument()
    // There is no fake "Install" action button.
    expect(screen.queryByRole('button', { name: /^install$/i })).not.toBeInTheDocument()
  })

  it('flags an OAuth entry without a green "connected"/auth check', () => {
    render(<McpCatalogCard entry={LINEAR} />)
    expect(screen.getByText(/sign-in and setup happen there/i)).toBeInTheDocument()
    expect(screen.queryByText(/connected/i)).not.toBeInTheDocument()
  })

  it('flags a git-bootstrap entry as requiring a CLI install', () => {
    render(
      <McpCatalogCard
        entry={{
          ...LINEAR,
          name: 'n8n',
          requiresInstall: true,
          transport: 'stdio',
          authKind: 'api_key',
        }}
      />,
    )
    // The "git install" badge marks the CLI-only bootstrap.
    expect(screen.getByText(/^git install$/i)).toBeInTheDocument()
    expect(screen.getByText('hermes mcp install n8n')).toBeInTheDocument()
  })

  it('an already-installed entry reads as installed (no duplicate add)', () => {
    render(<McpCatalogCard entry={{ ...LINEAR, installed: true }} />)
    expect(screen.getByText(/installed/i)).toBeInTheDocument()
    expect(screen.queryByText(/hermes mcp install/i)).not.toBeInTheDocument()
  })

  it('links to the source when present', () => {
    render(<McpCatalogCard entry={LINEAR} />)
    expect(screen.getByRole('link', { name: /learn more/i })).toHaveAttribute(
      'href',
      'https://linear.app/docs/mcp',
    )
  })
})
