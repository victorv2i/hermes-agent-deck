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
    root.setProperty('--surface-1', '#07211f')
    root.setProperty('--foreground', '#f2ebdd')
    root.setProperty('--primary', '#dd8e35')
    root.setProperty('--success', '#3fb7a0')
    root.setProperty('--destructive', '#e5604d')

    const theme = buildTerminalTheme()
    expect(theme.background).toBe('#07211f') // surface-1, an elevated viewport
    expect(theme.foreground).toBe('#f2ebdd')
    expect(theme.cursor).toBe('#dd8e35') // amber caret
    expect(theme.yellow).toBe('#dd8e35') // amber-leaning yellow
    expect(theme.green).toBe('#3fb7a0') // teal-glow green
    expect(theme.red).toBe('#e5604d')
  })

  it('falls back to warm-void dark defaults when variables are absent', () => {
    const theme = buildTerminalTheme()
    expect(theme.background).toBe('#07211F') // surface-1 fallback
    expect(theme.foreground).toBe('#F2EBDD')
    expect(theme.cursor).toBe('#DD8E35')
  })

  it('uses an amber-tinted selection consistent with the app', () => {
    expect(buildTerminalTheme().selectionBackground).toMatch(/221, 142, 53/)
  })
})
