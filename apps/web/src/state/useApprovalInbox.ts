/**
 * Cross-device approval inbox — the client mirror of the BFF's namespace-wide
 * `approval.pending` / `approval.cleared` broadcasts.
 *
 * The per-run chat stream only tells THIS device about approvals for the run it
 * is tailing. The inbox holds approvals raised by runs this device is NOT tailing
 * (a run you started on another device, or a cron/telegram run) so any open
 * device can notify you and badge them instantly — no slow poll. Entries are
 * keyed by run id; the socket fills it (`useChatRun`), notifications + the badge
 * read it.
 */
import { create } from 'zustand'

export interface ApprovalInboxEntry {
  runId: string
  sessionId?: string
  command?: string
  description?: string
  /** When this device first learned of the gate (ms epoch), for stable ordering. */
  at: number
}

interface ApprovalInboxState {
  /** Pending cross-device approvals, keyed by run id. */
  pending: Record<string, ApprovalInboxEntry>
  /** Record a newly-broadcast pending approval (idempotent per run id — a repeat
   * broadcast for an already-known run leaves the existing entry untouched). */
  markPending(entry: Omit<ApprovalInboxEntry, 'at'> & { at?: number }): void
  /** Remove a run's entry once its gate resolved or its run ended (idempotent). */
  clear(runId: string): void
  /** Drop everything (used on full reset / tests). */
  reset(): void
}

/** Wall clock, isolated so tests can keep ordering deterministic if needed. */
function nowMs(): number {
  return Date.now()
}

export const useApprovalInbox = create<ApprovalInboxState>((set) => ({
  pending: {},
  markPending: (entry) =>
    set((s) => {
      if (s.pending[entry.runId]) return s
      return {
        pending: { ...s.pending, [entry.runId]: { ...entry, at: entry.at ?? nowMs() } },
      }
    }),
  clear: (runId) =>
    set((s) => {
      if (!s.pending[runId]) return s
      const next = { ...s.pending }
      delete next[runId]
      return { pending: next }
    }),
  reset: () => set({ pending: {} }),
}))

/** Pending entries as a stable list, oldest first — for a badge / list view. */
export function selectPendingApprovals(state: ApprovalInboxState): ApprovalInboxEntry[] {
  return Object.values(state.pending).sort((a, b) => a.at - b.at)
}
