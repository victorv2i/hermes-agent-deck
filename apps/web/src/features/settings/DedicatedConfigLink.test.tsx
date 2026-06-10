import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Mic } from 'lucide-react'
import { DedicatedConfigLink } from './DedicatedConfigLink'

function renderLink(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('DedicatedConfigLink', () => {
  it('renders a read-only card that links to the dedicated surface', () => {
    renderLink(
      <DedicatedConfigLink
        icon={Mic}
        title="Voice"
        description="Text-to-speech, speech-to-text, and the gateway auto-speak toggle."
        to="/voice"
        linkLabel="Configured on the Voice page"
      />,
    )
    expect(screen.getByText('Voice')).toBeInTheDocument()
    // The honest "this lives elsewhere" affordance.
    const link = screen.getByRole('link', { name: /configured on the voice page/i })
    expect(link).toHaveAttribute('href', '/voice')
    // It is read-only here (no editor) — carries the quiet Read-only marker.
    expect(screen.getByText(/^read-only$/i)).toBeInTheDocument()
  })

  it('shows the plain-language description of what the surface owns', () => {
    renderLink(
      <DedicatedConfigLink
        icon={Mic}
        title="Messaging"
        description="Telegram, Discord, and Slack bot tokens and pairing."
        to="/messaging"
        linkLabel="Configured on the Messaging page"
      />,
    )
    expect(
      screen.getByText(/telegram, discord, and slack bot tokens and pairing/i),
    ).toBeInTheDocument()
  })
})
