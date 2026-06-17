import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DmAuthPanel } from './DmAuthPanel'

function renderPanel() {
  return render(
    <MemoryRouter>
      <DmAuthPanel />
    </MemoryRouter>,
  )
}

describe('DmAuthPanel — owner-gated inbound DM authorization (points at the in-app Pairing tab)', () => {
  it('explains inbound pairing is owner-gated (no fake auto-approve button)', () => {
    renderPanel()
    const region = screen.getByRole('region', { name: /direct message|dm/i })
    expect(region).toBeInTheDocument()
    // No fake "Approve" action here — approval happens on the Pairing tab.
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument()
    expect(within(region).getByText(/only you, the owner, can approve/i)).toBeInTheDocument()
  })

  it('links to the Studio Connections > Pairing tab where approval actually happens', () => {
    renderPanel()
    const region = screen.getByRole('region', { name: /direct message|dm/i })
    const link = within(region).getByRole('link', { name: /pairing tab/i })
    // Connections folded into the Studio as a global view, so the link targets
    // the Studio's Connections view on the Pairing sub-tab.
    expect(link).toHaveAttribute('href', '/?view=connections&tab=pairing')
  })

  it('no longer claims approval is terminal-only or prints CLI commands', () => {
    renderPanel()
    expect(screen.queryByText(/hermes pairing/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/terminal/i)).not.toBeInTheDocument()
  })
})
