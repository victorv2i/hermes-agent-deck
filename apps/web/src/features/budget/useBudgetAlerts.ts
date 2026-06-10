/**
 * useBudgetAlerts — the headless budget watcher.
 *
 * On each usage poll it compares spend against the user's soft caps and, on a
 * fresh breach, raises ONE calm `toast.warning` with a "Go to Usage" action. It
 * is honest in copy (it warns; it does not stop the agent) and NON-BLOCKING.
 *
 * Dedup: a session-scoped `seen` latch (a ref, see budgetAlert.ts for the key
 * scheme) guarantees one toast per breach — a 60s poll won't re-toast every
 * minute, but raising the cap or a new day/month re-arms it.
 *
 * Cheap by default: with no budget set there's nothing to check, so the whole
 * watcher early-returns. Mounted once near the app root; renders nothing.
 */
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/lib/toast'
import { formatCost } from '@/lib/format'
import { useUsage } from '@/features/usage/useUsage'
import { BURN_RATE_POLL_MS } from '@/features/usage/LiveBurnRate'
import { useBudget, hasBudget } from './budgetStore'
import {
  detectBreaches,
  pickUnwarnedBreaches,
  usageWindowDays,
  type BudgetBreach,
} from './budgetAlert'

function breachMessage(b: BudgetBreach): string {
  const spend = formatCost(b.spend) ?? `$${b.spend.toFixed(2)}`
  const cap = formatCost(b.cap) ?? `$${b.cap.toFixed(2)}`
  return b.period === 'daily'
    ? `You've hit your daily budget: ${spend} today (cap ${cap})`
    : `You've hit your monthly budget: ${spend} this month (cap ${cap})`
}

export function useBudgetAlerts(): null {
  const { budget } = useBudget()
  const navigate = useNavigate()
  // Fetch a window wide enough to cover the active caps: a monthly cap needs the
  // whole month (month-to-date), a daily-only / unset budget needs just today. A
  // 1-day window would leave a monthly cap blind to every day but today. The
  // days=1 case shares react-query's cache with the header burn pill, so it's a
  // single fetch, not a second poll.
  const { data } = useUsage(usageWindowDays(budget), { refetchInterval: BURN_RATE_POLL_MS })

  // Session-scoped dedup latch — survives re-renders, resets on reload.
  const seenRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!data || !hasBudget(budget)) return
    const breaches = detectBreaches(data.daily, budget)
    const fresh = pickUnwarnedBreaches(breaches, seenRef.current)
    for (const b of fresh) {
      toast.warning(breachMessage(b), {
        description: 'agent-deck warns you; it can’t stop a CLI, Telegram, or scheduled run.',
        action: { label: 'Go to Usage', onClick: () => navigate('/usage') },
      })
    }
  }, [data, budget, navigate])

  return null
}
