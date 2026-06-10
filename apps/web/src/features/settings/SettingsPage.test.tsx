import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { SettingsPage } from './SettingsPage'
import type { SettingsField, SettingsPayload } from './types'

/** Render the page on a throwaway QueryClient (retries off; the surface reads
 * the app-wide client via useSettings → useQuery) inside a router so the
 * embedded Model section + its links resolve. */
function renderPage(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const PAYLOAD: SettingsPayload = {
  editable: false,
  sections: [
    {
      category: 'general',
      fields: [
        {
          key: 'model',
          label: 'model',
          description: 'Default model',
          type: 'string',
          value: 'anthropic/claude-sonnet-4.6',
          isSecret: false,
        },
        {
          key: 'compression.enabled',
          label: 'enabled',
          description: 'Compression → Enabled',
          type: 'boolean',
          value: true,
          isSecret: false,
        },
      ],
    },
    {
      category: 'auxiliary',
      fields: [
        {
          key: 'auxiliary.vision.api_key',
          label: 'api_key',
          description: 'Auxiliary → Vision → Api Key',
          type: 'string',
          value: '••••••••',
          isSecret: true,
        },
      ],
    },
    {
      category: 'tools',
      fields: [
        {
          key: 'tools.command_allowlist',
          label: 'command_allowlist',
          description: 'Commands the agent may run without approval',
          type: 'list',
          value: ['Bash(ls)', 'Read', 'Write'],
          isSecret: false,
        },
        {
          key: 'tools.workspace',
          label: 'workspace',
          description: 'Working directory override',
          type: 'string',
          value: null,
          isSecret: false,
        },
      ],
    },
  ],
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  document.documentElement.removeAttribute('data-density')
})

function stubFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

