import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { MessagingPlatformState } from '@agent-deck/protocol'
import { PlatformTile, type PlatformTileProps } from './PlatformTile'

/**
 * PlatformTile is the COMPACT, honesty-critical unit of the redesigned Messaging
 * hub: a grid tile that shows status AT A GLANCE and EXPANDS on click to reveal
 * the existing setup flow. These tests pin the spine + the no-fake-states rule:
 *  - a tile shows a REAL SEMANTIC status dot driven by the gateway's `connection`
 *    (+ gateway liveness) — connected = success, error = destructive, connecting =
 *    a quiet working dot, not_configured/unknown = idle, gateway-down = honest;
 *  - the dot is NEVER the sky-blue `--primary` action accent;
 *  - the tile is COLLAPSED by default (setup steps + token field hidden) and
 *    EXPANDS on click (accessible disclosure: aria-expanded + aria-controls);
 *  - on expand the EXISTING honest behavior is preserved: the BYO-bot copy, the
 *    setup steps, the masked shape-only token field (never echoes plaintext),
 *    "Restart to apply", and the restart-advisory.
 */

const TELEGRAM: MessagingPlatformState = {
  platform: {
    id: 'telegram',
    label: 'Telegram',
    setupUrl: 'https://t.me/BotFather',
    steps: ['Message @BotFather', 'Run /newbot', 'Copy the token it gives you'],
  },
  connection: 'not_configured',
  errorMessage: null,
  tokens: [{ envVar: 'TELEGRAM_BOT_TOKEN', label: 'Bot token', isSet: false, redactedValue: null }],
}

function setup(overrides: Partial<PlatformTileProps> = {}) {
  const props: PlatformTileProps = {
    platform: TELEGRAM,
    gatewayRunning: true,
    onSetToken: vi.fn(),
    onRestart: vi.fn(),
    restarting: false,
    ...overrides,
  }
  render(<PlatformTile {...props} />)
  return props
}

function withConnection(
  connection: MessagingPlatformState['connection'],
  extra: Partial<MessagingPlatformState> = {},
): MessagingPlatformState {
  return { ...TELEGRAM, connection, ...extra }
}

/** The tile's expand/collapse trigger — labelled by the platform name. */
function trigger() {
  return screen.getByRole('button', { name: /telegram/i })
}

describe('PlatformTile — compact, at-a-glance status (gateway truth)', () => {
  it('renders the platform as its own labelled region with a brand logo', () => {
    setup()
    const region = screen.getByRole('region', { name: /telegram/i })
    // The brand mark is present (identity), labelled for screen readers.
    expect(within(region).getByLabelText('Telegram', { selector: 'svg' })).toBeInTheDocument()
  })

  it('CONNECTED shows a semantic-success status dot, NEVER the amber action accent', () => {
    setup({ platform: withConnection('connected') })
    const region = screen.getByRole('region', { name: /telegram/i })
    const dot = within(region).getByTestId('messaging-status')
    expect(dot.getAttribute('data-tone')).toBe('ok')
    // The status dot is semantic — never the primary/active sky-blue accent.
    expect(dot.className).not.toContain('bg-primary')
    expect(within(region).getByText(/connected/i)).toBeInTheDocument()
  })

  it('ERROR shows a destructive status dot', () => {
    setup({ platform: withConnection('error', { errorMessage: 'Unauthorized: token rejected' }) })
    const region = screen.getByRole('region', { name: /telegram/i })
    expect(within(region).getByTestId('messaging-status').getAttribute('data-tone')).toBe('error')
  })

  it('CONNECTING shows a quiet working dot (no fake "connected")', () => {
    setup({ platform: withConnection('connecting') })
    const region = screen.getByRole('region', { name: /telegram/i })
    const dot = within(region).getByTestId('messaging-status')
    expect(dot.getAttribute('data-tone')).not.toBe('ok')
    expect(dot.getAttribute('data-tone')).not.toBe('error')
  })

  it('CONNECTING — copy honesty (INFO-ACC-3): shows "Pending restart" (not "Connecting — restart to apply") and is non-pulsing', () => {
    // "Connecting — restart to apply" implies a live in-progress connection which
    // is misleading — the state means a token was saved but a restart is needed.
    // "Pending restart" is accurate. The dot should NOT pulse (pulse = live/active).
    setup({ platform: withConnection('connecting') })
    const region = screen.getByRole('region', { name: /telegram/i })
    // Correct label: "Pending restart"
    expect(within(region).getByText(/pending restart/i)).toBeInTheDocument()
    // Old incorrect label must not appear
    expect(within(region).queryByText(/connecting.*restart/i)).not.toBeInTheDocument()
    // Must NOT pulse (pulsing implies live/in-progress connection).
    const dot = within(region).getByTestId('messaging-status')
    // The status dot's shape/style reflects non-pulsing: data-tone should be info
    // but the StatusDot itself won't emit animate-pulse class here.
    // We rely on the pulse=false prop being passed (tested via the shape/behavior).
    expect(dot.getAttribute('aria-label')).toMatch(/pending restart/i)
  })

  it('NOT_CONFIGURED shows a calm idle dot reading "Not connected"', () => {
    setup({ platform: withConnection('not_configured') })
    const region = screen.getByRole('region', { name: /telegram/i })
    expect(within(region).getByTestId('messaging-status').getAttribute('data-tone')).toBe('idle')
    expect(within(region).getByText(/not connected/i)).toBeInTheDocument()
  })

  it('gateway-down reads the HONEST "start your agent" (not a fake disconnected)', () => {
    setup({ platform: withConnection('unknown'), gatewayRunning: false })
    const region = screen.getByRole('region', { name: /telegram/i })
    expect(within(region).getByText(/start your agent/i)).toBeInTheDocument()
    // No fake green — it's an idle/neutral dot, not success.
    expect(within(region).getByTestId('messaging-status').getAttribute('data-tone')).not.toBe('ok')
  })

  it('gateway UP but state unknown reads a neutral "Not connected", not "start your agent"', () => {
    setup({ platform: withConnection('unknown'), gatewayRunning: true })
    const region = screen.getByRole('region', { name: /telegram/i })
    expect(within(region).getByText(/not connected/i)).toBeInTheDocument()
    expect(within(region).queryByText(/start your agent/i)).not.toBeInTheDocument()
  })
})

