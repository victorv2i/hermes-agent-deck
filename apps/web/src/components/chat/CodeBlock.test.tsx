/**
 * CodeBlock unit tests — filename header parsing + open-in-panel affordance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { CodeBlock } from './CodeBlock'
import { useWorkPanelStore } from '@/features/work-panel/workPanelStore'

// Stub Shiki so tests run fast.
vi.mock('./lib/highlight', async () => {
  const actual = await vi.importActual<typeof import('./lib/highlight')>('./lib/highlight')
  return { ...actual, highlight: vi.fn(async () => null) }
})

function resetStore() {
  useWorkPanelStore.setState({ open: false, artifact: null })
}

function renderBlock(props: { code: string; lang?: string; filename?: string }) {
  return render(
    <ThemeProvider>
      <CodeBlock {...props} />
    </ThemeProvider>,
  )
}

describe('CodeBlock — filename label', () => {
  it('shows the language label when no filename is given', () => {
    renderBlock({ code: 'const x = 1', lang: 'typescript' })
    expect(screen.getByText('typescript')).toBeInTheDocument()
  })

  it('shows the filename when filename prop is supplied (not just the lang)', () => {
    renderBlock({ code: 'const x = 1', lang: 'typescript', filename: 'src/index.ts' })
    expect(screen.getByText('src/index.ts')).toBeInTheDocument()
    // The bare language label must NOT appear as well (filename replaces it)
    expect(screen.queryByText('typescript')).not.toBeInTheDocument()
  })

  it('falls back to lang label when filename is an empty string', () => {
    renderBlock({ code: 'const x = 1', lang: 'typescript', filename: '' })
    expect(screen.getByText('typescript')).toBeInTheDocument()
  })

  it('shows "text" when neither lang nor filename is provided', () => {
    renderBlock({ code: 'hello' })
    expect(screen.getByText('text')).toBeInTheDocument()
  })
})

describe('CodeBlock — open-in-panel affordance', () => {
  beforeEach(resetStore)
  afterEach(() => vi.restoreAllMocks())

  it('renders an "Open in panel" button', () => {
    renderBlock({ code: 'const x = 1', lang: 'typescript' })
    expect(screen.getByRole('button', { name: /open in panel/i })).toBeInTheDocument()
  })

  it('clicking Open in panel opens the WorkPanel with the artifact', async () => {
    renderBlock({ code: 'const x = 1', lang: 'typescript', filename: 'src/index.ts' })
    fireEvent.click(screen.getByRole('button', { name: /open in panel/i }))
    await waitFor(() => {
      const s = useWorkPanelStore.getState()
      expect(s.open).toBe(true)
      expect(s.artifact?.content).toBe('const x = 1')
      expect(s.artifact?.title).toBe('src/index.ts')
      expect(s.artifact?.type).toBe('code')
    })
  })

  it('uses the lang as title when no filename is given', async () => {
    renderBlock({ code: 'print("hi")', lang: 'python' })
    fireEvent.click(screen.getByRole('button', { name: /open in panel/i }))
    await waitFor(() => {
      const s = useWorkPanelStore.getState()
      expect(s.artifact?.title).toBe('python')
    })
  })

  it('auto-opens the panel for sizeable code (>= 8 lines) on render', async () => {
    const bigCode = Array.from({ length: 10 }, (_, i) => `const x${i} = ${i}`).join('\n')
    act(() => {
      renderBlock({ code: bigCode, lang: 'typescript', filename: 'big.ts' })
    })
    // We give a tick for the auto-open effect
    await waitFor(() => {
      const s = useWorkPanelStore.getState()
      expect(s.open).toBe(true)
    })
  })
})

describe('CodeBlock — copy button', () => {
  it('copy button writes code to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    renderBlock({ code: 'export default 42', lang: 'typescript' })
    fireEvent.click(screen.getByRole('button', { name: /copy code/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('export default 42'))
  })
})
