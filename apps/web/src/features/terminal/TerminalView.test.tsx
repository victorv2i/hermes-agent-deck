import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TerminalView, type TerminalEngine } from './TerminalView'
import type { TerminalSocketLike } from './terminalSocket'

/** Pre-connected fake transport so TerminalView's connect() emits immediately. */
class FakeSocket implements TerminalSocketLike {
  connected = true
  emits: { event: string; args: unknown[] }[] = []
  private handlers = new Map<string, ((...a: unknown[]) => void)[]>()
  on(event: string, listener: (...a: unknown[]) => void) {
    const list = this.handlers.get(event) ?? []
    list.push(listener)
    this.handlers.set(event, list)
    return this
  }
  off() {
    return this
  }
  emit(event: string, ...args: unknown[]) {
    this.emits.push({ event, args })
    return this
  }
  disconnect() {
    this.connected = false
    return this
  }
  fire(event: string, ...args: unknown[]) {
    for (const l of this.handlers.get(event) ?? []) l(...args)
  }
  emitsFor(event: string) {
    return this.emits.filter((e) => e.event === event)
  }
}

class FakeEngine implements TerminalEngine {
  cols = 80
  rows = 24
  written: string[] = []
  opened = false
  disposed = false
  cleared = 0
  themeSets = 0
  private dataCb?: (d: string) => void
  open(_el?: HTMLElement) {
    this.opened = true
  }
  write(d: string) {
    this.written.push(d)
  }
  onData(cb: (d: string) => void) {
    this.dataCb = cb
  }
  focus() {}
  clear() {
    this.cleared += 1
  }
  dispose() {
    this.disposed = true
  }
  fit() {
    return { cols: this.cols, rows: this.rows }
  }
  setTheme() {
    this.themeSets += 1
  }
  type(d: string) {
    this.dataCb?.(d)
  }
}

beforeEach(() => {
  // jsdom has no ResizeObserver; provide a no-op stub.
  if (!('ResizeObserver' in globalThis)) {
    // @ts-expect-error test stub
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
    }
  }
})

function renderView(engine: FakeEngine, socket: FakeSocket) {
  return render(<TerminalView engineFactory={async () => engine} socket={socket} />)
}

