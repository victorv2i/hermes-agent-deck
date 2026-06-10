import { describe, it, expect } from 'vitest'
import { parseHighlight, highlightTerms, humanizeSnippet } from './searchSnippet'

describe('parseHighlight', () => {
  it('splits a snippet into plain + matched segments (tags consumed)', () => {
    expect(parseHighlight('the <b>docker</b> build')).toEqual([
      { text: 'the ', match: false },
      { text: 'docker', match: true },
      { text: ' build', match: false },
    ])
  })

  it('returns a single plain segment when there are no markers', () => {
    expect(parseHighlight('no markers here')).toEqual([{ text: 'no markers here', match: false }])
  })

  it('handles multiple, adjacent, and case-variant matches', () => {
    expect(parseHighlight('<B>a</B><b>b</b> c')).toEqual([
      { text: 'a', match: true },
      { text: 'b', match: true },
      { text: ' c', match: false },
    ])
  })

  it('tolerates a stray/unbalanced tag without emitting it as text', () => {
    expect(parseHighlight('half <b>open')).toEqual([
      { text: 'half ', match: false },
      { text: 'open', match: true },
    ])
  })

  it('decodes HTML entities inside segments', () => {
    expect(parseHighlight('a &lt;tag&gt; &amp; <b>m&#39;atch</b>')).toEqual([
      { text: 'a <tag> & ', match: false },
      { text: "m'atch", match: true },
    ])
  })

  it('never emits empty segments', () => {
    expect(parseHighlight('<b></b>hi')).toEqual([{ text: 'hi', match: false }])
  })

  // The LIVE hermes dashboard wraps matches as `>>>term<<<` (triple-angle), NOT
  // `<b>…</b>`. The original tests only used `<b>` fixtures, so the production
  // markers fell through and rendered as literal `>>>…<<<` text in the rail.
  it('recognizes the live dashboard >>>…<<< markers', () => {
    expect(parseHighlight('the >>>docker<<< build')).toEqual([
      { text: 'the ', match: false },
      { text: 'docker', match: true },
      { text: ' build', match: false },
    ])
  })

  it('handles a real JSON-ish snippet with multiple >>>…<<< matches', () => {
    // Shape measured live against /api/sessions/search?q=hermes.
    expect(
      parseHighlight('from >>>hermes<<<_constants import get_default_>>>hermes<<<_root'),
    ).toEqual([
      { text: 'from ', match: false },
      { text: 'hermes', match: true },
      { text: '_constants import get_default_', match: false },
      { text: 'hermes', match: true },
      { text: '_root', match: false },
    ])
  })

  it('tolerates a stray/unbalanced >>> marker', () => {
    expect(parseHighlight('half >>>open')).toEqual([
      { text: 'half ', match: false },
      { text: 'open', match: true },
    ])
  })

  it('recognizes both marker forms within one snippet', () => {
    expect(parseHighlight('<b>a</b> and >>>b<<<')).toEqual([
      { text: 'a', match: true },
      { text: ' and ', match: false },
      { text: 'b', match: true },
    ])
  })
})

describe('highlightTerms', () => {
  it('extracts the matched terms', () => {
    expect(highlightTerms('the <b>parser</b> and the <b>lexer</b>')).toEqual(['parser', 'lexer'])
  })

  it('is empty when nothing is highlighted', () => {
    expect(highlightTerms('plain text')).toEqual([])
  })

  it('extracts terms from the live >>>…<<< marker form', () => {
    expect(highlightTerms('the >>>parser<<< and the >>>lexer<<<')).toEqual(['parser', 'lexer'])
  })
})

describe('humanizeSnippet', () => {
  it('leaves prose essentially untouched (whitespace collapsed)', () => {
    expect(humanizeSnippet('please   refactor the\nparser')).toBe('please refactor the parser')
  })

  it('preserves highlight markers in prose', () => {
    expect(humanizeSnippet('match the <b>parser</b> now')).toBe('match the <b>parser</b> now')
  })

  it('preserves the live >>>…<<< markers in prose', () => {
    expect(humanizeSnippet('match the >>>parser<<< now')).toBe('match the >>>parser<<< now')
  })

  it('keeps the live >>>…<<< marker when humanizing JSON', () => {
    const out = humanizeSnippet('{"command":"git >>>status<<<"}')
    expect(out).toContain('>>>status<<<')
  })

  it('caps length without splitting a >>>…<<< marker, closing an open one', () => {
    const out = humanizeSnippet(`x >>>${'y'.repeat(80)}<<<`, 20)
    const opens = (out.match(/>>>/g) ?? []).length
    const closes = (out.match(/<<</g) ?? []).length
    expect(opens).toBe(closes)
    // Visible length (markers stripped) stays within the cap.
    expect(out.replace(/>>>|<<</g, '').length).toBeLessThanOrEqual(20)
  })

  it('humanizes a raw-JSON tool-call fragment to readable values', () => {
    const out = humanizeSnippet('{"command":"git status","cwd":"/repo"}')
    expect(out).not.toContain('{')
    expect(out).not.toContain('"')
    expect(out).not.toContain('command":')
    expect(out).toContain('git status')
    expect(out).toContain('/repo')
  })

  it('keeps the highlight marker when humanizing JSON', () => {
    const out = humanizeSnippet('{"command":"git <b>status</b>"}')
    expect(out).toContain('<b>status</b>')
  })

  it('does not treat ordinary prose with braces as JSON', () => {
    expect(humanizeSnippet('use the {x} placeholder')).toBe('use the {x} placeholder')
  })

  it('caps length on the visible text and closes an open match tag', () => {
    const long = `start ${'a'.repeat(200)} <b>${'b'.repeat(50)}</b>`
    const out = humanizeSnippet(long, 40)
    // Visible length (tags stripped) stays within the cap.
    expect(out.replace(/<\/?b>/g, '').length).toBeLessThanOrEqual(40)
  })

  it('closes a match tag left open by the length cap', () => {
    const out = humanizeSnippet(`x <b>${'y'.repeat(80)}</b>`, 20)
    // Balanced: equal open/close tags so downstream parsing stays sane.
    const opens = (out.match(/<b>/g) ?? []).length
    const closes = (out.match(/<\/b>/g) ?? []).length
    expect(opens).toBe(closes)
  })
})
