import { describe, it, expect } from 'vitest'
import { Folder } from 'lucide-react'
import { glyphFor } from './fileIcons'

describe('glyphFor', () => {
  it('uses a calm neutral folder glyph for directories (never the accent)', () => {
    const { Icon, colorClass } = glyphFor({ type: 'dir', name: 'src' })
    expect(Icon).toBe(Folder)
    expect(colorClass).toBe('text-muted-foreground')
    // The `--primary` accent is reserved for the active row, not the icon kind.
    expect(colorClass).not.toContain('primary')
  })

  it('groups files by kind: code/docs read as calm neutrals, data + media pop', () => {
    const code = glyphFor({ type: 'file', name: 'app.ts' }).colorClass
    const data = glyphFor({ type: 'file', name: 'config.json' }).colorClass
    const docs = glyphFor({ type: 'file', name: 'README.md' }).colorClass
    const media = glyphFor({ type: 'file', name: 'logo.png' }).colorClass

    // Code reads as a calm neutral at label brightness — a quiet kind-marker, never
    // the loud full `--foreground` that would out-shout the filename beside it.
    expect(code).toBe('text-muted-foreground')
    expect(code).not.toBe('text-foreground')
    // Data + media are the two tints that pop so they stand out in a working dir.
    expect(data).toBe('text-success')
    expect(media).toBe('text-warning')
    expect(docs).toBe('text-muted-foreground')
    // No kind tint is the reserved action accent...
    for (const c of [code, data, docs, media]) expect(c).not.toContain('primary')
    // ...and code is NOT a near-primary blue (`text-info` ≈ `--primary` in the
    // default Clay&Sky theme, which read as a "selected" row).
    expect(code).not.toBe('text-info')
    // The pop tints are distinct from the calm neutral, so the list is never a
    // uniform wall of one hue.
    expect(new Set([code, data, media]).size).toBe(3)
  })

  it('falls back to a generic, quiet glyph for unknown extensions', () => {
    const { colorClass } = glyphFor({ type: 'file', name: 'mystery.zzz' })
    expect(colorClass).toBe('text-foreground-tertiary')
  })

  it('uses a lock glyph for suppressed (secret) entries', () => {
    const { Icon } = glyphFor({ type: 'file', name: '.env', suppressed: true })
    // The lock glyph differs from the plain-file glyph.
    expect(Icon).not.toBe(glyphFor({ type: 'file', name: '.env' }).Icon)
  })
})
