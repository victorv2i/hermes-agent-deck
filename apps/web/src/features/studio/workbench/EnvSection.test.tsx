import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { StudioEnvResponse } from '@agent-deck/protocol'
import { EnvSection } from './EnvSection'

const ENV: StudioEnvResponse = {
  env: [
    { key: 'OPENAI_API_KEY', isSet: true },
    { key: 'ANTHROPIC_API_KEY', isSet: false },
  ],
}

describe('EnvSection', () => {
  it('shows which keys are set vs unset, never a value', () => {
    render(<EnvSection env={ENV} isLoading={false} error={null} onSet={vi.fn()} />)
    expect(screen.getByText('OPENAI_API_KEY')).toBeInTheDocument()
    // Set/unset is shown as status text, not a value.
    expect(screen.getByTestId('studio-env-OPENAI_API_KEY')).toHaveTextContent(/set/i)
    expect(screen.getByTestId('studio-env-ANTHROPIC_API_KEY')).toHaveTextContent(/not set/i)
  })

  it('never renders an input pre-filled with a secret value', () => {
    render(<EnvSection env={ENV} isLoading={false} error={null} onSet={vi.fn()} />)
    // No textbox carries a value on first render (the value field is blank until
    // the user types a NEW value to set).
    for (const box of screen.queryAllByRole('textbox')) {
      expect((box as HTMLInputElement).value).toBe('')
    }
  })

  it('writes a new value by key through onSet (value sent once, never echoed)', async () => {
    const onSet = vi.fn().mockResolvedValue(undefined)
    render(<EnvSection env={ENV} isLoading={false} error={null} onSet={onSet} />)
    await userEvent.type(screen.getByLabelText(/new key/i), 'NEW_KEY')
    await userEvent.type(screen.getByLabelText(/value/i), 's3cret')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSet).toHaveBeenCalledWith({ key: 'NEW_KEY', value: 's3cret' })
  })

  it('renders an empty state when no keys are set', () => {
    render(<EnvSection env={{ env: [] }} isLoading={false} error={null} onSet={vi.fn()} />)
    expect(screen.getByText(/no environment variables/i)).toBeInTheDocument()
  })
})
