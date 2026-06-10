import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { ConnectionsRoute } from './ConnectionsRoute'
import { CONNECTIONS_TAB_IDS, DEFAULT_CONNECTIONS_TAB } from './connectionsTabs'

// Stub every tab surface so the shell test is isolated from data/socket deps.
vi.mock('@/features/voice', () => ({
  VoiceRoute: () => <div data-testid="panel">Voice surface</div>,
}))
vi.mock('@/features/messaging', () => ({
  MessagingRoute: () => <div data-testid="panel">Messaging surface</div>,
}))
vi.mock('@/features/mcp', () => ({
  McpRoute: () => <div data-testid="panel">MCP surface</div>,
}))
vi.mock('./PairingTab', () => ({
  PairingTab: () => <div data-testid="panel">Pairing surface</div>,
}))
vi.mock('./WebhooksTab', () => ({
  WebhooksTab: () => <div data-testid="panel">Webhooks surface</div>,
}))
vi.mock('./CredentialsTab', () => ({
  CredentialsTab: () => <div data-testid="panel">Credentials surface</div>,
}))

/** Surface the current `?tab=` so we can assert the URL the shell drives. */
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="search">{loc.search}</div>
}

function renderAt(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/connections" element={<ConnectionsRoute />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('ConnectionsRoute', () => {
  it('exposes a tablist with six tabs (Voice · Messaging · MCP · Pairing · Webhooks · Credentials)', () => {
    renderAt('/connections')
    const tablist = screen.getByRole('tablist', { name: /connections/i })
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Voice',
      'Messaging',
      'MCP',
      'Pairing',
      'Webhooks',
      'Credentials',
    ])
    expect([...CONNECTIONS_TAB_IDS]).toEqual([
      'voice',
      'messaging',
      'mcp',
      'pairing',
      'webhooks',
      'credentials',
    ])
  })

  it('keeps the mobile tab strip roomy enough for touch', () => {
    renderAt('/connections')
    const tablist = screen.getByRole('tablist', { name: /connections/i })
    // Each cluster lays its three tabs out as a full-width row on mobile.
    expect(tablist.querySelectorAll('.grid-cols-3')).toHaveLength(2)
    for (const tab of within(tablist).getAllByRole('tab')) {
      expect(tab.className).toContain('min-h-11')
      expect(tab.querySelector('svg')?.className.baseVal).toContain('max-[359px]:hidden')
    }
  })

  it('groups the tabs into two labeled clusters: Channels first, then Advanced', () => {
    renderAt('/connections')
    const tablist = screen.getByRole('tablist', { name: /connections/i })
    // The cluster labels render inside the strip, decorative for screen readers
    // (the tablist itself stays one flat list of six tabs).
    const channels = within(tablist).getByText('Channels')
    const advanced = within(tablist).getByText('Advanced')
    expect(channels).toHaveAttribute('aria-hidden')
    expect(advanced).toHaveAttribute('aria-hidden')
    // Channels (Voice · Messaging · MCP) precede the Advanced label; the admin
    // tabs (Pairing · Webhooks · Credentials) follow it. Document order proves
    // the visual clustering without depending on layout.
    const voice = screen.getByRole('tab', { name: /voice/i })
    const mcp = screen.getByRole('tab', { name: /^mcp$/i })
    const pairing = screen.getByRole('tab', { name: /pairing/i })
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(channels, voice)).toBe(true)
    expect(follows(mcp, advanced)).toBe(true)
    expect(follows(advanced, pairing)).toBe(true)
  })

  it('defaults to the first tab (Voice) when no ?tab= is given', async () => {
    renderAt('/connections')
    expect(screen.getByRole('tab', { name: /voice/i })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getByTestId('panel')).toHaveTextContent('Voice surface'))
    expect(DEFAULT_CONNECTIONS_TAB).toBe('voice')
  })

  it('honors a deep-linked ?tab=messaging (so /messaging redirects land here)', async () => {
    renderAt('/connections?tab=messaging')
    expect(screen.getByRole('tab', { name: /messaging/i })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getByTestId('panel')).toHaveTextContent('Messaging surface'))
  })

  it('honors a deep-linked ?tab=mcp', async () => {
    renderAt('/connections?tab=mcp')
    expect(screen.getByRole('tab', { name: /^mcp$/i })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getByTestId('panel')).toHaveTextContent('MCP surface'))
  })

  it('falls back to the default tab on an unknown ?tab= value', async () => {
    renderAt('/connections?tab=bogus')
    expect(screen.getByRole('tab', { name: /voice/i })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getByTestId('panel')).toHaveTextContent('Voice surface'))
  })

  it('clicking a tab swaps the panel AND writes ?tab= to the URL', async () => {
    const user = userEvent.setup()
    renderAt('/connections')
    await user.click(screen.getByRole('tab', { name: /^mcp$/i }))
    await waitFor(() => expect(screen.getByTestId('panel')).toHaveTextContent('MCP surface'))
    expect(screen.getByTestId('search')).toHaveTextContent('tab=mcp')
  })

  it('uses roving tabindex (only the selected tab is in the tab order)', () => {
    renderAt('/connections?tab=messaging')
    expect(screen.getByRole('tab', { name: /messaging/i })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: /voice/i })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tab', { name: /^mcp$/i })).toHaveAttribute('tabindex', '-1')
  })

  it('arrow keys move + activate the next/previous tab (ARIA roving)', async () => {
    const user = userEvent.setup()
    renderAt('/connections')
    screen.getByRole('tab', { name: /voice/i }).focus()
    await user.keyboard('{ArrowRight}')
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /messaging/i })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
    await user.keyboard('{ArrowLeft}')
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /voice/i })).toHaveAttribute('aria-selected', 'true'),
    )
  })

  it('wires the tabpanel to the active tab (aria-controls / aria-labelledby)', () => {
    renderAt('/connections?tab=mcp')
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveAttribute('aria-labelledby', 'connections-tab-mcp')
    const tab = screen.getByRole('tab', { name: /^mcp$/i })
    expect(tab).toHaveAttribute('aria-controls', 'connections-tabpanel')
  })

  it('honors a deep-linked ?tab=pairing', async () => {
    renderAt('/connections?tab=pairing')
    expect(screen.getByRole('tab', { name: /pairing/i })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getByTestId('panel')).toHaveTextContent('Pairing surface'))
  })

  it('honors a deep-linked ?tab=webhooks', async () => {
    renderAt('/connections?tab=webhooks')
    expect(screen.getByRole('tab', { name: /webhooks/i })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getByTestId('panel')).toHaveTextContent('Webhooks surface'))
  })

  it('honors a deep-linked ?tab=credentials', async () => {
    renderAt('/connections?tab=credentials')
    expect(screen.getByRole('tab', { name: /credentials/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await waitFor(() =>
      expect(screen.getByTestId('panel')).toHaveTextContent('Credentials surface'),
    )
  })
})
