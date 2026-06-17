import { describe, it, expect, afterEach } from 'vitest'
import { buildTerminalTheme } from './terminalTheme'

afterEach(() => {
  document.documentElement.style.cssText = ''
})

describe('buildTerminalTheme', () => {
  it('reads live CSS variables for the core colors', () => {
    const root = document.documentElement.style
    // The viewport sits on surface-1 (lifted from base) so it reads as a designed
    // panel; the rest of the palette comes from the live tokens.
    root.setProperty('--surface-1', '#1a2333')
    root.setProperty('--foreground', '#e9eef6')
    root.setProperty('--primary', '#6fb1ea')
    root.setProperty('--warning', '#e3b45a')
    root.setProperty('--success', '#56bd9c')
    root.setProperty('--destructive', '#e8736d')

    const theme = buildTerminalTheme()
    expect(theme.background).toBe('#1a2333') // surface-1, an elevated viewport
    expect(theme.foreground).toBe('#e9eef6')
    expect(theme.cursor).toBe('#6fb1ea') // sky-blue caret
    expect(theme.yellow).toBe('#e3b45a') // ANSI yellow tracks --warning (not --primary)
    expect(theme.green).toBe('#56bd9c')
    expect(theme.red).toBe('#e8736d')
  })

  it('falls back to sky-blue dark defaults when variables are absent', () => {
    const theme = buildTerminalTheme()
    expect(theme.background).toBe('#1a2333') // surface-1 fallback
    expect(theme.foreground).toBe('#e9eef6')
    expect(theme.cursor).toBe('#6fb1ea')
  })

  it('uses a sky-blue selection built from --primary', () => {
    // No vars set → primary falls back to #6fb1ea → rgba(111, 177, 234, 0.3).
    expect(buildTerminalTheme().selectionBackground).toMatch(/111, 177, 234/)
  })
})
