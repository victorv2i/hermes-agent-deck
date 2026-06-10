/**
 * WorkPanel store — the singleton that drives the artifact canvas.
 *
 * The WorkPanel is the "Artifacts / Canvas" equivalent for Agent Deck: a docked
 * side panel that shows a REAL code/markdown/HTML artifact beside the
 * conversation. It reuses the same docked-side-panel real estate as the Preview
 * panel (two separate panels, separately toggled; the user sees the most
 * recently-opened one at any time).
 *
 * The store is intentionally simple: it holds the current artifact (if any),
 * whether the panel is open, and three actions: openArtifact, close, toggle.
 * All security rules apply: this is a READ-ONLY render surface. We never
 * execute user or agent code in the browser — we render / preview only.
 */
import { create } from 'zustand'

/** The three artifact types the panel can render. */
export type ArtifactType = 'code' | 'markdown' | 'html'

export interface Artifact {
  /** What kind of artifact this is — drives the render path. */
  type: ArtifactType
  /** The filename or title shown in the panel header. */
  title: string
  /** The raw content (code source, markdown source, or HTML source). */
  content: string
  /** For code artifacts: the language hint for the highlighter (optional). */
  lang?: string
}

export interface WorkPanelState {
  /** Whether the panel is currently open (visible). */
  open: boolean
  /** The artifact being displayed, or null when nothing has been opened yet. */
  artifact: Artifact | null

  /**
   * Open the panel with the given artifact. Replaces any existing artifact.
   * Always sets open=true.
   */
  openArtifact: (artifact: Omit<Artifact, never>) => void
  /** Close the panel. Keeps the artifact so re-opening returns to it. */
  close: () => void
  /** Toggle open/closed. If no artifact is set, opening shows the empty state. */
  toggle: () => void
}

export const useWorkPanelStore = create<WorkPanelState>((set) => ({
  open: false,
  artifact: null,

  openArtifact: (artifact) => set({ open: true, artifact }),
  close: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open })),
}))
