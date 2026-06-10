import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CodeView } from './CodeView'

// Keep the test hermetic + synchronous: stub the shared Shiki highlighter (it
// lazy-loads WASM) so CodeView renders its raw <pre> fallback. The gutter is
// rendered regardless of highlight state, which is what we assert here.
vi.mock('@/components/chat/lib/highlight', () => ({
  highlight: vi.fn(async () => null),
}))
vi.mock('@/components/theme/theme-context', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' as const }),
}))

describe('CodeView', () => {
  it('renders a line-number gutter, one number per source line', () => {
    render(<CodeView code={'const a = 1\nconst b = 2\nconst c = 3'} lang="ts" />)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    // No phantom 4th line for a 3-line file.
    expect(screen.queryByText('4')).not.toBeInTheDocument()
  })

  it('does not number a trailing empty line', () => {
    render(<CodeView code={'only one line\n'} lang="text" />)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('2')).not.toBeInTheDocument()
  })

  it('shows the raw code as a fallback before/without highlight', () => {
    render(<CodeView code={'hello world'} lang="text" />)
    expect(screen.getByText('hello world')).toBeInTheDocument()
  })
})
