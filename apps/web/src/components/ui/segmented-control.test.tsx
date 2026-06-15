import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CornerDownLeft, Command } from 'lucide-react'
import { SegmentedControl } from './segmented-control'

const OPTIONS = [
  { value: 'enter', label: 'Enter sends', icon: CornerDownLeft },
  { value: 'mod-enter', label: 'Cmd sends', icon: Command },
]

describe('SegmentedControl', () => {
  it('renders a radiogroup with one radio per option', () => {
    render(
      <SegmentedControl
        aria-label="Send key"
        value="enter"
        onValueChange={() => {}}
        options={OPTIONS}
      />,
    )
    expect(screen.getByRole('radiogroup', { name: 'Send key' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
  })

  it('marks the selected option aria-checked', () => {
    render(
      <SegmentedControl
        aria-label="Send key"
        value="mod-enter"
        onValueChange={() => {}}
        options={OPTIONS}
      />,
    )
    expect(screen.getByRole('radio', { name: 'Enter sends' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.getByRole('radio', { name: 'Cmd sends' })).toHaveAttribute('aria-checked', 'true')
  })

  it('calls onValueChange when an option is clicked', () => {
    const onValueChange = vi.fn()
    render(
      <SegmentedControl
        aria-label="Send key"
        value="enter"
        onValueChange={onValueChange}
        options={OPTIONS}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Cmd sends' }))
    expect(onValueChange).toHaveBeenCalledWith('mod-enter')
  })

  it('moves selection with the arrow keys (roving radiogroup)', () => {
    const onValueChange = vi.fn()
    render(
      <SegmentedControl
        aria-label="Send key"
        value="enter"
        onValueChange={onValueChange}
        options={OPTIONS}
      />,
    )
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' })
    expect(onValueChange).toHaveBeenCalledWith('mod-enter')
  })

  it('tints only the active segment with the governed accent', () => {
    render(
      <SegmentedControl
        aria-label="Send key"
        value="enter"
        onValueChange={() => {}}
        options={OPTIONS}
      />,
    )
    expect(screen.getByRole('radio', { name: 'Enter sends' }).className).toContain('text-primary')
    expect(screen.getByRole('radio', { name: 'Cmd sends' }).className).not.toContain('text-primary')
  })

  it('does not fire onValueChange when disabled and a segment is clicked', () => {
    const onValueChange = vi.fn()
    render(
      <SegmentedControl
        aria-label="Send key"
        value="enter"
        disabled
        onValueChange={onValueChange}
        options={OPTIONS}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Cmd sends' }))
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('ignores arrow keys when disabled', () => {
    const onValueChange = vi.fn()
    render(
      <SegmentedControl
        aria-label="Send key"
        value="enter"
        disabled
        onValueChange={onValueChange}
        options={OPTIONS}
      />,
    )
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' })
    expect(onValueChange).not.toHaveBeenCalled()
  })
})
