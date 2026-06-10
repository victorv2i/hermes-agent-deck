/**
 * Tests for the WorkPanel component.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { WorkPanel } from './WorkPanel'
import { useWorkPanelStore } from './workPanelStore'

// Stub Shiki so CodeBlock falls back to plain text (fast + deterministic).
vi.mock('@/components/chat/lib/highlight', async () => {
  const actual = await vi.importActual<typeof import('@/components/chat/lib/highlight')>(
    '@/components/chat/lib/highlight',
  )
  return { ...actual, highlight: vi.fn(async () => null) }
})

function reset() {
  useWorkPanelStore.setState({ open: true, artifact: null })
}

function renderPanel() {
  return render(
    <ThemeProvider>
      <WorkPanel open />
    </ThemeProvider>,
  )
}

describe('WorkPanel', () => {
  beforeEach(reset)
  afterEach(() => vi.restoreAllMocks())

  // --- Empty state -----------------------------------------------------------
  it('shows an empty state when no artifact is set', () => {
    renderPanel()
    expect(screen.getByTestId('work-panel-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('work-panel-artifact')).not.toBeInTheDocument()
  })

  it('exposes the panel as a labelled landmark region', () => {
    renderPanel()
    // The heading labels the region so it is reachable + announced as a landmark.
    expect(screen.getByRole('region', { name: /artifact canvas/i })).toBeInTheDocument()
  })

  // --- Code artifact ---------------------------------------------------------
  it('renders a code artifact with the filename header and copy button', async () => {
    act(() => {
      useWorkPanelStore.getState().openArtifact({
        type: 'code',
        title: 'src/index.ts',
        lang: 'typescript',
        content: 'export const x = 1',
      })
    })
    renderPanel()
    expect(await screen.findByTestId('work-panel-artifact')).toBeInTheDocument()
    // Title shown in the panel header (the data-testid element is just the title span)
    // There may be multiple instances (panel header + CodeBlock label), so just check
    // that at least one is present.
    expect(screen.getAllByText('src/index.ts').length).toBeGreaterThan(0)
    // The code is rendered (Shiki stubbed → plain text fallback)
    expect(screen.getByText('export const x = 1')).toBeInTheDocument()
    // Panel copy button is present (by testid to avoid ambiguity with CodeBlock's copy)
    expect(screen.getByTestId('work-panel-copy')).toBeInTheDocument()
  })

  // --- Markdown artifact -----------------------------------------------------
  it('renders a markdown artifact as prose', async () => {
    act(() => {
      useWorkPanelStore.getState().openArtifact({
        type: 'markdown',
        title: 'README.md',
        content: '# Hello world\n\nSome paragraph.',
      })
    })
    renderPanel()
    expect(await screen.findByTestId('work-panel-artifact')).toBeInTheDocument()
    // Heading in rendered markdown
    expect(await screen.findByRole('heading', { name: 'Hello world' })).toBeInTheDocument()
  })

  // --- HTML artifact (sandboxed iframe) -------------------------------------
  it('renders an html artifact in a sandboxed iframe', async () => {
    act(() => {
      useWorkPanelStore.getState().openArtifact({
        type: 'html',
        title: 'page.html',
        content: '<h1>Hi</h1>',
      })
    })
    renderPanel()
    expect(await screen.findByTestId('work-panel-artifact')).toBeInTheDocument()
    // The iframe renders with a srcDoc attribute
    const frame = screen.getByTestId('work-panel-html-iframe') as HTMLIFrameElement
    expect(frame).toBeInTheDocument()
    expect(frame.getAttribute('sandbox')).not.toContain('allow-top-navigation')
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Hi</h1>')
  })

  // --- Download button -------------------------------------------------------
  it('Download button triggers a real file download (click on an anchor)', async () => {
    act(() => {
      useWorkPanelStore.getState().openArtifact({
        type: 'code',
        title: 'hello.py',
        lang: 'python',
        content: 'print("hi")',
      })
    })
    renderPanel()
    await screen.findByTestId('work-panel-artifact')

    // Spy on the hidden download anchor's click
    const clickSpy = vi.fn()
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag)
      if (tag === 'a') {
        vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(clickSpy)
      }
      return el
    })

    const downloadBtn = screen.getByRole('button', { name: /download/i })
    fireEvent.click(downloadBtn)
    expect(clickSpy).toHaveBeenCalled()
  })

  // --- Close button ----------------------------------------------------------
  it('the close button calls the store close', () => {
    act(() => {
      useWorkPanelStore.getState().openArtifact({
        type: 'code',
        title: 'x.ts',
        lang: 'typescript',
        content: 'const x = 1',
      })
    })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /close work panel/i }))
    expect(useWorkPanelStore.getState().open).toBe(false)
  })

  // --- Copy button -----------------------------------------------------------
  it('the copy button writes content to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    act(() => {
      useWorkPanelStore.getState().openArtifact({
        type: 'code',
        title: 'app.ts',
        lang: 'typescript',
        content: 'const answer = 42',
      })
    })
    renderPanel()
    await screen.findByTestId('work-panel-artifact')
    // Use the panel-level copy button (data-testid) to avoid ambiguity with the
    // CodeBlock's own copy button rendered inside the panel.
    fireEvent.click(screen.getByTestId('work-panel-copy'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const answer = 42'))
  })
})
