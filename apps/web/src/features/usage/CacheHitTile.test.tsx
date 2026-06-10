import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CacheHitTile } from './CacheHitTile'

describe('CacheHitTile', () => {
  it('renders the cache-hit percentage from cache-read vs input tokens', () => {
    // 800 cached / (800 + 200) = 80%.
    render(<CacheHitTile cacheReadTokens={800} inputTokens={200} />)
    // The visible label is the short single-line "Hit rate"; the fuller "cache
    // hit rate" wording lives in the info explainer.
    expect(screen.getByText('Hit rate')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
    // The sub line carries the honest token basis.
    expect(screen.getByText(/800 cached/i)).toBeInTheDocument()
  })

  it('shows the honest "—" empty state when there is no prompt-side usage', () => {
    render(<CacheHitTile cacheReadTokens={0} inputTokens={0} />)
    expect(screen.getByText('—')).toBeInTheDocument()
    // No misleading "0%" in the empty case.
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(screen.getByText(/no cached usage yet/i)).toBeInTheDocument()
  })

  it('shows a real 0% (not "—") when input exists but nothing was a hit', () => {
    render(<CacheHitTile cacheReadTokens={0} inputTokens={5000} />)
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('exposes a keyboard-reachable info affordance explaining the formula', () => {
    render(<CacheHitTile cacheReadTokens={800} inputTokens={200} />)
    const info = screen.getByRole('button', { name: /about hit rate: cache hit rate/i })
    expect(info).toBeInTheDocument()
    expect(info).toHaveAttribute('title', expect.stringMatching(/cache.?read/i))
  })
})
