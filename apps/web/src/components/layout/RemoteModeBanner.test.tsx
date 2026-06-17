import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RemoteModeBanner } from './RemoteModeBanner'

describe('RemoteModeBanner', () => {
  it('states the honest remote-mode warning as an alert', () => {
    render(<RemoteModeBanner />)
    const banner = screen.getByTestId('remote-mode-banner')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner).toHaveTextContent(/remote mode/i)
    expect(banner).toHaveTextContent(/token is not a network boundary/i)
  })

  it('uses the destructive semantic color, not the amber accent', () => {
    render(<RemoteModeBanner />)
    const banner = screen.getByTestId('remote-mode-banner')
    // The caution reads via the destructive semantic; the sky-blue (primary) accent is never
    // used for a security warning.
    expect(banner.className).toMatch(/text-destructive/)
    expect(banner.className).not.toMatch(/primary|amber/)
  })
})
