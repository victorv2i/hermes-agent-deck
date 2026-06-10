import { describe, it, expect } from 'vitest'
import { isSubscriptionProvider } from './subscriptionProviders'

describe('isSubscriptionProvider', () => {
  it('treats openai-codex (ChatGPT/Codex OAuth seat) as a subscription', () => {
    expect(isSubscriptionProvider('openai-codex')).toBe(true)
  })

  it('treats GitHub Copilot as a subscription seat', () => {
    expect(isSubscriptionProvider('copilot')).toBe(true)
  })

  it('matches case-insensitively and on slug variants that contain a known plan', () => {
    expect(isSubscriptionProvider('OpenAI-Codex')).toBe(true)
    expect(isSubscriptionProvider('claude-max-2026')).toBe(true)
  })

  it('returns false for a metered, key-based provider (so cost inference wins)', () => {
    expect(isSubscriptionProvider('openrouter')).toBe(false)
    expect(isSubscriptionProvider('anthropic')).toBe(false)
    expect(isSubscriptionProvider('openai')).toBe(false)
  })

  it('returns false for empty / missing input', () => {
    expect(isSubscriptionProvider('')).toBe(false)
    expect(isSubscriptionProvider('   ')).toBe(false)
    expect(isSubscriptionProvider(null)).toBe(false)
    expect(isSubscriptionProvider(undefined)).toBe(false)
  })
})
