import { describe, it, expect } from 'vitest'
import { sanitizeSessionPreview } from './sessionPreview'

describe('sanitizeSessionPreview — strips injected-prompt preambles from titles/previews', () => {
  it('turns a TRUNCATED skill-invocation preamble (unclosed bracket) into a human label', () => {
    // Real string from the audit: the preview is cut mid-preamble, so there is no
    // closing bracket and no user text to fall back to.
    expect(
      sanitizeSessionPreview(
        '[IMPORTANT: The user has invoked the "outlook-email" skill, and you must follow its ins',
      ),
    ).toBe('Ran the outlook-email skill')
  })

  it('prefers the REAL user text after a closed preamble over the skill label', () => {
    expect(
      sanitizeSessionPreview(
        '[IMPORTANT: The user has invoked the "outlook-email" skill] Reply to the budget thread',
      ),
    ).toBe('Reply to the budget thread')
  })

  it('handles a single-quoted skill name', () => {
    expect(
      sanitizeSessionPreview("[IMPORTANT: The user has invoked the 'daily-brief' skill, follo"),
    ).toBe('Ran the daily-brief skill')
  })

  it('handles curly-quoted skill names (double and single)', () => {
    expect(
      sanitizeSessionPreview('[IMPORTANT: The user has invoked the “daily-brief” skill, follo'),
    ).toBe('Ran the daily-brief skill')
    expect(
      sanitizeSessionPreview('[IMPORTANT: The user has invoked the ‘daily-brief’ skill, follo'),
    ).toBe('Ran the daily-brief skill')
  })

  it('returns empty for a preamble that names no skill and leaves no user text', () => {
    expect(sanitizeSessionPreview('[IMPORTANT: Always respond in markdown]')).toBe('')
    expect(sanitizeSessionPreview('[IMPORTANT: The user has provided additional cont')).toBe('')
  })

  it('passes a normal preview through unchanged (the cron image-gen line is real user text)', () => {
    const cron = 'Use your image generation tool (gpt-image-2) to create this week’s banner'
    expect(sanitizeSessionPreview(cron)).toBe(cron)
    expect(sanitizeSessionPreview('Let us map out the week ahead')).toBe(
      'Let us map out the week ahead',
    )
  })

  it('collapses newlines and runs of whitespace', () => {
    expect(sanitizeSessionPreview('  draft the\n\nrelease   notes ')).toBe(
      'draft the release notes',
    )
  })

  it('collapses whitespace inside a preamble before matching the skill pattern', () => {
    expect(
      sanitizeSessionPreview('[IMPORTANT:\nThe user has invoked\nthe "outlook-email" skill'),
    ).toBe('Ran the outlook-email skill')
  })

  it('leaves non-preamble brackets alone (markdown links, [sic], lowercase tags)', () => {
    expect(sanitizeSessionPreview('[link](https://example.com) check this out')).toBe(
      '[link](https://example.com) check this out',
    )
    expect(sanitizeSessionPreview('[sic] the original wording')).toBe('[sic] the original wording')
  })

  it('returns empty for null, undefined, and blank input', () => {
    expect(sanitizeSessionPreview(null)).toBe('')
    expect(sanitizeSessionPreview(undefined)).toBe('')
    expect(sanitizeSessionPreview('   ')).toBe('')
  })
})
