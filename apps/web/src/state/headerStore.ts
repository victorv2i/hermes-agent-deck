/**
 * Live-header slot — a tiny store that lets the ACTIVE route project content
 * (session title · model · context-usage ring) into the AppShell top bar.
 *
 * The design language (§4) calls for a "minimal sticky header (session title ·
 * model · context-usage ring)", but the shell only owned ConnectionDot +
 * ThemeToggle, so the live chat header read as empty. Rather than thread a node
 * through the Outlet context (which App already uses for the chat actions), a
 * one-field store lets any surface fill the slot declaratively via
 * {@link useHeaderSlot}; AppShell subscribes and renders it centered in the bar.
 * Default is empty, which is correct for surfaces that own their own header
 * (Files/Terminal/the centered content pages).
 */
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { create } from 'zustand'

interface HeaderSlotStore {
  /** The node the active route wants rendered in the shell header, or null. */
  content: ReactNode | null
  setContent: (content: ReactNode | null) => void
}

export const useHeaderStore = create<HeaderSlotStore>((set) => ({
  content: null,
  setContent: (content) => set({ content }),
}))

/** Read the current header slot content (AppShell consumes this). */
export function useHeaderContent(): ReactNode | null {
  return useHeaderStore((s) => s.content)
}

/**
 * Project `content` into the AppShell header for as long as the calling route is
 * mounted, clearing it on unmount so the next surface starts from empty. Pass
 * `null` to render nothing (the default). The effect re-runs whenever `content`
 * identity changes, so callers should memoize a non-trivial node.
 */
export function useHeaderSlot(content: ReactNode | null): void {
  const setContent = useHeaderStore((s) => s.setContent)
  useEffect(() => {
    setContent(content)
    return () => setContent(null)
  }, [content, setContent])
}
