/**
 * The platform modifier key — the single source of truth for how the app spells
 * the command/control accelerator in UI (NOT in the key handlers, which already
 * accept both metaKey and ctrlKey). On Apple platforms this is the ⌘ glyph; on
 * Linux + Windows it is the word "Ctrl". Both the ⌘K command palette
 * (CommandPalette) and the `?` shortcuts overlay (ShortcutsOverlay) read from
 * here so a Linux user never sees a Mac-only ⌘ they can't press, and they never
 * disagree about which key it is.
 */

/** True on Apple platforms (Mac / iPhone / iPad), guarded for SSR/tests. */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  // `navigator.platform` is the reliable signal where present; fall back to the
  // UA string for environments that have deprecated it.
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
}

/** The displayed modifier glyph/word: "⌘" on Apple platforms, else "Ctrl". */
export function platformModKey(): string {
  return isMac() ? '⌘' : 'Ctrl'
}

/**
 * Hook form for components that want the modifier key during render. It's a pure
 * read of a stable per-device value, so it needs no state/effect — a thin
 * wrapper kept for call-site readability and so a future reactive source (e.g.
 * an env override) has one place to change.
 */
export function usePlatformModKey(): string {
  return platformModKey()
}
