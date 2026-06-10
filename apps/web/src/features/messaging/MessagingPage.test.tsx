import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { MessagingState } from '@agent-deck/protocol'
import { MessagingPage, type MessagingPageProps } from './MessagingPage'

/**
 * MessagingPage composes the registry-driven COMPACT grid: N platforms → N tiles,
 * plus the single DM-authorization panel. These tests pin the data-driven render
 * (no hardcoded platform list) and the gateway-down honesty propagation.
 */

function platform(id: string, label: string): MessagingState['platforms'][number] {
  return {
    platform: { id, label, setupUrl: `https://example.com/${id}`, steps: [`Set up ${label}`] },
    connection: 'not_configured',
    errorMessage: null,
    tokens: [
      {
        envVar: `${id.toUpperCase()}_BOT_TOKEN`,
        label: 'Bot token',
        isSet: false,
        redactedValue: null,
      },
    ],
  }
}

const STATE: MessagingState = {
  gatewayRunning: true,
  platforms: [
    platform('telegram', 'Telegram'),
    platform('discord', 'Discord'),
    platform('slack', 'Slack'),
  ],
}

function setup(overrides: Partial<MessagingPageProps> = {}) {
  const props: MessagingPageProps = {
    state: STATE,
    onSetToken: vi.fn(),
    onRestart: vi.fn(),
    restarting: false,
    ...overrides,
  }
  // MemoryRouter: DmAuthPanel links to the Connections > Pairing tab.
  render(
    <MemoryRouter>
      <MessagingPage {...props} />
    </MemoryRouter>,
  )
  return props
}

describe('MessagingPage — registry-driven compact grid', () => {
  it('renders one tile per platform in the registry (N tiles for N platforms)', () => {
    setup()
    expect(screen.getByRole('region', { name: /telegram/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /discord/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /slack/i })).toBeInTheDocument()
  })

  it('keeps every tile COLLAPSED by default so the page fits ~one screen', () => {
    setup()
    // No setup steps / token fields shown until a tile is expanded.
    expect(screen.queryByLabelText(/bot token/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /telegram/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('renders the DM-authorization panel below the tiles', () => {
    setup()
    expect(screen.getByRole('region', { name: /direct message|dm/i })).toBeInTheDocument()
  })

  it('expanding ONE tile (Telegram) does NOT expand any other tile (Discord, Slack)', () => {
    // Regression guard for the reported "open Telegram also opens Discord" bug.
    // Each tile owns its OWN disclosure state (independent useState, keyed by the
    // unique platform id), so opening one must leave the others collapsed. If two
    // platforms ever shared an id (a registry key collision), React would reconcile
    // them as one element and share state — this catches that too.
    setup()
    const telegram = screen.getByRole('button', { name: /telegram/i })
    const discord = screen.getByRole('button', { name: /discord/i })
    const slack = screen.getByRole('button', { name: /slack/i })

    expect(telegram).toHaveAttribute('aria-expanded', 'false')
    expect(discord).toHaveAttribute('aria-expanded', 'false')
    expect(slack).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(telegram)

    // Telegram opened…
    expect(telegram).toHaveAttribute('aria-expanded', 'true')
    // …and ONLY Telegram. Discord + Slack stay collapsed.
    expect(discord).toHaveAttribute('aria-expanded', 'false')
    expect(slack).toHaveAttribute('aria-expanded', 'false')

    // Telegram's token field is revealed; the others' are not — assert via each
    // tile's own region so a shared-state regression (two open panels) is caught.
    const telegramRegion = screen.getByRole('region', { name: /telegram/i })
    const discordRegion = screen.getByRole('region', { name: /discord/i })
    expect(within(telegramRegion).getByLabelText(/bot token/i)).toBeInTheDocument()
    expect(within(discordRegion).queryByLabelText(/bot token/i)).not.toBeInTheDocument()
  })

  it('propagates gateway-down honesty to every tile', () => {
    setup({ state: { ...STATE, gatewayRunning: false } })
    expect(screen.getByText(/your agent is stopped/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /restart your agent/i })).toBeInTheDocument()
    const tiles = ['telegram', 'discord', 'slack']
    expect(screen.getAllByTestId('messaging-status').length).toBe(3)
    for (const id of tiles) {
      const region = screen.getByRole('region', { name: new RegExp(id, 'i') })
      expect(within(region).getByText(/start your agent/i)).toBeInTheDocument()
      // No fake green: gateway-down is an idle dot, never success.
      expect(within(region).getByTestId('messaging-status').getAttribute('data-tone')).not.toBe(
        'ok',
      )
    }
  })
})