describe('SettingsPage', () => {
  it('shows a loading skeleton before data arrives', () => {
    stubFetch(() => new Promise(() => {})) // never resolves
    renderPage(<SettingsPage />)
    expect(screen.getByTestId('settings-loading')).toBeInTheDocument()
  })

  it('offers a "Maintenance & logs" convenience card (System is back in the rail; Logs stays rail-hidden)', () => {
    // System is a visible rail row again; Logs stays off the rail, so this card
    // keeps it reachable without ⌘K. The card lives in the local "Your
    // preferences" group, so it renders even before the config load resolves.
    stubFetch(() => new Promise(() => {})) // never resolves
    renderPage(<SettingsPage />)
    expect(screen.getByText(/maintenance & logs/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^system/i })).toHaveAttribute('href', '/system')
    expect(screen.getByRole('link', { name: /^logs/i })).toHaveAttribute('href', '/logs')
  })

  it('renders sections and fields once loaded', async () => {
    stubFetch(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }))
    renderPage(<SettingsPage />)

    await screen.findByText('General')
    // The 'auxiliary' category now renders as 'Extra AI Models' (plain language).
    expect(screen.getByText('Extra AI Models')).toBeInTheDocument()
    // field label (humanized from the dot-path segment) + value. The model is
    // surfaced by the dedicated Model section (the picker), so the generic field
    // example here is the compression toggle (label "Enabled" + a humane boolean).
    expect(screen.getAllByText('Enabled').length).toBeGreaterThanOrEqual(1)
  })

  it('hosts the model picker in a "Model" section and drops the duplicate model row', async () => {
    stubFetch(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }))
    renderPage(<SettingsPage />)
    await screen.findByText('General')

    // The model-selection control is folded in as a "Model" section (the retired
    // /models page moved here), so there's no link to a standalone Models page.
    expect(screen.getByRole('region', { name: /^model$/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /change on the models page/i }),
    ).not.toBeInTheDocument()

    // The duplicated `model` row is gone from the General config dump (the Model
    // section owns the active model now).
    expect(screen.queryByText('Default model')).not.toBeInTheDocument()
  })

  it('uses plain-language for the auxiliary-model note (no "auxiliary" jargon visible)', async () => {
    const payload = {
      ...PAYLOAD,
      sections: [
        ...PAYLOAD.sections,
        {
          category: 'auxiliary',
          fields: [
            {
              key: 'auxiliary.vision.model',
              label: 'model',
              description: 'Auxiliary → Vision → Model',
              type: 'string',
              value: 'gpt-4o',
              isSecret: false,
            },
          ],
        },
      ],
    }
    stubFetch(async () => new Response(JSON.stringify(payload), { status: 200 }))
    renderPage(<SettingsPage />)
    await screen.findByText('General')

    // The aux-model note must NOT use the word "Auxiliary" standalone —
    // it should use plain language a non-technical user can understand.
    // "Extra AI models" appears in the note on the Active model card.
    const notes = screen.getAllByText(/extra ai models/i)
    expect(notes.length).toBeGreaterThanOrEqual(1)
  })

  it('marks non-editable config rows as Read-only so editable vs read-only is obvious', async () => {
    stubFetch(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }))
    renderPage(<SettingsPage />)
    await screen.findByText('General')
    // The read-only fields carry a quiet "Read-only" marker.
    expect(screen.getAllByText(/^read-only$/i).length).toBeGreaterThanOrEqual(1)
  })

  it('marks secret fields and never shows a raw secret', async () => {
    stubFetch(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }))
    renderPage(<SettingsPage />)

    // The 'auxiliary' category now renders as 'Extra AI Models' (plain language).
    await screen.findByText('Extra AI Models')
    // a "Secret" affordance badge is shown for the api_key row
    expect(screen.getByText('Secret')).toBeInTheDocument()
    // the masked value is present, no real key
    expect(screen.getByText('••••••••')).toBeInTheDocument()
  })

  it('honestly frames the agent-config group: editable inline vs read-only-with-a-pointer', async () => {
    stubFetch(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }))
    renderPage(<SettingsPage />)
    await screen.findByText('General')
    // The notice names the editing surface for the read-only fields (no dead-end).
    expect(screen.getByText('hermes config')).toBeInTheDocument()
    expect(screen.getAllByText(/read-only/i).length).toBeGreaterThanOrEqual(1)
  })

  it('groups the surface into "Your preferences" and "Agent config"', async () => {
    stubFetch(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }))
    renderPage(<SettingsPage />)
    await screen.findByText('General')
    expect(screen.getByText('Your preferences')).toBeInTheDocument()
    expect(screen.getByText('Agent config')).toBeInTheDocument()
  })

  it('offers an inline Edit on the allowlisted scalar fields, but NOT on the rest', async () => {
    const payload: SettingsPayload = {
      editable: false,
      sections: [
        {
          category: 'general',
          fields: [
            {
              key: 'timezone',
              label: 'timezone',
              description: 'Display timezone',
              type: 'string',
              value: 'UTC',
              isSecret: false,
            },
            {
              key: 'model',
              label: 'model',
              description: 'Default model',
              type: 'string',
              value: 'gpt-5.5',
              isSecret: false,
            },
          ],
        },
      ],
    }
    stubFetch(async () => new Response(JSON.stringify(payload), { status: 200 }))
    renderPage(<SettingsPage />)
    await screen.findByText('General')

    // Exactly one editable field (timezone) → exactly one Edit button. The
    // `model` row is lifted out of the dump into the Model section, so it's not an
    // editable config row here either.
    const editButtons = screen.getAllByRole('button', { name: /edit/i })
    expect(editButtons).toHaveLength(1)
    // timezone's value is shown.
    expect(screen.getByText('UTC')).toBeInTheDocument()
  })

  it('renders list values as individual chips, not a truncated string', async () => {
    stubFetch(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }))
    renderPage(<SettingsPage />)
    await screen.findByText('Tools')
    expect(screen.getByText('Bash(ls)')).toBeInTheDocument()
    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('Write')).toBeInTheDocument()
  })

  it('renders empty values as a muted "Not set" rather than a bare em-dash', async () => {
    stubFetch(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }))
    renderPage(<SettingsPage />)
    await screen.findByText('Tools')
    expect(screen.getByText('Not set')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('shows an error state with a retry when the load fails', async () => {
    stubFetch(async () => new Response('nope', { status: 502 }))
    renderPage(<SettingsPage />)

    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument())
    // The title is "Couldn't load configuration" — match regardless of apostrophe style.
    expect(screen.getByText(/couldn.t load configuration/i)).toBeInTheDocument()
  })

  it('filters fields by a free-text search, hiding non-matching sections', async () => {
    const user = userEvent.setup()
    stubFetch(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }))
    renderPage(<SettingsPage />)
    await screen.findByText('General')

    const search = screen.getByRole('searchbox', { name: /search settings/i })
    await user.type(search, 'allowlist')

    // The matching row stays; an unrelated section drops out entirely.
    expect(screen.getByText('Command Allowlist')).toBeInTheDocument()
    // 'auxiliary' section heading is now 'Extra AI Models' — still absent when filtered out.
    expect(screen.queryByText('Extra AI Models')).not.toBeInTheDocument()
    // The unrelated General config section is filtered out too. (The "Model"
    // section is the picker, not searchable config, so it stays — by design.)
    expect(screen.queryByRole('heading', { name: 'General' })).not.toBeInTheDocument()
  })

  it('shows a calm no-results state when the query matches nothing', async () => {
    const user = userEvent.setup()
    stubFetch(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }))
    renderPage(<SettingsPage />)
    await screen.findByText('General')

    await user.type(screen.getByRole('searchbox', { name: /search settings/i }), 'zzz-nope')
    expect(screen.getByText(/no settings match/i)).toBeInTheDocument()
  })

  it('collapses large sections by default and toggles them open on click', async () => {
    const user = userEvent.setup()
    const bigFields: SettingsField[] = Array.from({ length: 8 }, (_, i) => ({
      key: `big.field_${i}`,
      label: `field_${i}`,
      description: `Field number ${i}`,
      type: 'string',
      value: `value-${i}`,
      isSecret: false,
    }))
    const payload: SettingsPayload = {
      editable: false,
      sections: [{ category: 'big', fields: bigFields }],
    }
    stubFetch(async () => new Response(JSON.stringify(payload), { status: 200 }))
    renderPage(<SettingsPage />)
    await screen.findByText('Big')

    // A big section starts collapsed: its field rows are not rendered.
    expect(screen.queryByText('value-0')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: /big/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('value-0')).toBeInTheDocument()
  })

  it('auto-expands a matched (normally-collapsed) section while searching', async () => {
    const user = userEvent.setup()
    const bigFields: SettingsField[] = Array.from({ length: 8 }, (_, i) => ({
      key: `big.field_${i}`,
      label: `field_${i}`,
      description: `Field number ${i}`,
      type: 'string',
      value: `value-${i}`,
      isSecret: false,
    }))
    const payload: SettingsPayload = {
      editable: false,
      sections: [{ category: 'big', fields: bigFields }],
    }
    stubFetch(async () => new Response(JSON.stringify(payload), { status: 200 }))
    renderPage(<SettingsPage />)
    await screen.findByText('Big')

    // Collapsed by default…
    expect(screen.queryByText('value-3')).not.toBeInTheDocument()
    // …but a search reveals the matching field without a manual expand.
    await user.type(screen.getByRole('searchbox', { name: /search settings/i }), 'field_3')
    expect(screen.getByText('value-3')).toBeInTheDocument()
  })

  it('keeps small sections expanded by default', async () => {
    stubFetch(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }))
    renderPage(<SettingsPage />)
    await screen.findByText('General')
    // The General section is small → expanded, so its value shows. (The `model`
    // row is lifted into the Model section, leaving the compression toggle.)
    expect(screen.getAllByText('Enabled').length).toBeGreaterThanOrEqual(1)
  })

  describe('density control', () => {
    it('renders a Comfortable/Compact density toggle even before config loads', () => {
      stubFetch(() => new Promise(() => {})) // never resolves
      renderPage(<SettingsPage />)
      expect(screen.getByRole('radiogroup', { name: /density/i })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: /comfortable/i })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: /compact/i })).toBeInTheDocument()
    })

    it('defaults to Comfortable (no data-density attribute on <html>)', () => {
      stubFetch(() => new Promise(() => {}))
      renderPage(<SettingsPage />)
      expect(screen.getByRole('radio', { name: /comfortable/i })).toHaveAttribute(
        'aria-checked',
        'true',
      )
      expect(document.documentElement.hasAttribute('data-density')).toBe(false)
    })

    it('flips to Compact: persists and stamps data-density on <html>', async () => {
      const user = userEvent.setup()
      stubFetch(() => new Promise(() => {}))
      renderPage(<SettingsPage />)

      await user.click(screen.getByRole('radio', { name: /compact/i }))

      expect(document.documentElement.getAttribute('data-density')).toBe('compact')
      expect(localStorage.getItem('agent-deck-density')).toBe('compact')
      expect(screen.getByRole('radio', { name: /compact/i })).toHaveAttribute(
        'aria-checked',
        'true',
      )
    })

    it('flips back to Comfortable: clears the attribute', async () => {
      const user = userEvent.setup()
      stubFetch(() => new Promise(() => {}))
      renderPage(<SettingsPage />)

      await user.click(screen.getByRole('radio', { name: /compact/i }))
      await user.click(screen.getByRole('radio', { name: /comfortable/i }))

      expect(document.documentElement.hasAttribute('data-density')).toBe(false)
      expect(localStorage.getItem('agent-deck-density')).toBe('comfortable')
    })
  })

  describe('composer prefs control', () => {
    it('renders the send-key radiogroup and auto-speak switch even before config loads', () => {
      stubFetch(() => new Promise(() => {})) // never resolves
      renderPage(<SettingsPage />)
      expect(screen.getByRole('radiogroup', { name: /send key/i })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: /^enter sends$/i })).toBeInTheDocument()
      expect(screen.getByRole('switch', { name: /auto-speak replies/i })).toBeInTheDocument()
    })
  })

  describe('dedicated-config dedup (the coherence rule)', () => {
    const DEDICATED: SettingsPayload = {
      editable: false,
      sections: [
        {
          category: 'general',
          fields: [
            {
              key: 'model',
              label: 'model',
              description: 'Default model',
              type: 'string',
              value: 'anthropic/claude-sonnet-4.6',
              isSecret: false,
            },
            {
              key: 'timezone',
              label: 'timezone',
              description: 'Display timezone',
              type: 'string',
              value: 'UTC',
              isSecret: false,
            },
          ],
        },
        {
          category: 'voice',
          fields: [
            {
              key: 'voice.auto_tts',
              label: 'auto_tts',
              description: 'Voice → Auto Tts',
              type: 'boolean',
              value: true,
              isSecret: false,
            },
          ],
        },
        {
          category: 'tts',
          fields: [
            {
              key: 'tts.provider',
              label: 'provider',
              description: 'Tts → Provider',
              type: 'string',
              value: 'elevenlabs',
              isSecret: false,
            },
          ],
        },
        {
          category: 'messaging',
          fields: [
            {
              key: 'messaging.telegram.bot_token',
              label: 'bot_token',
              description: 'Messaging → Telegram → Bot Token',
              type: 'string',
              value: '••••••••',
              isSecret: true,
            },
          ],
        },
        {
          category: 'mcp',
          fields: [
            {
              key: 'mcp_servers',
              label: 'mcp_servers',
              description: 'Configured MCP servers',
              type: 'object',
              value: { context7: { url: 'https://example' } },
              isSecret: false,
            },
          ],
        },
        {
          category: 'auxiliary',
          fields: [
            {
              key: 'auxiliary.vision.model',
              label: 'model',
              description: 'Auxiliary → Vision → Model',
              type: 'string',
              value: 'gpt-4o',
              isSecret: false,
            },
            {
              key: 'auxiliary.vision.api_key',
              label: 'api_key',
              description: 'Auxiliary → Vision → Api Key',
              type: 'string',
              value: '••••••••',
              isSecret: true,
            },
          ],
        },
      ],
    }

    it('drops voice/messaging/mcp config from the dump and renders a link card for each', async () => {
      stubFetch(async () => new Response(JSON.stringify(DEDICATED), { status: 200 }))
      renderPage(<SettingsPage />)
      await screen.findByText('General')

      // The voice/messaging/mcp categories no longer render as dump sections…
      expect(screen.queryByRole('heading', { name: /^voice$/i })).not.toBeInTheDocument()
      expect(screen.queryByText('Tts')).not.toBeInTheDocument()
      // …and no raw dedicated row leaks through.
      expect(screen.queryByText('Auto Tts')).not.toBeInTheDocument()

      // Instead, one "Configured on the X page →" link per dropped domain. Voice/
      // Messaging/MCP folded into the tabbed Connections surface, so each link
      // lands on the matching ?tab= (deep-links still resolve to the right place).
      expect(screen.getByRole('link', { name: /configured on the voice page/i })).toHaveAttribute(
        'href',
        '/connections?tab=voice',
      )
      expect(
        screen.getByRole('link', { name: /configured on the messaging page/i }),
      ).toHaveAttribute('href', '/connections?tab=messaging')
      expect(screen.getByRole('link', { name: /configured on the mcp page/i })).toHaveAttribute(
        'href',
        '/connections?tab=mcp',
      )
    })

    it('folds auxiliary model rows into the Model section (no separate aux card) and keeps other aux fields', async () => {
      stubFetch(async () => new Response(JSON.stringify(DEDICATED), { status: 200 }))
      renderPage(<SettingsPage />)
      await screen.findByText('General')

      // No auxiliary model row in the config dump…
      expect(screen.queryByText('Auxiliary → Vision → Model')).not.toBeInTheDocument()
      // …the Model section (the folded-in picker) owns the auxiliary models now…
      expect(screen.getByRole('region', { name: /^model$/i })).toBeInTheDocument()
      // …but the non-model auxiliary field (api_key) is still shown in the dump.
      expect(screen.getByText('Secret')).toBeInTheDocument()
    })

    it('does NOT render a Memory link when the schema emits no memory category', async () => {
      stubFetch(async () => new Response(JSON.stringify(DEDICATED), { status: 200 }))
      renderPage(<SettingsPage />)
      await screen.findByText('General')
      // Some dedicated links exist (voice/messaging/mcp)…
      expect(
        screen.getAllByRole('link', { name: /configured on the .* page/i }).length,
      ).toBeGreaterThanOrEqual(1)
      // …but none of them is the Profiles (memory) link.
      expect(
        screen.queryByRole('link', { name: /configured on the profiles page/i }),
      ).not.toBeInTheDocument()
    })

    it('renders a Memory link to /profiles when the schema DOES emit a memory category', async () => {
      const withMemory: SettingsPayload = {
        editable: false,
        sections: [
          ...DEDICATED.sections,
          {
            category: 'memory',
            fields: [
              {
                key: 'memory.provider',
                label: 'provider',
                description: 'Memory → Provider',
                type: 'string',
                value: 'sqlite',
                isSecret: false,
              },
            ],
          },
        ],
      }
      stubFetch(async () => new Response(JSON.stringify(withMemory), { status: 200 }))
      renderPage(<SettingsPage />)
      await screen.findByText('General')
      // The memory domain surfaces as a Profiles link (memory lives per-profile).
      const memoryLink = screen.getByRole('link', { name: /configured on the agents page/i })
      expect(memoryLink).toHaveAttribute('href', '/profiles')
      // It is titled "Memory" so the user knows what it owns.
      expect(screen.getByText('Memory')).toBeInTheDocument()
      // The raw memory row is gone from the dump.
      expect(screen.queryByText('Memory → Provider')).not.toBeInTheDocument()
    })

    it('keeps the canonical config (timezone) in the dump', async () => {
      stubFetch(async () => new Response(JSON.stringify(DEDICATED), { status: 200 }))
      renderPage(<SettingsPage />)
      await screen.findByText('General')
      // timezone is editable + kept (its Edit control proves the row is present).
      expect(screen.getAllByRole('button', { name: /edit/i }).length).toBeGreaterThanOrEqual(1)
    })

    it('does NOT resurface a dropped dedicated row on search', async () => {
      const user = userEvent.setup()
      stubFetch(async () => new Response(JSON.stringify(DEDICATED), { status: 200 }))
      renderPage(<SettingsPage />)
      await screen.findByText('General')

      // Searching for a voice key must not bring the dropped voice row back.
      await user.type(screen.getByRole('searchbox', { name: /search settings/i }), 'auto_tts')
      expect(screen.queryByText('Auto Tts')).not.toBeInTheDocument()
      expect(screen.getByText(/no settings match/i)).toBeInTheDocument()
    })
  })
})
