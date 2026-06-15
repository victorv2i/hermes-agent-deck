import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, SquarePen, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CHAT_PATH } from '@/app/navigation'
import { toast } from '@/lib/toast'
import { useSessionStats, usePruneSessions } from './hooks'
import { SessionList } from './SessionList'

/**
 * The History surface — a full-page HOME for past conversations, mounted at
 * `/history`. Now that the rail is nav-only (the embedded session list moved
 * out), past chats need an obvious destination beyond Home + ⌘K; this is it. It
 * REUSES the full {@link SessionList} experience (search, date groups, Recent,
 * projects, pin/delete) verbatim — the same component the split-rail sessions
 * pane uses — so there is one session browser, not two.
 *
 * Like a chat client's conversation list, "New chat" sits at the TOP (start a new
 * one above your recent ones). §1 — selecting a row RESUMES the conversation in
 * place (→ `/chat?continue=<id>`, reusing the existing seed in App), so a past
 * chat is one click from typing again; the read-only transcript (`/sessions/:id`)
 * is DEMOTED to a secondary "View transcript (read-only)" overflow action.
 *
 * The "Prune old sessions" maintenance action (GET /api/sessions/stats +
 * POST /api/sessions/prune) lives here — it affects the whole session store,
 * not a single row. Stats load eagerly so the confirm dialog can name the count
 * of sessions that will be removed.
 */
export function HistoryRoute() {
  const navigate = useNavigate()
  const [pruneOpen, setPruneOpen] = useState(false)
  // How many days old to prune. 90 is the stock default.
  const [pruneDays, setPruneDays] = useState(90)

  const statsQuery = useSessionStats()
  const pruneMutation = usePruneSessions()

  const stats = statsQuery.data

  function handlePruneConfirm() {
    pruneMutation.mutate(
      { older_than_days: pruneDays },
      {
        onSuccess: (res) => {
          setPruneOpen(false)
          toast.success(`Pruned ${res.removed} session${res.removed === 1 ? '' : 's'}`)
        },
        onError: () => {
          toast.error('Prune failed', { description: "Couldn't prune sessions. Try again." })
        },
      },
    )
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[920px] flex-col gap-6 py-8">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold text-foreground">History</h1>
          {stats && typeof stats.total === 'number' && (
            <span className="text-[12px] text-foreground-tertiary">
              {stats.total.toLocaleString()} session{stats.total === 1 ? '' : 's'}
              {stats.archived > 0 && ` · ${stats.archived} archived`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* before:-inset-y-2 stretches each sm (28px) control's hit area to
              44px without changing its visual size (the StatCard technique). */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPruneOpen(true)}
            className="relative gap-1.5 text-foreground-tertiary before:absolute before:inset-x-0 before:-inset-y-2 before:content-[''] hover:text-foreground"
            title="Remove old ended sessions to free space"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Prune old
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(CHAT_PATH)}
            // "New chat" is the page's KEY action → the sanctioned faint-amber
            // action affordance (amber border + tint + amber glyph).
            className="relative gap-2 border-primary/25 bg-primary/10 text-primary before:absolute before:inset-x-0 before:-inset-y-2 before:content-[''] hover:bg-primary/15 hover:text-primary"
          >
            <SquarePen className="size-4 text-primary" aria-hidden />
            New chat
          </Button>
        </div>
      </div>

      {/* The full session browser — Recent floated above the date groups so the
          latest conversations are one glance away, projects + tags + pin/delete
          all live here. §1 — a row click RESUMES (→ /chat?continue=); the
          read-only transcript is the row overflow's secondary action. */}
      <div className="min-h-0 flex-1">
        <SessionList
          selectedId={null}
          onSelect={(sid) => navigate(`${CHAT_PATH}?continue=${encodeURIComponent(sid)}`)}
          onViewTranscript={(sid) => navigate(`/sessions/${sid}`)}
          recentLimit={5}
          enableBulkOps
        />
      </div>

      {/* Prune confirm dialog — shows how many sessions total so the user can
          judge scope before committing. The count is the overall session total;
          the actual prune removes ended sessions older than pruneDays, which may
          be fewer. Honest: no exact "will remove N" preview (that would require
          a separate dry-run call; the actual count comes back in the response). */}
      <PruneSessionsDialog
        open={pruneOpen}
        totalSessions={stats?.total ?? null}
        days={pruneDays}
        onDaysChange={setPruneDays}
        busy={pruneMutation.isPending}
        onConfirm={handlePruneConfirm}
        onCancel={() => {
          if (!pruneMutation.isPending) {
            setPruneOpen(false)
            pruneMutation.reset()
          }
        }}
      />
    </div>
  )
}

/**
 * Prune confirm dialog. Shows the current session total + lets the user pick
 * the age threshold. Cancel-default: Cancel is auto-focused so accidental Enter
 * never prunes. The dialog names the action honestly — "ended sessions older
 * than N days" — rather than implying it removes all sessions.
 */
function PruneSessionsDialog({
  open,
  totalSessions,
  days,
  onDaysChange,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean
  totalSessions: number | null
  days: number
  onDaysChange: (days: number) => void
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel()
      }}
    >
      <DialogContent className="max-w-sm" showClose={!busy}>
        <DialogHeader>
          <DialogTitle>Prune old sessions?</DialogTitle>
          <DialogDescription>
            This permanently deletes ended sessions older than the age you choose.
            {typeof totalSessions === 'number' && (
              <>
                {' '}
                You currently have {totalSessions.toLocaleString()} session
                {totalSessions === 1 ? '' : 's'} total; only ended ones older than the threshold are
                removed.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="prune-days" className="text-foreground-tertiary">
            Remove sessions older than
          </label>
          <select
            id="prune-days"
            value={days}
            onChange={(e) => onDaysChange(Number(e.target.value))}
            disabled={busy}
            className="rounded-md border border-border bg-surface-2 px-2 py-1 text-13 text-foreground focus-visible:ad-focus"
          >
            {[7, 14, 30, 60, 90, 180, 365].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 className="animate-spin motion-reduce:animate-none" />}
            Prune
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
