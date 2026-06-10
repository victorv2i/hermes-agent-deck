import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from './command'

describe('Command', () => {
  it('renders an accessible combobox + listbox', () => {
    render(
      <Command label="Test palette">
        <CommandInput placeholder="Search…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Fruit">
            <CommandItem value="apple">Apple</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    )
    expect(screen.getByRole('combobox', { name: /test palette/i })).toBeInTheDocument()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Apple' })).toBeInTheDocument()
  })

  it('filters items by the typed query (case-insensitive substring)', async () => {
    const user = userEvent.setup()
    render(
      <Command label="Test palette">
        <CommandInput placeholder="Search…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Fruit">
            <CommandItem value="apple">Apple</CommandItem>
            <CommandItem value="banana">Banana</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    )
    await user.type(screen.getByRole('combobox'), 'ban')
    expect(screen.queryByRole('option', { name: 'Apple' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Banana' })).toBeInTheDocument()
  })

  it('shows the empty state when nothing matches', async () => {
    const user = userEvent.setup()
    render(
      <Command label="Test palette">
        <CommandInput placeholder="Search…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Fruit">
            <CommandItem value="apple">Apple</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    )
    await user.type(screen.getByRole('combobox'), 'zzz')
    expect(screen.getByText('No results.')).toBeInTheDocument()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('selects the active item on Enter and fires onSelect', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(
      <Command label="Test palette">
        <CommandInput placeholder="Search…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Fruit">
            <CommandItem value="apple" onSelect={() => onPick('apple')}>
              Apple
            </CommandItem>
            <CommandItem value="banana" onSelect={() => onPick('banana')}>
              Banana
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    )
    const input = screen.getByRole('combobox')
    input.focus()
    // First item is active by default; arrow down moves to Banana, Enter selects it.
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')
    expect(onPick).toHaveBeenCalledWith('banana')
  })

  it('selects on click', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(
      <Command label="Test palette">
        <CommandInput placeholder="Search…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Fruit">
            <CommandItem value="apple" onSelect={() => onPick('apple')}>
              Apple
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    )
    await user.click(screen.getByRole('option', { name: 'Apple' }))
    expect(onPick).toHaveBeenCalledWith('apple')
  })

  it('keeps the active item within the filtered set after typing', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(
      <Command label="Test palette">
        <CommandInput placeholder="Search…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Fruit">
            <CommandItem value="apple" onSelect={() => onPick('apple')}>
              Apple
            </CommandItem>
            <CommandItem value="banana" onSelect={() => onPick('banana')}>
              Banana
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    )
    const input = screen.getByRole('combobox')
    await user.type(input, 'ban')
    // Only Banana matches; Enter must select it even though it was the 2nd item.
    await user.keyboard('{Enter}')
    expect(onPick).toHaveBeenCalledWith('banana')
  })

  it('renders disabled informational rows without making them selectable', async () => {
    const user = userEvent.setup()
    const onDisabled = vi.fn()
    const onPick = vi.fn()
    render(
      <Command label="Test palette">
        <CommandInput placeholder="Search…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Sessions">
            <CommandItem value="loading sessions" disabled onSelect={onDisabled}>
              Loading sessions…
            </CommandItem>
            <CommandItem value="apple" onSelect={() => onPick('apple')}>
              Apple
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    )

    const disabled = screen.getByRole('option', { name: 'Loading sessions…' })
    expect(disabled).toHaveAttribute('aria-disabled', 'true')
    expect(disabled).toHaveAttribute('aria-selected', 'false')

    await user.click(disabled)
    expect(onDisabled).not.toHaveBeenCalled()

    screen.getByRole('combobox').focus()
    await user.keyboard('{Home}{Enter}')
    expect(onPick).toHaveBeenCalledWith('apple')
  })
})