describe('TerminalView', () => {
  it('re-skins the live terminal when the <html> theme attribute flips', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    renderView(engine, socket)
    await waitFor(() => expect(engine.opened).toBe(true))
    const before = engine.themeSets
    // Flip the theme the way ThemeProvider does (data-theme + the .dark class on
    // <html>); the MutationObserver should re-skin the live engine in place.
    act(() => {
      document.documentElement.classList.remove('dark')
      document.documentElement.setAttribute('data-theme', 'light')
    })
    await waitFor(() => expect(engine.themeSets).toBeGreaterThan(before))
    // Restore so the attribute change does not leak into sibling tests.
    act(() => {
      document.documentElement.setAttribute('data-theme', 'dark')
      document.documentElement.classList.add('dark')
    })
  })

  it('opens the engine and starts a shell with the fitted geometry (deferred a frame)', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    renderView(engine, socket)

    await waitFor(() => expect(engine.opened).toBe(true))
    // The initial fit + start is deferred to requestAnimationFrame so the host has
    // real measured dimensions before xterm sizes its grid — so `terminal.start`
    // arrives a frame after the engine opens, not synchronously with it.
    await waitFor(() => expect(socket.emitsFor('terminal.start')).toHaveLength(1))
    const starts = socket.emitsFor('terminal.start')
    expect(starts[0]!.args[0]).toEqual({ cols: 80, rows: 24 })
  })

  it('forwards the pane cwd into the start payload so the shell opens there', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    render(
      <TerminalView
        engineFactory={async () => engine}
        socket={socket}
        cwd="/home/me/Projects/app"
      />,
    )

    await waitFor(() => expect(socket.emitsFor('terminal.start')).toHaveLength(1))
    const starts = socket.emitsFor('terminal.start')
    expect(starts[0]!.args[0]).toEqual({
      cols: 80,
      rows: 24,
      cwd: '/home/me/Projects/app',
    })
  })

  it('defers the initial fit until after a frame (real container dimensions)', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    // Record the order of lifecycle calls so we can prove the first fit happens
    // INSIDE the deferred requestAnimationFrame, after open() — not synchronously
    // during it (which would measure the host before layout settles). We schedule
    // a deferral marker via rAF at the same point so the ordering is observable
    // regardless of jsdom's rAF/waitFor timing.
    const log: string[] = []
    const realRaf = globalThis.requestAnimationFrame
    const rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        log.push('raf-scheduled')
        return realRaf((t) => {
          log.push('raf-fired')
          cb(t)
        })
      })
    const origFit = engine.fit.bind(engine)
    engine.fit = () => {
      log.push('fit')
      return origFit()
    }
    const origOpen = engine.open.bind(engine)
    engine.open = (el: HTMLElement) => {
      log.push('open')
      origOpen(el)
    }
    renderView(engine, socket)

    await waitFor(() => expect(socket.emitsFor('terminal.start')).toHaveLength(1))
    // open ran, THEN the rAF was scheduled, THEN it fired, THEN the fit happened.
    expect(log.indexOf('open')).toBeLessThan(log.indexOf('raf-scheduled'))
    expect(log.indexOf('raf-scheduled')).toBeLessThan(log.indexOf('fit'))
    expect(log.indexOf('raf-fired')).toBeLessThanOrEqual(log.indexOf('fit'))
    rafSpy.mockRestore()
  })

  it('writes shell output to the engine', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    renderView(engine, socket)
    await waitFor(() => expect(engine.opened).toBe(true))

    socket.fire('terminal.data', 'hello world\r\n')
    await waitFor(() => expect(engine.written).toContain('hello world\r\n'))
  })

  it('forwards keystrokes from the engine to the wire', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    renderView(engine, socket)
    await waitFor(() => expect(engine.opened).toBe(true))

    engine.type('ls\r')
    expect(socket.emitsFor('terminal.input')[0]!.args[0]).toBe('ls\r')
  })

  it('shows an honest "Terminal unavailable" overlay on terminal.error', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    renderView(engine, socket)
    await waitFor(() => expect(engine.opened).toBe(true))

    act(() => {
      socket.fire('terminal.error', { message: 'node-pty is not available on this host.' })
    })
    expect(await screen.findByText('Terminal unavailable')).toBeInTheDocument()
    expect(screen.getByText(/not available on this host/i)).toBeInTheDocument()
  })

  it('shows a "Session ended" overlay with the exit code on terminal.exit', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    renderView(engine, socket)
    await waitFor(() => expect(engine.opened).toBe(true))

    act(() => {
      socket.fire('terminal.exit', { exitCode: 0 })
    })
    expect(await screen.findByText(/code 0/i)).toBeInTheDocument()
  })

  it('reports live status changes up so the route can show them in the header', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    const onStatusChange = vi.fn()
    render(
      <TerminalView
        engineFactory={async () => engine}
        socket={socket}
        onStatusChange={onStatusChange}
      />,
    )
    await waitFor(() => expect(engine.opened).toBe(true))

    // connect() reports 'connecting'; a shell exit reports 'exited'. (The
    // pre-connected fake never fires the socket 'connect' event, so it stays at
    // 'connecting' until exit — same as the real flow before the wire is live.)
    expect(onStatusChange).toHaveBeenCalledWith('connecting')
    act(() => {
      socket.fire('terminal.exit', { exitCode: 0 })
    })
    expect(onStatusChange).toHaveBeenCalledWith('exited')
  })

  it('hands a Clear handle up once the engine is live, and revokes it on unmount', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    const onClearReady = vi.fn()
    const { unmount } = render(
      <TerminalView
        engineFactory={async () => engine}
        socket={socket}
        onClearReady={onClearReady}
      />,
    )
    await waitFor(() => expect(engine.opened).toBe(true))

    const clear = onClearReady.mock.calls.at(-1)?.[0] as (() => void) | null
    expect(typeof clear).toBe('function')
    clear?.()
    expect(engine.cleared).toBe(1)

    unmount()
    expect(onClearReady).toHaveBeenLastCalledWith(null)
  })

  it('shows an honest "Connection dropped" overlay on reconnect (P1 — no silent fresh shell)', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    const onRestart = vi.fn()
    render(
      <TerminalView engineFactory={async () => engine} socket={socket} onRestart={onRestart} />,
    )
    await waitFor(() => expect(engine.opened).toBe(true))
    // The pre-connected socket sent the initial start once.
    await waitFor(() => expect(socket.emitsFor('terminal.start')).toHaveLength(1))

    // Simulate a transport reconnect (the server force-killed the pty). The view
    // must NOT silently re-spawn a shell that masquerades as the same session.
    act(() => {
      socket.fire('connect')
    })
    expect(await screen.findByText('Connection dropped')).toBeInTheDocument()
    // No second terminal.start (no silent fresh shell).
    expect(socket.emitsFor('terminal.start')).toHaveLength(1)
    // The overlay offers a Restart (a deliberate fresh shell).
    const restart = await screen.findByRole('button', { name: /restart session/i })
    restart.click()
    expect(onRestart).toHaveBeenCalledTimes(1)
  })

  it('offers a Restart button in the exit overlay when onRestart is provided', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    const onRestart = vi.fn()
    render(
      <TerminalView engineFactory={async () => engine} socket={socket} onRestart={onRestart} />,
    )
    await waitFor(() => expect(engine.opened).toBe(true))

    act(() => {
      socket.fire('terminal.exit', { exitCode: 0 })
    })
    const restart = await screen.findByRole('button', { name: /restart session/i })
    restart.click()
    expect(onRestart).toHaveBeenCalledTimes(1)
  })

  it('renders no inner header bar (single-header surface, T1.8)', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    renderView(engine, socket)
    await waitFor(() => expect(engine.opened).toBe(true))

    // The old inner bar carried a "Terminal session" section label; it is gone —
    // the connection status now lives in the route's single SurfaceHeader.
    expect(screen.queryByText(/terminal session/i)).not.toBeInTheDocument()
  })

  it('disposes the engine and socket on unmount', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    const { unmount } = renderView(engine, socket)
    await waitFor(() => expect(engine.opened).toBe(true))

    unmount()
    await waitFor(() => expect(engine.disposed).toBe(true))
    expect(socket.connected).toBe(false) // dispose() disconnected the transport
  })

  it('surfaces a calm error when the engine fails to load', async () => {
    const socket = new FakeSocket()
    render(
      <TerminalView
        engineFactory={async () => {
          throw new Error('chunk load failed')
        }}
        socket={socket}
      />,
    )
    expect(await screen.findByText('Terminal unavailable')).toBeInTheDocument()
    expect(screen.getByText(/failed to load the terminal/i)).toBeInTheDocument()
  })
})

