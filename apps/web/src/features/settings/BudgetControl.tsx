import { useId } from 'react'
import { Info, Wallet } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { useBudget } from '@/features/budget/budgetStore'

/**
 * BudgetControl – the "Cost" preferences group on the Settings surface.
 *
 * Lets a user set OPTIONAL soft spend caps in plain language ("Alert me if I
 * spend more than $__/day or $__/month"). Both are unset by default. When a cap
 * is crossed, the app raises a calm, once-per-breach warning toast and the
 * header burn-rate pill turns amber – it does NOT stop the agent.
 *
 * The control is deliberately honest about that limit (an explicit note), so the
 * feature never over-promises a kill switch agent-deck cannot deliver: it watches
 * a read-only usage rollup and can't halt a CLI / telegram / cron run.
 *
 * Bound to the self-contained `useBudget` store (localStorage, LOCAL-ONLY),
 * mirroring DensityControl/ComposerPrefsControl so it persists and stays live.
 */
export function BudgetControl() {
  const { budget, setDaily, setMonthly } = useBudget()
  const dailyId = useId()
  const monthlyId = useId()

  return (
    <Card className="ad-raised gap-0 py-0">
      <CardContent className="flex flex-col gap-5 p-5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-heading text-base leading-snug font-medium text-foreground">
            <Wallet className="size-4 shrink-0 text-foreground-tertiary" aria-hidden />
            Cost
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Get a heads-up before the bill surprises you. Set an optional soft budget and agent-deck
            will warn you the day you cross it.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <CapField
            id={dailyId}
            label="Alert me if I spend more than"
            unit="/ day"
            value={budget.daily}
            onChange={setDaily}
          />
          <CapField
            id={monthlyId}
            label="…or more than"
            unit="/ month"
            value={budget.monthly}
            onChange={setMonthly}
          />
        </div>

        {/* HONEST framing – this warns, it does not stop the agent. */}
        <p className="flex items-start gap-2 rounded-[8px] bg-surface-1 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0 text-foreground-tertiary" aria-hidden />
          <span>
            This is a warning, not a hard stop. agent-deck can alert you, but it can't pause a run
            started from the CLI, Telegram, or a schedule. Leave a field blank to turn that alert
            off.
          </span>
        </p>
      </CardContent>
    </Card>
  )
}

interface CapFieldProps {
  id: string
  label: string
  unit: string
  value: number | null
  onChange: (cap: number | null) => void
}

/** One soft-cap input: a labelled "$ [amount] / day|month" row. */
function CapField({ id, label, unit, value, onChange }: CapFieldProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <label htmlFor={id} className="text-sm text-foreground">
        {label}
      </label>
      <div className="ad-surface inline-flex h-9 shrink-0 items-center rounded-md bg-surface-1 pr-3 pl-3 focus-within:ring-2 focus-within:ring-ring/50">
        <span className="text-sm text-foreground-tertiary" aria-hidden>
          $
        </span>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          placeholder="–"
          // An empty field reads as "unset"; the store normalizes 0/blank to null.
          value={value ?? ''}
          onChange={(e) => {
            const raw = e.target.value.trim()
            if (raw === '') return onChange(null)
            const n = Number(raw)
            onChange(Number.isFinite(n) ? n : null)
          }}
          aria-label={`${label} dollars ${unit.replace('/', 'per').trim()}`}
          className="w-20 bg-transparent px-1.5 text-right text-sm tabular-nums text-foreground placeholder:text-foreground-tertiary focus:outline-none"
        />
        <span className="text-xs whitespace-nowrap text-muted-foreground">{unit}</span>
      </div>
    </div>
  )
}
