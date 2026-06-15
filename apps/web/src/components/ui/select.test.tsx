import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Select } from './select'

describe('Select', () => {
  it('renders a select with the given value and options', () => {
    render(
      <Select aria-label="Provider" value="edge" onChange={() => {}}>
        <option value="edge">Edge</option>
        <option value="openai">OpenAI</option>
      </Select>,
    )
    expect(screen.getByRole('combobox', { name: 'Provider' })).toHaveValue('edge')
  })

  it('calls onChange when a new option is chosen', () => {
    const onChange = vi.fn()
    render(
      <Select aria-label="Provider" value="edge" onChange={onChange}>
        <option value="edge">Edge</option>
        <option value="openai">OpenAI</option>
      </Select>,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'openai' } })
    expect(onChange).toHaveBeenCalled()
  })

  it('uses the shared focus ring and hides the native arrow', () => {
    render(
      <Select aria-label="Provider" value="edge" onChange={() => {}}>
        <option value="edge">Edge</option>
      </Select>,
    )
    const select = screen.getByRole('combobox')
    expect(select.className).toContain('ad-focus')
    expect(select.className).toContain('appearance-none')
  })
})
