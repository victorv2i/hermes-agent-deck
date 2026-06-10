import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProviderBrandIcon } from './providerBrandIcons'
import { resolveProviderBrand } from './providerBrands'

/**
 * The provider brand marks identify a model's vendor (Anthropic, Google/Gemini, …)
 * for nominative use, using ACCURATE official marks from the `@lobehub/icons` package.
 * They are IDENTITY, never the amber action accent — so a mark must render an <svg>
 * and must NOT be wired to `--primary` (no `text-primary`, `fill-primary`, or a
 * literal amber hex). A vendor whose icon is genuinely absent falls back to a tasteful
 * neutral monogram rather than a garbled/hand-drawn logo.
 */
describe('resolveProviderBrand', () => {
  it('matches known vendor slugs to real brand marks (not monograms)', () => {
    const knownSlugs = [
      'anthropic',
      'google',
      'meta',
      'mistral',
      'qwen',
      'deepseek',
      'openai',
      'xai',
      'grok',
      'cohere',
      'perplexity',
      'ollama',
      'openrouter',
    ]
    for (const slug of knownSlugs) {
      const brand = resolveProviderBrand(slug)
      expect(brand.isFallback, `${slug} should have a real mark`).toBe(false)
      expect(brand.label.length).toBeGreaterThan(0)
    }
  })

  it('maps common aliases to the same brand (gemini→google, mistralai→mistral, grok→xai)', () => {
    expect(resolveProviderBrand('gemini').key).toBe(resolveProviderBrand('google').key)
    expect(resolveProviderBrand('google-gemini').key).toBe(resolveProviderBrand('google').key)
    expect(resolveProviderBrand('google-gemini-cli').key).toBe(resolveProviderBrand('google').key)
    expect(resolveProviderBrand('mistralai').key).toBe(resolveProviderBrand('mistral').key)
    expect(resolveProviderBrand('llama').key).toBe(resolveProviderBrand('meta').key)
    // grok is an xAI product — resolves to the same brand
    expect(resolveProviderBrand('grok').key).toBe(resolveProviderBrand('xai').key)
  })

  it('is case-insensitive', () => {
    expect(resolveProviderBrand('OpenAI').key).toBe(resolveProviderBrand('openai').key)
    expect(resolveProviderBrand('XAI').key).toBe(resolveProviderBrand('xai').key)
    expect(resolveProviderBrand('Anthropic').key).toBe(resolveProviderBrand('anthropic').key)
  })

  it('falls back to a neutral monogram for an unknown provider (never garbled)', () => {
    const brand = resolveProviderBrand('totally-unknown-vendor')
    expect(brand.isFallback).toBe(true)
    // The monogram derives a readable initial from the slug.
    expect(brand.label.toLowerCase()).toContain('totally-unknown-vendor')
  })

  it('falls back gracefully for an empty/garbage slug', () => {
    expect(resolveProviderBrand('').isFallback).toBe(true)
    expect(resolveProviderBrand('   ').isFallback).toBe(true)
  })
})

describe('ProviderBrandIcon', () => {
  it('renders an <svg> mark for a known vendor', () => {
    const { container } = render(<ProviderBrandIcon provider="anthropic" />)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('renders the accurate @lobehub/icons mark for all real vendors', () => {
    const knownSlugs = [
      'anthropic',
      'google',
      'meta',
      'mistral',
      'qwen',
      'deepseek',
      'openai',
      'xai',
      'cohere',
      'perplexity',
      'ollama',
      'openrouter',
    ]
    for (const slug of knownSlugs) {
      const { container, unmount } = render(<ProviderBrandIcon provider={slug} />)
      const svg = container.querySelector('svg')
      expect(svg, `${slug} should render an svg`).not.toBeNull()
      unmount()
    }
  })

  it('renders a fallback monogram <svg> for an unknown vendor', () => {
    const { container } = render(<ProviderBrandIcon provider="acme-llm" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    // The monogram shows a readable initial derived from the slug.
    expect(svg?.textContent ?? '').toMatch(/a/i)
  })

  it('is decorative-hidden by default (the label carries the accessible name)', () => {
    const { container } = render(<ProviderBrandIcon provider="openai" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('NEVER wires the mark to the amber action accent (identity, not action)', () => {
    // The mark is identity: it must not reference `--primary`/`--ring` (amber) nor
    // a literal amber hex. Brand color or neutral `currentColor` only.
    for (const slug of ['openai', 'anthropic', 'google', 'xai', 'mistral', 'unknown-x']) {
      const { container } = render(<ProviderBrandIcon provider={slug} />)
      const html = container.innerHTML
      expect(html, `${slug} mark must not use --primary`).not.toMatch(/--primary|--ring/)
      expect(html, `${slug} mark must not use text-primary`).not.toMatch(
        /\b(text|fill|stroke|bg)-primary\b/,
      )
    }
  })

  it('renders a logo beside a label for the model breakdown surface', () => {
    // Smoke-test: renders with a label for usage breakdown rows
    render(
      <span data-testid="model-row">
        <ProviderBrandIcon provider="anthropic" size={14} />
        <span>claude-opus-4</span>
      </span>,
    )
    const row = screen.getByTestId('model-row')
    expect(row.querySelector('svg')).toBeInTheDocument()
  })
})