/* ── The touch key bar (JS-gated) + the honest fresh-shell notice ───────────── */

const FRESH_NOTICE = /the previous shell ended; this is a fresh one\./i

describe('TerminalView touch key bar', () => {
  /** Pretend this device takes touch input (a hybrid laptop / phone). */
  function enableTouch() {
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 2, configurable: true })
  }
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).maxTouchPoints
  })

  it('does NOT render the bar without touch input (fine pointer, no touch points)', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    renderView(engine, socket)
    await waitFor(() => expect(engine.opened).toBe(true))
    expect(screen.queryByRole('toolbar', { name: /terminal touch keys/i })).toBeNull()
  })

  it('renders the bar on touch input, and a key press reaches the wire', async () => {
    enableTouch()
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    renderView(engine, socket)
    await waitFor(() => expect(engine.opened).toBe(true))
    expect(screen.getByRole('toolbar', { name: /terminal touch keys/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Arrow up' }))
    const inputs = socket.emitsFor('terminal.input')
    expect(inputs.at(-1)?.args[0]).toBe('\x1b[A')
  })

  it('appears when touch input arrives later (re-checked on resize)', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    renderView(engine, socket)
    await waitFor(() => expect(engine.opened).toBe(true))
    expect(screen.queryByRole('toolbar', { name: /terminal touch keys/i })).toBeNull()
    enableTouch()
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(screen.getByRole('toolbar', { name: /terminal touch keys/i })).toBeInTheDocument()
  })

  it('sticky Ctrl then a typed "c" sends ^C on the wire, then disarms', async () => {
    enableTouch()
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    renderView(engine, socket)
    await waitFor(() => expect(engine.opened).toBe(true))
    const ctrl = screen.getByRole('button', { name: /control modifier/i })
    fireEvent.click(ctrl)
    expect(ctrl).toHaveAttribute('aria-pressed', 'true')
    act(() => {
      engine.type('c')
    })
    expect(socket.emitsFor('terminal.input').at(-1)?.args[0]).toBe('\x03')
    expect(ctrl).toHaveAttribute('aria-pressed', 'false')
    act(() => {
      engine.type('c') // disarmed: the next character is plain again
    })
    expect(socket.emitsFor('terminal.input').at(-1)?.args[0]).toBe('c')
  })

  it('Paste sends the clipboard text to the wire verbatim', async () => {
    enableTouch()
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: async () => 'echo pasted' },
      configurable: true,
    })
    try {
      const engine = new FakeEngine()
      const socket = new FakeSocket()
      renderView(engine, socket)
      await waitFor(() => expect(engine.opened).toBe(true))
      fireEvent.click(screen.getByRole('button', { name: 'Paste' }))
      await waitFor(() =>
        expect(socket.emitsFor('terminal.input').at(-1)?.args[0]).toBe('echo pasted'),
      )
    } finally {
      delete (navigator as unknown as Record<string, unknown>).clipboard
    }
  })
})