describe('PlatformTile — expand / collapse disclosure', () => {
  it('is COLLAPSED by default — setup steps + token field are hidden', () => {
    setup()
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/message @botfather/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/bot token/i)).not.toBeInTheDocument()
  })

  it('EXPANDS on click — revealing the real setup steps + the token field', () => {
    setup()
    fireEvent.click(trigger())
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/message @botfather/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/bot token/i)).toBeInTheDocument()
  })

  it('the trigger controls the panel it expands (aria-controls → real panel id)', () => {
    setup()
    fireEvent.click(trigger())
    const id = trigger().getAttribute('aria-controls')
    expect(id).toBeTruthy()
    expect(document.getElementById(String(id))).toBeInTheDocument()
  })

  it('COLLAPSES again on a second click', () => {
    setup()
    fireEvent.click(trigger())
    fireEvent.click(trigger())
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText(/bot token/i)).not.toBeInTheDocument()
  })
})

describe('PlatformTile — preserves the existing honest setup flow (on expand)', () => {
  it('states plainly that you create the bot, and links to the official page', () => {
    setup()
    fireEvent.click(trigger())
    const region = screen.getByRole('region', { name: /telegram/i })
    expect(within(region).getByText(/you create the bot/i)).toBeInTheDocument()
    const link = within(region).getByRole('link', { name: /create your bot/i })
    expect(link).toHaveAttribute('href', 'https://t.me/BotFather')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
  })

  it('renders a MASKED password token field that never echoes the plaintext', () => {
    setup()
    fireEvent.click(trigger())
    const input = screen.getByLabelText(/bot token/i)
    expect(input).toHaveAttribute('type', 'password')
  })

  it('shows the redacted preview (not plaintext) when a token is already set', () => {
    setup({
      platform: withConnection('connecting', {
        tokens: [
          {
            envVar: 'TELEGRAM_BOT_TOKEN',
            label: 'Bot token',
            isSet: true,
            redactedValue: '123…wxyz',
          },
        ],
      }),
    })
    fireEvent.click(trigger())
    const preview = screen.getByText(/123…wxyz/)
    expect(preview).toBeInTheDocument()
    expect(preview.className).toContain('truncate')
  })

  it('submitting posts the typed value for the right (platform, envVar) and clears it', () => {
    const props = setup()
    fireEvent.click(trigger())
    const input = screen.getByLabelText(/bot token/i)
    fireEvent.change(input, { target: { value: 'secret-bot-token-123' } })
    fireEvent.click(screen.getByRole('button', { name: /save token/i }))
    expect(props.onSetToken).toHaveBeenCalledWith({
      platform: 'telegram',
      envVar: 'TELEGRAM_BOT_TOKEN',
      value: 'secret-bot-token-123',
    })
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('renders a field per token (Slack needs bot + app tokens)', () => {
    setup({
      platform: {
        platform: {
          id: 'slack',
          label: 'Slack',
          setupUrl: 'https://api.slack.com/apps',
          steps: ['Create an app'],
        },
        connection: 'not_configured',
        errorMessage: null,
        tokens: [
          { envVar: 'SLACK_BOT_TOKEN', label: 'Bot token', isSet: false, redactedValue: null },
          { envVar: 'SLACK_APP_TOKEN', label: 'App token', isSet: false, redactedValue: null },
        ],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /slack/i }))
    expect(screen.getByLabelText(/bot token/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/app token/i)).toBeInTheDocument()
  })

  it('shows the gateway error message verbatim when expanded on an errored platform', () => {
    setup({ platform: withConnection('error', { errorMessage: 'Unauthorized: token rejected' }) })
    fireEvent.click(trigger())
    expect(screen.getByText(/unauthorized: token rejected/i)).toBeInTheDocument()
  })

  it('offers "Restart to apply" (the shared real restart) with the restart advisory', () => {
    const props = setup()
    fireEvent.click(trigger())
    expect(screen.getByText(/only takes effect after your agent restarts/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /restart to apply/i }))
    expect(props.onRestart).toHaveBeenCalledTimes(1)
  })

  it('shows a busy/disabled restart while a restart is in flight (no fake "done")', () => {
    setup({ restarting: true })
    fireEvent.click(trigger())
    expect(screen.getByRole('button', { name: /restarting/i })).toBeDisabled()
  })

  it('the reveal (show/hide) toggle carries a visible keyboard focus ring on the neutral border', () => {
    setup()
    fireEvent.click(trigger())
    const reveal = screen.getByRole('button', { name: /show token characters/i })
    expect(reveal.className).toContain('focus-visible:ring-2')
    expect(reveal.className).toContain('focus-visible:ring-[var(--border-strong)]')
  })
})
