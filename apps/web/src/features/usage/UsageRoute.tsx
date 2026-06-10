/**
 * UsageRoute — the Usage surface route element (mounted at `/usage`). Owns the
 * period (7/14/30) selection and the react-query fetch, then hands data to the
 * presentational {@link UsagePage}.
 *
 * The period lives in the URL (`?period=`) so a refresh keeps your window (it used
 * to reset to 7) and the view is deep-linkable. An absent / out-of-range value
 * falls back to the 7-day default.
 *
 * Reads ride the single app-wide QueryClient (main.tsx); the converged retry
 * policy (one retry, skip permanent 4xx) lives there, so this surface no longer
 * carries its own client.
 */
import { useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useModels } from '@/features/models/useModels'
import { CHAT_PATH } from '@/app/navigation'
import { useUsage } from './useUsage'
import { UsagePage } from './UsagePage'
import { USAGE_PERIODS, type UsagePeriod } from './types'

/** Read a `?period=` value, falling back to the 7-day default when absent/invalid. */
function resolvePeriod(raw: string | null): UsagePeriod {
  const n = Number(raw)
  return (USAGE_PERIODS as readonly number[]).includes(n) ? (n as UsagePeriod) : 7
}

export function UsageRoute() {
  const [params, setParams] = useSearchParams()
  const period = resolvePeriod(params.get('period'))
  // Change period = rewrite `?period=` (replace, so it doesn't pollute Back).
  const setPeriod = useCallback(
    (next: UsagePeriod) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          p.set('period', String(next))
          return p
        },
        { replace: true },
      )
    },
    [setParams],
  )
  const query = useUsage(period)
  // The active provider is the authoritative billing signal: a subscription/OAuth
  // seat (e.g. openai-codex) reports $0 cost even when busy, so the Usage surface
  // needs it to label cost honestly. Best-effort — usage still renders if it fails.
  const models = useModels()
  const provider = models.data?.provider
  // The empty-state "Start a chat" CTA router-navigates to Chat (matching
  // Home/History), not an `<a href="/">` hard reload.
  const navigate = useNavigate()

  return (
    <UsagePage
      period={period}
      onPeriodChange={setPeriod}
      data={query.data}
      isLoading={query.isLoading}
      isFetching={query.isFetching}
      error={query.error}
      onRetry={() => void query.refetch()}
      providerId={provider?.id}
      providerLabel={provider?.label}
      onStartChat={() => navigate(CHAT_PATH)}
    />
  )
}
