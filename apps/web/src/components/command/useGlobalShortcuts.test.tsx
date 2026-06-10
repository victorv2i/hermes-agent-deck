import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useGlobalShortcuts } from './useGlobalShortcuts'

function Harness(props: Parameters<typeof useGlobalShortcuts>[0] & { withInput?: boolean }) {
  const { withInput, ...handlers } = props
  useGlobalShortcuts(handlers)
  return withInput ? <input aria-label="field" /> : <div data-testid="root">root</div>
}

describe('useGlobalShortcuts', () => {
  it('opens the palette on Cmd/Ctrl+K', async () => {
    const user = userEvent.setup()
    const onOpenPalette = vi.fn()
    render(<Harness onOpenPalette={onOpenPalette} onNewChat={vi.fn()} onShowShortcuts={vi.fn()} />)
    await user.keyboard('{Control>}k{/Control}')
    expect(onOpenPalette).toHaveBeenCalledTimes(1)
    await user.keyboard('{Meta>}k{/Meta}')
    expect(onOpenPalette).toHaveBeenCalledTimes(2)
  })

  it('starts a new chat on Cmd/Ctrl+N', async () => {
    const user = userEvent.setup()
    const onNewChat = vi.fn()
    render(<Harness onOpenPalette={vi.fn()} onNewChat={onNewChat} onShowShortcuts={vi.fn()} />)
    await user.keyboard('{Meta>}n{/Meta}')
    expect(onNewChat).toHaveBeenCalledTimes(1)
  })

  it('shows the shortcuts overlay on plain "?"', async () => {
    const user = userEvent.setup()
    const onShowShortcuts = vi.fn()
    render(
      <Harness onOpenPalette={vi.fn()} onNewChat={vi.fn()} onShowShortcuts={onShowShortcuts} />,
    )
    await user.keyboard('?')
    expect(onShowShortcuts).toHaveBeenCalledTimes(1)
  })

  it('ignores "?" while typing in an input', async () => {
    const user = userEvent.setup()
    const onShowShortcuts = vi.fn()
    render(
      <Harness
        withInput
        onOpenPalette={vi.fn()}
        onNewChat={vi.fn()}
        onShowShortcuts={onShowShortcuts}
      />,
    )
    const input = document.querySelector('input')!
    input.focus()
    await user.keyboard('?')
    expect(onShowShortcuts).not.toHaveBeenCalled()
  })

  it('ignores Cmd/Ctrl+N while typing in an input (so the browser/native field wins)', async () => {
    const user = userEvent.setup()
    const onNewChat = vi.fn()
    render(
      <Harness withInput onOpenPalette={vi.fn()} onNewChat={onNewChat} onShowShortcuts={vi.fn()} />,
    )
    const input = document.querySelector('input')!
    input.focus()
    await user.keyboard('{Meta>}n{/Meta}')
    expect(onNewChat).not.toHaveBeenCalled()
  })

  it('toggles the sessions pane on Cmd/Ctrl+B (even while typing in an input)', async () => {
    const user = userEvent.setup()
    const onToggleSessions = vi.fn()
    render(
      <Harness
        withInput
        onOpenPalette={vi.fn()}
        onNewChat={vi.fn()}
        onShowShortcuts={vi.fn()}
        onToggleSessions={onToggleSessions}
      />,
    )
    const input = document.querySelector('input')!
    input.focus()
    await user.keyboard('{Control>}b{/Control}')
    expect(onToggleSessions).toHaveBeenCalledTimes(1)
    await user.keyboard('{Meta>}b{/Meta}')
    expect(onToggleSessions).toHaveBeenCalledTimes(2)
  })

  it('does nothing on Cmd/Ctrl+B when no sessions handler is provided', async () => {
    const user = userEvent.setup()
    render(<Harness onOpenPalette={vi.fn()} onNewChat={vi.fn()} onShowShortcuts={vi.fn()} />)
    await user.keyboard('{Meta>}b{/Meta}')
    expect(document.querySelector('[data-testid="root"]')).toBeInTheDocument()
  })

  it('STILL opens the palette on Cmd/Ctrl+K even while typing in an input', async () => {
    const user = userEvent.setup()
    const onOpenPalette = vi.fn()
    render(
      <Harness
        withInput
        onOpenPalette={onOpenPalette}
        onNewChat={vi.fn()}
        onShowShortcuts={vi.fn()}
      />,
    )
    const input = document.querySelector('input')!
    input.focus()
    await user.keyboard('{Meta>}k{/Meta}')
    expect(onOpenPalette).toHaveBeenCalledTimes(1)
  })

  describe('session rail navigation (j/k + arrows + Enter)', () => {
    function navProps(over?: Partial<Parameters<typeof useGlobalShortcuts>[0]>) {
      return {
        onOpenPalette: vi.fn(),
        onNewChat: vi.fn(),
        onShowShortcuts: vi.fn(),
        ...over,
      }
    }

    it('moves to the next session on "j" and the previous on "k"', async () => {
      const user = userEvent.setup()
      const onSessionNav = vi.fn()
      render(<Harness {...navProps({ onSessionNav })} />)
      await user.keyboard('j')
      expect(onSessionNav).toHaveBeenLastCalledWith('next')
      await user.keyboard('k')
      expect(onSessionNav).toHaveBeenLastCalledWith('prev')
      expect(onSessionNav).toHaveBeenCalledTimes(2)
    })

    it('moves with ArrowDown / ArrowUp as aliases for j / k', async () => {
      const user = userEvent.setup()
      const onSessionNav = vi.fn()
      render(<Harness {...navProps({ onSessionNav })} />)
      await user.keyboard('{ArrowDown}')
      expect(onSessionNav).toHaveBeenLastCalledWith('next')
      await user.keyboard('{ArrowUp}')
      expect(onSessionNav).toHaveBeenLastCalledWith('prev')
    })

    it('ignores j/k while typing in a field (so the keystroke lands in the input)', async () => {
      const user = userEvent.setup()
      const onSessionNav = vi.fn()
      render(<Harness withInput {...navProps({ onSessionNav })} />)
      const input = document.querySelector('input')!
      input.focus()
      await user.keyboard('jk')
      expect(onSessionNav).not.toHaveBeenCalled()
      expect(input).toHaveValue('jk')
    })

    it('does not fire arrow navigation while typing (native caret movement wins)', async () => {
      const user = userEvent.setup()
      const onSessionNav = vi.fn()
      render(<Harness withInput {...navProps({ onSessionNav })} />)
      const input = document.querySelector('input')!
      input.focus()
      await user.keyboard('{ArrowDown}{ArrowUp}')
      expect(onSessionNav).not.toHaveBeenCalled()
    })

    it('does nothing on j/k when no nav handler is supplied (binding is inert)', async () => {
      const user = userEvent.setup()
      render(<Harness {...navProps()} />)
      await user.keyboard('jk')
      expect(document.querySelector('[data-testid="root"]')).toBeInTheDocument()
    })

    it('opens the focused session on Enter when a session is focused', async () => {
      const user = userEvent.setup()
      const onOpenFocusedSession = vi.fn(() => true)
      render(<Harness {...navProps({ onOpenFocusedSession })} />)
      await user.keyboard('{Enter}')
      expect(onOpenFocusedSession).toHaveBeenCalledTimes(1)
    })

    it('does not swallow Enter when no session is focused (handler returns false)', async () => {
      const user = userEvent.setup()
      // Returns false → nothing was focused, so Enter must not be preventDefaulted
      // and the rest of the page keeps its native Enter behavior.
      const onOpenFocusedSession = vi.fn(() => false)
      const onActivate = vi.fn()
      render(
        <>
          <Harness {...navProps({ onOpenFocusedSession })} />
          <button onClick={onActivate}>activate</button>
        </>,
      )
      const btn = screen.getByRole('button', { name: 'activate' })
      btn.focus()
      await user.keyboard('{Enter}')
      // The handler was consulted, but since it declined, the button's own Enter
      // activation still fires.
      expect(onOpenFocusedSession).toHaveBeenCalledTimes(1)
      expect(onActivate).toHaveBeenCalledTimes(1)
    })

    it('ignores Enter while typing in a field (so Enter sends/newlines normally)', async () => {
      const user = userEvent.setup()
      const onOpenFocusedSession = vi.fn(() => true)
      render(<Harness withInput {...navProps({ onOpenFocusedSession })} />)
      const input = document.querySelector('input')!
      input.focus()
      await user.keyboard('{Enter}')
      expect(onOpenFocusedSession).not.toHaveBeenCalled()
    })
  })
})
