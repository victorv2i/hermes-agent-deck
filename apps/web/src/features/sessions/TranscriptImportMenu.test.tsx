import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranscriptImportMenu } from './TranscriptImportMenu'
import { buildExport } from './export'
import type { SessionDetail, SessionMessage } from './types'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function detail(over: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: 'sess-1',
    source: 'cli',
    model: 'anthropic/claude-sonnet-4',
    title: 'Imported chat',
    preview: 'help me',
    started_at: 1,
    last_active: 2,
    message_count: 2,
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    cost_usd: 0.01,
    is_active: false,
    ended_at: 3,
    end_reason: 'completed',
    tool_call_count: 0,
    ...over,
  }
}

function msg(over: Partial<SessionMessage> & { id: string; role: string }): SessionMessage {
  return { content: '', timestamp: 1, reasoning: null, tool_name: null, tool_calls: [], ...over }
}

function sampleJson(): string {
  return buildExport(
    detail(),
    [
      msg({ id: '1', role: 'user', content: 'hello agent' }),
      msg({ id: '2', role: 'assistant', content: 'hi human' }),
    ],
    'json',
  ).body
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('TranscriptImportMenu', () => {
  it('imports a transcript pasted into the textarea', async () => {
    const user = userEvent.setup()
    const onImport = vi.fn()
    render(<TranscriptImportMenu onImport={onImport} />)

    await user.click(screen.getByRole('button', { name: /^import transcript$/i }))
    const textarea = await screen.findByRole('textbox')
    await user.click(textarea)
    await user.paste(sampleJson())
    await user.click(screen.getByRole('button', { name: /open read-only/i }))

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    const [session, messages] = onImport.mock.calls[0]!
    expect(session.id).toBe('sess-1')
    expect(messages).toHaveLength(2)
    expect(messages[0].content).toBe('hello agent')
  })

  it('imports a transcript chosen via the file input', async () => {
    const user = userEvent.setup()
    const onImport = vi.fn()
    render(<TranscriptImportMenu onImport={onImport} />)

    await user.click(screen.getByRole('button', { name: /^import transcript$/i }))
    const file = new File([sampleJson()], 'session.json', { type: 'application/json' })
    const input = screen.getByTestId('transcript-import-file') as HTMLInputElement
    await user.upload(input, file)

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    const [session] = onImport.mock.calls[0]!
    expect(session.id).toBe('sess-1')
  })

  it('shows a calm error and does not import malformed paste', async () => {
    const user = userEvent.setup()
    const onImport = vi.fn()
    render(<TranscriptImportMenu onImport={onImport} />)

    await user.click(screen.getByRole('button', { name: /^import transcript$/i }))
    const textarea = await screen.findByRole('textbox')
    await user.click(textarea)
    await user.paste('not a transcript at all')
    await user.click(screen.getByRole('button', { name: /open read-only/i }))

    expect(onImport).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
