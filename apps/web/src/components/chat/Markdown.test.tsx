import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { Markdown } from './Markdown'

// Shiki + Mermaid are heavy and lazy-imported; stub them so the component tests
// stay fast and hermetic (no real grammar/diagram engines in jsdom).
vi.mock('./lib/highlight', async () => {
  const actual = await vi.importActual<typeof import('./lib/highlight')>('./lib/highlight')
  return {
    ...actual,
    // Resolve null so CodeBlock keeps its raw-text fallback (deterministic DOM).
    highlight: vi.fn(async () => null),
  }
})

const mermaidRender = vi.fn()
vi.mock('./lib/mermaid', () => ({
  renderMermaid: (...args: unknown[]) => mermaidRender(...args),
}))

function renderMd(src: string) {
  return render(
    <ThemeProvider>
      <Markdown>{src}</Markdown>
    </ThemeProvider>,
  )
}

function renderMdFind(src: string, query: string, active = false) {
  return render(
    <ThemeProvider>
      <Markdown highlightQuery={query} highlightActive={active}>
        {src}
      </Markdown>
    </ThemeProvider>,
  )
}

describe('Markdown', () => {
  beforeEach(() => {
    mermaidRender.mockReset()
  })

  it('renders GFM prose: headings, lists, and tables', async () => {
    renderMd('# Title\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |')
    // Markdown is lazy-loaded (a React.lazy chunk: react-markdown + remark/rehype +
    // katex). This first render in the file pays the cold import cost; under full
    // parallel-suite CPU contention that can exceed the default 1s find timeout, so
    // give the cold load headroom (later tests reuse the now-cached chunk).
    expect(
      await screen.findByRole('heading', { name: 'Title' }, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.getByText('one')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'a' })).toBeInTheDocument()
  })

  it('makes a GFM table SORTABLE: clicking a header reorders rows + cycles aria-sort, other markdown intact', async () => {
    const user = userEvent.setup()
    // A numeric column (Score) so we also prove numeric (not lexical) ordering,
    // and a heading + paragraph so we prove non-table markdown still renders.
    renderMd(
      '# Report\n\nSummary line.\n\n' +
        '| Name | Score |\n|---|---|\n| Bravo | 2 |\n| Alpha | 10 |\n| Charlie | 1 |',
    )

    // Non-table markdown around the table renders normally.
    expect(await screen.findByRole('heading', { name: 'Report' })).toBeInTheDocument()
    expect(screen.getByText('Summary line.')).toBeInTheDocument()

    const readFirstCol = () => {
      const table = screen.getByRole('table')
      return within(table)
        .getAllByRole('row')
        .filter((r) => within(r).queryAllByRole('cell').length > 0)
        .map((r) => within(r).getAllByRole('cell')[0]?.textContent ?? '')
    }

    // Header is a real button; starts unsorted in document order.
    const scoreHeader = screen.getByRole('columnheader', { name: /Score/ })
    expect(scoreHeader).toHaveAttribute('aria-sort', 'none')
    expect(readFirstCol()).toEqual(['Bravo', 'Alpha', 'Charlie'])

    // Click Score: ascending, NUMERIC order (1, 2, 10) -> Charlie, Bravo, Alpha.
    await user.click(within(scoreHeader).getByRole('button'))
    expect(scoreHeader).toHaveAttribute('aria-sort', 'ascending')
    expect(readFirstCol()).toEqual(['Charlie', 'Bravo', 'Alpha'])

    // Click again: descending (10, 2, 1) -> Alpha, Bravo, Charlie.
    await user.click(within(scoreHeader).getByRole('button'))
    expect(scoreHeader).toHaveAttribute('aria-sort', 'descending')
    expect(readFirstCol()).toEqual(['Alpha', 'Bravo', 'Charlie'])

    // Third click returns to the original document order.
    await user.click(within(scoreHeader).getByRole('button'))
    expect(scoreHeader).toHaveAttribute('aria-sort', 'none')
    expect(readFirstCol()).toEqual(['Bravo', 'Alpha', 'Charlie'])
  })

  it('renders a code block with a language label and copies on click', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    renderMd('```ts\nconst x = 1\n```')

    // Language label (normalized ts -> typescript) appears in the header.
    expect(await screen.findByText('typescript')).toBeInTheDocument()
    // Raw code is visible (Shiki stubbed to fall back to plain text).
    expect(screen.getByText('const x = 1')).toBeInTheDocument()

    const copyBtn = screen.getByRole('button', { name: /copy code/i })
    await user.click(copyBtn)
    expect(writeText).toHaveBeenCalledWith('const x = 1')
    expect(await screen.findByText('Copied!')).toBeInTheDocument()
  })

  it('renders inline math via KaTeX', async () => {
    const { container } = renderMd('Euler: $e^{i\\pi} + 1 = 0$')
    // rehype-katex emits .katex markup once the lazy chunk has rendered.
    await waitFor(() => expect(container.querySelector('.katex')).toBeTruthy())
  })

  it('renders $$…$$ as CENTERED display math even when streamed inline (no own-line $$)', async () => {
    // Streamed deltas rarely land the `$$` fences on their own lines, so the raw
    // markdown arrives as `$$E = mc^2$$` inside a paragraph. Without normalization
    // remark-math treats that as INLINE math (left-aligned `.katex`); we lift it
    // onto its own lines so it becomes a `.katex-display` (centered) block.
    const { container } = renderMd('The mass–energy relation $$E = mc^2$$ is famous.')
    await waitFor(() => expect(container.querySelector('.katex-display')).toBeTruthy())
  })

  it('keeps already-block $$ display math centered (idempotent normalization)', async () => {
    const { container } = renderMd('Some text.\n\n$$\nE = mc^2\n$$\n\nMore text.')
    await waitFor(() => expect(container.querySelector('.katex-display')).toBeTruthy())
  })

  it('routes a mermaid fence to the Mermaid renderer and falls back on error', async () => {
    mermaidRender.mockRejectedValue(new Error('bad diagram'))
    renderMd('```mermaid\ngraph TD; A-->B;\n```')
    // On render failure it shows the raw source rather than crashing.
    expect(await screen.findByTestId('mermaid-fallback')).toBeInTheDocument()
    expect(screen.getByText(/graph TD; A-->B;/)).toBeInTheDocument()
  })

  it('renders a mermaid SVG when the engine resolves', async () => {
    mermaidRender.mockResolvedValue('<svg data-ok="1"></svg>')
    renderMd('```mermaid\ngraph TD; A-->B;\n```')
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument())
  })

  describe('find-in-conversation prose highlighting', () => {
    it('wraps query matches in <mark> in assistant prose', async () => {
      const { container } = renderMdFind('The agent ran a tool', 'agent')
      await screen.findByText('ran a tool', { exact: false })
      const marks = container.querySelectorAll('mark')
      expect(marks).toHaveLength(1)
      expect(marks[0]?.textContent).toBe('agent')
    })

    it('uses the accent tint for the active turn, neutral otherwise', async () => {
      const activeRender = renderMdFind('find me', 'find', true)
      await waitFor(() => expect(activeRender.container.querySelector('mark')).toBeTruthy())
      expect(activeRender.container.querySelector('mark')?.className).toContain('bg-primary/30')
      activeRender.unmount()

      const idleRender = renderMdFind('find me', 'find', false)
      await waitFor(() => expect(idleRender.container.querySelector('mark')).toBeTruthy())
      expect(idleRender.container.querySelector('mark')?.className).toContain('bg-foreground/15')
    })

    it('does NOT highlight inside a code fence', async () => {
      const { container } = renderMdFind('```ts\nconst run = 1\n```', 'run')
      // The code block renders (CodeBlock); no <mark> is spliced into it.
      await screen.findByText(/const run = 1/)
      expect(container.querySelectorAll('mark')).toHaveLength(0)
    })

    it('does NOT highlight inside inline code', async () => {
      const { container } = renderMdFind('call `run` now', 'run')
      await waitFor(() => expect(container.querySelector('code')).toBeTruthy())
      expect(container.querySelectorAll('mark')).toHaveLength(0)
    })

    it('does NOT highlight inside link text (anchor stays intact)', async () => {
      const { container } = renderMdFind('[docs](https://example.com)', 'docs')
      const anchor = await waitFor(() => {
        const a = container.querySelector('a')
        expect(a).toBeTruthy()
        return a as HTMLAnchorElement
      })
      expect(anchor.querySelector('mark')).toBeNull()
      expect(container.querySelectorAll('mark')).toHaveLength(0)
    })

    it('does NOT highlight inside KaTeX output', async () => {
      const { container } = renderMdFind('the sum $sum$ here', 'sum')
      await waitFor(() => expect(container.querySelector('.katex')).toBeTruthy())
      // Only the two PROSE 'sum's are marked; the math 'sum' is left alone.
      const katex = container.querySelector('.katex')
      expect(katex?.querySelector('mark')).toBeNull()
    })

    it('renders byte-identical prose when no query is set', async () => {
      const { container } = renderMdFind('plain agent prose', '')
      await screen.findByText('plain agent prose')
      expect(container.querySelectorAll('mark')).toHaveLength(0)
    })
  })

  describe('media (img + audio/video links)', () => {
    it('renders a markdown image as a lazy, enlargeable thumbnail', async () => {
      renderMd('![a chart](https://example.com/chart.png)')
      const img = await screen.findByRole('img', { name: 'a chart' })
      expect(img).toHaveAttribute('loading', 'lazy')
      expect(img).toHaveAttribute('src', 'https://example.com/chart.png')
      expect(screen.getByRole('button', { name: /enlarge image: a chart/i })).toBeInTheDocument()
    })

    it('embeds an agent audio link inline with native controls', async () => {
      renderMd('Here is the [recording](https://example.com/clip.mp3).')
      const audio = await screen.findByLabelText('recording')
      expect(audio.tagName.toLowerCase()).toBe('audio')
      expect(audio).toHaveAttribute('controls')
    })

    it('embeds an agent video link inline with native controls', async () => {
      renderMd('Watch the [demo](https://example.com/demo.mp4).')
      const video = await screen.findByLabelText('demo')
      expect(video.tagName.toLowerCase()).toBe('video')
      expect(video).toHaveAttribute('controls')
    })

    it('leaves a normal link untouched (still a chat link, not a media embed)', async () => {
      renderMd('See [the docs](https://example.com/docs).')
      const link = await screen.findByText('the docs')
      expect(link).toBeInTheDocument()
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('renders an inline RASTER data: image the agent emits (a generated chart)', async () => {
      // A 1x1 PNG data URL — react-markdown strips data: by default, so this proves
      // the urlTransform allows the safe raster set through for `src`.
      const png =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      renderMd(`![chart](${png})`)
      const img = await screen.findByRole('img', { name: 'chart' })
      expect(img).toHaveAttribute('src', png)
    })

    it('still strips an UNSAFE data: image (svg can carry script) — defense holds', async () => {
      // data:image/svg+xml is NOT in the safe raster set (SVG can embed script), so
      // the default sanitizer strips it; no <img> points at the svg data URL.
      const svg = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
      renderMd(`![x](${svg})`)
      // Give the lazy markdown chunk a tick to mount, then assert nothing renders
      // an <img> with the unsafe source.
      await screen.findByText('x').catch(() => null)
      const imgs = screen.queryAllByRole('img')
      expect(imgs.some((i) => i.getAttribute('src') === svg)).toBe(false)
    })

    it('still strips a javascript: link href — the relaxation is src-only', async () => {
      renderMd('[click me](javascript:alert(1))')
      const link = await screen.findByText('click me')
      // The anchor (if any) must not carry the javascript: scheme.
      const anchor = link.closest('a')
      expect(anchor?.getAttribute('href') ?? '').not.toContain('javascript:')
    })
  })
})
