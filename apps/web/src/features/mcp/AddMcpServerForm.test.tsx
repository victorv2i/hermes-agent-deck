import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AddMcpServerForm } from './AddMcpServerForm'

/**
 * AddMcpServerForm pins the guided-add contract + the masked-key honesty:
 *  - an http server emits { name, transport:'http', url };
 *  - a stdio server emits { name, transport:'stdio', command, args[] };
 *  - the masked key value is a password field, sent ONCE then cleared;
 *  - validation blocks a malformed name / a key value without an env var.
 */

function setup(submitting = false) {
  const onAdd = vi.fn()
  render(<AddMcpServerForm onAdd={onAdd} submitting={submitting} />)
  return { onAdd }
}

describe('AddMcpServerForm — guided add', () => {
  it('emits an http server request', () => {
    const { onAdd } = setup()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'my-http' } })
    fireEvent.change(screen.getByLabelText(/server url/i), {
      target: { value: 'https://my.example/mcp' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add server/i }))
    expect(onAdd).toHaveBeenCalledWith({
      name: 'my-http',
      transport: 'http',
      url: 'https://my.example/mcp',
    })
  })

  it('switches to stdio and emits command + parsed args', () => {
    const { onAdd } = setup()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'local' } })
    fireEvent.click(screen.getByRole('radio', { name: /stdio/i }))
    fireEvent.change(screen.getByLabelText(/^command$/i), { target: { value: 'npx' } })
    fireEvent.change(screen.getByLabelText(/arguments/i), {
      target: { value: '-y @scope/mcp-server' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add server/i }))
    expect(onAdd).toHaveBeenCalledWith({
      name: 'local',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@scope/mcp-server'],
    })
  })

  it('sends a masked key ONCE (password field) and clears it after submit', () => {
    const { onAdd } = setup()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'keyed' } })
    fireEvent.change(screen.getByLabelText(/server url/i), { target: { value: 'https://k/mcp' } })
    fireEvent.change(screen.getByLabelText(/key name/i), {
      target: { value: 'MCP_KEYED_API_KEY' },
    })
    const keyField = screen.getByLabelText(/^key value$/i)
    expect(keyField).toHaveAttribute('type', 'password')
    fireEvent.change(keyField, { target: { value: 'plaintext-secret' } })
    fireEvent.click(screen.getByRole('button', { name: /add server/i }))
    expect(onAdd).toHaveBeenCalledWith({
      name: 'keyed',
      transport: 'http',
      url: 'https://k/mcp',
      apiKeyEnvVar: 'MCP_KEYED_API_KEY',
      apiKeyValue: 'plaintext-secret',
    })
    // The plaintext is cleared from the DOM after submit.
    expect(screen.getByLabelText(/^key value$/i)).toHaveValue('')
  })

  it('moves the transport selection with arrow keys (roving radiogroup)', () => {
    setup()
    const httpRadio = screen.getByRole('radio', { name: /http url/i })
    const stdioRadio = screen.getByRole('radio', { name: /stdio/i })
    // http is the default-checked radio and the only one in the tab order.
    expect(httpRadio).toHaveAttribute('aria-checked', 'true')
    expect(httpRadio).toHaveAttribute('tabindex', '0')
    expect(stdioRadio).toHaveAttribute('tabindex', '-1')
    // ArrowRight selects stdio and follows focus; the tab order moves with it.
    fireEvent.keyDown(httpRadio, { key: 'ArrowRight' })
    expect(stdioRadio).toHaveAttribute('aria-checked', 'true')
    expect(stdioRadio).toHaveAttribute('tabindex', '0')
    expect(httpRadio).toHaveAttribute('tabindex', '-1')
    // ArrowLeft wraps/moves back to http.
    fireEvent.keyDown(stdioRadio, { key: 'ArrowLeft' })
    expect(httpRadio).toHaveAttribute('aria-checked', 'true')
  })

  it('blocks submit on a malformed name', () => {
    const { onAdd } = setup()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'bad name!' } })
    fireEvent.change(screen.getByLabelText(/server url/i), { target: { value: 'https://x/mcp' } })
    expect(screen.getByRole('button', { name: /add server/i })).toBeDisabled()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('blocks submit when a key value has no env var to store it under', () => {
    const { onAdd } = setup()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'k' } })
    fireEvent.change(screen.getByLabelText(/server url/i), { target: { value: 'https://x/mcp' } })
    fireEvent.change(screen.getByLabelText(/^key value$/i), { target: { value: 'orphan' } })
    expect(screen.getByRole('button', { name: /add server/i })).toBeDisabled()
    expect(onAdd).not.toHaveBeenCalled()
  })
})