describe('TerminalView fresh-shell notice (honest non-resume)', () => {
  it('shows the notice when an expected resume comes back as a fresh shell', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    render(<TerminalView engineFactory={async () => engine} socket={socket} expectResume />)
    await waitFor(() => expect(engine.opened).toBe(true))
    // The tmux session died between snapshot and mount: new-session -A quietly
    // made a fresh shell, so ready arrives WITHOUT resumed:true.
    act(() => {
      socket.fire('terminal.ready', { pid: 11, persistent: true })
    })
    expect(screen.getByText(FRESH_NOTICE)).toBeInTheDocument()
  })

  it('shows NO notice when the expected resume actually resumed', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    render(<TerminalView engineFactory={async () => engine} socket={socket} expectResume />)
    await waitFor(() => expect(engine.opened).toBe(true))
    act(() => {
      socket.fire('terminal.ready', { pid: 11, persistent: true, resumed: true })
    })
    expect(screen.queryByText(FRESH_NOTICE)).toBeNull()
  })

  it('shows NO notice for a brand-new launch (no resume expected)', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    renderView(engine, socket)
    await waitFor(() => expect(engine.opened).toBe(true))
    act(() => {
      socket.fire('terminal.ready', { pid: 11, persistent: true })
    })
    expect(screen.queryByText(FRESH_NOTICE)).toBeNull()
  })

  it('a known-persistent session that later readies without resumed shows the notice', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    renderView(engine, socket)
    await waitFor(() => expect(engine.opened).toBe(true))
    // First ready: a brand-new persistent shell — no notice.
    act(() => {
      socket.fire('terminal.ready', { pid: 11, persistent: true })
    })
    expect(screen.queryByText(FRESH_NOTICE)).toBeNull()
    // A reconnect re-start readies WITHOUT resumed: that shell died in between.
    act(() => {
      socket.fire('terminal.ready', { pid: 12, persistent: true })
    })
    expect(screen.getByText(FRESH_NOTICE)).toBeInTheDocument()
  })

  it('clears the notice once a later ready actually resumes', async () => {
    const engine = new FakeEngine()
    const socket = new FakeSocket()
    render(<TerminalView engineFactory={async () => engine} socket={socket} expectResume />)
    await waitFor(() => expect(engine.opened).toBe(true))
    act(() => {
      socket.fire('terminal.ready', { pid: 11, persistent: true })
    })
    expect(screen.getByText(FRESH_NOTICE)).toBeInTheDocument()
    act(() => {
      socket.fire('terminal.ready', { pid: 11, persistent: true, resumed: true })
    })
    expect(screen.queryByText(FRESH_NOTICE)).toBeNull()
  })
})
